/**
 * F5 — AI send boundary + bulk AI safety.
 *
 * Generation-time checks are necessarily advisory: an unbounded think-time
 * window separates "user clicked AI" from "user clicked Send". In between, the
 * company may answer the thread from another operator, another connected
 * account, or the browser extension. The draft is then stale, and sending it
 * posts a reply to a conversation nobody is waiting on.
 *
 * The invariant under test:
 *   the LAST server-side write is where actionability is authoritative.
 *
 * Companion file: engagementAiActionabilityF5.test.ts covers the canonical
 * accessor and the generation chokepoint.
 */

// ── Controlled canonical state ───────────────────────────────────────────────
// The derivation itself is proven against a real in-memory database in the
// companion file. Here it is a controllable input so the race can be staged
// deterministically: what matters is that the send boundary ASKS, and obeys.
const actionableThreads = new Set<string>();
const isThreadActionableMock = jest.fn(
  async (_org: string, threadId: string) => actionableThreads.has(threadId),
);
const getThreadActionabilityMock = jest.fn(
  async (_org: string, ids: string[]) =>
    new Map(ids.map((id) => [id, actionableThreads.has(id)])),
);
jest.mock('../../services/engagementThreadService', () => ({
  isThreadActionable: (...a: [string, string]) => isThreadActionableMock(...a),
  getThreadActionability: (...a: [string, string[]]) => getThreadActionabilityMock(...a),
}));

// ── In-memory rows for the reply route ───────────────────────────────────────
interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_messages: [], engagement_threads: [], engagement_authors: [],
  ai_message_drafts: [], comment_replies: [],
};

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { filters.push([c, v]); return api; },
    in() { return api; },
    order() { return api; }, limit() { return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    single() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    update(patch: Row) {
      const upd: any = {
        eq(c: string, v: unknown) { filters.push([c, v]); return upd; },
        then(res: (v: unknown) => unknown) {
          for (const r of rows()) Object.assign(r, patch);
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return upd;
    },
    upsert(row: Row) { (db[table] ??= []).push(row); return Promise.resolve({ error: null }); },
    insert(row: Row) {
      (db[table] ??= []).push(row);
      const ins: any = {
        select() { return ins; },
        single() { return Promise.resolve({ data: row, error: null }); },
        then(res: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(res); },
      };
      return ins;
    },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));

// ── Route scaffolding ────────────────────────────────────────────────────────
const ORG = 'org_eng';
const USER = 'user_1';

jest.mock('@/lib/api/withContract', () => ({ withContract: (h: unknown) => h }));
jest.mock('../../../lib/api/withContract', () => ({ withContract: (h: unknown) => h }), { virtual: true });
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: USER, defaultCompanyId: ORG }),
  enforceCompanyAccess: async () => ({ userId: USER }),
}));
jest.mock('../../services/rbacService', () => ({
  enforceRole: async () => ({ userId: USER }),
}));
// The capability table is built from a Role enum that does not resolve under
// the unit-test module graph. Role membership is not what these tests are
// about — enforceRole is stubbed above — so the table is stubbed to match.
jest.mock('../../services/rbac/communityAiCapabilities', () => ({
  COMMUNITY_AI_CAPABILITIES: { EXECUTE_ACTIONS: ['SUPER_ADMIN'], VIEW_ACTIONS: ['SUPER_ADMIN'] },
}));

