/**
 * Community execution safety — executor, claims and the scheduler.
 *
 *   - API: a may-have-acted outcome (timeout, throw, unclassified connector
 *     failure) is 'uncertain' and is NEVER re-routed to the browser; only a
 *     provably-not-acted refusal may fall back.
 *   - RPA: post-submit failure / timeout -> 'uncertain'; deferral ->
 *     'deferred' persisted as 'approved'.
 *   - Claims: approved -> executing is an atomic, tenant-scoped CAS; exactly
 *     one of N racing claimants wins; two schedulers racing for one action
 *     perform it once; the terminal write is CAS from 'executing'.
 *   - Kill switch, approval and tenant scope still refuse.
 *   - auto_insert never leaves a claimable 'pending' row behind.
 *
 * In-memory fake DB (helpers/communityExecutionFakeDb); no network.
 */

import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
// L-3: these tests exercise other mechanics with fixtures that carry no
// resolvable recipient; the recipient recheck itself is proven in
// communityL3RecipientRecheck / communityL3RecheckEnforcement /
// communityL3RecheckBrowserClaim. Here every recipient is treated as allowed.
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
// Prompt 3: the claim RPC and refusal recorder, emulated over the fake DB
// (helpers/communityClaimRpcEmulation; the SQL is proven in the RS suites).
const mockRpc = (name: string, args: any) => require('./helpers/communityClaimRpcEmulation')
  .communityRpcEmulation(() => mockDb, () => (mockPolicy.execution_enabled
    ? { allowed: true, code: null, auto_rules_enabled: false }
    : { allowed: false, code: 'PLATFORM_KILL_SWITCH', auto_rules_enabled: null })).rpc(name, args);
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: (name: string, args: any) => mockRpc(name, args),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));

const mockPolicy = { execution_enabled: true, require_human_approval: false };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  // Prompt 3: the legacy knobs below, read as the tenant execution decision.
  getCommunityExecutionPolicy: ((legacy: any) => jest.fn((..._a: any[]) =>
    require('../helpers/communityPolicyDecisionShim').asExecutionDecision(legacy())))(jest.fn(async () => ({ ...mockPolicy }))),
}));
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
const mockWebhook = jest.fn(async (_a: any) => undefined);
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: (a: any) => mockWebhook(a) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => ({ id: 'pb1' })),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({
  validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })),
}));
jest.mock('../../services/executionGuardrailService', () => ({
  canExecuteAction: jest.fn(async () => ({ allowed: true })),
}));
const mockRpa = jest.fn();
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: (...a: any[]) => mockRpa(...a),
  rpaResultMayHaveActed: (r: any) => !r || (r.success !== true && r.may_have_acted !== false && r.deferred !== true),
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));

import {
  executeAction,
  claimCommunityActionForExecution,
  persistExecutionResult,
  type CommunityAiAction,
} from '../../services/communityAiActionExecutor';
import { runCommunityAiScheduler } from '../../services/communityAiScheduler';

const ACTION_ID = '00000000-0000-0000-0000-0000000000a1';

// Prompt 3: an approved row carries its approval of record (approve.ts), < 7 days old;
// a fixture that sets approved_at: null describes a row nobody approved.
const row = (over: Record<string, any> = {}) => {
  const merged: Record<string, any> = {
  id: ACTION_ID,
  tenant_id: 'o1',
  organization_id: 'o1',
  platform: 'linkedin',
  action_type: 'like',
  target_id: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
  suggested_text: null,
  playbook_id: 'pb1',
  execution_mode: 'api',
  status: 'approved',
  scheduled_at: '2026-10-01T00:00:00Z',
  requires_human_approval: false,
  risk_level: 'low',
  cancel_requested_at: null,
    ...over,
  };
  if ('approved_at' in over && over.approved_at === null) return merged;
  return withApprovalEvidence(merged);
};

const action = (over: Record<string, any> = {}) => {
  const r = row(over);
  return { ...r, action_type: r.action_type as any, risk_level: r.risk_level as any, execution_mode: r.execution_mode as any } as unknown as CommunityAiAction;
};

