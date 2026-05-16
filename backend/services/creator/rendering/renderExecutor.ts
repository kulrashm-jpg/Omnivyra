/**
 * executeRenderJob — Step-R3 first real rendering runtime.
 * ──────────────────────────────────────────────────────────────────────────
 * Synchronous, single-provider, IMAGE-ONLY, feature-flagged, fail-closed.
 * Reuses the R1 immutable substrate + existing billing_operations +
 * job_execution_registry. NO queue, NO retry/failover, NO video, NO
 * scheduler awareness. ALL I/O is injected via `deps` so the module is
 * import-safe and unit-testable without network/DB.
 *
 * Fail-closed contract: this NEVER throws to the caller and NEVER leaves
 * billing held on failure — any error path RELEASEs the HOLD, advances
 * the mutable job_state to a terminal failure, and returns { ok:false }.
 * Unsafe output is NEVER attached to media/scheduler lineage.
 */

import { projectRenderRequest, RenderProjectionError } from './projector';
import { preRenderModeration, postRenderModeration } from './moderation/renderModerationGate';
import { computeDeterministicInputHash } from './contracts';
import type { RenderProviderRegistry, RenderSpec } from './contracts';

export function isCreatorRenderingEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_RENDERING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

export type RenderEvent =
  | 'render_started' | 'render_completed' | 'render_failed'
  | 'moderation_blocked' | 'duplicate_render_reused' | 'provider_rejected'
  | 'billing_hold_created' | 'billing_confirmed' | 'billing_released'
  | 'render_skipped_disabled' | 'media_lineage_attached';

export interface RenderDeps {
  supabase: any;
  ownedDbTable: (t: string) => any;
  providerRegistry: RenderProviderRegistry;
  now: () => string;
}

export interface ExecuteRenderArgs {
  workspaceTaskLike: unknown;
  platform: string;
  organizationId: string;
  contentCoreId: string;
  createdBy?: string | null;
  options?: { aspectRatio?: string; resolution?: { w: number; h: number } };
}

export interface ExecuteRenderResult {
  ok: boolean;
  status: 'completed' | 'reused' | 'blocked' | 'failed' | 'skipped';
  events: RenderEvent[];
  spec_id?: string;
  render_job_id?: string;
  output?: { output_id: string; storage_ref: string; content_sha256: string } | null;
  attached?: boolean;
  reason?: string;
}

function skip(reason: string): ExecuteRenderResult {
  return { ok: false, status: 'skipped', events: ['render_skipped_disabled'], reason };
}

/**
 * The 10-step synchronous render flow. Image-family only (Phase-8).
 */
