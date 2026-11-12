/**
 * CLASS-2 A19 + A20 (e9 sweep; migration 20270217000021) - the executor and the scheduler WIRING.
 *
 * A19: the scheduler and the auto-rule path claim THROUGH the guardrails
 * (community_ai_claim_within_limits), so a limit cannot be passed by two claimants that both
 * pre-checked (canExecuteAction) before either claimed. canExecuteAction is held at "allowed" here:
 * that IS the race - both pre-checks already passed; only the atomic claim can still refuse.
 * The SQL itself (lock, counts, parity) is proven on real PostgreSQL in
 * realschema/a19a20_atomic_guardrail_claim_and_usage_reserve.test.ts.
 *
 * A20: the executor RESERVES plan usage (checkUsageBeforeExecution with `reserve`) and settles the
 * reservation once: released when the meter counts the send or nothing could have acted; kept (it
 * counts until its TTL) when the send may have acted unmetered (browser dispatch, uncertain).
 */
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
const mockRpcNames: string[] = [];
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
let mockEmulation: any = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: (name: string, args: any) => { mockRpcNames.push(name); return mockEmulation.rpc(name, args); },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
const mockPolicy = { auto_rules_enabled: true };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  getCommunityExecutionPolicy: jest.fn(async () => ({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: mockPolicy.auto_rules_enabled }, version: 'v1' })),
}));
const mockUsage = {
  check: jest.fn(async (_p: any): Promise<any> => ({ allowed: true })),
  release: jest.fn(async (_r: any) => true),
};
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: (p: any) => mockUsage.check(p),
  releaseUsageReservation: (r: any) => mockUsage.release(r),
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
// The race: both pre-checks already said "allowed".
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(),
  rpaResultMayHaveActed: (r: any) => !r || (r.success !== true && r.may_have_acted !== false && r.deferred !== true),
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

import { executeAction, type CommunityAiAction } from '../../services/communityAiActionExecutor';
import { runCommunityAiScheduler } from '../../services/communityAiScheduler';

const id = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const row = (n: number, over: Record<string, any> = {}) => withApprovalEvidence({
  id: id(n), tenant_id: 'o1', organization_id: 'o1', platform: 'linkedin', action_type: 'like',
  target_id: `https://www.linkedin.com/feed/update/urn:li:activity:${n}/`, suggested_text: null, playbook_id: 'pb1',
  execution_mode: 'api', status: 'approved', scheduled_at: '2026-10-01T00:00:00Z', requires_human_approval: false,
  risk_level: 'low', cancel_requested_at: null, ...over,
});
const asAction = (r: Record<string, any>) => ({ ...r } as unknown as CommunityAiAction);
const statusOf = (n: number) => mockDb.tables.community_ai_actions.find((r) => r.id === id(n))?.status;

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [row(1), row(2)], execution_guardrails: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockEmulation = require('./helpers/communityClaimRpcEmulation').communityRpcEmulation(() => mockDb,
    () => ({ allowed: true, code: null, auto_rules_enabled: mockPolicy.auto_rules_enabled }));
  mockRpcNames.length = 0;
  mockConnector.mockReset().mockImplementation(async () => { await new Promise((r) => setImmediate(r)); return { success: true, platform_id: 'urn:x' }; });
  mockUsage.check.mockReset().mockImplementation(async () => ({ allowed: true }));
  mockUsage.release.mockReset().mockImplementation(async () => true);
});

