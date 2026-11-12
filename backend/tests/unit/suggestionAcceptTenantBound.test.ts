/**
 * Two-id sweep (2026-11-13), BLOCKING: POST /api/engagement/reply authorized the caller for organization A and then
 * called recordSuggestionAccepted with a CALLER-SUPPLIED suggestion_id and NO organization_id. The service added the
 * tenant predicate only "when given", so a member of A could mark ANY tenant's AI suggestion accepted (poisoning the
 * accept/reject signal the intelligence layer learns from). The correlation-id fallback had the same hole.
 *
 * Fix: organization_id is REQUIRED by recordSuggestionAccepted / recordSuggestionRejected (fail closed: throws before
 * any read or write), and reply.ts passes its authorized organization on both paths.
 *
 * The REAL route and the REAL suggestion service run against the shared harness database; only identity, the
 * platform executor and unrelated side-effect services are faked.
 */
import { upsertAppendsBlindly, seed, invoke, rows, writeCalls, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

let executorCorrelationId = 'corr-unrelated';
const executeAction = jest.fn(async () => ({
  ok: true, status: 'executed', platform_id: 'urn:li:comment:999', correlation_id: executorCorrelationId, response: {},
}));
jest.mock('../../services/communityAiActionExecutor', () => ({ executeAction: (...a: unknown[]) => (executeAction as any)(...a) }));
jest.mock('../../services/engagementCapabilityMap', () => ({ resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'api' }) }));
jest.mock('../../services/engagementThreadService', () => ({
  isThreadActionable: async (org: string, thread: string) => org === 'co-a-0000-0000-0000-00000000000a' && thread === 'thr-a',
  getThreadActionability: async () => new Map(),
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/engagementThreadEventService', () => ({ recordThreadEvent: async () => undefined }));
// NOTE: aiSuggestionTrackingService is deliberately NOT mocked.

/* eslint-disable @typescript-eslint/no-var-requires */
const reply = require('../../../pages/api/engagement/reply').default;
const aiSuggestion = require('../../../pages/api/engagement/ai-suggestion').default;
const tracking = require('../../services/aiSuggestionTrackingService');
/* eslint-enable @typescript-eslint/no-var-requires */

const THREAD_A = 'thr-a';
const MSG_A = 'msg-a';
const SUG_A = 'sug-a-000-0000-0000-00000000000a';
const SUG_B = 'sug-b-000-0000-0000-00000000000b';
const CORR_A = 'corr-a-00-0000-0000-00000000000a';
const CORR_B = 'corr-b-00-0000-0000-00000000000b';

beforeEach(() => {
  seed({
    engagement_threads: [
      { id: THREAD_A, organization_id: CO_A, platform: 'linkedin', platform_thread_id: 'urn:li:share:a', raw_payload: {} },
    ],
    engagement_messages: [
      { id: MSG_A, thread_id: THREAD_A, organization_id: CO_A, platform_message_id: 'urn:li:comment:1', post_comment_id: null, platform: 'linkedin', message_type: 'comment', author_id: null, raw_payload: {} },
    ],
    ai_suggestions: [
      { id: SUG_A, organization_id: CO_A, platform: 'linkedin', action_type: 'reply', execution_correlation_id: CORR_A, accepted_at: null, rejected_at: null },
      { id: SUG_B, organization_id: CO_B, platform: 'linkedin', action_type: 'reply', execution_correlation_id: CORR_B, accepted_at: null, rejected_at: null },
    ],
  });
  upsertAppendsBlindly('engagement_messages', 'nothing — the 200 path touches this table and no assertion reads it');
  executeAction.mockClear();
  executorCorrelationId = 'corr-unrelated';
});
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});

/** reply.ts fires the accept as `void ...`; let it settle before reading the table. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const suggestion = (id: string) => rows('ai_suggestions').find((r) => r.id === id)!;
const sendAsA = (extra: Record<string, unknown> = {}) =>
  invoke(reply, {
    method: 'POST',
    headers: bearer('A'),
    body: { organization_id: CO_A, thread_id: THREAD_A, message_id: MSG_A, platform: 'linkedin', reply_text: 'Thanks!', ...extra },
  });

describe('engagement/reply — suggestion acceptance is bound to the authorized organization', () => {
  it("THE EXPLOIT (suggestion_id path): A naming B's suggestion → reply sends, B's suggestion stays UNACCEPTED", async () => {
    const r = await sendAsA({ suggestion_id: SUG_B });
    await settle();
    expect(r.status).toBe(200);
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(suggestion(SUG_B).accepted_at).toBeNull();
  });

  it("THE EXPLOIT (correlation fallback): an executor correlation id matching B's suggestion → B stays UNACCEPTED", async () => {
    executorCorrelationId = CORR_B;
    const r = await sendAsA();
    await settle();
    expect(r.status).toBe(200);
    expect(suggestion(SUG_B).accepted_at).toBeNull();
  });

  it("CONTROL (suggestion_id path): A naming A's OWN suggestion → accepted", async () => {
    const r = await sendAsA({ suggestion_id: SUG_A });
    await settle();
    expect(r.status).toBe(200);
    expect(suggestion(SUG_A).accepted_at).not.toBeNull();
    expect(suggestion(SUG_B).accepted_at).toBeNull();
  });

  it("CONTROL (correlation fallback): A's own correlation id → A's suggestion accepted", async () => {
    executorCorrelationId = CORR_A;
    const r = await sendAsA();
    await settle();
    expect(r.status).toBe(200);
    expect(suggestion(SUG_A).accepted_at).not.toBeNull();
  });
});

// MIXED IDENTIFIERS (05, 2026-11-13): correlation_id co-occurs with identity without being it. Each case asserts
// WHICH ROW ended up accepted, not just allow/deny: a wrong-row write inside the caller's own org is invisible to a
// tenant-boundary test.
describe('mixed suggestion_id / correlation_id — the suggestion_id decides, and only that row moves', () => {
  const acceptedIds = () => rows('ai_suggestions').filter((r) => r.accepted_at !== null).map((r) => r.id).sort();

  it("ai-suggestion: B's suggestion_id + A's correlation_id → 403, NOTHING accepted (not A's row via the correlation)", async () => {
    const r = await invoke(aiSuggestion, { method: 'POST', headers: bearer('A'), body: { event: 'accepted', suggestion_id: SUG_B, correlation_id: CORR_A } });
    expect(r.status).toBe(403);
    expect(acceptedIds()).toEqual([]);
  });

  it("ai-suggestion: A's suggestion_id + B's correlation_id → 200, ONLY A's suggestion accepted", async () => {
    const r = await invoke(aiSuggestion, { method: 'POST', headers: bearer('A'), body: { event: 'accepted', suggestion_id: SUG_A, correlation_id: CORR_B } });
    expect(r.status).toBe(200);
    expect(acceptedIds()).toEqual([SUG_A]);
  });

  it("reply: B's suggestion_id + an executor correlation of A's suggestion → NOTHING accepted", async () => {
    executorCorrelationId = CORR_A;
    const r = await sendAsA({ suggestion_id: SUG_B });
    await settle();
    expect(r.status).toBe(200);
    expect(acceptedIds()).toEqual([]);
  });

  it("reply: A's suggestion_id + an executor correlation of B's suggestion → ONLY A's suggestion accepted", async () => {
    executorCorrelationId = CORR_B;
    const r = await sendAsA({ suggestion_id: SUG_A });
    await settle();
    expect(r.status).toBe(200);
    expect(acceptedIds()).toEqual([SUG_A]);
  });
});

describe('aiSuggestionTrackingService — the tenant is required (fail closed)', () => {
  for (const fn of ['recordSuggestionAccepted', 'recordSuggestionRejected'] as const) {
    it(`${fn} without organization_id THROWS and writes nothing (suggestion_id and correlation paths)`, async () => {
      for (const org of [undefined, null, '', '   ']) {
        await expect(tracking[fn]({ suggestion_id: SUG_B, organization_id: org })).rejects.toThrow(/organization_id is required/);
        await expect(tracking[fn]({ correlation_id: CORR_B, organization_id: org })).rejects.toThrow(/organization_id is required/);
      }
      expect(writeCalls(['ai_suggestions'])).toHaveLength(0);
      expect(suggestion(SUG_B).accepted_at).toBeNull();
      expect(suggestion(SUG_B).rejected_at).toBeNull();
    });

    it(`${fn} with tenant A cannot touch B's suggestion (by id or by correlation id); A's own still resolves`, async () => {
      await tracking[fn]({ suggestion_id: SUG_B, organization_id: CO_A });
      await tracking[fn]({ correlation_id: CORR_B, organization_id: CO_A });
      expect(suggestion(SUG_B).accepted_at).toBeNull();
      expect(suggestion(SUG_B).rejected_at).toBeNull();
      await tracking[fn]({ suggestion_id: SUG_A, organization_id: CO_A });
      const a = suggestion(SUG_A);
      expect(fn === 'recordSuggestionAccepted' ? a.accepted_at : a.rejected_at).not.toBeNull();
    });
  }
});