const statusOf = (id = ACTION_ID) => mockDb.tables.community_ai_actions.find((r) => r.id === id)?.status;

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [row()] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockPolicy.execution_enabled = true;
  mockPolicy.require_human_approval = false;
  mockConnector.mockReset();
  mockRpa.mockReset();
  mockWebhook.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('API execution — no fallback after a may-have-acted outcome', () => {
  it('API timeout: uncertain, no browser fallback, persisted uncertain', async () => {
    jest.useFakeTimers();
    mockConnector.mockImplementation(() => new Promise(() => undefined)); // never answers
    const p = executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    await jest.advanceTimersByTimeAsync(31_000);
    const r = await p;
    expect(r.status).toBe('uncertain');
    expect(r.execution_mode).toBe('api');
    expect(r.response?.fallback_from).toBeUndefined();
    expect((r as any).command_chain).toBeUndefined();
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(statusOf()).toBe('uncertain');
  });

  it('API throw after the request: uncertain, no fallback', async () => {
    mockConnector.mockRejectedValue(new Error('socket hang up'));
    const r = await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r).toMatchObject({ ok: false, status: 'uncertain', may_have_acted: true });
    expect(statusOf()).toBe('uncertain');
  });

  it('ambiguous / unclassified connector failure (success:false) is uncertain, never re-routed', async () => {
    mockConnector.mockResolvedValue({ success: false, error: 'LINKEDIN_EXECUTION_FAILED' });
    const r = await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('uncertain');
    expect(r.execution_mode).toBe('api');
    expect(statusOf()).toBe('uncertain');
  });

  it('an uncertain outcome emits no failure webhook (an external system could resend)', async () => {
    mockConnector.mockRejectedValue(new Error('boom'));
    await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: true });
    expect(mockWebhook).not.toHaveBeenCalled();
  });

  it('a provably-not-acted refusal (connector says may_have_acted:false) may fall back to the browser', async () => {
    mockConnector.mockResolvedValue({ success: false, error: 'RATE_LIMITED', may_have_acted: false });
    const r = await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('dispatched');
    expect(r.execution_mode).toBe('browser');
    expect(r.response?.fallback_from).toBe('api');
    expect(statusOf()).toBe('pending');
  });

  it('API success is executed', async () => {
    mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:x' });
    const r = await executeAction(action(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('executed');
    expect(statusOf()).toBe('executed');
  });
});

