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
  | 'render_skipped_disabled' | 'media_lineage_attached'
  | 'execution_registry_unavailable' | 'execution_registry_advance_failed' | 'billing_hold_failed';

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
  /** Set on a failure that may succeed if retried as is (a transient store error). */
  retryable?: boolean;
}

/** The PostgREST client returns `{ data, error }` and does NOT throw on a database error. */
type RpcResult = { data?: unknown; error?: { code?: string; message?: string } | null };
const rpcFailure = (r: RpcResult | undefined, thrown: unknown): string | null => {
  if (thrown) return thrown instanceof Error ? thrown.message : String(thrown);
  if (r?.error) return `${r.error.code ?? 'error'}: ${r.error.message ?? 'rpc failed'}`;
  return null;
};

/**
 * Provider attempts per render job in the SYNC path (e9 ruling, K = 3). After the K-th provider failure
 * the job is failed_provider_exhausted (terminal). Nothing in the async queue picks up a sync job's
 * retry_scheduled state: the queue reads creator_render_queue_job, which the sync path never writes.
 */
export const RENDER_MAX_ATTEMPTS = 3;

/** Job states that are final for a tenant + content (guard_render_state_monotonic's terminal set). */
const RENDER_TERMINAL_STATES: ReadonlySet<string> = new Set([
  'scheduling_ready', 'handed_to_human',
  'failed_render', 'failed_moderation_pre', 'failed_moderation_post',
  'failed_provider_exhausted', 'failed_timeout',
  'cancelled_by_user', 'cancelled_superseded', 'cancelled_quota',
]);

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
    // TENANT-SCOPED KEYS. deterministic_input_hash (and spec_id = render:<hash>) are computed from the
    // CONTENT alone, with no tenant; job_execution_registry is UNIQUE (execution_hash) and
    // billing_operations is UNIQUE (idempotency_key), both GLOBAL. Keyed on the bare hash, a second
    // tenant rendering identical content would hit the first tenant's registry row and billing key.
    // Scoping both keys to the organization makes a registry entry or a key conflict mean "THIS
    // tenant, this spec" by construction (the creator_render_job dedupe is already per tenant).
    let registryHash = `${args.organizationId}:${specHash}`;
    let billingKey = `render:${args.organizationId}:${spec.spec_id}`;

    /** Record the registry transition; checked (the client does not throw), never fatal. */
    const advanceRegistry = async (status: 'completed' | 'released', error: string | null): Promise<void> => {
      let res: RpcResult | undefined; let thrown: unknown = null;
      try {
        res = await supabase.rpc('advance_job_execution', {
          p_execution_hash: registryHash, p_status: status, p_billing_operation_id: billingId, p_error: error,
        });
      } catch (e) { thrown = e ?? 'rpc threw'; }
      const failed = rpcFailure(res, thrown);
      if (failed !== null) {
        console.error('[creator-render] execution registry advance failed', { spec_id: spec.spec_id, status, error: failed });
        events.push('execution_registry_advance_failed');
      }
    };

    // 2) pre-render moderation (fail-closed)
    const pre = preRenderModeration(spec, specHash);
    if (pre.decision !== 'allowed') {
      events.push('moderation_blocked');
      return { ok: false, status: 'blocked', events, spec_id: spec.spec_id, reason: 'pre_moderation' };
    }

    // 3) dedupe, per tenant (creator_render_job UNIQUE (organization_id, deterministic_input_hash)).
    //    An existing job is resolved through ITS OWN state (never "the newest output in the table"):
    //      - attached output              -> reused (that output only);
    //      - retry_scheduled              -> RETRY under the next attempt number (below);
    //      - still in progress            -> refused render_in_progress (retryable);
    //      - terminal failure             -> refused (not retryable), never an empty "reused".
    let retryOf: { jobId: string; retryCount: number } | null = null;
    const { data: existing, error: existingError } = await supabase
      .from('creator_render_job')
      .select('id')
      .eq('organization_id', args.organizationId)
      .eq('deterministic_input_hash', specHash)
      .maybeSingle();
    if (existingError) {
      events.push('render_failed');
      return { ok: false, status: 'failed', events, spec_id: spec.spec_id, reason: 'render_state_unreadable', retryable: true };
    }
    if (existing?.id) {
      const { data: state, error: stateError } = await supabase
        .from('creator_render_job_state')
        .select('attached_output_id, current_state, retry_count')
        .eq('render_job_id', existing.id)
        .maybeSingle();
      if (stateError) {
        // CHECKED (83 GOV-SEC note): an unreadable state is refused (retryable), never read as "no output".
        events.push('render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: existing.id, reason: 'render_state_unreadable', retryable: true };
      }
      const st = (state ?? null) as { attached_output_id?: string | null; current_state?: string; retry_count?: number } | null;
      const attachedOutputId = st?.attached_output_id ?? null;
      if (attachedOutputId) {
        // SECURITY (cross-tenant): THIS job's attached output, never the newest output of any tenant.
        const { data: doneOut, error: outError } = await supabase
          .from('creator_render_output')
          .select('id, storage_ref, content_sha256, attempt_id')
          .eq('id', attachedOutputId)
          .maybeSingle();
        if (outError || !doneOut?.id) {
          events.push('render_failed');
          return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: existing.id, reason: 'render_output_unreadable', retryable: true };
        }
        events.push('duplicate_render_reused');
        await attachToSharedMedia(deps, args, specHash, doneOut.id, doneOut.storage_ref, events);
        return {
          ok: true, status: 'reused', events, spec_id: spec.spec_id, render_job_id: existing.id,
          output: { output_id: doneOut.id, storage_ref: doneOut.storage_ref, content_sha256: doneOut.content_sha256 },
          attached: true,
        };
      }
      const cs = String(st?.current_state ?? '');
      if (cs === 'retry_scheduled') {
        retryOf = { jobId: String(existing.id), retryCount: Number(st?.retry_count ?? 0) };
      } else if (RENDER_TERMINAL_STATES.has(cs)) {
        // A terminal failure (moderation, exhausted retries, or a pre-retry failed_render) is final for
        // this tenant + content: refused with its state, never an empty "reused" (there is no output).
        events.push('render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: existing.id, reason: `render_terminal:${cs || 'unknown'}`, retryable: false };
      } else {
        // queued / preparing / rendering / ... : another request is producing it right now.
        events.push('render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: existing.id, reason: 'render_in_progress', retryable: true };
      }
    }

    // 4) provider resolution (fail-closed: capability-filtered)
    const chain = providerRegistry.resolveProviderChain(spec);
    const provider = chain.length ? providerRegistry.get(chain[0]!) : undefined;
    if (!provider || !provider.supports(spec)) {
      events.push('provider_rejected');
      return { ok: false, status: 'failed', events, spec_id: spec.spec_id, reason: 'no_capable_provider' };
    }

    // 5) the JOB first (before any claim, hold or provider call), so every later failure leaves a job
    //    whose state can carry a retry. Creation is exactly-once per tenant + content by the UNIQUE job
    //    key: a concurrent first render loses here, before anything is claimed or held.
    let jobId: string;
    let variantId: string | null = null;
    if (retryOf) {
      jobId = retryOf.jobId;
      // One retry at a time: a conditional transition retry_scheduled -> preparing. A concurrent retry
      // matches no row and is refused before any claim, hold or provider call.
      const { data: moved, error: moveError } = await ownedDbTable('creator_render_job_state')
        .update({ current_state: 'preparing', active_provider: provider.key, last_transition_at: now() })
        .eq('render_job_id', jobId)
        .eq('current_state', 'retry_scheduled')
        .select('render_job_id');
      if (moveError || !Array.isArray(moved) || moved.length === 0) {
        events.push('render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: jobId, reason: 'retry_in_progress', retryable: true };
      }
      const { data: v } = await supabase
        .from('creator_render_variant')
        .select('id')
        .eq('render_job_id', jobId)
        .eq('spec_fingerprint', specHash)
        .maybeSingle();
      variantId = (v as { id?: string } | null)?.id ?? null;
    } else {
      const { data: job, error: jobError } = await ownedDbTable('creator_render_job').insert({
        blueprint_id: null, task_id: args.contentCoreId, card_id: args.contentCoreId,
        organization_id: args.organizationId, canonical_asset_family: 'image',
        render_modality: 'image', deterministic_input_hash: specHash,
        render_spec_snapshot: spec, created_by: args.createdBy ?? null,
      }).select('id').single();
      if (jobError || !job?.id) {
        const concurrent = (jobError as { code?: string } | null | undefined)?.code === '23505';
        events.push('render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, reason: concurrent ? 'render_in_progress' : 'job_insert_failed', retryable: true };
      }
      jobId = String(job.id);
      await ownedDbTable('creator_render_job_state').insert({
        render_job_id: jobId, current_state: 'preparing', active_provider: provider.key,
        moderation_state: 'pre_passed', last_transition_at: now(),
      });
      const { data: v } = await ownedDbTable('creator_render_variant').insert({
        render_job_id: jobId, platform: args.platform,
        aspect_ratio: spec.platform_projection.aspect_ratio,
        resolution: spec.platform_projection.resolution,
        spec_fingerprint: specHash, production_source: 'ai_render',
      }).select('id').single();
      variantId = (v as { id?: string } | null)?.id ?? null;
    }

    // The attempt number is part of every key below, so a retry never meets the failed attempt's
    // registry row (whose 'released' is terminal) or its released billing key.
    const attemptNumber = retryOf ? retryOf.retryCount + 1 : 1;
    if (attemptNumber > 1) {
      registryHash = `${registryHash}:a${attemptNumber}`;
      billingKey = `${billingKey}:a${attemptNumber}`;
    }

    /**
     * Every failure AFTER the job exists CONSUMES this attempt: the hold is released (never charged),
     * the registry entry is released, and the job is retry_scheduled with retry_count = attempts so
     * far, or failed_provider_exhausted at RENDER_MAX_ATTEMPTS. The next request runs attempt N+1.
     */
    const failAttempt = async (reason: string, opts: { consumeRegistry: boolean }): Promise<ExecuteRenderResult> => {
      const exhausted = attemptNumber >= RENDER_MAX_ATTEMPTS;
      await releaseBilling(reason);
      if (opts.consumeRegistry) await advanceRegistry('released', reason);
      await ownedDbTable('creator_render_job_state')
        .update({ current_state: exhausted ? 'failed_provider_exhausted' : 'retry_scheduled', retry_count: attemptNumber, last_transition_at: now() })
        .eq('render_job_id', jobId);
      events.push('render_failed');
      return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: jobId, reason: exhausted ? `${reason}:attempts_exhausted` : reason, retryable: !exhausted };
    };

    // 6) claim (checked; the client does not throw on a database error).
    {
      let claim: RpcResult | undefined; let thrown: unknown = null;
      try {
        claim = await supabase.rpc('claim_job_execution', {
          p_job_id: spec.spec_id, p_queue_name: 'creator_render_sync',
          p_execution_hash: registryHash, p_correlation_id: args.contentCoreId,
          p_idempotency_key: billingKey, p_organization_id: args.organizationId,
          p_metadata: { attempt_number: attemptNumber },
        });
      } catch (e) { thrown = e ?? 'rpc threw'; }
      const failed = rpcFailure(claim, thrown);
      if (failed !== null) {
        // Nothing was registered, so this attempt is NOT consumed: back to retry_scheduled as it was.
        console.error('[creator-render] execution registry claim failed; render refused', { spec_id: spec.spec_id, error: failed });
        await ownedDbTable('creator_render_job_state')
          .update({ current_state: 'retry_scheduled', last_transition_at: now() })
          .eq('render_job_id', jobId);
        events.push('execution_registry_unavailable', 'render_failed');
        return { ok: false, status: 'failed', events, spec_id: spec.spec_id, render_job_id: jobId, reason: 'execution_registry_unavailable', retryable: true };
      }
      if ((claim?.data as { is_terminal?: unknown } | null | undefined)?.is_terminal === true) {
        // This attempt's key already ended: consume it, so the next request runs a fresh attempt.
        console.error('[creator-render] execution registry already terminal for this attempt', { spec_id: spec.spec_id, attempt: attemptNumber });
        return failAttempt('execution_already_terminal', { consumeRegistry: false });
      }
    }

    // 7) billing HOLD (checked). billing_operations UNIQUE (idempotency_key); the key is tenant- and
    //    attempt-scoped, so a 23505 means this very attempt already holds one.
    const estimate = provider.estimateCost(spec);
    const { data: bo, error: boError } = await ownedDbTable('billing_operations').insert({
      correlation_id: args.contentCoreId, module: 'creator_render', action: 'render_image',
      organization_id: args.organizationId, actor_user_id: args.createdBy ?? null,
      idempotency_key: billingKey, amount_estimated: estimate.estimated_credits,
      status: 'held', metadata: { provider: provider.key, attempt_number: attemptNumber },
    }).select('id').single();
    billingId = bo?.id ?? null;
    if (!billingId) {
      const conflict = (boError as { code?: string } | null | undefined)?.code === '23505';
      console.error('[creator-render] billing hold not created; render refused', { spec_id: spec.spec_id, conflict, error: (boError as { message?: string } | null)?.message ?? 'no row returned' });
      events.push('billing_hold_failed');
      return failAttempt(conflict ? 'billing_hold_conflict' : 'billing_hold_unavailable', { consumeRegistry: true });
    }
    events.push('billing_hold_created');

    // 8) attempt (checked; GLOBAL UNIQUE (execution_hash) -> the tenant + attempt scoped registryHash)
    const { data: attempt, error: attemptError } = variantId
      ? await ownedDbTable('creator_render_attempt').insert({
        variant_id: variantId, provider_key: provider.key, attempt_number: attemptNumber,
        idempotency_key: billingKey, billing_operation_id: billingId,
        execution_hash: registryHash, status: 'submitted',
      }).select('id').single()
      : { data: null, error: { code: 'variant_missing', message: 'no variant row for this job' } };
    if (!attempt?.id) {
      // FAIL CLOSED BEFORE THE PROVIDER: without the attempt row the output cannot be recorded.
      console.error('[creator-render] attempt not recorded; render refused before the provider', { spec_id: spec.spec_id, attempt: attemptNumber, code: (attemptError as { code?: string } | null)?.code ?? null, error: (attemptError as { message?: string } | null)?.message ?? 'no row returned' });
      return failAttempt('attempt_insert_failed', { consumeRegistry: true });
    }
    await ownedDbTable('creator_render_job_state')
      .update({ current_state: 'rendering', last_transition_at: now() })
      .eq('render_job_id', jobId);

    // 9) provider submit -> poll -> fetch (synchronous). A provider failure consumes the attempt.
    let outRef;
    try {
      const handle = await provider.submit(spec, billingKey);
      const pst = await provider.poll(handle);
      if (pst.state !== 'succeeded') throw new Error(`provider state ${pst.state}`);
      outRef = await provider.fetchOutput(handle);
    } catch (e) {
      events.push('provider_rejected');
      return failAttempt('provider_failed', { consumeRegistry: true });
    }

    // 10) deterministic content hash
    const contentSha = computeDeterministicInputHash({ ref: outRef.storage_ref, spec: specHash });

    // 11) post-render moderation (fail-closed; unsafe NEVER attaches). TERMINAL: never retried.
    const post = postRenderModeration({ ...outRef, content_sha256: contentSha }, pre);
    if (post.decision !== 'allowed') {
      await ownedDbTable('creator_render_job_state')
        .update({ current_state: 'failed_moderation_post', moderation_state: 'blocked', last_transition_at: now() })
        .eq('render_job_id', jobId);
      await releaseBilling('post_moderation_blocked');
      await advanceRegistry('released', 'post_moderation_blocked');
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
    // The render is performed and billed; a registry failure must not fail it (e9 ruling), but it is
    // no longer silent: an event on the result and an error log.
    await advanceRegistry('completed', null);

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
