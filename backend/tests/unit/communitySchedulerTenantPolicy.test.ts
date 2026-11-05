/**
 * Prompt 3 (OD-1, LD-7) — runCommunityAiScheduler, the real service.
 *
 *   - only rows with a human approval of record are loaded: an 'approved' row
 *     with no approved_at is never read (it used to be re-read every run and
 *     never settled);
 *   - the policy is decided PER ACTION for that action's tenant, before anything
 *     is written or claimed; a refusal (kill switch, missing, disabled) writes one
 *     governance refusal record (claim point 'scheduler') and leaves the row
 *     'approved'; another tenant's rows are unaffected;
 *   - an expired or evidence-less approval is refused the same way, unburned;
 *   - an allowed action takes the single claim (claim point 'scheduler') and the
 *     executor runs only after it, under the same correlation id; a refused
 *     claim runs nothing.
 */
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence, approvedAgo } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
const mockDecisions: Record<string, Record<string, unknown>> = {};
const mockRefusals: Array<Record<string, unknown>> = [];
const mockClaim = jest.fn();
const mockExecute = jest.fn();
const mockPersist = jest.fn(async () => ({ ok: true }));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: jest.fn(async (name: string, args: { p_org: string }) => (name === 'community_execution_policy_decision'
      ? { data: [mockDecisions[args.p_org] ?? { allowed: false, code: 'POLICY_MISSING', auto_rules_enabled: null, policy_version: null }], error: null }
      : { data: null, error: { message: 'unexpected rpc' } })),
  },
}));
jest.mock('../../services/communityExecutionRefusal', () => ({
  recordCommunityExecutionRefusal: jest.fn(async (input: Record<string, unknown>) => { mockRefusals.push(input); return true; }),
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  claimCommunityActionForExecution: (...a: any[]) => mockClaim(...a),
  executeAction: (...a: any[]) => mockExecute(...a),
  persistExecutionResult: (...a: any[]) => (mockPersist as any)(...a),
}));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb-1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));

import { runCommunityAiScheduler } from '../../services/communityAiScheduler';
import { __resetCommunityAiPlatformPolicyCacheForTests } from '../../services/communityAiPlatformPolicyService';

const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ALLOW = { allowed: true, code: null, auto_rules_enabled: false, policy_version: '2026-11-01T00:00:00.000Z' };

const row = (id: string, org: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: org, organization_id: org, platform: 'linkedin', action_type: 'like',
  target_id: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`, suggested_text: null,
  playbook_id: 'pb-1', execution_mode: 'api', status: 'approved', risk_level: 'low',
  requires_human_approval: true, scheduled_at: '2026-01-01T00:00:00.000Z', cancel_requested_at: null,
  intent_classification: null, ...over,
});
const statusOf = (id: string) => mockDb.tables.community_ai_actions.find((r) => r.id === id)?.status;

beforeEach(() => {
  __resetCommunityAiPlatformPolicyCacheForTests();
  for (const k of Object.keys(mockDecisions)) delete mockDecisions[k];
  mockRefusals.length = 0;
  mockClaim.mockReset();
  mockExecute.mockReset();
  mockPersist.mockClear();
  mockClaim.mockResolvedValue({ claimed: true, code: null, currentStatus: 'executing' });
  mockExecute.mockResolvedValue({ ok: true, status: 'executed' });
});

describe('scheduler: per-tenant policy and approval of record, before any write or claim', () => {
  it('never loads an approved row with no approved_at (no policy read, no refusal, no write)', async () => {
    mockDecisions[ORG_A] = ALLOW;
    mockDb = createFakeDb({ community_ai_actions: [row('a-legacy', ORG_A, { approved_at: null })] });
    const r = await runCommunityAiScheduler(new Date());
    expect(r.processed).toBe(0);
    expect(mockRefusals).toEqual([]);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(statusOf('a-legacy')).toBe('approved');
  });

  it('a refusing tenant is refused (recorded, unburned) while another tenant executes', async () => {
    mockDecisions[ORG_A] = { allowed: false, code: 'POLICY_EXECUTION_DISABLED', auto_rules_enabled: null, policy_version: null };
    mockDecisions[ORG_B] = ALLOW;
    mockDb = createFakeDb({
      community_ai_actions: [withApprovalEvidence(row('a1', ORG_A)), withApprovalEvidence(row('b1', ORG_B))],
    });
    await runCommunityAiScheduler(new Date());
    expect(mockRefusals).toEqual([expect.objectContaining({ actionId: 'a1', organizationId: ORG_A, tenantId: ORG_A, claimPoint: 'scheduler', code: 'POLICY_EXECUTION_DISABLED' })]);
    expect(statusOf('a1')).toBe('approved');
    expect(mockClaim).toHaveBeenCalledTimes(1);
    const claimArg = mockClaim.mock.calls[0][0];
    expect(claimArg).toMatchObject({ actionId: 'b1', organizationId: ORG_B, tenantId: ORG_B, claimPoint: 'scheduler', executionMode: 'api' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0][0].id).toBe('b1');
    expect(mockExecute.mock.calls[0][2]).toMatchObject({ source: 'scheduler', persist: true, expected_from_statuses: ['executing'], correlation_id: claimArg.correlationId });
    // No pre-claim terminal write for the refused tenant.
    expect(mockPersist.mock.calls.map((c: any[]) => c[0].actionId)).not.toContain('a1');
  });

  it.each([
    ['the platform kill switch', 'PLATFORM_KILL_SWITCH'],
    ['a missing tenant policy (fails closed)', 'POLICY_MISSING'],
  ])('%s refuses every action, unburned', async (_n, code) => {
    mockDecisions[ORG_A] = { allowed: false, code, auto_rules_enabled: null, policy_version: null };
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(row('a1', ORG_A))] });
    await runCommunityAiScheduler(new Date());
    expect(mockRefusals).toEqual([expect.objectContaining({ actionId: 'a1', code, claimPoint: 'scheduler' })]);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(statusOf('a1')).toBe('approved');
  });

  it('an expired approval is refused (APPROVAL_EXPIRED), not claimed, not burned', async () => {
    mockDecisions[ORG_A] = ALLOW;
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(row('a1', ORG_A), { approvedAt: approvedAgo(8 * 24 * 3600_000) })] });
    await runCommunityAiScheduler(new Date());
    expect(mockRefusals).toEqual([expect.objectContaining({ actionId: 'a1', code: 'APPROVAL_EXPIRED', claimPoint: 'scheduler' })]);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(statusOf('a1')).toBe('approved');
  });

  it('approved_at without evidence (no approver / passkey) is refused, not claimed', async () => {
    mockDecisions[ORG_A] = ALLOW;
    mockDb = createFakeDb({ community_ai_actions: [row('a1', ORG_A, { approved_at: approvedAgo() })] });
    await runCommunityAiScheduler(new Date());
    expect(mockRefusals).toEqual([expect.objectContaining({ actionId: 'a1', code: 'APPROVAL_EVIDENCE_REQUIRED' })]);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('a claim the RPC refuses runs nothing', async () => {
    mockDecisions[ORG_A] = ALLOW;
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(row('a1', ORG_A))] });
    mockClaim.mockResolvedValue({ claimed: false, code: 'APPROVAL_EXPIRED', currentStatus: 'approved' });
    await runCommunityAiScheduler(new Date());
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