describe('A19: the guardrail limit holds even when both pre-checks passed', () => {
  it('two concurrent schedulers, daily limit 1, two approved actions -> ONE sends; the other is refused at the claim', async () => {
    mockDb.tables.execution_guardrails.push({ company_id: 'o1', auto_execution_enabled: true, daily_platform_limit: 1, per_post_reply_limit: null, per_evaluation_limit: null });
    await Promise.all([runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z')), runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'))]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect([statusOf(1), statusOf(2)].sort()).toEqual(['approved', 'executed']); // the refused one is left approved
    expect(mockEmulation.refusals).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GUARDRAIL_DAILY_PLATFORM_LIMIT', claim_point: 'scheduler' })]));
    expect(mockRpcNames).not.toContain('claim_community_ai_action_for_execution'); // every scheduler claim went through the limits
  });

  it('CONTROL: no guardrail row -> both send (no limits)', async () => {
    await Promise.all([runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z')), runCommunityAiScheduler(new Date('2026-10-28T00:00:00Z'))]);
    expect(mockConnector).toHaveBeenCalledTimes(2);
  });

  it('the auto-rule path (executeAction source auto) claims through the limits with p_source evaluation', async () => {
    mockDb.tables.execution_guardrails.push({ company_id: 'o1', auto_execution_enabled: true, daily_platform_limit: null, per_post_reply_limit: null, per_evaluation_limit: 1 });
    const opts = { source: 'auto' as const, persist: true, notify: false, webhook: false };
    const [a, b] = await Promise.all([executeAction(asAction(row(1)), true, opts), executeAction(asAction(row(2)), true, opts)]);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect([a.reason, b.reason]).toContain('GUARDRAIL_PER_EVALUATION_LIMIT');
    expect(mockEmulation.claims.every((c: any) => c.p_source === 'evaluation')).toBe(true);
  });

  it('a manual execute does NOT go through the guardrails (they do not apply to manual)', async () => {
    mockDb.tables.execution_guardrails.push({ company_id: 'o1', auto_execution_enabled: false, daily_platform_limit: 0, per_post_reply_limit: null, per_evaluation_limit: null });
    await executeAction(asAction(row(1)), true, { source: 'manual', persist: true, notify: false, webhook: false, auto_insert: false } as any);
    expect(mockRpcNames).not.toContain('community_ai_claim_within_limits');
  });
});

describe('A20: the plan-usage reservation is taken and settled exactly once', () => {
  const RES = { id: 'res-1', organization_id: 'o1' };
  const run = () => executeAction(asAction(row(1)), true, { source: 'auto', persist: true, notify: false, webhook: false });

  it('the executor asks to RESERVE (not just read) for this action', async () => {
    await run();
    expect(mockUsage.check).toHaveBeenCalledWith(expect.objectContaining({ resource_key: 'automation_executions', failClosed: true, reserve: { action_id: id(1) } }));
  });

  it('executed -> the meter counts it -> the reservation is released', async () => {
    mockUsage.check.mockImplementation(async () => ({ allowed: true, reservation: RES }));
    const r = await run();
    expect(r.status).toBe('executed');
    expect(mockUsage.release).toHaveBeenCalledTimes(1);
    expect(mockUsage.release).toHaveBeenCalledWith(RES);
  });

  it('nothing could have acted (claim refused) -> released', async () => {
    mockDb.tables.execution_guardrails.push({ company_id: 'o1', auto_execution_enabled: false, daily_platform_limit: null, per_post_reply_limit: null, per_evaluation_limit: null });
    mockUsage.check.mockImplementation(async () => ({ allowed: true, reservation: RES }));
    const r = await run();
    expect(r.may_have_acted).toBe(false);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockUsage.release).toHaveBeenCalledWith(RES);
  });

  it('an UNCERTAIN send (may have acted, not metered) -> KEPT: it counts until its TTL', async () => {
    mockConnector.mockImplementation(async () => { throw new Error('socket hang up'); });
    mockUsage.check.mockImplementation(async () => ({ allowed: true, reservation: RES }));
    const r = await run();
    expect(r.status).toBe('uncertain');
    expect(mockUsage.release).not.toHaveBeenCalled();
  });

  it('the plan refuses -> nothing sent, nothing to release', async () => {
    mockUsage.check.mockImplementation(async () => ({ allowed: false, resource_key: 'automation_executions', limit: 10, current_usage: 10, allowed_until: 10, grace_percent: 0 }));
    const r = await run();
    expect(r.status).toBe('blocked');
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockUsage.release).not.toHaveBeenCalled();
  });
});
