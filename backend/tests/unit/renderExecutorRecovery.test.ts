/**
 * 05 residual D (2026-11-11): the sync dedupe RECOVERS a job whose state write failed after its output
 * landed, through the job's OWN variant -> attempt -> output, instead of answering render_in_progress
 * forever. Two real requests against ONE stateful store that enforces the real UNIQUE keys.
 */
import { executeRenderJob, createRenderProviderRegistry } from '../../services/creator/rendering';
import type { RenderProvider } from '../../services/creator/rendering';
import { makeStore, NOW, type RenderStore } from '../helpers/renderStateStore';

const FLAG = 'ENABLE_CREATOR_RENDERING';
const TASK = {
  asset_family: 'image',
  production_context: {
    asset_family: 'image',
    storyboard: [{ subject: 'a calm modern office, data dashboard on screen' }],
    overlays: ['Turn data into decisions'],
    pacing_guidance: '', scene_direction: 'clean corporate photography, soft light',
  },
  packaging_context: { caption: 'From data to decisions' },
};
const args = (org: string) => ({ workspaceTaskLike: TASK, platform: 'instagram', organizationId: org, contentCoreId: `core-${org}`, createdBy: 'u1' });

function provider() {
  const calls = { submit: 0 };
  const p: RenderProvider = {
    key: 'openai',
    capabilities: () => ({ modalities: ['image'], max_duration_sec: 0, resolutions: [{ w: 1024, h: 1024 }, { w: 1080, h: 1080 }, { w: 1080, h: 1350 }], aspect_ratios: ['1:1', '4:5', '9:16', '16:9'], supports_seed: false, supports_audio: false, supports_overlay_text: false, supports_batch: false, max_concurrent: 2 }),
    supports: () => true,
    estimateCost: () => ({ estimated_credits: 5, currency: 'CREDITS' }),
    submit: async () => { calls.submit += 1; return { provider: 'openai', external_job_id: `x${calls.submit}`, provider_metadata: { url: `https://cdn/r${calls.submit}.png` } }; },
    poll: async (h) => ({ handle: h, state: 'succeeded', progress: 1 }),
    fetchOutput: async (h) => ({ output_id: 'o', content_sha256: '', storage_ref: String((h.provider_metadata as any).url), modality: 'image', mime_type: 'image/png', byte_size: 0, version: 1, derived_from_output_id: null }),
    cancel: async () => undefined,
  };
  return { p, calls };
}
const deps = (s: RenderStore, p: RenderProvider) => ({ supabase: s.supabase, ownedDbTable: s.ownedDbTable, now: () => NOW, providerRegistry: createRenderProviderRegistry([p]) }) as any;
const jobOf = (s: RenderStore, org: string) => s.rows('creator_render_job').find((r) => r.organization_id === org)!;
const stateOf = (s: RenderStore, jobId: string) => s.rows('creator_render_job_state').find((r) => r.render_job_id === jobId)!;

const O = process.env[FLAG];
let err: jest.SpyInstance;
beforeEach(() => { process.env[FLAG] = '1'; err = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { err.mockRestore(); if (O === undefined) delete process.env[FLAG]; else process.env[FLAG] = O; });

describe('recovery of a delivered render whose state write failed', () => {
  it('request 1 renders but its job_state writes fail; request 2 RECOVERS the output: no second provider call, no second charge', async () => {
    const s = makeStore(); const { p, calls } = provider();
    s.faults['creator_render_job_state.update'] = { code: 'XX000', message: 'down' };
    const r1 = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r1.status).toBe('completed');
    expect(r1.events).toContain('render_state_write_failed');
    const job = jobOf(s, 'org-a');
    expect(stateOf(s, job.id)).toMatchObject({ current_state: 'preparing' });
    expect(stateOf(s, job.id).attached_output_id ?? null).toBeNull();

    s.faults['creator_render_job_state.update'] = undefined;
    const r2 = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r2).toMatchObject({ ok: true, status: 'reused', render_job_id: job.id });
    expect(r2.events).toContain('render_output_recovered');
    expect(r2.output?.output_id).toBe(r1.output?.output_id);
    expect(calls.submit).toBe(1);
    expect(s.rows('billing_operations')).toHaveLength(1);
    expect(s.rows('billing_operations')[0]).toMatchObject({ status: 'confirmed' });
    expect(stateOf(s, job.id)).toMatchObject({ current_state: 'attached', attached_output_id: r1.output?.output_id });

    // And from now on it is an ordinary reuse.
    const r3 = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r3.status).toBe('reused');
    expect(r3.events).not.toContain('render_output_recovered');
    expect(calls.submit).toBe(1);
  });

  it('TENANT-BOUNDED: another tenant\'s output for the SAME content is never recovered into this tenant\'s job', async () => {
    const s = makeStore(); const { p, calls } = provider();
    expect((await executeRenderJob(deps(s, p), args('org-a'))).status).toBe('completed');
    // Tenant B's own job exists, in progress, with no output of its own.
    s.rows('creator_render_job').push({ id: 'job-b', organization_id: 'org-b', deterministic_input_hash: jobOf(s, 'org-a').deterministic_input_hash });
    s.rows('creator_render_job_state').push({ render_job_id: 'job-b', current_state: 'rendering', retry_count: 0, attached_output_id: null });
    const r = await executeRenderJob(deps(s, p), args('org-b'));
    expect(r).toMatchObject({ ok: false, reason: 'render_in_progress', retryable: true });
    expect(r.output ?? null).toBeNull();
    expect(calls.submit).toBe(1);
  });

  it('an in-progress job with NO output stays render_in_progress (recovery finds nothing, invents nothing)', async () => {
    const s = makeStore(); const { p, calls } = provider();
    s.rows('creator_render_job').push({ id: 'job-a', organization_id: 'org-a', deterministic_input_hash: '' });
    // Make the dedupe hit: reuse the hash the executor computes, by rendering once in a scratch store.
    const scratch = makeStore();
    await executeRenderJob(deps(scratch, provider().p), args('org-a'));
    s.rows('creator_render_job')[0]!.deterministic_input_hash = jobOf(scratch, 'org-a').deterministic_input_hash;
    s.rows('creator_render_job_state').push({ render_job_id: 'job-a', current_state: 'rendering', retry_count: 0, attached_output_id: null });
    const r = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r).toMatchObject({ reason: 'render_in_progress' });
    expect(calls.submit).toBe(0);
  });

  it('a recovery READ error is refused (retryable), never read as "no output"', async () => {
    const s = makeStore(); const { p, calls } = provider();
    s.faults['creator_render_job_state.update'] = { code: 'XX000', message: 'down' };
    await executeRenderJob(deps(s, p), args('org-a'));
    s.faults['creator_render_job_state.update'] = undefined;
    s.faults['creator_render_attempt.select'] = { code: '57014', message: 'timeout' };
    const r = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r).toMatchObject({ ok: false, reason: 'render_state_unreadable', retryable: true });
    expect(calls.submit).toBe(1);
  });

  it('a TERMINAL job is never "recovered" (moderation-blocked output stays blocked)', async () => {
    const s = makeStore(); const { p } = provider();
    expect((await executeRenderJob(deps(s, p), args('org-a'))).status).toBe('completed');
    const job = jobOf(s, 'org-a');
    Object.assign(stateOf(s, job.id), { current_state: 'failed_moderation_post', attached_output_id: null });
    const r = await executeRenderJob(deps(s, p), args('org-a'));
    expect(r).toMatchObject({ ok: false, reason: 'render_terminal:failed_moderation_post' });
  });
});
