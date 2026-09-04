/**
 * F5-P1.2 — bulk send governance.
 *
 * The audit found more than a governance asymmetry. `sendReply` passed
 * `execution_mode: 'manual'`, which the executor routes to
 * `recordManualSimulation` — a no-op returning `{ ok: true, status:
 * 'sent_unverified', response: { simulated: true } }`. `bulkReplyThreads`
 * counted that as `sent`, so BOTH bulk routes reported success to the operator
 * while nothing was ever posted to any platform. `source: 'bulk'` shows real
 * dispatch was intended; 'manual' as an EXECUTION MODE is the simulation lane
 * and is distinct from `source: 'manual'` (a human-initiated send).
 *
 * The service is shared by thread/bulk-ai-reply and thread/bulk-pattern-reply,
 * so these tests exercise the service directly — that is where the contract
 * now lives for both callers.
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

// Canonical actionability is proven against a real derivation elsewhere
// (engagementAiActionabilityF5). Here it is a controllable input so the
// selection→send race can be staged deterministically.
const actionable = new Set<string>();
jest.mock('../../services/engagementThreadService', () => ({
  isThreadActionable: async (_o: string, t: string) => actionable.has(t),
  getThreadActionability: async (_o: string, ids: string[]) =>
    new Map(ids.map((i) => [i, actionable.has(i)])),
}));

let capability: { status: string; mode?: string; reason?: string } = { status: 'api_verified', mode: 'api' };
jest.mock('../../services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => capability,
}));

const auditEvents: Array<Record<string, unknown>> = [];
jest.mock('../../services/auditLoggingService', () => ({
  logAuditEvent: async (e: Record<string, unknown>) => { auditEvents.push(e); },
}));

const executeActionMock = jest.fn(async (_a: any, _a2: any, _o: any) => ({
  ok: true, status: 'executed', platform_id: 'urn:li:comment:sent', response: {},
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: (...a: unknown[]) => executeActionMock(...(a as [any, any, any])),
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: async () => [{ id: 'pb1', status: 'active' }],
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/systemHealthMetricsService', () => ({ recordMetric: async () => undefined }));

import { bulkReplyThreads } from '../../services/bulkEngagementService';

function seed(threadId: string, org = ORG, messageType = 'comment') {
  db.engagement_threads.push({ id: threadId, organization_id: org });
  db.engagement_messages.push({
    id: `msg_${threadId}`, thread_id: threadId, platform: 'linkedin',
    platform_message_id: `urn:li:comment:${threadId}`, post_comment_id: null,
    message_type: messageType, platform_created_at: '2026-01-10T00:00:00Z',
  });
}

const textFor = async () => 'Thanks — sending details over now.';

beforeEach(() => {
  db.engagement_messages = []; db.engagement_threads = [];
  actionable.clear();
  auditEvents.length = 0;
  executeActionMock.mockClear();
  capability = { status: 'api_verified', mode: 'api' };
  executeActionMock.mockResolvedValue({
    ok: true, status: 'executed', platform_id: 'urn:li:comment:sent', response: {},
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the simulation defect is closed', () => {
  it('dispatches through a real execution mode, never the manual simulation lane', async () => {
    seed('A'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    const action = executeActionMock.mock.calls[0][0];
    expect(action.execution_mode).toBe('api');
    expect(action.execution_mode).not.toBe('manual');
  });

  it('a simulated result is NOT counted as sent', async () => {
    seed('A'); actionable.add('A');
    // Exactly what recordManualSimulation returns.
    executeActionMock.mockResolvedValueOnce({
      ok: true, status: 'sent_unverified', response: { simulated: true },
    } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.outcomes.failed_dispatch).toBe(1);
  });

  it('a browser-queued dispatch counts as sent', async () => {
    seed('A'); actionable.add('A');
    capability = { status: 'api_verified', mode: 'browser' };
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'dispatched', response: {} } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(r.sent).toBe(1);
  });
});

describe('B1–B3 batch outcomes', () => {
  it('B1: one valid actionable thread sends', async () => {
    seed('A'); actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(r).toMatchObject({ sent: 1, skipped: 0 });
    expect(r.outcomes.sent).toBe(1);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('B2: a company-answered thread is skipped and never dispatched', async () => {
    seed('A');                                  // not in `actionable`
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(r.outcomes.skipped_not_actionable).toBe(1);
    expect(executeActionMock).not.toHaveBeenCalled();
    expect(auditEvents.some((e) => (e.metadata as any)?.code === 'THREAD_NOT_ACTIONABLE')).toBe(true);
  });

  it('B3: a mixed batch processes A and C, skips B', async () => {
    seed('A'); seed('B'); seed('C');
    actionable.add('A'); actionable.add('C');
    const r = await bulkReplyThreads(ORG, ['A', 'B', 'C'], textFor, 'user_1');
    expect(r.sent).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.outcomes.skipped_not_actionable).toBe(1);
    const targets = executeActionMock.mock.calls.map((c) => c[0].target_id);
    expect(targets).toEqual(['urn:li:comment:A', 'urn:li:comment:C']);
  });
});

describe('B4–B6 authorization and capability', () => {
  it('B4: a foreign-company thread is never dispatched and is counted', async () => {
    seed('X', OTHER_ORG); actionable.add('X');
    const r = await bulkReplyThreads(ORG, ['X'], textFor, 'user_1');
    expect(executeActionMock).not.toHaveBeenCalled();
    // Previously this id vanished from BOTH counters.
    expect(r.skipped).toBe(1);
    expect(r.outcomes.skipped_unauthorized).toBe(1);
  });

  it('B5: a missing capability blocks dispatch and is audited', async () => {
    seed('A'); actionable.add('A');
    capability = { status: 'unsupported', reason: 'reply is not supported on reddit' };
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(executeActionMock).not.toHaveBeenCalled();
    expect(r.outcomes.skipped_capability).toBe(1);
    expect(auditEvents.some((e) => (e.metadata as any)?.code === 'ACTION_NOT_SUPPORTED')).toBe(true);
  });

  it('B6: the execution mode comes from capability, not from the caller', async () => {
    seed('A'); actionable.add('A');
    capability = { status: 'api_verified', mode: 'browser' };
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'dispatched', response: {} } as never);
    await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(executeActionMock.mock.calls[0][0].execution_mode).toBe('browser');
  });

  it('a DM resolves the dm capability, not reply', async () => {
    seed('A', ORG, 'dm'); actionable.add('A');
    capability = { status: 'api_verified', mode: 'browser' };
    executeActionMock.mockResolvedValueOnce({ ok: true, status: 'dispatched', response: {} } as never);
    await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(executeActionMock.mock.calls[0][0].action_type).toBe('dm');
  });
});

describe('B7–B9 races, duplicates and failures', () => {
  it('B9: a thread that turns non-actionable after selection is refused at send', async () => {
    seed('A'); actionable.add('A');
    // The company answers between generation and dispatch.
    const raceText = async () => { actionable.delete('A'); return 'stale draft text'; };
    const r = await bulkReplyThreads(ORG, ['A'], raceText, 'user_1');
    expect(r.sent).toBe(0);
    expect(r.outcomes.skipped_not_actionable).toBe(1);
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it('B7: a successful send closes the thread, so a repeat run does not re-send', async () => {
    seed('A'); actionable.add('A');
    const first = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(first.sent).toBe(1);

    // The mirrored self-reply is what makes the thread non-actionable. Without
    // it the next bulk run would reply to the same external turn again.
    const mirrored = db.engagement_messages.filter(
      (m) => m.thread_id === 'A' && m.direction === 'outgoing',
    );
    expect(mirrored).toHaveLength(1);
    expect((mirrored[0].raw_payload as any).author_self).toBe(true);

    actionable.delete('A');                       // canonical state now reflects it
    const second = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(second.sent).toBe(0);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('B8: a generation failure sends nothing and bypasses no governance', async () => {
    seed('A'); actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A'], async () => null, 'user_1');
    expect(r.sent).toBe(0);
    expect(r.outcomes.failed_generation).toBe(1);
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it('a dispatch failure is reported, not silently counted as sent', async () => {
    seed('A'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: false, status: 'failed', error: 'connector 500' } as never);
    const r = await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(r.sent).toBe(0);
    expect(r.outcomes.failed_dispatch).toBe(1);
    expect(r.errors).toContain('connector 500');
  });

  it('a failed dispatch does not mirror a reply into the thread', async () => {
    seed('A'); actionable.add('A');
    executeActionMock.mockResolvedValueOnce({ ok: false, status: 'failed', error: 'connector 500' } as never);
    await bulkReplyThreads(ORG, ['A'], textFor, 'user_1');
    expect(db.engagement_messages.filter((m) => m.direction === 'outgoing')).toHaveLength(0);
  });
});

describe('accounting and limits', () => {
  it('every requested thread lands in exactly one terminal outcome', async () => {
    seed('A'); seed('B'); seed('X', OTHER_ORG);
    actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A', 'B', 'X'], textFor, 'user_1');
    const total = Object.values(r.outcomes).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
    expect(r.sent + r.skipped).toBe(3);
  });

  it('the batch cap is preserved', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) { seed(`t${i}`); actionable.add(`t${i}`); ids.push(`t${i}`); }
    const r = await bulkReplyThreads(ORG, ids, textFor, 'user_1');
    expect(r.sent).toBe(20);
    expect(executeActionMock).toHaveBeenCalledTimes(20);
  });

  it('the acting user is attributed server-side on every dispatch', async () => {
    seed('A'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, 'user_7');
    expect(executeActionMock.mock.calls[0][0].acting_user_id).toBe('user_7');
  });
});
