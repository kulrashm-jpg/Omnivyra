/**
 * processQueuedRenderJob — Step-R4 async render worker.
 * ──────────────────────────────────────────────────────────────────────────
 * Claims one queued render job and runs the provider→moderation→output→
 * attach flow against the IMMUTABLE R1 lineage. Reuses the R0/R3 shared
 * modules (moderation gate, provider registry, contracts). Fail-closed;
 * scheduler-isolated; image-only.
 *
 * ATTEMPTS ARE SHARED WITH THE SYNC PATH (2026-11-11, BLOCKING money fix). The worker takes the job
 * with a conditional transition on creator_render_job_state (current_state AND retry_count as read),
 * so the sync executor and this worker never run the same job at once, and attempt N's keys come from
 * job_state.retry_count + 1 and the SAME tenant-scoped execution hash as the sync path
 * (renderAttemptExecutionHash). Before this, the attempt's execution_hash was content-only against a
 * GLOBAL UNIQUE, its insert error was discarded, and the provider was called anyway: a second tenant
 * with identical content paid for a provider call and then crashed on `attempt.id`.
 *
 * Every store write before the provider is CHECKED and refuses the attempt before any paid call; every
 * failure leaves job_state with an exit (queued for a queue retry, retry_scheduled once the queue gives
 * up, or a terminal state for a spec that can never render) instead of 'queued' forever.
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
import { RENDER_TERMINAL_STATES } from './renderTerminalStates';
import { renderAttemptExecutionHash } from './renderAttemptKeys';
import { RENDER_MAX_ATTEMPTS } from './renderExecutor';

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
  /** Whether BOTH shared-media lineage writes landed (completed renders only). */
  attached?: boolean;
}

type DbResult = { data?: unknown; error?: { code?: string; message?: string } | null };
const dbFailure = (r: DbResult | undefined, thrown: unknown): string | null => {
  if (thrown) return thrown instanceof Error ? thrown.message : String(thrown);
  if (r?.error) return `${r.error.code ?? 'error'}: ${r.error.message ?? 'write failed'}`;
  return null;
};

/** Release this job's async hold; CHECKED (the client does not throw). */
async function releaseBilling(deps: ProcessRenderDeps, jobId: string, reason: string, events: string[]): Promise<void> {
  let res: DbResult | undefined; let thrown: unknown = null;
  try {
    res = await deps.ownedDbTable('billing_operations')
      .update({ status: 'released', failure_reason: reason, completed_at: deps.now() })
      .eq('idempotency_key', `render:${jobId}`);
  } catch (e) { thrown = e ?? 'update threw'; }
  const failed = dbFailure(res, thrown);
  if (failed !== null) {
    console.error('[creator-render-async] billing hold NOT released (still held, not charged)', { render_job_id: jobId, reason, error: failed });
    events.push('billing_release_failed');
  }
}

/** A job_state write; CHECKED. `onlyFrom` makes it conditional on the state it was read in. */
async function writeJobState(
  deps: ProcessRenderDeps, jobId: string, patch: Record<string, unknown>, context: string, events: string[], onlyFrom?: string,
): Promise<boolean> {
  let res: DbResult | undefined; let thrown: unknown = null;
  try {
    let q = deps.ownedDbTable('creator_render_job_state')
      .update({ ...patch, last_transition_at: deps.now() })
      .eq('render_job_id', jobId);
    if (onlyFrom !== undefined) q = q.eq('current_state', onlyFrom);
    res = await q;
  } catch (e) { thrown = e ?? 'update threw'; }
  const failed = dbFailure(res, thrown);
  if (failed !== null) {
    console.error('[creator-render-async] job state write failed', { render_job_id: jobId, context, patch, error: failed });
    events.push('render_state_write_failed');
    return false;
  }
  return true;
}

