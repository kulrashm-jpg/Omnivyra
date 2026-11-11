/**
 * Async render worker — the 2026-11-11 BLOCKING money fix (processQueuedRenderJob).
 *
 * Before: the attempt's execution_hash was `${content_hash}:a${n}` (content-only) against the GLOBAL
 * UNIQUE (execution_hash); the attempt insert's error was discarded and the provider was called anyway,
 * so a second tenant with identical content PAID for a provider call and then crashed on `attempt.id`.
 * The variant was blindly re-inserted on every retry tick (UNIQUE (render_job_id, spec_fingerprint)),
 * so async retries never ran, and a terminal failure left creator_render_job_state at 'queued' forever.
 *
 * A stateful in-memory store that ENFORCES the real UNIQUE keys (not a call recorder), so a collision
 * is a collision and a refusal is observable as "zero provider calls".
 */
import { processQueuedRenderJob, createRenderProviderRegistry } from '../../services/creator/rendering';
import type { RenderProvider } from '../../services/creator/rendering';
import { renderAttemptExecutionHash } from '../../services/creator/rendering/renderAttemptKeys';
import { makeStore, NOW, type Row } from '../helpers/renderStateStore';

const HASH = 'b'.repeat(64);
const SPEC = {
  spec_id: 'render:' + HASH,
  canonical_asset_family: 'image', render_modality: 'image',
  blueprint_projection: { asset_family: 'image', storyboard: [{ s: 1 }], overlays: [], pacing_guidance: '', scene_direction: 'clean office', visual_prompt: 'a calm office' },
  packaging_projection: { caption: 'c', overlay_text: [] },
  platform_projection: { platform: 'instagram', aspect_ratio: '1:1', resolution: { w: 1024, h: 1024 } },
  rendering_parameters: { modality: 'image' },
  moderation_context: { canonical_asset_key: 'image', is_text_like: false, moderated_text: ['a calm office'] },
  deterministic_input_hash: HASH,
};


function provider(over: Partial<RenderProvider> = {}) {
  const calls = { submit: 0, keys: [] as string[] };
  const p: RenderProvider = {
    key: 'openai',
    capabilities: () => ({ modalities: ['image'], max_duration_sec: 0, resolutions: [{ w: 1024, h: 1024 }], aspect_ratios: ['1:1'], supports_seed: false, supports_audio: false, supports_overlay_text: false, supports_batch: false, max_concurrent: 2 }),
    supports: () => true,
    estimateCost: () => ({ estimated_credits: 5, currency: 'CREDITS' }),
    submit: async (_s, key) => { calls.submit += 1; calls.keys.push(String(key)); return { provider: 'openai', external_job_id: `x${calls.submit}`, provider_metadata: { url: `https://cdn/r${calls.submit}.png` } }; },
    poll: async (h) => ({ handle: h, state: 'succeeded', progress: 1 }),
    fetchOutput: async (h) => ({ output_id: 'o', content_sha256: '', storage_ref: String((h.provider_metadata as any).url), modality: 'image', mime_type: 'image/png', byte_size: 0, version: 1, derived_from_output_id: null }),
    cancel: async () => undefined,
    ...over,
  };
  return { p, calls };
}

/** What the enqueue route writes (render-image.ts, async branch) for one tenant's job. */
function enqueue(s: ReturnType<typeof makeStore>, org: string, opts: { spec?: any; state?: Row } = {}) {
  const jobId = `job-${org}`;
  s.rows('creator_render_job').push({ id: jobId, organization_id: org, deterministic_input_hash: HASH, render_spec_snapshot: opts.spec ?? SPEC, task_id: `core-${org}` });
  s.rows('creator_render_job_state').push({ render_job_id: jobId, current_state: 'queued', retry_count: 0, attached_output_id: null, ...(opts.state ?? {}) });
  s.rows('billing_operations').push({ id: `bo-${org}`, organization_id: org, idempotency_key: `render:${jobId}`, status: 'held', amount_estimated: 5 });
  s.rows('creator_render_queue_job').push({ id: `q-${org}`, render_job_id: jobId, provider_key: 'openai', retry_count: 0, queue_state: 'queued', next_retry_at: null, created_at: NOW });
  return jobId;
}

function deps(s: ReturnType<typeof makeStore>, p: RenderProvider) {
  return { supabase: s.supabase, ownedDbTable: s.ownedDbTable, now: () => NOW, providerRegistry: createRenderProviderRegistry([p]) } as any;
}
const state = (s: ReturnType<typeof makeStore>, jobId: string) => s.rows('creator_render_job_state').find((r) => r.render_job_id === jobId)!;
const queue = (s: ReturnType<typeof makeStore>, jobId: string) => s.rows('creator_render_queue_job').find((r) => r.render_job_id === jobId)!;
const bill = (s: ReturnType<typeof makeStore>, jobId: string) => s.rows('billing_operations').filter((r) => r.idempotency_key === `render:${jobId}`);
/** Make a retry_scheduled queue job due now (backoff elapsed). */
const due = (s: ReturnType<typeof makeStore>, jobId: string) => { queue(s, jobId).next_retry_at = NOW; };

