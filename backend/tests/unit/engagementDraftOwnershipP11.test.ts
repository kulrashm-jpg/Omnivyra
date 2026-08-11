/**
 * F5-P1.1 — AI draft thread ownership.
 *
 * /api/engagement/generate-response created an `ai_message_drafts` row using a
 * client-supplied `thread_id` (or one resolved from a campaign signal, a path
 * that carries no tenant check of its own) without ever proving the thread
 * belongs to the authenticated company.
 *
 * A cross-tenant SEND was already impossible — reply.ts matches the draft's
 * thread against the resolved thread and F5's org-scoped, fail-closed
 * actionability gate rejects foreign threads. But a draft whose thread
 * relationship was never authorized should not exist in the first place.
 *
 * Every rejection assertion below checks the DRAFT TABLE, not just the HTTP
 * status: the contract is "no row", not "an error was shown".
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_threads: [],
  ai_message_drafts: [],
  engagement_messages: [],
  campaign_activity_engagement_signals: [],
};

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { filters.push([c, v]); return api; },
    order() { return api; }, limit() { return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    single() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    insert(row: Row) {
      const stored = { id: `draft_${(db[table] ?? []).length + 1}`, ...row };
      (db[table] ??= []).push(stored);
      const ins: any = {
        select() { return ins; },
        single() { return Promise.resolve({ data: stored, error: null }); },
        then(res: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(res); },
      };
      return ins;
    },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
const USER = 'user_1';

let accessAllowed = true;
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: USER, defaultCompanyId: ORG }),
  enforceCompanyAccess: async () => (accessAllowed ? { userId: USER } : null),
}));
jest.mock('@/lib/api/withContract', () => ({ withContract: (h: unknown) => h }));

const generateEngagementResponseMock = jest.fn(async () => ({
  immediate_response: 'Happy to help — here are the details.',
}));
jest.mock('../../adapters/engagement/responseAdapter', () => ({
  generateEngagementResponse: (...a: unknown[]) => generateEngagementResponseMock(...(a as [])),
}));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));

import handler from '../../../pages/api/engagement/generate-response';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

const BASE = {
  message: 'Can you share pricing?',
  platform: 'linkedin',
  engagement_type: 'comment',
};

async function post(body: Record<string, unknown>) {
  const res = mockRes();
  await (handler as any)({ method: 'POST', body: { ...BASE, ...body }, headers: {} }, res);
  return res;
}

const draftCount = () => db.ai_message_drafts.length;

beforeEach(() => {
  db.engagement_threads = [{ id: 'mine', organization_id: ORG }, { id: 'theirs', organization_id: OTHER_ORG }];
  db.ai_message_drafts = [];
  db.engagement_messages = [];
  db.campaign_activity_engagement_signals = [];
  accessAllowed = true;
  generateEngagementResponseMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P1.1 draft ownership', () => {
  it('T1: a same-company thread creates the draft', async () => {
    const res = await post({ thread_id: 'mine' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ai_draft_id).toBeTruthy();
    expect(draftCount()).toBe(1);
    expect(db.ai_message_drafts[0].thread_id).toBe('mine');
  });

  it('T2: a foreign-company thread is refused and creates NO row', async () => {
    const res = await post({ thread_id: 'theirs' });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('THREAD_ACCESS_DENIED');
    expect(draftCount()).toBe(0);
  });

  it('T3: an unknown thread fails closed with NO row', async () => {
    const res = await post({ thread_id: 'does-not-exist' });
    expect(res.statusCode).toBe(403);
    expect(draftCount()).toBe(0);
  });

  it('T4: a deleted thread fails closed with NO row', async () => {
    db.engagement_threads = db.engagement_threads.filter((t) => t.id !== 'mine');
    const res = await post({ thread_id: 'mine' });
    expect(res.statusCode).toBe(403);
    expect(draftCount()).toBe(0);
  });

  it('T2b: a thread whose organization_id is null is not treated as ownerless-and-open', async () => {
    db.engagement_threads.push({ id: 'orphan', organization_id: null });
    const res = await post({ thread_id: 'orphan' });
    expect(res.statusCode).toBe(403);
    expect(draftCount()).toBe(0);
  });

  it('T6: a client-supplied company_id cannot redirect the ownership check', async () => {
    // The authenticated default company wins; the body value is only a fallback
    // and is still membership-checked by enforceCompanyAccess.
    const res = await post({ thread_id: 'theirs', company_id: OTHER_ORG });
    expect(res.statusCode).toBe(403);
    expect(draftCount()).toBe(0);
  });

  it('the signal-resolved path is authorized too, not just the direct thread_id', async () => {
    db.campaign_activity_engagement_signals = [{ id: 'sig1', source_id: 'msg1' }];
    db.engagement_messages = [{ id: 'msg1', thread_id: 'theirs' }];
    const res = await post({ signal_id: 'sig1' });
    expect(res.statusCode).toBe(403);
    expect(draftCount()).toBe(0);
  });

  it('a signal resolving to an owned thread still creates the draft', async () => {
    db.campaign_activity_engagement_signals = [{ id: 'sig1', source_id: 'msg1' }];
    db.engagement_messages = [{ id: 'msg1', thread_id: 'mine' }];
    const res = await post({ signal_id: 'sig1' });
    expect(res.statusCode).toBe(200);
    expect(draftCount()).toBe(1);
  });

  it('tenant access is enforced before anything is generated or written', async () => {
    accessAllowed = false;
    const res = await post({ thread_id: 'mine' });
    expect(res.body).toBeNull();
    expect(generateEngagementResponseMock).not.toHaveBeenCalled();
    expect(draftCount()).toBe(0);
  });

  it('no draft is created when generation returns no immediate text', async () => {
    generateEngagementResponseMock.mockResolvedValueOnce({ jobId: 'queued-1' } as never);
    const res = await post({ thread_id: 'mine' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ai_draft_id).toBeNull();
    expect(draftCount()).toBe(0);
  });

  it('a request with no thread reference creates no draft and is not rejected', async () => {
    // Pre-existing behaviour: without a thread there is nothing to authorize
    // and nothing to attach a draft to. Unchanged by P1.1.
    const res = await post({});
    expect(res.statusCode).toBe(200);
    expect(res.body.ai_draft_id).toBeNull();
    expect(draftCount()).toBe(0);
  });
});