/** Job states the async worker may start an attempt from (anything else is owned or final). */
const ASYNC_STARTABLE = new Set(['queued', 'retry_scheduled']);

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
  /** Set once this worker holds the job (the conditional transition succeeded); cleared once delivered. */
  let held: { jobId: string; fromCount: number; attemptNumber: number; consumed: boolean } | null = null;
  try {
    claimed = await claimRenderJob(deps, leaseOwner);
    if (!claimed) return { ok: true, status: 'idle', events };
    events.push('render_claimed');
    const claim = claimed;
    const qId = claim.id;
    const jobId = claim.render_job_id;
    const queueMax = claim.retry_count + 1 < 3 ? 3 : claim.retry_count + 1;

    /**
     * End this attempt through the queue's own retry policy, and give job_state an exit: a queue
     * retry -> 'queued'; the queue gives up -> hold released and 'retry_scheduled' (non-terminal: the
     * sync path or a manual retry can still run it). retry_count advances only when this attempt's
     * keys were spent (its attempt row was written or refused).
     */
    const settle = async (reason: string, label: string): Promise<ProcessResult> => {
      const r = await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: queueMax, reason });
      const h = held;
      const nextCount = h ? (h.consumed ? h.attemptNumber : h.fromCount) : undefined;
      if (r.event === 'render_retry_scheduled') {
        if (h) await writeJobState(deps, jobId, { current_state: 'queued', retry_count: nextCount }, `queue_retry:${label}`, events);
        events.push('render_retry_scheduled');
        return { ok: false, status: 'retry_scheduled', events, render_job_id: jobId, reason: label };
      }
      await releaseBilling(deps, jobId, label, events);
      if (h) await writeJobState(deps, jobId, { current_state: 'retry_scheduled', retry_count: nextCount }, `queue_failed:${label}`, events);
      held = null;
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, render_job_id: jobId, reason: label };
    };
    /**
     * A failure AFTER the provider was called is judged on PROVIDER CALLS, the same budget as the sync
     * path (creator_render_attempt rows for the variant, which both paths write). The queue's own cap
     * (queueMax) always admitted one more retry, so a provider that kept failing was called, and paid
     * for, forever. A failed count read falls back to the attempt number (>= calls): it errs toward
     * stopping a paid provider.
     */
    const afterProviderCall = async (reason: string, label: string, variant: string, attemptNo: number): Promise<ProcessResult> => {
      let providerCalls = attemptNo;
      try {
        const { count, error: countError } = await deps.supabase
          .from('creator_render_attempt').select('id', { count: 'exact', head: true }).eq('variant_id', variant);
        if (!countError && typeof count === 'number') providerCalls = count;
      } catch { /* attemptNo stands: the conservative bound */ }
      if (providerCalls < RENDER_MAX_ATTEMPTS) return settle(reason, label);
      held = null;
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason: 'provider_exhausted' });
      await releaseBilling(deps, jobId, `${label}:attempts_exhausted`, events);
      await writeJobState(deps, jobId, { current_state: 'failed_provider_exhausted', retry_count: attemptNo }, `exhausted:${label}`, events);
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, render_job_id: jobId, reason: `${label}:attempts_exhausted` };
    };
    /** A failure that can never succeed for this spec: terminal job state, conditional on what was read. */
    const finalFailure = async (reason: string, jobState: string, from: string, status: 'failed' | 'blocked' = 'failed'): Promise<ProcessResult> => {
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason });
      await releaseBilling(deps, jobId, reason, events);
      await writeJobState(deps, jobId, { current_state: jobState }, `final:${reason}`, events, from);
      events.push('render_terminal_failure');
      return { ok: false, status, events, render_job_id: jobId, reason };
    };

    // Load immutable render lineage (spec snapshot is the source of truth). CHECKED.
    const { data: job, error: jobError } = await deps.supabase
      .from('creator_render_job')
      .select('id, render_spec_snapshot, organization_id, task_id, deterministic_input_hash')
      .eq('id', jobId).maybeSingle();
    if (jobError) return settle('store_unavailable', 'job_unreadable');
    if (!job?.id) {
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason: 'invalid_spec' });
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, reason: 'lineage_missing' };
    }

    // The job's state FIRST: who owns it, and is it already done?
    const { data: stRow, error: stError } = await deps.supabase
      .from('creator_render_job_state')
      .select('current_state, retry_count, attached_output_id')
      .eq('render_job_id', jobId).maybeSingle();
    if (stError) return settle('store_unavailable', 'job_state_unreadable');
    let st = stRow as { current_state?: string; retry_count?: number; attached_output_id?: string | null } | null;
    if (!st) {
      // No state row (enqueue's insert failed): create it as 'queued'; a racer loses at the PK.
      const { error: adoptError } = await deps.ownedDbTable('creator_render_job_state').insert({
        render_job_id: jobId, current_state: 'queued', retry_count: 0, last_transition_at: deps.now(),
      });
      if (adoptError) return settle('store_unavailable', 'job_state_unavailable');
      st = { current_state: 'queued', retry_count: 0, attached_output_id: null };
    }
    const cs = String(st.current_state ?? '');
    const rc = Number(st.retry_count ?? 0);
    if (cs === 'attached' && st.attached_output_id) {
      // Already rendered (e.g. by the sync path): nothing to do, and this job's async hold is not owed.
      await completeRenderJob(deps, qId);
      await releaseBilling(deps, jobId, 'already_attached', events);
      events.push('render_already_attached');
      return { ok: true, status: 'completed', events, render_job_id: jobId, reason: 'already_attached' };
    }
    if (RENDER_TERMINAL_STATES.has(cs)) {
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason: 'superseded' });
      await releaseBilling(deps, jobId, `render_terminal:${cs}`, events);
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, render_job_id: jobId, reason: `render_terminal:${cs}` };
    }
    if (!ASYNC_STARTABLE.has(cs)) {
      // The sync path (or a stale run) holds it right now: try again later, no provider call.
      return settle('job_busy', 'render_in_progress');
    }

    // Re-validate the frozen spec fail-closed (never trust a raw row). A bad spec can never render.
    let spec: RenderSpec;
    try {
      spec = validateRenderProjection(job.render_spec_snapshot);
    } catch (e) {
      const r = await finalFailure('invalid_spec', 'failed_render', cs);
      return { ...r, reason: e instanceof RenderProjectionError ? e.code : 'invalid_spec' };
    }
    if (spec.canonical_asset_family !== 'image' || spec.render_modality !== 'image') {
      return finalFailure('image_only_this_step', 'failed_render', cs);
    }

    // Provider reconciliation (failover chain; single-active head).
    const chain = deps.providerRegistry.resolveProviderChain(spec);
    const provider = chain.length ? deps.providerRegistry.get(chain[0]!) : undefined;
    if (!provider || !provider.supports(spec)) {
      // Capability can come back: terminal for this queue job, NOT for the render job (retry_scheduled).
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason: 'no_capable_provider' });
      await releaseBilling(deps, jobId, 'no_capable_provider', events);
      await writeJobState(deps, jobId, { current_state: 'retry_scheduled' }, 'no_capable_provider', events, cs);
      events.push('render_terminal_failure');
      return { ok: false, status: 'failed', events, render_job_id: jobId, reason: 'no_capable_provider' };
    }
    if (chain.length > 1) events.push('render_failover_selected');

    // Pre-moderation (fail-closed; NOT retryable).
    const pre = preRenderModeration(spec, spec.deterministic_input_hash);
    if (pre.decision !== 'allowed') {
      return finalFailure('pre_moderation', 'failed_moderation_pre', cs, 'blocked');
    }

    // TAKE THE JOB: conditional on the state AND count we read, so the sync path, a second worker or a
    // stale reader cannot run the same attempt. A loser makes no provider call.
    {
      const { data: moved, error: moveError } = await deps.ownedDbTable('creator_render_job_state')
        .update({ current_state: 'rendering', active_provider: provider.key, last_transition_at: deps.now() })
        .eq('render_job_id', jobId)
        .eq('current_state', cs)
        .eq('retry_count', rc)
        .select('render_job_id');
      if (moveError || !Array.isArray(moved) || moved.length === 0) return settle('job_busy', 'render_in_progress');
    }
    held = { jobId, fromCount: rc, attemptNumber: rc + 1, consumed: false };
    const attemptNumber = rc + 1;
    await advanceQueueState(deps, qId, 'rendering');

    // The variant (CHECKED): read it, insert it if absent, re-read after a concurrent insert. A retry
    // re-uses it (UNIQUE (render_job_id, spec_fingerprint) made the old blind re-insert throw on every
    // retry tick, so async retries never ran).
    let variantId: string | null = null;
    {
      const { data: v, error: vReadError } = await deps.supabase
        .from('creator_render_variant').select('id')
        .eq('render_job_id', jobId).eq('spec_fingerprint', spec.deterministic_input_hash).maybeSingle();
      if (vReadError) return settle('store_unavailable', 'variant_unavailable');
      variantId = (v as { id?: string } | null)?.id ?? null;
      if (!variantId) {
        const { data: vIns, error: vInsError } = await deps.ownedDbTable('creator_render_variant').insert({
          render_job_id: jobId, platform: spec.platform_projection.platform,
          aspect_ratio: spec.platform_projection.aspect_ratio,
          resolution: spec.platform_projection.resolution,
          spec_fingerprint: spec.deterministic_input_hash, production_source: 'ai_render',
        }).select('id').single();
        variantId = (vIns as { id?: string } | null)?.id ?? null;
        if (!variantId && (vInsError as { code?: string } | null)?.code === '23505') {
          const { data: v2 } = await deps.supabase
            .from('creator_render_variant').select('id')
            .eq('render_job_id', jobId).eq('spec_fingerprint', spec.deterministic_input_hash).maybeSingle();
          variantId = (v2 as { id?: string } | null)?.id ?? null;
        }
        if (!variantId) return settle('store_unavailable', 'variant_unavailable');
      }
    }

    const { data: bo, error: boError } = await deps.supabase.from('billing_operations')
      .select('id').eq('idempotency_key', `render:${jobId}`).maybeSingle();
    if (boError) return settle('store_unavailable', 'billing_unreadable');

    // Append-only attempt, CHECKED, BEFORE the provider. TENANT-SCOPED execution hash (GLOBAL UNIQUE).
    const attemptKey = `render:${jobId}:a${attemptNumber}`;
    held.consumed = true; // from here this attempt number is spent: the next attempt uses fresh keys
    const { data: attempt, error: attemptError } = await deps.ownedDbTable('creator_render_attempt').insert({
      variant_id: variantId, provider_key: provider.key,
      attempt_number: attemptNumber,
      idempotency_key: attemptKey,
      billing_operation_id: (bo as { id?: string } | null)?.id ?? null,
      execution_hash: renderAttemptExecutionHash(String(job.organization_id), spec.deterministic_input_hash, attemptNumber),
      status: 'submitted',
    }).select('id').single();
    const attemptId = (attempt as { id?: string } | null)?.id ?? null;
    if (!attemptId) {
      // FAIL CLOSED BEFORE THE PROVIDER: no paid call without the attempt row.
      console.error('[creator-render-async] attempt not recorded; refused before the provider', { render_job_id: jobId, attempt: attemptNumber, code: (attemptError as { code?: string } | null)?.code ?? null });
      return settle('attempt_insert_failed', 'attempt_insert_failed');
    }

    // Provider execution — failures classified transient vs terminal.
    let outRef;
    try {
      const handle = await provider.submit(spec, attemptKey);
      const pst = await provider.poll(handle);
      if (pst.state !== 'succeeded') throw new Error(`provider_state:${pst.state}`);
      outRef = await provider.fetchOutput(handle);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'provider';
      const reason = /timeout/i.test(msg) ? 'provider_timeout'
        : /network|fetch|econn/i.test(msg) ? 'provider_network'
        : /5\d\d/.test(msg) ? 'provider_5xx' : 'transient';
      await advanceQueueState(deps, qId, 'processing');
      return afterProviderCall(reason, reason, variantId, attemptNumber);
    }

    // Deterministic content hash + post-moderation (fail-closed).
    await advanceQueueState(deps, qId, 'moderation');
    const contentSha = computeDeterministicInputHash({ ref: outRef.storage_ref, spec: spec.deterministic_input_hash });
    const post = postRenderModeration({ ...outRef, content_sha256: contentSha }, pre);
    if (post.decision !== 'allowed') {
      held = null;
      await failRenderJob(deps, { id: qId, retryCount: claim.retry_count, maxRetries: 0, reason: 'post_moderation' });
      await releaseBilling(deps, jobId, 'post_moderation', events);
      await writeJobState(deps, jobId, { current_state: 'failed_moderation_post', moderation_state: 'blocked' }, 'post_moderation', events);
      events.push('render_terminal_failure');
      return { ok: false, status: 'blocked', events, render_job_id: jobId, reason: 'post_moderation' };
    }

    // Immutable output, CHECKED: without it nothing can be attached (a queue retry under fresh keys).
    const { data: output, error: outputError } = await deps.ownedDbTable('creator_render_output').insert({
      attempt_id: attemptId, storage_ref: outRef.storage_ref, content_sha256: contentSha,
      modality: 'image', mime_type: outRef.mime_type, byte_size: outRef.byte_size ?? 0,
      version: 1, moderation_state: 'allowed',
    }).select('id, storage_ref').single();
    const out = output as { id?: string; storage_ref?: string } | null;
    if (outputError || !out?.id) {
      console.error('[creator-render-async] output not recorded after the provider call', { render_job_id: jobId, attempt: attemptNumber, code: (outputError as { code?: string } | null)?.code ?? null });
      return afterProviderCall('output_insert_failed', 'output_insert_failed', variantId, attemptNumber);
    }
    // From here the render is delivered: nothing below releases the hold or retries.
    held = null;

    // Billing CONFIRM (checked).
    {
      let res: DbResult | undefined; let thrown: unknown = null;
      try {
        res = await deps.ownedDbTable('billing_operations')
          .update({ status: 'confirmed', amount_charged: provider.estimateCost(spec).estimated_credits, completed_at: deps.now() })
          .eq('idempotency_key', `render:${jobId}`);
      } catch (e) { thrown = e ?? 'update threw'; }
      const failed = dbFailure(res, thrown);
      if (failed !== null) {
        console.error('[creator-render-async] billing confirm failed for a delivered render (hold still held)', { render_job_id: jobId, error: failed });
        events.push('billing_confirm_failed');
      } else {
        events.push('billing_confirmed');
      }
    }

    // Shared-media lineage attach (Step-15/16 auto-propagation), CHECKED.
    let attached = false;
    try {
      const { error: coreError } = await deps.ownedDbTable('content_core_asset').upsert({
        content_core_id: job.task_id, asset_id: out.id, asset_type: 'image',
        canonical_asset_family: 'image', content_spec_hash: spec.deterministic_input_hash,
        asset_url: out.storage_ref, organization_id: job.organization_id,
      }, { onConflict: 'content_core_id,asset_id', ignoreDuplicates: true });
      if (coreError) throw coreError;
      const { error: attachError } = await deps.ownedDbTable('content_asset_attachment').upsert({
        content_core_id: job.task_id, asset_id: out.id, attachment_role: 'primary',
        override_policy: 'inherit_all', compatibility_policy: 'registry', updated_at: deps.now(),
      }, { onConflict: 'content_core_id,asset_id,attachment_role', ignoreDuplicates: true });
      if (attachError) throw attachError;
      attached = true;
      events.push('media_lineage_attached');
    } catch (e) {
      console.error('[creator-render-async] shared-media lineage write failed', { render_job_id: jobId, asset_id: out.id, code: (e as { code?: string } | null)?.code ?? null });
      events.push('media_lineage_attach_failed');
    }

    await writeJobState(deps, jobId, { current_state: 'attached', moderation_state: 'post_passed', attached_output_id: out.id }, 'attached', events);

    await completeRenderJob(deps, qId);
    events.push('render_completed_async');
    return { ok: true, status: 'completed', events, render_job_id: jobId, output: { output_id: out.id, storage_ref: String(out.storage_ref) }, attached };
  } catch (e) {
    // Hard fail-closed: never throw. Release billing if we had claimed; give the job state an exit.
    console.error('[creator-render-async] unexpected error', { error: e instanceof Error ? e.message : String(e) });
    if (claimed) {
      await failRenderJob(deps, { id: claimed.id, retryCount: claimed.retry_count, maxRetries: 0, reason: 'unexpected' });
      await releaseBilling(deps, claimed.render_job_id, 'unexpected', events);
      const h = held as { jobId: string; fromCount: number; attemptNumber: number; consumed: boolean } | null;
      if (h) {
        await writeJobState(deps, h.jobId, { current_state: 'retry_scheduled', retry_count: h.consumed ? h.attemptNumber : h.fromCount }, 'unexpected', events);
      }
    }
    events.push('render_terminal_failure');
    return { ok: false, status: 'failed', events, reason: e instanceof Error ? e.message : 'unexpected' };
  }
}