let err: jest.SpyInstance;
beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { err.mockRestore(); });

describe('attempt-insert failure: refused BEFORE any paid provider call', () => {
  it.each([
    ['a 23505 collision', { code: '23505', message: 'duplicate key value violates unique constraint' }],
    ['a transient store error', { code: '08006', message: 'connection failure' }],
  ])('%s -> zero provider calls, hold kept for the retry, job_state gets an exit (queued, number spent)', async (_l, fault) => {
    const s = makeStore(); const { p, calls } = provider();
    const jobId = enqueue(s, 'org-a');
    s.faults['creator_render_attempt.insert'] = fault;
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(calls.submit).toBe(0);
    expect(r).toMatchObject({ status: 'retry_scheduled', reason: 'attempt_insert_failed' });
    expect(state(s, jobId)).toMatchObject({ current_state: 'queued', retry_count: 1 });
    expect(queue(s, jobId).queue_state).toBe('retry_scheduled');
    expect(bill(s, jobId)[0]!.status).toBe('held');
    expect(s.rows('creator_render_output')).toHaveLength(0);
  });
});

describe('two tenants, IDENTICAL content', () => {
  it('both render, each billed once, with distinct tenant-scoped attempt keys', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const a = enqueue(s, 'org-a'); const b = enqueue(s, 'org-b');
    const r1 = await processQueuedRenderJob(deps(s, p), 'w1');
    const r2 = await processQueuedRenderJob(deps(s, p), 'w2');
    expect([r1.status, r2.status]).toEqual(['completed', 'completed']);
    expect(calls.submit).toBe(2);
    for (const j of [a, b]) {
      expect(bill(s, j)).toHaveLength(1);
      expect(bill(s, j)[0]).toMatchObject({ status: 'confirmed', amount_charged: 5 });
      expect(state(s, j)).toMatchObject({ current_state: 'attached' });
    }
    const hashes = s.rows('creator_render_attempt').map((x) => x.execution_hash).sort();
    expect(hashes).toEqual([renderAttemptExecutionHash('org-a', HASH, 1), renderAttemptExecutionHash('org-b', HASH, 1)].sort());
  });

  it('a LEGACY content-only attempt key already in the table does not block either tenant', async () => {
    const s = makeStore(); const { p, calls } = provider();
    s.rows('creator_render_attempt').push({ id: 'legacy', variant_id: 'v-legacy', attempt_number: 1, execution_hash: `${HASH}:a1` });
    const b = enqueue(s, 'org-b');
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(r.status).toBe('completed');
    expect(calls.submit).toBe(1);
    expect(bill(s, b)[0]!.status).toBe('confirmed');
  });
});

describe('a retry tick re-uses the variant and calls the provider', () => {
  it('provider fails once (transient) -> the next tick runs attempt 2 on the SAME variant, billed once', async () => {
    const s = makeStore();
    let fail = true;
    const { p, calls } = provider({ poll: async (h) => { if (fail) { fail = false; throw new Error('provider timeout'); } return { handle: h, state: 'succeeded', progress: 1 }; } });
    const jobId = enqueue(s, 'org-a');
    const r1 = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(r1).toMatchObject({ status: 'retry_scheduled', reason: 'provider_timeout' });
    expect(state(s, jobId)).toMatchObject({ current_state: 'queued', retry_count: 1 });
    due(s, jobId);
    const r2 = await processQueuedRenderJob(deps(s, p), 'w2');
    expect(r2.status).toBe('completed');
    expect(calls.submit).toBe(2);
    expect(s.rows('creator_render_variant')).toHaveLength(1);
    expect(s.rows('creator_render_attempt').map((x) => x.attempt_number)).toEqual([1, 2]);
    expect(s.rows('creator_render_attempt')[1]!.execution_hash).toBe(renderAttemptExecutionHash('org-a', HASH, 2));
    expect(bill(s, jobId)).toHaveLength(1);
    expect(bill(s, jobId)[0]!.status).toBe('confirmed');
  });
});