describe('RPA execution — consequence mapping', () => {
  const rpaAction = () => action({ execution_mode: 'rpa' });

  it('post-submit failure -> uncertain (never failed, never retried)', async () => {
    mockRpa.mockResolvedValue({ success: false, error: 'RPA_POST_CONDITION_FAILED', may_have_acted: true });
    const r = await executeAction(rpaAction(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('uncertain');
    expect(mockRpa).toHaveBeenCalledTimes(1);
    expect(statusOf()).toBe('uncertain');
  });

  it('RPA timeout (browser may still post) -> uncertain', async () => {
    jest.useFakeTimers();
    mockRpa.mockImplementation(() => new Promise(() => undefined));
    const p = executeAction(rpaAction(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    await jest.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    const r = await p;
    expect(r.status).toBe('uncertain');
    expect(statusOf()).toBe('uncertain');
  });

  it('provably-not-acted failure -> failed', async () => {
    mockRpa.mockResolvedValue({ success: false, error: 'RPA_NO_SESSION', may_have_acted: false });
    const r = await executeAction(rpaAction(), true, { source: 'scheduler', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('failed');
    expect(statusOf()).toBe('failed');
  });

  it('deferral -> deferred, row back to approved, initiating source recorded', async () => {
    mockRpa.mockResolvedValue({ success: false, error: 'RPA_ENV_NOT_READY:x', deferred: true, may_have_acted: false });
    const r = await executeAction(rpaAction(), true, { source: 'manual', persist: true, notify: false, webhook: false });
    expect(r.status).toBe('deferred');
    expect(statusOf()).toBe('approved');
    const stored = mockDb.tables.community_ai_actions[0].execution_result;
    expect(stored.response.deferred_source).toBe('manual');
  });
});

describe('claims — exactly one executor', () => {
  it('N concurrent claimants: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o1', claimPoint: 'scheduler' })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(statusOf()).toBe('executing');
  });

  it('tenant mismatch never claims', async () => {
    const r = await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 't-other', organizationId: 'o1', claimPoint: 'scheduler' });
    expect(r.claimed).toBe(false);
    const r2 = await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o-other', claimPoint: 'scheduler' });
    expect(r2.claimed).toBe(false);
    expect(statusOf()).toBe('approved');
  });

  it('approval race: an action no longer approved (revoked / pending) is not claimed', async () => {
    mockDb.tables.community_ai_actions[0].status = 'pending';
    const r = await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o1', claimPoint: 'scheduler' });
    expect(r.claimed).toBe(false);
  });

  it('a cancel-requested action is not claimed', async () => {
    mockDb.tables.community_ai_actions[0].cancel_requested_at = '2026-10-28T00:00:00Z';
    const r = await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o1', claimPoint: 'scheduler' });
    expect(r.claimed).toBe(false);
  });

  it('terminal write is CAS from executing: a row changed underneath (e.g. reaped) is not overwritten', async () => {
    const corr = '7a1c1f7e-2f4c-4a51-9a1e-0000000000c3';
    await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o1', claimPoint: 'scheduler', correlationId: corr });
    // The reaper / a reviewer moves the row WHILE the platform call is in flight.
    mockConnector.mockImplementation(async () => {
      mockDb.tables.community_ai_actions[0].status = 'uncertain';
      return { success: true };
    });
    const r = await executeAction(action(), true, {
      source: 'scheduler', persist: true, notify: false, webhook: false, expected_from_statuses: ['executing'], correlation_id: corr,
    });
    expect(statusOf()).toBe('uncertain');
    expect(r.ok).toBe(false);
    expect(r.response?.persist_error).toBe('STATE_MISMATCH');
    // executed-but-unrecorded is surfaced as uncertain, never as a retryable failure
    expect(r.status).toBe('uncertain');
  });

  it('F3: a caller that says it holds the claim but does not (row moved before dispatch) sends nothing', async () => {
    const corr = '7a1c1f7e-2f4c-4a51-9a1e-0000000000c4';
    await claimCommunityActionForExecution({ actionId: ACTION_ID, tenantId: 'o1', organizationId: 'o1', claimPoint: 'scheduler', correlationId: corr });
    mockDb.tables.community_ai_actions[0].status = 'uncertain';
    const r = await executeAction(action(), true, {
      source: 'scheduler', persist: true, notify: false, webhook: false, expected_from_statuses: ['executing'], correlation_id: corr,
    });
    expect(r).toMatchObject({ ok: false, reason: 'CLAIM_NOT_HELD' });
    expect(mockConnector).not.toHaveBeenCalled();
    expect(statusOf()).toBe('uncertain');
  });

  it('persist maps deferred -> approved and uncertain is terminal (lease fields cleared)', async () => {
    mockDb.tables.community_ai_actions[0].dispatch_lease_id = 'L';
    const out = await persistExecutionResult({
      actionId: ACTION_ID, organizationId: 'o1', correlationId: 'c',
      result: { ok: false, status: 'uncertain', error: 'x' },
    });
    expect(out.ok).toBe(true);
    expect(statusOf()).toBe('uncertain');
    expect(mockDb.tables.community_ai_actions[0].dispatch_lease_id).toBeNull();
  });
});

describe('scheduler', () => {
  it('two schedulers racing for one approved action perform it exactly once', async () => {
    mockConnector.mockImplementation(async () => {
      await new Promise((r) => setImmediate(r));
      return { success: true, platform_id: 'urn:x' };
    });
    const [a, b] = await Promise.all([runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z')), runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'))]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(a.executed + b.executed).toBe(1);
    expect(statusOf()).toBe('executed');
  });

  it('throw during execution: uncertain, and the next tick never re-runs it', async () => {
    mockConnector.mockImplementation(async () => { throw new Error('process died mid-call'); });
    await runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'));
    expect(statusOf()).toBe('uncertain');
    mockConnector.mockReset();
    mockConnector.mockResolvedValue({ success: true });
    await runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'));
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('crash after claim (row left executing / expired claim) is never re-run by the scheduler', async () => {
    mockDb.tables.community_ai_actions[0].status = 'executing';
    await runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'));
    expect(mockConnector).not.toHaveBeenCalled();
    expect(statusOf()).toBe('executing');
  });

  it('kill switch: nothing claimed, nothing executed', async () => {
    mockPolicy.execution_enabled = false;
    await runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'));
    expect(mockConnector).not.toHaveBeenCalled();
    expect(statusOf()).toBe('approved');
  });
});

describe('executor gates still refuse', () => {
  it('kill switch on a direct call: skipped, connector never called', async () => {
    mockPolicy.execution_enabled = false;
    const r = await executeAction(action(), true, { source: 'scheduler', notify: false, webhook: false });
    expect(r).toMatchObject({ status: 'skipped', reason: 'PLATFORM_POLICY' });
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('high-risk without persisted approval: refused, connector never called', async () => {
    const r = await executeAction(action({ risk_level: 'high', approved_at: null }), true, { source: 'scheduler', notify: false, webhook: false });
    // D-01: refused at the human-approval gate, whatever the risk level.
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it('unresolved LinkedIn DM target is refused (not dispatched into the open thread)', async () => {
    const r = await executeAction(
      action({ action_type: 'dm', target_id: 'Rajesh Singh', suggested_text: 'hi', execution_mode: 'browser' }),
      true, { source: 'manual', notify: false, webhook: false });
    expect(r).toMatchObject({ ok: false, status: 'failed', error: 'DM_TARGET_UNRESOLVED', may_have_acted: false });
  });

  // D-01: was 'auto_insert creates the row already claimed (executing)'. An ad-hoc
  // action has no human approval, so it is now refused BEFORE any row is
  // written: still never a claimable pending row, and no row at all.
  it('auto_insert is refused before any row is written, never a claimable pending row', async () => {
    mockDb = createFakeDb({ community_ai_actions: [] });
    mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
    const inserted: string[] = [];
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      const origInsert = q.insert;
      q.insert = (r: any) => { if (t === 'community_ai_actions') inserted.push(r.status); return origInsert(r); };
      return q;
    };
    const r = await executeAction(action({ execution_mode: 'browser' }), true, {
      source: 'scheduler', persist: true, auto_insert: true, notify: false, webhook: false,
    });
    expect(inserted).toEqual([]);
    expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED', may_have_acted: false });
    expect(statusOf()).toBeUndefined();
    expect(mockConnector).not.toHaveBeenCalled();
  });
});
