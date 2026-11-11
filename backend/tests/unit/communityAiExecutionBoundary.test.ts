/**
 * Final execution boundary (runExecution, reached through executeAction): the
 * platform call happens here, so automation and scheduled dispatch must be
 * refused here even if a caller skipped its own check.
 *   - automated invocations (source 'auto' or auto: true) need an explicit
 *     auto_rules_enabled — refused when the policy row is missing, unreadable
 *     or turns auto rules off;
 *   - scheduled dispatch needs an approval of record (approved_at);
 *   - manual (human-initiated) execution still needs a persisted approval
 *     (approved_at): D-01, W1 retained under CR-X-01, where round 3 let a
 *     manual run proceed with no policy row.
 * The platform connectors are spies: a refusal must leave them uncalled.
 */

let policy: Record<string, unknown>;

jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  // Prompt 3: the legacy knobs below, read as the tenant execution decision.
  getCommunityExecutionPolicy: ((legacy: any) => jest.fn((..._a: any[]) =>
    require('../helpers/communityPolicyDecisionShim').asExecutionDecision(legacy())))(jest.fn(async () => policy)),
}));
jest.mock('../../services/communityAiActionExecutorContracts', () => {
  const actual = jest.requireActual('../../services/communityAiActionExecutorContracts');
  return {
    ...actual,
    recordExecutionMetric: jest.fn(async () => undefined),
    resolveExecutionMode: jest.fn(async () => 'api'),
    loadHistoryMetrics: jest.fn(async () => null),
    runApiExecution: jest.fn(async () => ({ ok: true, status: 'executed' })),
    runRpaExecution: jest.fn(async () => ({ ok: true, status: 'executed' })),
    prepareBrowserDispatch: jest.fn(() => ({ ok: true, status: 'dispatched' })),
  };
});
jest.mock('../../services/communityAiActionLogService', () => ({
  logCommunityAiActionEvent: jest.fn(async () => undefined),
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => ({ id: 'pb-1', name: 'Engage', status: 'active' })),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({
  validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })),
}));
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => null) }));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn(async () => ({ success: true })) }));
// L-3 recipient recheck (W1) is not under test here: allowed.
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: jest.fn(async () => ({ ok: true, basis: 'recipient_allowed', recipient: { platform: 'linkedin', platformUserId: 'li-1', personId: null } })),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
// Prompt 3: an in-memory database holding the stored action row (with its
// approval of record), and the claim RPC emulated over it
// (helpers/communityClaimRpcEmulation) with the same policy knobs.
let mockDb: any = null;
const mockFakeDb = () => (mockDb ??= require('./helpers/communityExecutionFakeDb').createFakeDb({ community_ai_actions: [] }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockFakeDb().from(t),
  ownedDbRpc: (name: string, args: any) => require('./helpers/communityClaimRpcEmulation')
    .communityRpcEmulation(() => mockFakeDb(), () => (policy && (policy as any).execution_enabled === true
      ? { allowed: true, code: null, auto_rules_enabled: (policy as any).auto_rules_enabled === true }
      : { allowed: false, code: 'PLATFORM_KILL_SWITCH', auto_rules_enabled: null })).rpc(name, args),
}));

import { executeAction as realExecuteAction } from '../../services/communityAiActionExecutorRuntime';
import { withApprovalEvidence, approvedAgo } from '../helpers/communityApprovalEvidenceFixture';

/**
 * Prompt 3: an action with approved_at was approved by a person through approve.ts,
 * so its stored row carries the approval of record (approver, content binding,
 * passkey, < 7 days). One without approved_at is stored as it is.
 */
const executeAction: typeof realExecuteAction = (a: any, approved, options) => {
  const stored = typeof a.approved_at === 'string' ? withApprovalEvidence({ status: 'approved', ...a }, { approvedAt: approvedAgo() }) : { status: 'approved', ...a };
  mockDb = null;
  mockFakeDb().tables.community_ai_actions = [stored];
  // SEC3-F3: an external mode needs a held claim; the executor takes it itself.
  return realExecuteAction(stored as any, approved, { persist: true, ...(options || {}) });
};
import { runApiExecution, runRpaExecution, prepareBrowserDispatch } from '../../services/communityAiActionExecutorContracts';

const ALLOW_AUTO = { execution_enabled: true, auto_rules_enabled: true, require_human_approval: false };
// The no-row default after CR-X-01 (W1's D-01 default: approval required).
const MISSING_ROW = { execution_enabled: true, auto_rules_enabled: false, require_human_approval: true };
const APPROVED_AT = '2026-11-03T00:00:00Z';
const UNREADABLE = { execution_enabled: false, auto_rules_enabled: false, require_human_approval: true };

