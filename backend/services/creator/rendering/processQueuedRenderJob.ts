/**
 * processQueuedRenderJob — Step-R4 async render worker.
 * ──────────────────────────────────────────────────────────────────────────
 * Claims one queued render job and runs the provider→moderation→output→
 * attach flow against the IMMUTABLE R1 lineage. Reuses the R0/R3 shared
 * modules (moderation gate, provider registry, contracts). R3's
 * synchronous executeRenderJob is NOT modified — this is the parallel
 * async path. Fail-closed; scheduler-isolated; image-only.
 *
 * ALL I/O via injected deps. Never throws to the caller.
 */

import { validateRenderProjection, RenderProjectionError } from './projector';
import { preRenderModeration, postRenderModeration } from './moderation/renderModerationGate';
import { computeDeterministicInputHash } from './contracts';
import type { RenderSpec, RenderProviderRegistry } from './contracts';
import {
  claimRenderJob, advanceQueueState, completeRenderJob, failRenderJob,
  type RenderQueueDeps,
} from './renderQueue';

export interface ProcessRenderDeps extends RenderQueueDeps {
  providerRegistry: RenderProviderRegistry;
}

export interface ProcessResult {
  ok: boolean;
  status: 'completed' | 'retry_scheduled' | 'failed' | 'blocked' | 'idle';
  events: string[];
  render_job_id?: string;
  output?: { output_id: string; storage_ref: string } | null;
  reason?: string;
}

async function releaseBilling(deps: ProcessRenderDeps, jobId: string, reason: string) {
  try {
    await deps.ownedDbTable('billing_operations')
      .update({ status: 'released', failure_reason: reason, completed_at: deps.now() })
      .eq('idempotency_key', `render:${jobId}`);
  } catch { /* fail-closed best-effort */ }
}

/**
 * Process at most ONE claimable job. Returns status:'idle' when the
 * queue is empty. Designed to be invoked by a cron/worker tick (no
 * websockets) — exactly-once via the queue lease.
 */
