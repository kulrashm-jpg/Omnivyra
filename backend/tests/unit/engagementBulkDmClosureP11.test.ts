/**
 * P1.1 — bulk DM duplicate-send protection.
 *
 * Root cause, traced rather than assumed:
 *   - `prepareBrowserDispatch` has NO side effect. A browser DM is "queued"
 *     entirely by its community_ai_actions row.
 *   - `persistExecutionResult` maps status 'dispatched' → 'pending'
 *     (communityAiActionExecutorRuntime:167), and /api/extension/commands
 *     claims exactly `status='pending' AND execution_mode='browser'`.
 *   - The executor's idempotency key does not protect this. Dedup is detected
 *     at PERSIST time — after runExecution and after `auto_insert` has already
 *     written a fresh pending+browser row. The unique-index collision stops the
 *     new row being STAMPED but leaves it pending and claimable, so the
 *     extension sends a second DM. The key protects the ledger, not the inbox.
 *
 * The fix consults existing state (an unfinished browser action for the same
 * target) before dispatching. No schema, no fabricated message, no invented
 * platform_message_id: DISPATCHED and DELIVERED stay distinct.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = {
  engagement_messages: [], engagement_threads: [], community_ai_actions: [],
};

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
const USER = 'user_1';
const actionable = new Set<string>();
jest.mock('../../services/engagementThreadService', () => ({
  isThreadActionable: async (_o: string, t: string) => actionable.has(t),
  getThreadActionability: async (_o: string, ids: string[]) =>
    new Map(ids.map((i) => [i, actionable.has(i)])),
}));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: async () => undefined }));
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: async () => [{ id: 'pb1', status: 'active' }],
}));
jest.mock('../../services/responsePerformanceService', () => ({ recordReplyPerformance: async () => undefined }));
jest.mock('../../services/engagementOpportunityResolutionService', () => ({ resolveOpportunityByReply: async () => undefined }));
jest.mock('../../services/systemHealthMetricsService', () => ({ recordMetric: async () => undefined }));

/**
 * Faithful stand-in for the real executor: auto_insert writes a pending row
 * BEFORE execution, browser dispatch persists back as 'pending' (not
 * 'dispatched'), and the extension later claims pending+browser rows. This is
 * what makes the duplicate reachable at all.
 */
const executeActionMock = jest.fn(async (action: any, _approved: any, options: any) => {
  if (options?.auto_insert) {
    // Faithful to the real path: it selects by id first and treats a 23505
    // unique violation as benign, so an id that already exists is never
    // duplicated. This is what makes a deterministic action id a serialisation
    // point for concurrent callers.
    const exists = db.community_ai_actions.some((a) => a.id === action.id);
    if (!exists) {
      db.community_ai_actions.push({
        id: action.id, organization_id: action.organization_id, platform: action.platform,
        action_type: action.action_type, target_id: action.target_id,
        execution_mode: action.execution_mode, status: 'pending',
      });
    }
  }
  if (action.execution_mode === 'browser') {
    return { ok: true, status: 'dispatched', execution_mode: 'browser', response: {} };
  }
  return { ok: true, status: 'executed', platform_id: 'urn:li:comment:sent', response: {} };
});
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: (...a: unknown[]) => executeActionMock(...(a as [any, any, any])),
}));

import { bulkReplyThreads } from '../../services/bulkEngagementService';

function seed(threadId: string, messageType: 'dm' | 'comment') {
  db.engagement_threads.push({ id: threadId, organization_id: ORG });
  db.engagement_messages.push({
    id: `msg_${threadId}`, thread_id: threadId, platform: 'linkedin',
    platform_message_id: `urn:li:${messageType}:${threadId}`, post_comment_id: null,
    message_type: messageType, platform_created_at: '2026-01-10T00:00:00Z',
  });
}
const textFor = async () => 'Sending those details across now.';
/** Rows the Chrome extension would claim: status=pending AND mode=browser. */
const claimable = () =>
  db.community_ai_actions.filter((a) => a.status === 'pending' && a.execution_mode === 'browser');

