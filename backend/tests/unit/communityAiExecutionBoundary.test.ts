/**
 * Final execution boundary (runExecution, reached through executeAction): the
 * platform call happens here, so automation and scheduled dispatch must be
 * refused here even if a caller skipped its own check.
 *   - automated invocations (source 'auto' or auto: true) need an explicit
 *     auto_rules_enabled — refused when the policy row is missing, unreadable
 *     or turns auto rules off;
 *   - scheduled dispatch needs an approval of record (approved_at);
 *   - manual (human-initiated) execution is unchanged.
 * The platform connectors are spies: a refusal must leave them uncalled.
 */

let policy: Record<string, unknown>;

jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => policy),
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
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../db/writeOwner', () => {
  const chain: any = {
    insert: jest.fn(async () => ({ error: null })),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: null, error: null })),
  };
  return { ownedDbTable: jest.fn(() => chain) };
});

import { executeAction } from '../../services/communityAiActionExecutorRuntime';
import { runApiExecution, runRpaExecution, prepareBrowserDispatch } from '../../services/communityAiActionExecutorContracts';

const ALLOW_AUTO = { execution_enabled: true, auto_rules_enabled: true, require_human_approval: false };
const MISSING_ROW = { execution_enabled: true, auto_rules_enabled: false, require_human_approval: false };
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

    it('positive control: runs when the policy explicitly enables auto rules', async () => {
      const result = await executeAction(action(), true, opts as any);
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

  describe('manual (human-initiated) execution is unchanged', () => {
    it('runs with no policy row configured', async () => {
      policy = { ...MISSING_ROW };
      const result = await executeAction(action({ playbook_id: null }), true, { source: 'manual' });
      expect(result).toMatchObject({ ok: true, status: 'executed' });
      expect(runApiExecution).toHaveBeenCalledTimes(1);
    });

    it('still refuses without the caller approval flag', async () => {
      const result = await executeAction(action(), false, { source: 'manual' });
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
