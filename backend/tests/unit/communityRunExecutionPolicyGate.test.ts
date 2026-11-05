/**
 * Prompt 3 — runExecution's policy and approval gate (OD-1, OD-3, LD-4, LD-7).
 *
 *   - The tenant's own policy decides; every refusal code refuses before anything acts.
 *   - 'auto' (auto-rule origin) needs auto_rules_enabled === true; 'orchestration' is
 *     never 'auto' (even with auto:true) and needs a human approval of record.
 *   - The STORED approval evidence is checked (approver, content hash, passkey window,
 *     7-day lifetime) — the caller's copy of approved_at is not enough.
 *   - Every refusal writes exactly one refusal record via recordCommunityExecutionRefusal
 *     and is marked pre_claim_refusal (row untouched).
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';
import { communityApprovalBindingHash } from '../../services/communityApprovalBinding';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
let mockDecision: any = { ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: null };
const mockPolicyCalls: any[] = [];
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityExecutionPolicy: jest.fn(async (scope: unknown) => { mockPolicyCalls.push(scope); return mockDecision; }),
}));
const mockRefusals: any[] = [];
jest.mock('../../services/communityExecutionRefusal', () => ({
  recordCommunityExecutionRefusal: jest.fn(async (r: unknown) => { mockRefusals.push(r); return true; }),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb-1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
const mockRpa = jest.fn();
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: (...a: any[]) => mockRpa(...a),
  rpaResultMayHaveActed: () => false,
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

import { executeAction } from '../../services/communityAiActionExecutor';
import { APPROVAL_LIFETIME_MS } from '../../services/leadOutreachExecution/approvalBinding';

const ORG = '00000000-0000-4000-8000-0000000000b1';
const ACTION_ID = '00000000-0000-4000-8000-0000000000c1';
const APPROVER = '00000000-0000-4000-8000-0000000000a1';

const content = {
  id: ACTION_ID, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'like',
  target_id: 'urn:li:share:1', suggested_text: null, playbook_id: 'pb-1', discovered_user_id: null,
};
const HASH = (communityApprovalBindingHash(content as any) as any).hash as string;

const storedRow = (over: Record<string, unknown> = {}) => {
  const at = new Date(Date.now() - 60_000).toISOString();
  return {
    ...content, status: 'approved', execution_mode: 'manual', requires_human_approval: true, risk_level: 'low',
    approved_at: at, approved_by: APPROVER, approved_content_hash: HASH,
    passkey_credential_id: 'cred-1', passkey_verified_at: at, cancel_requested_at: null, dispatch_lease_id: null,
    ...over,
  };
};
const action = (over: Record<string, unknown> = {}) => ({ ...storedRow(), ...over }) as any;

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [storedRow()] });
  mockDecision = { ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: null };
  mockPolicyCalls.length = 0;
  mockRefusals.length = 0;
  mockConnector.mockReset();
  mockRpa.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});

const isGateRefusal = (r: any) => r.status === 'skipped' && r.response?.pre_claim_refusal === true && r.may_have_acted === false;

describe('runExecution — tenant policy', () => {
  it('reads the policy of the action\'s own tenant', async () => {
    await executeAction(action(), true, { source: 'manual' });
    expect(mockPolicyCalls[0]).toEqual({ organizationId: ORG, tenantId: ORG });
  });

  it.each([
    ['POLICY_MISSING'], ['POLICY_UNREADABLE'], ['PLATFORM_KILL_SWITCH'], ['POLICY_TENANT_MISMATCH'],
    ['POLICY_MALFORMED'], ['POLICY_AMBIGUOUS'], ['POLICY_EXECUTION_DISABLED'], ['POLICY_SCOPE_INVALID'],
  ])('%s refuses before anything acts, with one refusal record', async (code) => {
    mockDecision = { ok: false, code };
    const r = await executeAction(action({ execution_mode: 'api' }), true, { source: 'manual' });
    expect(isGateRefusal(r)).toBe(true);
    expect(r).toMatchObject({ reason: 'PLATFORM_POLICY', error: code });
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRefusals).toHaveLength(1);
    expect(mockRefusals[0]).toMatchObject({ actionId: ACTION_ID, organizationId: ORG, tenantId: ORG, claimPoint: 'manual', code });
    // The row is untouched (not burned).
    expect(mockDb.tables.community_ai_actions[0].status).toBe('approved');
  });
});

describe('runExecution — LD-4 auto vs orchestration', () => {
  it("source 'auto' without auto_rules_enabled === true is refused (claim point 'auto')", async () => {
    const r = await executeAction(action(), true, { source: 'auto' });
    expect(r).toMatchObject({ error: 'POLICY_AUTO_RULES_DISABLED' });
    expect(mockRefusals[0]).toMatchObject({ claimPoint: 'auto', code: 'POLICY_AUTO_RULES_DISABLED' });
  });

  it('auto:true metadata counts as auto-rule origin for any non-orchestration source', async () => {
    const r = await executeAction(action(), true, { source: 'scheduler', auto: true });
    expect(r).toMatchObject({ error: 'POLICY_AUTO_RULES_DISABLED' });
  });

  it("'orchestration' is never 'auto', even with auto:true", async () => {
    const r = await executeAction(action(), true, { source: 'orchestration', auto: true } as any);
    expect(isGateRefusal(r)).toBe(false);
    expect(mockRefusals).toHaveLength(0);
  });

  it("'orchestration' needs a human approval of record", async () => {
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ approved_at: null })] });
    const r = await executeAction(action({ approved_at: null }), true, { source: 'orchestration' } as any);
    expect(r).toMatchObject({ reason: 'HUMAN_APPROVAL_REQUIRED' });
    expect(mockRefusals[0]).toMatchObject({ claimPoint: 'orchestration', code: 'HUMAN_APPROVAL_REQUIRED', payload: { policy_flag: 'approval_of_record' } });
  });

  it("'auto' with auto_rules_enabled true passes the gate", async () => {
    mockDecision = { ok: true, policy: { execution_enabled: true, auto_rules_enabled: true }, version: null };
    const r = await executeAction(action(), true, { source: 'auto' });
    expect(isGateRefusal(r)).toBe(false);
  });
});

describe('runExecution — stored approval evidence (defence in depth)', () => {
  it('a current, evidenced approval passes', async () => {
    const r = await executeAction(action(), true, { source: 'scheduler' });
    expect(isGateRefusal(r)).toBe(false);
    expect(mockRefusals).toHaveLength(0);
  });

  it('the caller\'s approved_at is not enough: a stored row without evidence is refused', async () => {
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ passkey_credential_id: null })] });
    const r = await executeAction(action(), true, { source: 'scheduler' });
    expect(r).toMatchObject({ reason: 'APPROVAL_EVIDENCE_REQUIRED' });
    expect(mockRefusals[0]).toMatchObject({ claimPoint: 'scheduler', code: 'APPROVAL_EVIDENCE_REQUIRED' });
  });

  it('legacy approval (no approver, no hash) never authorizes', async () => {
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ approved_by: null, approved_content_hash: null, passkey_credential_id: null, passkey_verified_at: null })] });
    expect(isGateRefusal(await executeAction(action(), true, { source: 'manual' }))).toBe(true);
  });

  it('an approval at exactly 7 days is expired', async () => {
    const at = new Date(Date.now() - APPROVAL_LIFETIME_MS).toISOString();
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ approved_at: at, passkey_verified_at: at })] });
    const r = await executeAction(action(), true, { source: 'manual' });
    expect(r).toMatchObject({ reason: 'APPROVAL_EXPIRED' });
  });

  it('content changed after approval is refused', async () => {
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ target_id: 'urn:li:share:2' })] });
    const r = await executeAction(action(), true, { source: 'manual' });
    expect(r).toMatchObject({ reason: 'APPROVAL_CONTENT_CHANGED' });
  });

  it('another tenant\'s stored row is never read as evidence', async () => {
    const other = '00000000-0000-4000-8000-0000000000b9';
    mockDb = createFakeDb({ community_ai_actions: [storedRow({ tenant_id: other, organization_id: other })] });
    const r = await executeAction(action(), true, { source: 'manual' });
    expect(r).toMatchObject({ reason: 'HUMAN_APPROVAL_REQUIRED' });
  });

  it('an unreadable evidence read is refused', async () => {
    const realFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = realFrom(t);
      if (t === 'community_ai_actions') q.maybeSingle = () => ({ then: (res: any) => Promise.resolve({ data: null, error: { code: 'XX' } }).then(res) });
      return q;
    };
    const r = await executeAction(action(), true, { source: 'manual' });
    expect(r).toMatchObject({ reason: 'APPROVAL_EVIDENCE_REQUIRED', error: 'APPROVAL_EVIDENCE_UNREADABLE' });
  });
});
