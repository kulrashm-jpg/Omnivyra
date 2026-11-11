/**
 * SEC-91A (STEP 3AH-91) — A2: POST /api/engagement/reply looked up the
 * ai_message_drafts row by id alone.
 *
 * ai_message_drafts carries no organization column (its tenant is its
 * thread's). The status / thread / platform checks answered distinct errors for
 * ANOTHER tenant's draft id — "already in terminal status=sent",
 * "thread mismatch", "platform mismatch (draft=…)" — before the org-scoped
 * actionability check ran. The draft is now bound to the authorized
 * organization through its thread first: a foreign draft is indistinguishable
 * from a missing one, and is never approved or marked sent.
 *
 * Real guard chain (resolveUserContext → enforceCompanyAccess → enforceRole)
 * against the shared harness database; the platform executor is a spy.
 */
import { upsertAppendsBlindly, seed, invoke, rows, writeCalls, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

const executeAction = jest.fn(async () => ({ ok: true, status: 'executed', platform_id: 'urn:li:comment:999', correlation_id: 'c', response: {} }));
jest.mock('../../services/communityAiActionExecutor', () => ({ executeAction: (...a: unknown[]) => (executeAction as any)(...a) }));
jest.mock('../../services/engagementCapabilityMap', () => ({ resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'api' }) }));
// Runs between the draft read and its approval / after dispatch: lets a test change
// the draft's state mid-request, as a concurrent send or rejection would.
let mockMidRequest: (() => void) | null = null;
jest.mock('../../services/engagementThreadService', () => ({
  // Actionability is org-scoped in production; here: A's thread awaits a reply.
  isThreadActionable: async (org: string, thread: string) => { mockMidRequest?.(); return org === 'co-a-0000-0000-0000-00000000000a' && thread === 'thr-a'; },
  getThreadActionability: async () => new Map(),
}));
// Signal path: campaign 'camp-a' is A's, 'camp-b' is B's.
jest.mock('../../services/campaignOwnershipService', () => ({
  resolveCampaignOwnership: async (campaignId: string) => ({
    status: 'OWNED',
    companyId: campaignId === 'camp-a' ? 'co-a-0000-0000-0000-00000000000a' : 'co-b-0000-0000-0000-00000000000b',
  }),
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/aiSuggestionTrackingService', () => ({ recordSuggestionAccepted: async () => undefined }));
jest.mock('../../services/engagementThreadEventService', () => ({ recordThreadEvent: async () => undefined }));

/* eslint-disable @typescript-eslint/no-var-requires */
const reply = require('../../../pages/api/engagement/reply').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const THREAD_A = 'thr-a';
const THREAD_B = 'thr-b';
const MSG_A = 'msg-a';
const DRAFT_A = 'draft-a';
const DRAFT_B_SENT = 'draft-b-sent';
const DRAFT_B_OPEN = 'draft-b-open';

beforeEach(() => {
  seed({
    engagement_threads: [
      { id: THREAD_A, organization_id: CO_A, platform: 'linkedin', platform_thread_id: 'urn:li:share:a', raw_payload: {} },
      { id: THREAD_B, organization_id: CO_B, platform: 'linkedin', platform_thread_id: 'urn:li:share:b', raw_payload: {} },
    ],
    engagement_messages: [
      { id: MSG_A, thread_id: THREAD_A, organization_id: CO_A, platform_message_id: 'urn:li:comment:1', post_comment_id: null, platform: 'linkedin', message_type: 'comment', author_id: null, raw_payload: {} },
    ],
    campaign_activity_engagement_signals: [
      // A's signal with NO thread (no source message): every thread source is absent.
      { id: 'sig-a-nothread', campaign_id: 'camp-a', activity_id: 'act-1', platform: 'linkedin', conversation_url: 'https://example.test/c/1', source_id: null },
      // A's signal whose source message is on THREAD_A.
      { id: 'sig-a-thread', campaign_id: 'camp-a', activity_id: 'act-2', platform: 'linkedin', conversation_url: null, source_id: MSG_A },
    ],
    ai_message_drafts: [
      { id: DRAFT_A, thread_id: THREAD_A, platform: 'linkedin', status: 'draft', generated_text: 'a' },
      { id: DRAFT_B_SENT, thread_id: THREAD_B, platform: 'instagram', status: 'sent', generated_text: 'b' },
      { id: DRAFT_B_OPEN, thread_id: THREAD_B, platform: 'linkedin', status: 'draft', generated_text: 'b' },
    ],
  });
  // UPSERT MODEL, declared explicitly rather than inherited: this suite
  // not conflict resolution. The append model performs no arbiter
  // resolution, so nothing here may be read as evidence about row
  // identity, uniqueness or tenancy through an upsert.
  //
  // THE REASON NOW SAYS WHAT THIS DECLARATION IS ACTUALLY FOR. An earlier
  // version said the suite asserts "that the dispatch write is bound to the
  // authorized organization" — an organization-binding claim, which the append
  // model cannot support and which NOTHING in this file asserts: the only
  // references to this table are the seed above and this line. Every assertion
  // here is about ai_message_drafts or the executeAction spy. The declaration
  // exists so the 200-path test is not refused for an undeclared model.
  // NOTE AN ADJACENCY, corrected. An earlier version of this comment said
  // engagement_messages is also upserted with NO options at
  // backend/queue/jobProcessors/whatsappWebhookProcessor.ts:128, and that a
  // suite driving that processor would therefore need `alsoForNoOptionsCalls`.
  // BOTH HALVES WERE WRONG: that statement passes an explicit
  // `{ onConflict: 'thread_id,platform_message_id' }` (:149). A suite that
  // starts driving the webhook processor would need
  // `resolveUpsertConflicts('engagement_messages', ['thread_id','platform_message_id'])`
  // — with those two columns present on a seeded row or in the batch, or the
  // harness answers 42P10 — and NOT the no-options acknowledgement.
  // This suite drives the reply-draft route, where the table is touched on the
  // 200 path and no assertion reads it, so append remains the honest model.
  upsertAppendsBlindly('engagement_messages', 'nothing — the 200 path touches this table and no assertion reads it');
  executeAction.mockClear();
  mockMidRequest = null;
});

const send = (draftId: string, who: Parameters<typeof bearer>[0] | null = 'A') =>
  invoke(reply, {
    method: 'POST',
    headers: who ? bearer(who) : {},
    body: {
      organization_id: CO_A, thread_id: THREAD_A, message_id: MSG_A, platform: 'linkedin',
      reply_text: 'Thanks!', ai_generated: true, ai_draft_id: draftId,
    },
  });
const draft = (id: string) => rows('ai_message_drafts').find((d) => d.id === id)!;

describe('POST /api/engagement/reply — AI draft is bound to the authorized organization', () => {
  it('unauthenticated → 401, no dispatch', async () => {
    const r = await send(DRAFT_A, null);
    expect(r.status).toBe(401);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('member of A naming company B → 403, no dispatch', async () => {
    const r = await invoke(reply, { method: 'POST', headers: bearer('A'), body: { organization_id: CO_B, message_id: MSG_A, platform: 'linkedin', reply_text: 'x', ai_generated: true, ai_draft_id: DRAFT_B_OPEN } });
    expect(r.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });

  const unknown = async () => (await send('draft-does-not-exist')).body;

  it('THE ORACLE: B\'s already-sent draft answers exactly like a missing draft (was 400 "terminal status=sent")', async () => {
    const r = await send(DRAFT_B_SENT);
    expect(r.status).toBe(404);
    expect(r.body).toEqual(await unknown());
    expect(JSON.stringify(r.body)).not.toMatch(/sent|instagram|thr-b/);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('B\'s open draft → 404, and it is never approved or marked sent', async () => {
    const r = await send(DRAFT_B_OPEN);
    expect(r.status).toBe(404);
    expect(r.body).toEqual(await unknown());
    expect(draft(DRAFT_B_OPEN).status).toBe('draft');
    expect(writeCalls(['ai_message_drafts'])).toEqual([]);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('A\'s own draft → 200, approved then sent, dispatched once', async () => {
    const r = await send(DRAFT_A);
    expect(r.status).toBe(200);
    expect(draft(DRAFT_A).status).toBe('sent');
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(draft(DRAFT_B_OPEN).status).toBe('draft');
  });
});

const sendSignal = (signalId: string, draftId: string, extra: Record<string, unknown> = {}) =>
  invoke(reply, {
    method: 'POST',
    headers: bearer('A'),
    body: { organization_id: CO_A, signal_id: signalId, platform: 'linkedin', reply_text: 'Thanks!', ai_generated: true, ai_draft_id: draftId, ...extra },
  });

describe('e9 2026-11-11 - the draft is bound to its thread UNCONDITIONALLY, and its writes are checked', () => {
  it('a CROSS-TENANT draft id with EVERY thread source absent (signal without a thread) -> 404, no write, no dispatch', async () => {
    const r = await sendSignal('sig-a-nothread', DRAFT_B_OPEN);
    expect(r.status).toBe(404);
    expect(writeCalls(['ai_message_drafts'])).toEqual([]);
    expect(draft(DRAFT_B_OPEN).status).toBe('draft');
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("A's OWN draft for THREAD_A on a signal with no thread -> 400 thread mismatch (was: approved and sent), no write, no dispatch", async () => {
    const r = await sendSignal('sig-a-nothread', DRAFT_A);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'AI_DRAFT_THREAD_MISMATCH' });
    expect(writeCalls(['ai_message_drafts'])).toEqual([]);
    expect(draft(DRAFT_A).status).toBe('draft');
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('a CLIENT-SUPPLIED thread_id cannot vouch for the draft on the signal path -> 400, no dispatch', async () => {
    const r = await sendSignal('sig-a-nothread', DRAFT_A, { thread_id: THREAD_A });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'AI_DRAFT_THREAD_MISMATCH' });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("NEGATIVE CONTROL: a signal whose source message is on the draft's thread -> 200, approved then sent, dispatched once", async () => {
    const r = await sendSignal('sig-a-thread', DRAFT_A);
    expect(r.status).toBe(200);
    expect(draft(DRAFT_A).status).toBe('sent');
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("the draft left 'draft' between the read and the approval -> 409 AI_DRAFT_STATE_CHANGED, refused BEFORE dispatch", async () => {
    mockMidRequest = () => { draft(DRAFT_A).status = 'rejected'; };
    const r = await send(DRAFT_A);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'AI_DRAFT_STATE_CHANGED' });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('dispatched but the draft could not be marked sent -> 200 (the reply went out) and an ERROR names the draft', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    executeAction.mockImplementationOnce(async () => {
      draft(DRAFT_A).status = 'rejected'; // moved after approval, before mark-sent
      return { ok: true, status: 'executed', platform_id: 'urn:li:comment:999', correlation_id: 'c', response: {} };
    });
    const r = await send(DRAFT_A);
    expect(r.status).toBe(200);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('NOT marked sent'), expect.objectContaining({ ai_draft_id: DRAFT_A }));
    err.mockRestore();
  });
});

// ── OD-6 (Phase 82) ── mechanical adoption of the harness-configuration detector.
//
// A refusal means the harness declined to MODEL a statement, so nothing ran.
// On a DENY path writeCalls() counts it, so the canonical zero-write assertion
// fails and the refusal surfaces. On a GRANT path it does not: a refused
// statement is indistinguishable from a real write to presence, payload and
// ordering assertions, and a route that catches the throw makes it silent.
//
// This is the established detector, already proven in three suites. Adopting it
// here fails the test instead of letting a swallowed refusal read as
// enforcement. It is additive: no existing hook, assertion or declaration is
// changed, and the helper is required lazily so no import statement is touched.
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
