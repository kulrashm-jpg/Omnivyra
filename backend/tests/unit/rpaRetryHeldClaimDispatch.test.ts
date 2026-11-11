/**
 * SEC3-F1/F3 — the production RPA retry runner (runClaimedRetryAction) through the
 * REAL executor: the flush claims the action (claim point 'rpa_retry') with a
 * correlation id, and the runner forwards that id, so the executor's held-claim
 * check (F3) passes and the retry DISPATCHES. Without the id it would be refused
 * CLAIM_NOT_HELD before dispatch on every production retry.
 *
 * Real: rpaRetryQueue flush, rpaWorkerService wiring, the executor and its persist.
 * Emulated over the fake DB: the claim RPC (helpers/communityClaimRpcEmulation;
 * the SQL is proven in the RS suites). Spies: the platform connector.
 */
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
const mockRpc = (name: string, args: any) => require('./helpers/communityClaimRpcEmulation').communityRpcEmulation(() => mockDb).rpc(name, args);
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: (name: string, args: any) => mockRpc(name, args),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: (name: string, args: any) => mockRpc(name, args) },
}));
jest.mock('../../queue/bullmqClient', () => ({ withHeavyJobSlot: (fn: () => any) => fn() }));
jest.mock('../../services/rpaWorker/rpaEnv', () => ({
  rpaEnvReady: jest.fn(async () => ({ ok: true })),
  assertRpaEnvReady: jest.fn(),
  isProbeFailure: (r: any) => r && r.ok === false,
}));
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  getCommunityExecutionPolicy: jest.fn(async () => ({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: 'v1' })),
}));
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
jest.mock('../../services/usageEnforcementService', () => ({ checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb1' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

import { rpaSchedulerHooks, runClaimedRetryAction } from '../../services/rpaWorker/rpaWorkerService';

const A1 = '00000000-0000-0000-0000-0000000000f1';
const PAST = '2020-01-01T00:00:00.000Z';
const actionRow = () => withApprovalEvidence({
  id: A1, tenant_id: 'o1', organization_id: 'o1', platform: 'linkedin', action_type: 'like',
  target_id: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', suggested_text: null,
  execution_mode: 'api', status: 'approved', cancel_requested_at: null, playbook_id: 'pb1',
});
const retryRow = () => ({
  id: 'r1', action_id: A1, organization_id: 'o1', platform: 'linkedin', action_type: 'like',
  target_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', text: null,
  attempts: 1, max_attempts: 5, next_retry_at: PAST, claim_token: null, claimed_at: null,
});
const row = () => mockDb.tables.community_ai_actions[0];

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [actionRow()], rpa_retry_queue: [retryRow()] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockDb.unique.rpa_retry_queue = ['action_id'];
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:like:1' });
});

describe('production RPA retry: the claim\'s correlation id reaches the executor', () => {
  it('a retry with a held claim dispatches exactly once and ends executed', async () => {
    const out = await rpaSchedulerHooks.flushRetries({ limit_per_org: 10, max_orgs: 10 });
    expect(out.claimed).toBe(1);
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(row().status).toBe('executed');
    expect(row().execution_correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb.tables.rpa_retry_queue).toHaveLength(0);
  });

  it('the runner forwards ctx.correlationId; without it a held claim is not recognised (CLAIM_NOT_HELD), nothing sent', async () => {
    const corr = '3b1c1f7e-2f4c-4a51-9a1e-0000000000f1';
    Object.assign(row(), { status: 'executing', execution_correlation_id: corr });
    const wrong = await runClaimedRetryAction({ ...row() }, { correlationId: '3b1c1f7e-2f4c-4a51-9a1e-0000000000f2' });
    expect(wrong).toMatchObject({ ok: false, reason: 'CLAIM_NOT_HELD' });
    expect(mockConnector).not.toHaveBeenCalled();
    const right = await runClaimedRetryAction({ ...row() }, { correlationId: corr });
    expect(right.status).toBe('executed');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });
});
