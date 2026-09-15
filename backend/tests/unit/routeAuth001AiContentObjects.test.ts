/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "AI, paid calls and content" family, part 2:
 * object-id routes and voice transcription.
 *
 *  - voice/notes, voice/notes/[noteId]: voice_notes' only ownership column is
 *    campaign_id. Reads/writes are bound with requireCampaignAccess; a delete
 *    by note id loads the note and authorizes against ITS campaign; a foreign,
 *    unknown or ownerless note answers 404 identically.
 *  - content/generation-status/[jobId]: the job's recorded company_id is
 *    authorized with enforceCompanyAccess; foreign/unknown/ownerless → 404.
 *  - voice/transcribe: authenticated; a body companyId used for cost
 *    attribution is bound with enforceCompanyAccess.
 *
 * The real guard chain runs; only the DB, identity provider, BullMQ and the
 * transcription provider are faked, and the sinks are asserted untouched on
 * every denial.
 */
import {
  seed, invoke, rows, sinkCalls, writeCalls, leaksB, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockGuardAi = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/ai/aiRequestGuard', () => ({
  guardAiRequest: (...a: any[]) => mockGuardAi(...a),
  AiGuardError: class AiGuardError extends Error { status = 429; code = 'X'; retryAfterSecs = 0; },
}));
const mockCaptureCost = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureFlatProviderCost: (...a: any[]) => mockCaptureCost(...a) }));

type FakeJob = { id: string; data: any; progress: number; returnvalue: unknown; failedReason: string | null; timestamp: number; getState: () => Promise<string> };
const mockJobs: Record<string, FakeJob> = {};
const mockGetJob = jest.fn(async (queue: string, id: string) => (queue === 'content-post' ? mockJobs[id] ?? null : null));
jest.mock('../../queue/contentGenerationQueues', () => ({
  getContentQueue: (name: string) => ({ getJob: (id: string) => mockGetJob(name, id) }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const transcribe = require('../../../pages/api/voice/transcribe').default;
const notes = require('../../../pages/api/voice/notes').default;
const noteById = require('../../../pages/api/voice/notes/[noteId]').default;
const generationStatus = require('../../../pages/api/content/generation-status/[jobId]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const realFetch = global.fetch;
const mockFetch = jest.fn(async (..._a: any[]) => ({
  ok: true,
  json: async () => ({ text: 'we should post on linkedin', duration: 30, language: 'en' }),
  text: async () => '',
}));
beforeAll(() => { global.fetch = mockFetch as never; process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'; });
afterAll(() => { global.fetch = realFetch; });

const NOTES = [
  { id: 'note-a', text: 'A note', context: 'campaign', campaign_id: CAMPAIGN_A, created_at: '2026-01-02' },
  { id: 'note-b', text: `B note ${CANARY_B}`, context: 'campaign', campaign_id: CAMPAIGN_B, created_at: '2026-01-03' },
  { id: 'note-orphan', text: `orphan ${CANARY_B}`, context: 'campaign', campaign_id: null, created_at: '2026-01-04' },
];

beforeEach(() => {
  seed({ voice_notes: NOTES });
  mockGuardAi.mockClear();
  mockCaptureCost.mockClear();
  mockFetch.mockClear();
  mockGetJob.mockClear();
});

// ── voice/transcribe ────────────────────────────────────────────────────────
describe('voice/transcribe', () => {
  const audio = { audioFile: 'data:audio/webm;base64,AAAAAAAA', provider: 'whisper', context: 'campaign-planning' };
  const noSpend = () => {
    expect(mockGuardAi).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureCost).not.toHaveBeenCalled();
  };

  it('unauthenticated → 401, the transcription provider is never called', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: null, body: audio });
    expect(r.status).toBe(401);
    noSpend();
  });
  it('unauthenticated with a companyId → 401 too', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: null, body: { ...audio, companyId: CO_A } });
    expect(r.status).toBe(401);
    noSpend();
  });
  it('member of A attributing cost to company B (companyId) → 403, no spend, no cost row', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: 'A', body: { ...audio, companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(leaksB(r.body)).toBe(false);
    noSpend();
  });
  it('member of A attributing cost to company B (organization_id) → 403', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: 'A', body: { ...audio, organization_id: CO_B } });
    expect(r.status).toBe(403);
    noSpend();
  });
  it('member of A attributing to own company → 200, cost captured against CO_A', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: 'A', body: { ...audio, companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect((mockCaptureCost.mock.calls[0][0] as any).organizationId).toBe(CO_A);
  });
  it('signed-in without a company (the UI\'s call shape) → 200, unattributed', async () => {
    const r = await invoke(transcribe, { method: 'POST', as: 'A', body: audio });
    expect(r.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
    expect(mockCaptureCost).not.toHaveBeenCalled();
  });
});