const executeActionMock = jest.fn(async () => ({
  ok: true, status: 'executed', platform_id: 'urn:li:comment:999', correlation_id: 'corr-1', response: {},
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: (...a: unknown[]) => executeActionMock(...(a as [])),
}));
jest.mock('../../services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'api' }),
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/aiSuggestionTrackingService', () => ({ recordSuggestionAccepted: async () => undefined }));
jest.mock('../../services/engagementThreadEventService', () => ({ recordThreadEvent: async () => undefined }));

import replyHandler from '../../../pages/api/engagement/reply';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

const THREAD = 't1';
const MESSAGE = 'm1';
const DRAFT = 'draft-1';

function seed() {
  db.engagement_messages = [{
    id: MESSAGE, thread_id: THREAD, platform_message_id: 'urn:li:comment:1',
    post_comment_id: null, platform: 'linkedin', message_type: 'comment',
    author_id: null, raw_payload: {},
  }];
  db.engagement_threads = [{
    id: THREAD, organization_id: ORG, platform_thread_id: 'urn:li:share:1', raw_payload: {},
  }];
  db.ai_message_drafts = [{
    id: DRAFT, thread_id: THREAD, platform: 'linkedin', status: 'draft', generated_text: 'hi',
  }];
  db.comment_replies = [];
}

async function send(body: Record<string, unknown>) {
  const res = mockRes();
  await (replyHandler as any)({ method: 'POST', body, headers: {} }, res);
  return res;
}

const AI_SEND = {
  organization_id: ORG, thread_id: THREAD, message_id: MESSAGE,
  platform: 'linkedin', reply_text: 'Sounds good — Tuesday works.',
  ai_generated: true, ai_draft_id: DRAFT,
};

beforeEach(() => {
  seed();
  actionableThreads.clear();
  executeActionMock.mockClear();
  isThreadActionableMock.mockClear();
  getThreadActionabilityMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AI send boundary', () => {
  it('sends when the thread is still awaiting a reply', async () => {
    actionableThreads.add(THREAD);
    const res = await send(AI_SEND);
    expect(res.statusCode).toBe(200);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('C: a draft generated earlier is REFUSED after the company has replied', async () => {
    // T2 — user clicks AI while the thread is actionable.
    actionableThreads.add(THREAD);
    // T3 — someone answers the thread from another surface.
    actionableThreads.delete(THREAD);
    // T5 — the stale draft is submitted.
    const res = await send(AI_SEND);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('THREAD_NOT_ACTIONABLE');
    expect(executeActionMock).not.toHaveBeenCalled();       // nothing left the building
  });

  it('C2: a refused send does NOT promote the draft to approved', async () => {
    const res = await send(AI_SEND);
    expect(res.statusCode).toBe(409);
    // The draft must stay reusable: if the counterparty replies again, the
    // operator should be able to send it without regenerating.
    expect(db.ai_message_drafts[0].status).toBe('draft');
    expect(db.ai_message_drafts[0].approved_by).toBeUndefined();
  });

  it('C3: no reply is mirrored into engagement_messages on refusal', async () => {
    const before = db.engagement_messages.length;
    await send(AI_SEND);
    // A mirrored self-reply would itself flip actionability — a refused send
    // that still writes would corrupt the very state it was protecting.
    expect(db.engagement_messages).toHaveLength(before);
    expect(db.comment_replies).toHaveLength(0);
  });

  it('the guard consults canonical state — it does not re-derive ownership', async () => {
    actionableThreads.add(THREAD);
    await send(AI_SEND);
    expect(isThreadActionableMock).toHaveBeenCalledWith(ORG, THREAD);
  });

  it('D: once the external party replies again, the same draft sends', async () => {
    expect((await send(AI_SEND)).statusCode).toBe(409);
    actionableThreads.add(THREAD);                          // they replied again
    const res = await send(AI_SEND);
    expect(res.statusCode).toBe(200);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('G: a send against another company\'s thread never dispatches', async () => {
    db.engagement_messages[0].thread_id = 'thread-of-another-company';
    db.engagement_threads[0].id = 'thread-of-another-company';
    db.engagement_threads[0].organization_id = 'org_rival';
    actionableThreads.add('thread-of-another-company');   // actionable for its TRUE owner

    const res = await send({ ...AI_SEND, thread_id: 'thread-of-another-company' });

    // Layering, verified rather than assumed: the pre-existing tenant guard on
    // engagement_threads.organization_id fires FIRST (403) and F5 never needs to
    // run. That ordering is correct — authorization must not be reported as a
    // product-shaped "already answered" message. The F5 guard is the backstop
    // for the case this one cannot see (see the draft-mismatch test below).
    expect(res.statusCode).toBe(403);
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it('G2: a draft pointing at a different thread than the request is refused', async () => {
    db.ai_message_drafts[0].thread_id = 'thread-of-another-company';
    actionableThreads.add(THREAD);

    const res = await send(AI_SEND);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('AI_DRAFT_THREAD_MISMATCH');
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it('I: a duplicate AI send after success cannot re-dispatch the same draft', async () => {
    actionableThreads.add(THREAD);
    expect((await send(AI_SEND)).statusCode).toBe(200);
    expect(db.ai_message_drafts[0].status).toBe('sent');

    const second = await send(AI_SEND);
    expect(second.statusCode).toBe(400);
    expect(second.body.code).toBe('AI_DRAFT_TERMINAL');
    expect(executeActionMock).toHaveBeenCalledTimes(1);      // still one dispatch
  });

  it('a manual (non-AI) reply is NOT blocked on an answered thread', async () => {
    // Deliberate scope boundary: a human writing a considered follow-up is a
    // legitimate action. The F5 invariant is about AI-authored text, and
    // blocking human follow-ups would be a behaviour regression.
    const res = await send({
      organization_id: ORG, thread_id: THREAD, message_id: MESSAGE,
      platform: 'linkedin', reply_text: 'Following up personally.',
    });
    expect(res.statusCode).toBe(200);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('ai_generated without a draft id is still rejected (pre-existing contract intact)', async () => {
    actionableThreads.add(THREAD);
    const res = await send({ ...AI_SEND, ai_draft_id: undefined });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('AI_DRAFT_REQUIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const bulkReplyThreadsMock = jest.fn(
  async (_org: string, ids: string[], getText: (t: string, m: string, p: string) => Promise<string | null>) => {
    let sent = 0; let skipped = 0;
    for (const id of ids) {
      const text = await getText(id, `msg_${id}`, 'linkedin');
      if (text) sent += 1; else skipped += 1;
    }
    return { sent, skipped, errors: [] as string[] };
  },
);
jest.mock('../../services/bulkEngagementService', () => ({
  bulkReplyThreads: (...a: unknown[]) => bulkReplyThreadsMock(...(a as [string, string[], never])),
}));
jest.mock('../../services/engagementGovernanceService', () => ({
  getControls: async () => ({ bulk_reply_enabled: true, ai_suggestions_enabled: true }),
}));
const generateReplySuggestionsMock = jest.fn(async () => ({
  suggested_replies: [{ text: 'Thanks for reaching out!' }],
}));
jest.mock('../../services/engagementAiAssistantService', () => ({
  generateReplySuggestions: (...a: unknown[]) => generateReplySuggestionsMock(...(a as [])),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}), { virtual: true });

import bulkHandler from '../../../pages/api/engagement/thread/bulk-ai-reply';

describe('bulk AI safety', () => {
  async function bulk(threadIds: string[]) {
    const res = mockRes();
    await (bulkHandler as any)(
      { method: 'POST', body: { organization_id: ORG, thread_ids: threadIds }, headers: {} },
      res,
    );
    return res;
  }

  beforeEach(() => {
    bulkReplyThreadsMock.mockClear();
    generateReplySuggestionsMock.mockClear();
    actionableThreads.clear();
  });

  it('E: a mixed batch processes only the actionable threads', async () => {
    actionableThreads.add('A');
    actionableThreads.add('C');                              // B is company-answered

    const res = await bulk(['A', 'B', 'C']);

    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.skipped_not_actionable).toBe(1);

    const forwarded = bulkReplyThreadsMock.mock.calls[0][1];
    expect(forwarded).toEqual(['A', 'C']);                   // B never reached dispatch
  });

  it('E2: no AI tokens are spent on the non-actionable thread', async () => {
    actionableThreads.add('A');
    await bulk(['A', 'B']);
    // One generation call, for A only.
    expect(generateReplySuggestionsMock).toHaveBeenCalledTimes(1);
  });

  it('F: a stale client selection cannot bypass the server-side guard', async () => {
    // The client believes all three still need replies. The server disagrees.
    const res = await bulk(['A', 'B', 'C']);
    expect(res.body.sent).toBe(0);
    expect(res.body.skipped).toBe(3);
    expect(bulkReplyThreadsMock.mock.calls[0][1]).toEqual([]);
    expect(generateReplySuggestionsMock).not.toHaveBeenCalled();
  });

  it('G: thread ids from another company are skipped, not processed', async () => {
    // getThreadActionability is org-scoped and fail-closed, so a foreign id
    // simply never reports actionable.
    actionableThreads.add('A');
    const res = await bulk(['A', 'foreign-thread']);
    expect(bulkReplyThreadsMock.mock.calls[0][1]).toEqual(['A']);
    expect(res.body.skipped_not_actionable).toBe(1);
  });

  it('the guard is asked once per batch, with the whole batch', async () => {
    actionableThreads.add('A');
    await bulk(['A', 'B', 'C']);
    expect(getThreadActionabilityMock).toHaveBeenCalledTimes(1);
    expect(getThreadActionabilityMock).toHaveBeenCalledWith(ORG, ['A', 'B', 'C']);
  });

  it('J: a generation failure is counted as a skip, never as a send', async () => {
    actionableThreads.add('A');
    generateReplySuggestionsMock.mockRejectedValueOnce(new Error('provider down'));
    const res = await bulk(['A']);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(0);
    expect(res.body.skipped).toBe(1);
  });
});