const action = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'act-1',
    tenant_id: 'org-1',
    organization_id: 'org-1',
    platform: 'linkedin',
    action_type: 'reply',
    target_id: 'comment-1',
    suggested_text: 'Thanks!',
    playbook_id: 'pb-1',
    execution_mode: 'api',
    requires_human_approval: false,
    risk_level: 'low',
    ...overrides,
  }) as any;

const sideEffects = () =>
  (runApiExecution as jest.Mock).mock.calls.length +
  (runRpaExecution as jest.Mock).mock.calls.length +
  (prepareBrowserDispatch as jest.Mock).mock.calls.length;

describe('community AI final execution boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    policy = { ...ALLOW_AUTO };
  });

  describe.each([
    ['auto-rule path', { source: 'auto' as const }],
    ['automationService path', { source: 'auto' as const, auto: true }],
    ['auto flag without a source', { auto: true }],
  ])('%s', (_name, opts) => {
    it('refuses when the policy row is missing (auto rules not explicitly enabled)', async () => {
      policy = { ...MISSING_ROW };
      const result = await executeAction(action(), true, opts as any);
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(sideEffects()).toBe(0);
    });

    it('refuses when the policy is unreadable', async () => {
      policy = { ...UNREADABLE };
      const result = await executeAction(action(), true, opts as any);
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(sideEffects()).toBe(0);
    });

    it('refuses when auto rules are ambiguous (not a boolean true)', async () => {
      policy = { ...ALLOW_AUTO, auto_rules_enabled: 'true' };
      const result = await executeAction(action(), true, opts as any);
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(sideEffects()).toBe(0);
    });

    it('CR-X-01: even with auto rules enabled, no approved_at means no execution', async () => {
      const result = await executeAction(action(), true, opts as any);
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' });
      expect(sideEffects()).toBe(0);
    });

    it('positive control: runs when the policy explicitly enables auto rules', async () => {
      const result = await executeAction(action({ approved_at: APPROVED_AT }), true, opts as any);
      expect(result).toMatchObject({ ok: true, status: 'executed' });
      expect(runApiExecution).toHaveBeenCalledTimes(1);
    });
  });

  describe('scheduled dispatch', () => {
    it('refuses an approved row with no approval of record (approved_at)', async () => {
      const result = await executeAction(action({ status: 'approved', approved_at: null }), true, { source: 'scheduler' });
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' });
      expect(sideEffects()).toBe(0);
    });

    it('refuses when the policy is unreadable, even with approved_at', async () => {
      policy = { ...UNREADABLE };
      const result = await executeAction(action({ approved_at: '2026-11-03T00:00:00Z' }), true, { source: 'scheduler' });
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(sideEffects()).toBe(0);
    });

    it('positive control: runs a row approved through the approve route (approved_at set), with or without a policy row', async () => {
      policy = { ...MISSING_ROW };
      const result = await executeAction(action({ approved_at: '2026-11-03T00:00:00Z' }), true, { source: 'scheduler' });
      expect(result).toMatchObject({ ok: true, status: 'executed' });
      expect(runApiExecution).toHaveBeenCalledTimes(1);
    });
  });

  describe('manual (human-initiated) execution', () => {
    it('CR-X-01: refuses with no persisted approval, even with no policy row (W1 D-01)', async () => {
      policy = { ...MISSING_ROW };
      const result = await executeAction(action({ playbook_id: null }), true, { source: 'manual' });
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'HUMAN_APPROVAL_REQUIRED' });
      expect(sideEffects()).toBe(0);
    });

    it('runs with no policy row configured once approved_at is recorded', async () => {
      policy = { ...MISSING_ROW };
      const result = await executeAction(action({ playbook_id: null, approved_at: APPROVED_AT }), true, { source: 'manual' });
      expect(result).toMatchObject({ ok: true, status: 'executed' });
      expect(runApiExecution).toHaveBeenCalledTimes(1);
    });

    it('still refuses without the caller approval flag', async () => {
      const result = await executeAction(action({ approved_at: APPROVED_AT }), false, { source: 'manual' });
      expect(result).toMatchObject({ ok: false, error: 'APPROVAL_REQUIRED' });
      expect(sideEffects()).toBe(0);
    });

    it('still refuses while the policy is unreadable', async () => {
      policy = { ...UNREADABLE };
      const result = await executeAction(action(), true, { source: 'manual' });
      expect(result).toMatchObject({ ok: false, status: 'skipped', reason: 'PLATFORM_POLICY' });
      expect(sideEffects()).toBe(0);
    });
  });
});