// ── voice/notes GET / POST ──────────────────────────────────────────────────
describe('voice/notes GET', () => {
  it('unauthenticated → 401, voice_notes never queried', async () => {
    const r = await invoke(notes, { method: 'GET', as: null, query: { context: 'campaign', campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['voice_notes'])).toHaveLength(0);
  });
  it('member of A reading B\'s campaign → 403/404, not queried, no leak', async () => {
    const r = await invoke(notes, { method: 'GET', as: 'A', query: { context: 'campaign', campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(['voice_notes'])).toHaveLength(0);
  });
  it('no campaignId → 400 (was: every tenant\'s notes for the context)', async () => {
    const r = await invoke(notes, { method: 'GET', as: 'A', query: { context: 'campaign' } });
    expect(r.status).toBe(400);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(['voice_notes'])).toHaveLength(0);
  });
  it('member of A with own campaign → 200, only A\'s notes', async () => {
    const r = await invoke(notes, { method: 'GET', as: 'A', query: { context: 'campaign', campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(r.body.notes.map((n: any) => n.id)).toEqual(['note-a']);
    expect(leaksB(r.body)).toBe(false);
  });
});

describe('voice/notes POST', () => {
  const note = { text: 'hello', context: 'campaign' };
  it('unauthenticated → 401, nothing inserted', async () => {
    const r = await invoke(notes, { method: 'POST', as: null, body: { ...note, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(writeCalls(['voice_notes'])).toHaveLength(0);
  });
  it('member of A writing into B\'s campaign → 403/404, nothing inserted', async () => {
    const r = await invoke(notes, { method: 'POST', as: 'A', body: { ...note, campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls(['voice_notes'])).toHaveLength(0);
  });
  it('no campaignId → 400 (an ownerless note is unreachable by design)', async () => {
    const r = await invoke(notes, { method: 'POST', as: 'A', body: note });
    expect(r.status).toBe(400);
    expect(writeCalls(['voice_notes'])).toHaveLength(0);
  });
  it('member of A with own campaign → 201, stored under CAMPAIGN_A', async () => {
    const r = await invoke(notes, { method: 'POST', as: 'A', body: { ...note, id: 'note-new', campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(201);
    expect(rows('voice_notes').find((n) => n.id === 'note-new')?.campaign_id).toBe(CAMPAIGN_A);
  });
});

// ── DELETE by note id (both entry points) ───────────────────────────────────
describe.each([
  ['voice/notes?noteId=', notes],
  ['voice/notes/[noteId]', noteById],
])('%s DELETE', (_name, handler) => {
  const del = (as: 'A' | 'B' | null, noteId: string) => invoke(handler, { method: 'DELETE', as, query: { noteId } });

  it('unauthenticated → 401 before any lookup, nothing deleted', async () => {
    const r = await del(null, 'note-a');
    expect(r.status).toBe(401);
    expect(sinkCalls(['voice_notes'])).toHaveLength(0);
    expect(rows('voice_notes')).toHaveLength(3);
  });
  it('member of A deleting B\'s note → 404, B\'s note survives, no delete issued', async () => {
    const r = await del('A', 'note-b');
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
    expect(writeCalls(['voice_notes'])).toHaveLength(0);
    expect(rows('voice_notes').some((n) => n.id === 'note-b')).toBe(true);
  });
  it('foreign and unknown note ids get the SAME answer (no existence oracle)', async () => {
    const foreign = await del('A', 'note-b');
    const unknown = await del('A', UNKNOWN_ID);
    expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
  });
  it('an ownerless note (campaign_id null) cannot be deleted → 404', async () => {
    const r = await del('A', 'note-orphan');
    expect(r.status).toBe(404);
    expect(writeCalls(['voice_notes'])).toHaveLength(0);
  });
  it('member of A deleting own note → 200, delete scoped to the note\'s campaign', async () => {
    const r = await del('A', 'note-a');
    expect(r.status).toBe(200);
    expect(rows('voice_notes').map((n) => n.id)).toEqual(['note-b', 'note-orphan']);
    const [call] = writeCalls(['voice_notes']);
    expect(call.filters).toEqual({ id: 'note-a', campaign_id: CAMPAIGN_A });
  });
  it('member of B deleting own note → 200', async () => {
    expect((await del('B', 'note-b')).status).toBe(200);
  });
});

// ── content/generation-status/[jobId] ───────────────────────────────────────
describe('content/generation-status/[jobId]', () => {
  const job = (id: string, data: any, returnvalue: unknown): FakeJob => ({
    id, data, progress: 100, returnvalue, failedReason: null, timestamp: 1735000000000, getState: async () => 'completed',
  });
  beforeEach(() => {
    for (const k of Object.keys(mockJobs)) delete mockJobs[k];
    mockJobs['job-a'] = job('job-a', { company_id: CO_A }, { text: 'A result' });
    mockJobs['job-b'] = job('job-b', { company_id: CO_B }, { text: CANARY_B });
    mockJobs['job-bolt-b'] = job('job-bolt-b', { campaign_id: CAMPAIGN_B, campaign: { company_id: CO_B } }, { text: CANARY_B });
    mockJobs['job-orphan'] = job('job-orphan', { topic: 'x' }, { text: CANARY_B });
  });
  const get = (as: 'A' | 'B' | null, jobId: string) => invoke(generationStatus, { method: 'GET', as, query: { jobId } });

  it('unauthenticated → 401 before any queue lookup', async () => {
    const r = await get(null, 'job-a');
    expect(r.status).toBe(401);
    expect(mockGetJob).not.toHaveBeenCalled();
  });
  it('member of A polling B\'s job → 404, B\'s generated content not returned', async () => {
    const r = await get('A', 'job-b');
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
  });
  it('BOLT topic job (owner in data.campaign.company_id) is bound too', async () => {
    const r = await get('A', 'job-bolt-b');
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
  });
  it('foreign and unknown job ids get the SAME answer', async () => {
    const foreign = await get('A', 'job-b');
    const unknown = await get('A', UNKNOWN_ID);
    expect([foreign.status, foreign.body]).toEqual([unknown.status, unknown.body]);
  });
  it('a job with no recorded owner is not served → 404', async () => {
    const r = await get('A', 'job-orphan');
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
  });
  it('owner polls own job → 200 with its result', async () => {
    const a = await get('A', 'job-a');
    expect(a.status).toBe(200);
    expect(a.body.result).toEqual({ text: 'A result' });
    const b = await get('B', 'job-bolt-b');
    expect(b.status).toBe(200);
  });
});