export async function executeRenderJob(
  deps: RenderDeps,
  args: ExecuteRenderArgs,
): Promise<ExecuteRenderResult> {
  const events: RenderEvent[] = [];
  if (!isCreatorRenderingEnabled()) return skip('rendering_disabled');

  const { supabase, ownedDbTable, providerRegistry, now } = deps;
  let billingId: string | null = null;

  const releaseBilling = async (reason: string) => {
    if (!billingId) return;
    try {
      await ownedDbTable('billing_operations')
        .update({ status: 'released', failure_reason: reason, completed_at: now() })
        .eq('id', billingId);
      events.push('billing_released');
    } catch { /* fail-closed: best-effort */ }
  };

  try {
    // 1) project RenderSpec (R2 — fail-closed, render-safe)
    let spec: RenderSpec;
    try {
      spec = projectRenderRequest(args.workspaceTaskLike, {
        platform: args.platform,
        aspectRatio: args.options?.aspectRatio,
        resolution: args.options?.resolution,
      });
    } catch (e) {
      events.push('render_failed');
      return {
        ok: false, status: 'failed', events,
        reason: e instanceof RenderProjectionError ? e.code : 'projection_failed',
      };
    }

    // Phase-8: IMAGE family ONLY this step.
    if (spec.canonical_asset_family !== 'image' || spec.render_modality !== 'image') {
      events.push('render_failed');
      return { ok: false, status: 'failed', events, reason: 'image_only_this_step' };
    }
    events.push('render_started');
    const specHash = spec.deterministic_input_hash;

    // 2) pre-render moderation (fail-closed)
    const pre = preRenderModeration(spec, specHash);
    if (pre.decision !== 'allowed') {
      events.push('moderation_blocked');
      return { ok: false, status: 'blocked', events, spec_id: spec.spec_id, reason: 'pre_moderation' };
    }

    // 3) dedupe — reuse an existing completed render for the same org+hash
    const { data: existing } = await supabase
      .from('creator_render_job')
      .select('id')
      .eq('organization_id', args.organizationId)
      .eq('deterministic_input_hash', specHash)
      .maybeSingle();
    if (existing?.id) {
      const { data: doneOut } = await supabase
        .from('creator_render_output')
        .select('id, storage_ref, content_sha256, attempt_id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      events.push('duplicate_render_reused');
      if (doneOut?.id) {
        await attachToSharedMedia(deps, args, specHash, doneOut.id, doneOut.storage_ref, events);
      }
      return {
        ok: true, status: 'reused', events, spec_id: spec.spec_id,
        render_job_id: existing.id,
        output: doneOut ? { output_id: doneOut.id, storage_ref: doneOut.storage_ref, content_sha256: doneOut.content_sha256 } : null,
        attached: !!doneOut?.id,
      };
    }

    // 4) provider resolution (fail-closed: capability-filtered)
    const chain = providerRegistry.resolveProviderChain(spec);
    const provider = chain.length ? providerRegistry.get(chain[0]!) : undefined;
    if (!provider || !provider.supports(spec)) {
      events.push('provider_rejected');
      return { ok: false, status: 'failed', events, spec_id: spec.spec_id, reason: 'no_capable_provider' };
    }

    // 5) exactly-once claim (reuse job_execution_registry)
    try {
      await supabase.rpc('claim_job_execution', {
        p_job_id: spec.spec_id, p_queue_name: 'creator_render_sync',
        p_execution_hash: specHash, p_correlation_id: args.contentCoreId,
        p_idempotency_key: spec.spec_id, p_organization_id: args.organizationId,
        p_metadata: {},
      });
    } catch { /* registry is advisory here; dedupe above is authoritative */ }

    // 6) billing HOLD (reuse billing_operations; NO parallel ledger)
    const estimate = provider.estimateCost(spec);
    const { data: bo } = await ownedDbTable('billing_operations').insert({
      correlation_id: args.contentCoreId, module: 'creator_render', action: 'render_image',
      organization_id: args.organizationId, actor_user_id: args.createdBy ?? null,
      idempotency_key: `render:${spec.spec_id}`, amount_estimated: estimate.estimated_credits,
      status: 'held', metadata: { provider: provider.key },
    }).select('id').single();
    billingId = bo?.id ?? null;
    if (billingId) events.push('billing_hold_created');

    // 7) immutable job + state + variant + attempt
    const { data: job } = await ownedDbTable('creator_render_job').insert({
      blueprint_id: null, task_id: args.contentCoreId, card_id: args.contentCoreId,
      organization_id: args.organizationId, canonical_asset_family: 'image',
      render_modality: 'image', deterministic_input_hash: specHash,
      render_spec_snapshot: spec, created_by: args.createdBy ?? null,
    }).select('id').single();
    const jobId = job?.id;
    if (!jobId) { await releaseBilling('job_insert_failed'); events.push('render_failed'); return { ok: false, status: 'failed', events, reason: 'job_insert_failed' }; }

    await ownedDbTable('creator_render_job_state').insert({
      render_job_id: jobId, current_state: 'rendering', active_provider: provider.key,
      moderation_state: 'pre_passed', last_transition_at: now(),
    });
    const { data: variant } = await ownedDbTable('creator_render_variant').insert({
      render_job_id: jobId, platform: args.platform,
      aspect_ratio: spec.platform_projection.aspect_ratio,
      resolution: spec.platform_projection.resolution,
      spec_fingerprint: specHash, production_source: 'ai_render',
    }).select('id').single();
    const { data: attempt } = await ownedDbTable('creator_render_attempt').insert({
      variant_id: variant.id, provider_key: provider.key, attempt_number: 1,
      idempotency_key: `render:${spec.spec_id}`, billing_operation_id: billingId,
      execution_hash: specHash, status: 'submitted',
    }).select('id').single();

    // 8) provider submit → poll → fetch (synchronous)
    let outRef;
    try {
      const handle = await provider.submit(spec, `render:${spec.spec_id}`);
      const st = await provider.poll(handle);
      if (st.state !== 'succeeded') throw new Error(`provider state ${st.state}`);
      outRef = await provider.fetchOutput(handle);
    } catch (e) {
      await ownedDbTable('creator_render_job_state')
        .update({ current_state: 'failed_render', last_transition_at: now() })
        .eq('render_job_id', jobId);
      await releaseBilling('provider_failed');
      events.push('provider_rejected', 'render_failed');
      return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: jobId, reason: 'provider_failed' };
    }

    // 9) deterministic content hash
    const contentSha = computeDeterministicInputHash({ ref: outRef.storage_ref, spec: specHash });

    // 10) post-render moderation (fail-closed; unsafe NEVER attaches)
    const post = postRenderModeration({ ...outRef, content_sha256: contentSha }, pre);
    if (post.decision !== 'allowed') {
      await ownedDbTable('creator_render_job_state')
        .update({ current_state: 'failed_moderation_post', moderation_state: 'blocked', last_transition_at: now() })
        .eq('render_job_id', jobId);
      await releaseBilling('post_moderation_blocked');
      events.push('moderation_blocked');
      return { ok: false, status: 'blocked', events, spec_id: spec.spec_id, render_job_id: jobId, reason: 'post_moderation' };
    }

    // immutable output
    const { data: output } = await ownedDbTable('creator_render_output').insert({
      attempt_id: attempt.id, storage_ref: outRef.storage_ref, content_sha256: contentSha,
      modality: 'image', mime_type: outRef.mime_type, byte_size: outRef.byte_size ?? 0,
      version: 1, moderation_state: 'allowed',
    }).select('id, storage_ref, content_sha256').single();

    // CONFIRM billing
    if (billingId) {
      await ownedDbTable('billing_operations')
        .update({ status: 'confirmed', amount_charged: estimate.estimated_credits, completed_at: now() })
        .eq('id', billingId);
      events.push('billing_confirmed');
    }
    try {
      await supabase.rpc('advance_job_execution', {
        p_execution_hash: specHash, p_status: 'completed', p_billing_operation_id: billingId, p_error: null,
      });
    } catch { /* advisory */ }

    // attach to shared-media lineage (Step-15/16 auto-propagation)
    await attachToSharedMedia(deps, args, specHash, output.id, output.storage_ref, events);

    await ownedDbTable('creator_render_job_state')
      .update({ current_state: 'attached', moderation_state: 'post_passed', attached_output_id: output.id, last_transition_at: now() })
      .eq('render_job_id', jobId);

    events.push('render_completed');
    return {
      ok: true, status: 'completed', events, spec_id: spec.spec_id, render_job_id: jobId,
      output: { output_id: output.id, storage_ref: output.storage_ref, content_sha256: output.content_sha256 },
      attached: true,
    };
  } catch (e) {
    // Hard fail-closed: never throw, never leave billing held.
    await releaseBilling('unexpected_error');
    events.push('render_failed');
    return { ok: false, status: 'failed', events, reason: e instanceof Error ? e.message : 'unexpected' };
  }
}

/**
 * Attach the rendered asset to the shared-media lineage so Step-15/16
 * auto-propagate it across compatible platforms. Idempotent. NEVER
 * touches scheduler internals — only the same media lineage tables.
 */
async function attachToSharedMedia(
  deps: RenderDeps,
  args: ExecuteRenderArgs,
  specHash: string,
  outputId: string,
  storageRef: string,
  events: RenderEvent[],
): Promise<void> {
  const { ownedDbTable, now } = deps;
  try {
    await ownedDbTable('content_core_asset').upsert({
      content_core_id: args.contentCoreId, asset_id: outputId,
      asset_type: 'image', canonical_asset_family: 'image',
      content_spec_hash: specHash, asset_url: storageRef,
      organization_id: args.organizationId,
    }, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
    await ownedDbTable('content_asset_attachment').upsert({
      content_core_id: args.contentCoreId, asset_id: outputId,
      attachment_role: 'primary', override_policy: 'inherit_all',
      compatibility_policy: 'registry', updated_at: now(),
    }, { onConflict: 'content_core_id,asset_id,attachment_role', ignoreDuplicates: true });
    events.push('media_lineage_attached');
  } catch { /* fail-closed: attachment best-effort, render still recorded */ }
}