describe('a terminal failure never leaves job_state at queued', () => {
  it('a provider that keeps failing is called EXACTLY RENDER_MAX_ATTEMPTS (3) times, then failed_provider_exhausted (not queued, not forever)', async () => {
    const s = makeStore();
    const { p, calls } = provider({ poll: async () => { throw new Error('provider timeout'); } });
    const jobId = enqueue(s, 'org-a');
    let r = await processQueuedRenderJob(deps(s, p), 'w');
    // The old queue cap (maxRetries = retry_count + 1 once >= 2) always admitted one more: give it room to show that.
    for (let i = 0; i < 10 && r.status === 'retry_scheduled'; i += 1) { due(s, jobId); r = await processQueuedRenderJob(deps(s, p), `w${i}`); }
    expect(calls.submit).toBe(3);
    expect(r).toMatchObject({ status: 'failed', reason: 'provider_timeout:attempts_exhausted' });
    expect(queue(s, jobId).queue_state).toBe('failed');
    expect(state(s, jobId)).toMatchObject({ current_state: 'failed_provider_exhausted', retry_count: 3 });
    expect(bill(s, jobId)[0]!.status).toBe('released');
    // A later tick (e.g. the manual retry action) calls nothing: the job is terminal.
    queue(s, jobId).queue_state = 'retry_scheduled'; due(s, jobId);
    await processQueuedRenderJob(deps(s, p), 'manual');
    expect(calls.submit).toBe(3);
  });

  it('no capable provider -> queue job failed, but the render job gets a NON-terminal exit (retry_scheduled), not queued', async () => {
    const s = makeStore(); const { p, calls } = provider({ supports: () => false });
    const jobId = enqueue(s, 'org-a');
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(r).toMatchObject({ status: 'failed', reason: 'no_capable_provider' });
    expect(calls.submit).toBe(0);
    expect(state(s, jobId).current_state).toBe('retry_scheduled');
    expect(bill(s, jobId)[0]!.status).toBe('released');
  });

  it('pre-moderation -> failed_moderation_pre (terminal), no provider call', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const unsafe = { ...SPEC, moderation_context: { ...SPEC.moderation_context, moderated_text: ['nsfw explicit nude'] } };
    const jobId = enqueue(s, 'org-a', { spec: unsafe });
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(r.status).toBe('blocked');
    expect(calls.submit).toBe(0);
    expect(state(s, jobId).current_state).toBe('failed_moderation_pre');
  });

  it('an invalid frozen spec -> failed_render (terminal), no provider call', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const jobId = enqueue(s, 'org-a', { spec: { nope: true } });
    await processQueuedRenderJob(deps(s, p), 'w1');
    expect(calls.submit).toBe(0);
    expect(state(s, jobId).current_state).toBe('failed_render');
  });

  it('an output insert failure after the provider call is a queue retry under fresh keys (no freeze)', async () => {
    const s = makeStore(); const { p } = provider();
    const jobId = enqueue(s, 'org-a');
    s.faults['creator_render_output.insert'] = { code: 'XX000', message: 'down' };
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(r).toMatchObject({ status: 'retry_scheduled', reason: 'output_insert_failed' });
    expect(state(s, jobId)).toMatchObject({ current_state: 'queued', retry_count: 1 });
  });
});

describe('ownership against the sync path', () => {
  it('a job the sync path holds (rendering) is not run: zero provider calls, retried later, state untouched', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const jobId = enqueue(s, 'org-a', { state: { current_state: 'rendering', retry_count: 0 } });
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(calls.submit).toBe(0);
    expect(r).toMatchObject({ status: 'retry_scheduled', reason: 'render_in_progress' });
    expect(state(s, jobId).current_state).toBe('rendering');
  });

  it('a job already attached (rendered by the sync path) completes with no provider call, and its async hold is released', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const jobId = enqueue(s, 'org-a', { state: { current_state: 'attached', attached_output_id: 'out-x' } });
    const r = await processQueuedRenderJob(deps(s, p), 'w1');
    expect(calls.submit).toBe(0);
    expect(r).toMatchObject({ ok: true, status: 'completed', reason: 'already_attached' });
    expect(queue(s, jobId).queue_state).toBe('completed');
    expect(bill(s, jobId)[0]!.status).toBe('released');
  });

  it('the take is conditional on retry_count: a stale count moves nothing and calls nothing', async () => {
    const s = makeStore(); const { p, calls } = provider();
    const jobId = enqueue(s, 'org-a');
    // Another runner advanced the count between this worker's read and its transition.
    const realUpdate = s.ownedDbTable;
    let bumped = false;
    (s as any).ownedDbTable = (n: string) => {
      const q = realUpdate(n);
      if (n === 'creator_render_job_state' && !bumped) {
        const orig = q.update;
        q.update = (pt: Row) => { if (pt.current_state === 'rendering') { bumped = true; state(s, jobId).retry_count = 7; } return orig(pt); };
      }
      return q;
    };
    const r = await processQueuedRenderJob({ ...deps(s, p), ownedDbTable: (s as any).ownedDbTable }, 'w1');
    expect(calls.submit).toBe(0);
    expect(r.reason).toBe('render_in_progress');
  });
});

describe('renderAttemptExecutionHash', () => {
  it('matches the sync executor key shape: unsuffixed for attempt 1, :a<N> after', () => {
    expect(renderAttemptExecutionHash('org', HASH, 1)).toBe(`org:${HASH}`);
    expect(renderAttemptExecutionHash('org', HASH, 3)).toBe(`org:${HASH}:a3`);
  });
});