beforeEach(() => {
  db.engagement_messages = []; db.engagement_threads = []; db.community_ai_actions = [];
  actionable.clear();
  executeActionMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P1.1 DM duplicate-send protection', () => {
  it('T1: an actionable DM dispatches exactly once', async () => {
    seed('A', 'dm'); actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(1);
    expect(claimable()).toHaveLength(1);
  });

  it('T2: an immediate repeat does NOT dispatch again', async () => {
    seed('A', 'dm'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);

    // The thread is still actionable: the DM was queued, not delivered, so no
    // outgoing message exists yet. This is precisely the window in which the
    // duplicate used to occur.
    const second = await bulkReplyThreads(ORG, ['A'], textFor, USER);

    expect(second.sent).toBe(0);
    expect(second.outcomes.skipped_already_dispatched).toBe(1);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
    expect(claimable()).toHaveLength(1);        // the extension sees ONE command
  });

  it('T3: 16 concurrent invocations yield at most one queued DM', async () => {
    seed('A', 'dm'); actionable.add('A');
    const runs = await Promise.all(
      Array.from({ length: 16 }, () => bulkReplyThreads(ORG, ['A'], textFor, USER)),
    );
    // The invariant that matters is "exactly one effective DM dispatch". A
    // browser dispatch IS its community_ai_actions row, so the number of
    // claimable rows is the number of DMs the recipient will receive.
    expect(claimable()).toHaveLength(1);
    expect(db.community_ai_actions.filter((a) => a.action_type === 'dm')).toHaveLength(1);

    // The read guard is not atomic, so under exact simultaneity several callers
    // can each report sent=1 for what is one delivery. That is a reporting
    // imprecision, not a duplicate send — recorded here rather than hidden.
    const totalSent = runs.reduce((a, r) => a + r.sent, 0);
    expect(totalSent).toBeGreaterThanOrEqual(1);
  });

  it('T3b: the deterministic id is per (target, bucket), not global', async () => {
    seed('A', 'dm'); seed('B', 'dm');
    actionable.add('A'); actionable.add('B');
    await Promise.all([
      bulkReplyThreads(ORG, ['A'], textFor, USER),
      bulkReplyThreads(ORG, ['B'], textFor, USER),
    ]);
    // Two different recipients must never collapse onto one command.
    expect(claimable()).toHaveLength(2);
  });

  it('T4: a dispatch failure leaves the thread retryable', async () => {
    seed('A', 'dm'); actionable.add('A');
    executeActionMock.mockImplementationOnce(async () => ({
      ok: false, status: 'failed', error: 'extension offline',
    }) as never);
    const first = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(first.sent).toBe(0);
    expect(first.outcomes.failed_dispatch).toBe(1);
    expect(claimable()).toHaveLength(0);

    const retry = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(retry.sent).toBe(1);                 // retry is permitted
  });

  it('T5: a terminalised prior action does not block a later send', async () => {
    seed('A', 'dm'); actionable.add('A');
    db.community_ai_actions.push({
      id: 'old', organization_id: ORG, platform: 'linkedin', action_type: 'dm',
      target_id: 'urn:li:dm:A', execution_mode: 'browser', status: 'executed',
    });
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(1);                     // only UNFINISHED work blocks
  });

  it('T6/T8: once the extension ingests the sent DM, canonical state closes it', async () => {
    seed('A', 'dm'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);

    // Extension confirms delivery; ingestion writes the real outbound message
    // and terminalises the action. Closure comes from evidence, not fabrication.
    db.community_ai_actions[0].status = 'executed';
    actionable.delete('A');

    const after = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(after.sent).toBe(0);
    expect(after.outcomes.skipped_not_actionable).toBe(1);

    actionable.add('A');                        // they reply again
    const reopened = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(reopened.sent).toBe(1);
  });

  it('the guard is company-scoped — another tenant\'s queued DM never blocks ours', async () => {
    seed('A', 'dm'); actionable.add('A');
    db.community_ai_actions.push({
      id: 'rival', organization_id: 'org_rival', platform: 'linkedin', action_type: 'dm',
      target_id: 'urn:li:dm:A', execution_mode: 'browser', status: 'pending',
    });
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(1);
  });

  it('a queued DM to a DIFFERENT target does not block this one', async () => {
    seed('A', 'dm'); seed('B', 'dm');
    actionable.add('A'); actionable.add('B');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    const r = await bulkReplyThreads(ORG, ['B'], textFor, USER);
    expect(r.sent).toBe(1);
    expect(claimable()).toHaveLength(2);        // two distinct recipients
  });

  it('no fabricated outbound message is written for a queued DM', async () => {
    seed('A', 'dm'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    // DISPATCHED ≠ DELIVERED. Nothing may claim the DM was sent.
    expect(db.engagement_messages.filter((m) => m.direction === 'outgoing')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T9/T10 comment closure is unchanged', () => {
  it('T9: a comment closes immediately via the mirror', async () => {
    seed('A', 'comment'); actionable.add('A');
    const r = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(r.sent).toBe(1);
    expect(db.engagement_messages.filter((m) => m.direction === 'outgoing')).toHaveLength(1);
  });

  it('T10: a repeat comment run does not dispatch again', async () => {
    seed('A', 'comment'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    actionable.delete('A');                     // the mirror made it non-actionable
    const second = await bulkReplyThreads(ORG, ['A'], textFor, USER);
    expect(second.sent).toBe(0);
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it('the in-flight guard does not apply to api-mode comments', async () => {
    seed('A', 'comment'); actionable.add('A');
    await bulkReplyThreads(ORG, ['A'], textFor, USER);
    // The comment path is protected by the mirror, not by the browser guard;
    // its action row is 'pending' + 'api' and is irrelevant to the extension.
    expect(claimable()).toHaveLength(0);
  });
});
