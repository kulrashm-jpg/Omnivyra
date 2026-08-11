/**
 * Bulk real-dispatch acceptance — the gaps not covered by
 * engagementBulkGovernanceP12.
 *
 * Context: bulk replies previously ran through `execution_mode: 'manual'`, which
 * the executor routes to `recordManualSimulation` — a no-op reporting
 * `{ ok: true, status: 'sent_unverified' }`. That was counted as `sent`, so both
 * bulk routes reported success while posting nothing. The fix resolves the real
 * capability and dispatches for real, which makes this an operational-risk
 * change rather than a pure bug fix.
 *
 * These tests cover what the governance suite does not: client injection of
 * dispatch parameters, DM vs comment mirror semantics, a thrown dispatch, and a
 * mixed-tenant batch.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { engagement_messages: [], engagement_threads: [] };

function builder(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const rows = () =>
    (db[table] ?? []).filter(
      (r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, v]) => v.includes(r[c])),
    );
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { eqs.push([c, v]); return api; },
    in(c: string, v: unknown[]) { ins.push([c, v]); return api; },
    order() { return api; }, limit() { return api; },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    upsert(row: Row) { (db[table] ??= []).push(row); return Promise.resolve({ error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
const USER = 'user_1';

const actionable = new Set<string>();
jest.mock('../../services/engagementThreadService', () => ({
  isThreadActionable: async (_o: string, t: string) => actionable.has(t),
  getThreadActionability: async (_o: string, ids: string[]) =>
    new Map(ids.map((i) => [i, actionable.has(i)])),
}));

// The REAL capability map — this audit is about what actually dispatches.
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));

const executeActionMock = jest.fn(async () => ({
  ok: true, status: 'executed', platform_id: 'urn:li:comment:sent', response: {},
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: (...a: unknown[]) => executeActionMock(...(a as [])),
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: async () => [{ id: 'pb1', status: 'active' }],
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/systemHealthMetricsService', () => ({ recordMetric: async () => undefined }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: USER, defaultCompanyId: ORG }),
  enforceCompanyAccess: async () => ({ userId: USER }),
}));
jest.mock('../../services/rbacService', () => ({ enforceRole: async () => ({ userId: USER }) }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({
  COMMUNITY_AI_CAPABILITIES: { EXECUTE_ACTIONS: ['SUPER_ADMIN'] },
}));
jest.mock('../../services/engagementGovernanceService', () => ({
  getControls: async () => ({ bulk_reply_enabled: true, ai_suggestions_enabled: true }),
}));
jest.mock('../../services/engagementAiAssistantService', () => ({
  generateReplySuggestions: async () => ({ suggested_replies: [{ text: 'Sending details now.' }] }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { bulkReplyThreads } from '../../services/bulkEngagementService';
import bulkAiHandler from '../../../pages/api/engagement/thread/bulk-ai-reply';
import { resolveEngagementCapability } from '../../../lib/engagementCapabilities';

function seed(threadId: string, org = ORG, platform = 'linkedin', messageType = 'comment') {
  db.engagement_threads.push({ id: threadId, organization_id: org });
  db.engagement_messages.push({
    id: `msg_${threadId}`, thread_id: threadId, platform,
    platform_message_id: `urn:${platform}:${threadId}`, post_comment_id: null,
    message_type: messageType, platform_created_at: '2026-01-10T00:00:00Z',
  });
}
const textFor = async () => 'Thanks — sending details over now.';
const outgoing = (threadId: string) =>
  db.engagement_messages.filter((m) => m.thread_id === threadId && m.direction === 'outgoing');

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

beforeEach(() => {
  db.engagement_messages = []; db.engagement_threads = [];
  actionable.clear();
  executeActionMock.mockClear();
  executeActionMock.mockResolvedValue({
    ok: true, status: 'executed', platform_id: 'urn:li:comment:sent', response: {},
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§3 per-platform dispatch mode is server-resolved', () => {
  // The blast radius of the change, stated as a test rather than prose.
  const REPLY_MODES: Array<[string, string | undefined, string]> = [
    ['linkedin', 'api', 'api_verified'],
    ['facebook', 'api', 'api_verified'],
    ['instagram', 'api', 'api_verified'],
    ['twitter', 'api', 'api_verified'],
    ['youtube', 'api', 'api_verified'],
    ['reddit', 'api', 'api_verified'],
    ['tiktok', undefined, 'unsupported'],
    ['pinterest', undefined, 'unsupported'],
    ['whatsapp', undefined, 'unsupported'],
  ];

  it.each(REPLY_MODES)('comment reply on %s → mode=%s status=%s', (platform, mode, status) => {
    const cap = resolveEngagementCapability(platform, 'reply');
    expect(cap.status).toBe(status);
    expect((cap as { mode?: string }).mode).toBe(mode);
  });

  it('DM dispatch is browser-mode where supported, never silent API', () => {
    for (const p of ['linkedin', 'facebook', 'instagram', 'twitter']) {
      expect((resolveEngagementCapability(p, 'dm') as { mode?: string }).mode).toBe('browser');
    }
    for (const p of ['youtube', 'reddit']) {
      expect(resolveEngagementCapability(p, 'dm').status).toBe('unsupported');
    }
  });

  it('an unsupported platform is skipped, never dispatched', async () => {
    seed('A', ORG, 'tiktok'); actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(0);
    expect(r.outcomes.skipped_capability).toBe(1);
    expect(executeActionMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§5 C1/C2 the client cannot choose how a reply is dispatched', () => {
  it('C1: an injected execution_mode in the request body is ignored', async () => {
    seed('A'); actionable.add('A');
    const res = mockRes();
    await (bulkAiHandler as any)(
      {
        method: 'POST',
        body: {
          organization_id: ORG,
          thread_ids: ['A'],
          execution_mode: 'manual',              // ← attempted downgrade to simulation
          capability: { status: 'api_verified', mode: 'manual' },
        },
        headers: {},
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    // Server-resolved capability wins; the simulation lane is unreachable.
    expect(executeActionMock.mock.calls[0][0].execution_mode).toBe('api');
  });

  it('C2: a DM cannot be forced onto the API path when only browser is verified', async () => {
    seed('A', ORG, 'linkedin', 'dm'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'dispatched', response: {} } as never);
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    const action = executeActionMock.mock.calls[0][0];
    expect(action.action_type).toBe('dm');
    expect(action.execution_mode).toBe('browser');
  });

  it('the bulk request contract exposes no dispatch controls at all', () => {
    // Structural, not behavioural: the fields simply are not read.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('pages/api/engagement/thread/bulk-ai-reply.ts', 'utf8');
    expect(src).not.toMatch(/body\.execution_mode|body\.capability|body\.mode/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§7 self-reply closure: comment vs DM', () => {
  it('a successful comment reply mirrors and closes the thread', async () => {
    seed('A'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    const mirrored = outgoing('A');
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].direction).toBe('outgoing');
    expect((mirrored[0].raw_payload as any).author_self).toBe(true);
    expect((mirrored[0].raw_payload as any).ingested_via).toBe('bulk_reply');
  });

  it('a DM dispatch does NOT mirror — closure depends on extension ingestion', async () => {
    seed('A', ORG, 'linkedin', 'dm'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'dispatched', response: {} } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);

    expect(r.sent).toBe(1);
    // Deliberate, matching /api/engagement/reply: a browser-queued DM has no
    // confirmed platform id yet, so fabricating a sent message would assert a
    // delivery that has not happened. The consequence is real and is reported
    // as a finding: a bulk DM does not self-close until the extension ingests
    // the sent message.
    expect(outgoing('A')).toHaveLength(0);
  });

  it('the mirror carries a stable conflict key so re-ingestion does not duplicate', async () => {
    seed('A'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(outgoing('A')[0].platform_message_id).toBe('urn:li:comment:sent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§8 failure safety', () => {
  it('a thrown dispatch does not become a successful send', async () => {
    seed('A'); actionable.add('A');
    executeActionMock.mockRejectedValueOnce(new Error('socket hang up') as never);
    await expect(bulkReplyThreads(ORG, ['A'], textFor, USER)).rejects.toThrow(/socket hang up/);
    // Nothing was written on the way out.
    expect(outgoing('A')).toHaveLength(0);
  });

  it('a provider rejection leaves the thread untouched and unclosed', async () => {
    seed('A'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: false, status: 'failed', error: 'rate limited' } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(0);
    expect(r.outcomes.failed_dispatch).toBe(1);
    expect(outgoing('A')).toHaveLength(0);
  });

  it('an unknown terminal status is treated as failure, not success', async () => {
    seed('A'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'pending', response: {} } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(0);
    expect(r.outcomes.failed_dispatch).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§10/§11/§12 accounting, limits, tenancy', () => {
  it('T2: a mixed-tenant batch resolves each thread to its own outcome', async () => {
    seed('A1'); seed('B1', OTHER_ORG); seed('A2');
    actionable.add('A1');                      // A2 answered, B1 foreign
    const r = await bulkReplyThreads(ORG, ['A1', 'B1', 'A2'], textFor, USER);

    expect(r.sent).toBe(1);
    expect(r.outcomes.sent).toBe(1);
    expect(r.outcomes.skipped_unauthorized).toBe(1);
    expect(r.outcomes.skipped_not_actionable).toBe(1);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
    expect(executeActionMock.mock.calls[0][0].target_id).toBe('urn:linkedin:A1');
  });

  it('no foreign thread content is ever read into a dispatch', async () => {
    seed('B1', OTHER_ORG); actionable.add('B1');
    await bulkReplyThreads(ORG, ['B1'], textFor, USER);
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it('selected_count equals the sum of all terminal outcomes', async () => {
    seed('A1'); seed('B1', OTHER_ORG); seed('A2'); seed('A3', ORG, 'tiktok');
    actionable.add('A1'); actionable.add('A3');
    const ids = ['A1', 'B1', 'A2', 'A3'];
    const r = await bulkReplyThreads(ORG, ids, textFor, USER);
    const total = Object.values(r.outcomes).reduce((a, b) => a + b, 0);
    expect(total).toBe(ids.length);
    expect(r.sent + r.skipped).toBe(ids.length);
  });

  it('§11: 20 dispatch, the 21st is truncated — the cap is not silently raised', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 21; i += 1) { seed(`t${i}`); actionable.add(`t${i}`); ids.push(`t${i}`); }
    const r = await bulkReplyThreads(ORG, ids, textFor, USER);
    expect(r.sent).toBe(20);
    expect(executeActionMock).toHaveBeenCalledTimes(20);
    // Truncation is the established contract (slice), not an error.
    expect(r.sent + r.skipped).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§19 no bypass path exists', () => {
  it('the bulk service resolves ownership nowhere — it only consumes canonical state', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('backend/services/bulkEngagementService.ts', 'utf8');
    expect(src).not.toMatch(/isAuthorSelf|getOrgAuthorIds|latestAuthorIsExternal/);
    expect(src).toMatch(/isThreadActionable/);
    expect(src).toMatch(/resolveEngagementCapability/);
  });

  it('the simulation execution mode is never selected by the bulk service', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync('backend/services/bulkEngagementService.ts', 'utf8');
    // Comment lines are excluded deliberately: the file documents the old
    // `execution_mode: 'manual'` defect in prose, and that prose is worth
    // keeping. Only executable lines are asserted on.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/execution_mode:\s*'manual'/);
    // The mode is derived from the resolved capability and then passed through;
    // assert the derivation itself rather than one particular spelling of the
    // pass-through, which is what broke when the local was extracted.
    expect(code).toMatch(/const\s+executionMode\s*=\s*capability\.mode\s*\?\?/);
    expect(code).toMatch(/execution_mode:\s*executionMode/);
  });
});