export async function processQueuedRenderJob(
  deps: ProcessRenderDeps,
  leaseOwner: string,
): Promise<ProcessResult> {
  const events: string[] = [];
  let claimed: Awaited<ReturnType<typeof claimRenderJob>> = null;
  try {
    claimed = await claimRenderJob(deps, leaseOwner);
    if (!claimed) return { ok: true, status: 'idle', events };
    events.push('render_claimed');
    const qId = claimed.id;
    const jobId = claimed.render_job_id;

    // Load immutable render lineage (spec snapshot is the source of truth).
    const { data: job } = await deps.supabase
      .from('creator_render_job')
      .select('id, render_spec_snapshot, organization_id, task_id, deterministic_input_hash')
      .eq('id', jobId).maybeSingle();
    if (!job?.id) {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'invalid_spec' });
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, reason: 'lineage_missing' };
    }

    // Re-validate the frozen spec fail-closed (never trust a raw row).
    let spec: RenderSpec;
    try {
      spec = validateRenderProjection(job.render_spec_snapshot);
    } catch (e) {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'invalid_spec' });
      await releaseBilling(deps, jobId, 'invalid_spec');
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, reason: e instanceof RenderProjectionError ? e.code : 'invalid_spec' };
    }
    if (spec.canonical_asset_family !== 'image' || spec.render_modality !== 'image') {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'image_only_this_step' });
      await releaseBilling(deps, jobId, 'image_only');
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, reason: 'image_only_this_step' };
    }

    // Provider reconciliation (failover chain; single-active head).
    await advanceQueueState(deps, qId, 'rendering');
    const chain = deps.providerRegistry.resolveProviderChain(spec);
    const provider = chain.length ? deps.providerRegistry.get(chain[0]!) : undefined;
    if (!provider || !provider.supports(spec)) {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'no_capable_provider' });
      await releaseBilling(deps, jobId, 'no_capable_provider');
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, reason: 'no_capable_provider' };
    }
    if (chain.length > 1) events.push('render_failover_selected');

    // Pre-moderation (fail-closed; NOT retryable).
    const pre = preRenderModeration(spec, spec.deterministic_input_hash);
    if (pre.decision !== 'allowed') {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'pre_moderation' });
      await releaseBilling(deps, jobId, 'pre_moderation');
      events.push('render_terminal_failure');
      return { ok: false, status: 'blocked', events, render_job_id: jobId, reason: 'pre_moderation' };
    }

    // Append-only attempt (links billing by idempotency_key).
    const { data: variant } = await deps.ownedDbTable('creator_render_variant').insert({
      render_job_id: jobId, platform: spec.platform_projection.platform,
      aspect_ratio: spec.platform_projection.aspect_ratio,
      resolution: spec.platform_projection.resolution,
      spec_fingerprint: spec.deterministic_input_hash, production_source: 'ai_render',
    }).select('id').single();
    const { data: bo } = await deps.supabase.from('billing_operations')
      .select('id').eq('idempotency_key', `render:${jobId}`).maybeSingle();
    const { data: attempt } = await deps.ownedDbTable('creator_render_attempt').insert({
      variant_id: variant.id, provider_key: provider.key,
      attempt_number: claimed.retry_count + 1,
      idempotency_key: `render:${jobId}:a${claimed.retry_count + 1}`,
      billing_operation_id: bo?.id ?? null,
      execution_hash: `${spec.deterministic_input_hash}:a${claimed.retry_count + 1}`,
      status: 'submitted',
    }).select('id').single();

    // Provider execution — failures classified transient vs terminal.
    let outRef;
    try {
      const handle = await provider.submit(spec, `render:${jobId}:a${claimed.retry_count + 1}`);
      const st = await provider.poll(handle);
      if (st.state !== 'succeeded') throw new Error(`provider_state:${st.state}`);
      outRef = await provider.fetchOutput(handle);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'provider';
      const reason = /timeout/i.test(msg) ? 'provider_timeout'
        : /network|fetch|econn/i.test(msg) ? 'provider_network'
        : /5\d\d/.test(msg) ? 'provider_5xx' : 'transient';
      await advanceQueueState(deps, qId, 'processing');
      const r = await failRenderJob(deps, {
        id: qId, retryCount: claimed.retry_count, maxRetries: claimed.retry_count + 1 < 3 ? 3 : claimed.retry_count + 1, reason,
      });
      if (r.event === 'render_retry_scheduled') {
        events.push('render_retry_scheduled');
        return { ok: false, status: 'retry_scheduled', events, render_job_id: jobId, reason };
      }
      await releaseBilling(deps, jobId, reason);
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, render_job_id: jobId, reason };
    }

    // Deterministic content hash + post-moderation (fail-closed).
    await advanceQueueState(deps, qId, 'moderation');
    const contentSha = computeDeterministicInputHash({ ref: outRef.storage_ref, spec: spec.deterministic_input_hash });
    const post = postRenderModeration({ ...outRef, content_sha256: contentSha }, pre);
    if (post.decision !== 'allowed') {
      await failRenderJob(deps, { id: qId, retryCount: claimed.retry_count, maxRetries: 0, reason: 'post_moderation' });
      await releaseBilling(deps, jobId, 'post_moderation');
      await deps.ownedDbTable('creator_render_job_state')
        .update({ current_state: 'failed_moderation_post', moderation_state: 'blocked', last_transition_at: deps.now() })
        .eq('render_job_id', jobId);
      events.push('render_terminal_failure');
      return { ok: false, status: 'blocked', events, render_job_id: jobId, reason: 'post_moderation' };
    }

    // Immutable output.
    const { data: output } = await deps.ownedDbTable('creator_render_output').insert({
      attempt_id: attempt.id, storage_ref: outRef.storage_ref, content_sha256: contentSha,
      modality: 'image', mime_type: outRef.mime_type, byte_size: outRef.byte_size ?? 0,
      version: 1, moderation_state: 'allowed',
    }).select('id, storage_ref').single();

    // Billing CONFIRM.
    try {
      await deps.ownedDbTable('billing_operations')
        .update({ status: 'confirmed', completed_at: deps.now() })
        .eq('idempotency_key', `render:${jobId}`);
    } catch { /* advisory */ }

    // Shared-media lineage attach (Step-15/16 auto-propagation).
    try {
      await deps.ownedDbTable('content_core_asset').upsert({
        content_core_id: job.task_id, asset_id: output.id, asset_type: 'image',
        canonical_asset_family: 'image', content_spec_hash: spec.deterministic_input_hash,
        asset_url: output.storage_ref, organization_id: job.organization_id,
      }, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
      await deps.ownedDbTable('content_asset_attachment').upsert({
        content_core_id: job.task_id, asset_id: output.id, attachment_role: 'primary',
        override_policy: 'inherit_all', compatibility_policy: 'registry', updated_at: deps.now(),
      }, { onConflict: 'content_core_id,asset_id,attachment_role', ignoreDuplicates: true });
    } catch { /* best-effort */ }

    await deps.ownedDbTable('creator_render_job_state')
      .update({ current_state: 'attached', moderation_state: 'post_passed', attached_output_id: output.id, last_transition_at: deps.now() })
      .eq('render_job_id', jobId);

    await completeRenderJob(deps, qId);
    events.push('render_completed_async');
    return { ok: true, status: 'completed', events, render_job_id: jobId, output: { output_id: output.id, storage_ref: output.storage_ref } };
  } catch (e) {
    // Hard fail-closed: never throw; release billing if we had claimed.
    if (claimed) {
      await failRenderJob(deps, { id: claimed.id, retryCount: claimed.retry_count, maxRetries: 0, reason: 'unexpected' });
      await releaseBilling(deps, claimed.render_job_id, 'unexpected');
    }
    events.push('render_terminal_failure');
    return { ok: false, status: 'failed', events, reason: e instanceof Error ? e.message : 'unexpected' };
  }
}
