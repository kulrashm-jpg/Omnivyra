/**
 * Prompt 3, LD-4 — a journey step is NOT an auto-rule execution (regression for
 * the D1 defect where the adapter called the engine with source:'auto' +
 * auto:true and every human-approved journey step was consumed as 'skipped'
 * whenever auto rules were off).
 *
 * The adapter, its real pre-flight (enginePreflight) and the REAL engine
 * (executeAction → runExecution, with its real tenant-policy and approval gates)
 * run against the in-memory fake database. Only the platform connector, the L-3
 * recipient lookup and the playbook/usage services are doubles. The claim is an
 * emulation of claim_community_ai_action_for_execution (policy → evidence → CAS
 * approved → executing); the database function itself is proven in the RS suites.
 *
 *   1. default tenant policy (auto rules OFF) + a human-approved step → it
 *      EXECUTES; the row ends 'executed', never 'skipped';
 *   2. tenant execution OFF → the row stays 'approved' (not consumed), nothing
 *      is claimed or sent, one refusal record (claim point 'orchestration');
 *   3. a step with no approval of record → refused, nothing claimed or written;
 *   4. the engine is called with source 'orchestration' and never auto:true.
 */
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence, approvedAgo } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
let mockDecision: Record<string, unknown> = { allowed: true, code: null, auto_rules_enabled: false, policy_version: '2026-11-01T00:00:00.000Z' };
const mockRefusals: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'record_community_execution_refusal') { mockRefusals.push(args); return { data: true, error: null }; }
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  }),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: jest.fn(async (name: string) => (name === 'community_execution_policy_decision'
      ? { data: [{ ...mockDecision }], error: null }
      : { data: null, error: { message: `unexpected rpc ${name}` } })),
  },
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
  rpaResultMayHaveActed: () => true,
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
jest.mock('../../services/playbooks/playbookService', () => ({ getPlaybookById: jest.fn(async () => ({ id: 'pb-1', status: 'active' })) }));
jest.mock('../../services/playbooks/playbookValidator', () => ({ validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })) }));
jest.mock('../../services/executionGuardrailService', () => ({ canExecuteAction: jest.fn(async () => ({ allowed: true })) }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({ executeAction: (...a: any[]) => mockConnector(...a) }));

import {
  createCommunityAdapter, enginePreflight, defaultPreflightDeps,
  type CommunityActionRow, type CommunityAdapterDeps, type RequestRow,
} from '../../services/orchestration/communityEngineAdapter';
import { executeAction } from '../../services/communityAiActionExecutor';
import { evaluateCommunityApprovalEvidence } from '../../services/communityApprovalBinding';
import { getCommunityExecutionPolicy, __resetCommunityAiPlatformPolicyCacheForTests } from '../../services/communityAiPlatformPolicyService';
import { CONTRACT_ORG, contractContext, expectContractResult } from './helpers/engineAdapterContractKit';
import { provenIdentity } from './helpers/communityIdentityFixture';

const ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx = contractContext({ channel: 'community', personId: '77777777-7777-4777-8777-777777777777', now: new Date().toISOString() });

const baseRow = (): CommunityActionRow & Record<string, unknown> => ({
  id: ACTION_ID, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG,
  platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:activity:123',
  suggested_text: 'Thanks for sharing this.', final_text: null, playbook_id: 'pb-1',
  requires_human_approval: true, risk_level: 'low', status: 'approved', execution_mode: 'api',
  scheduled_at: null, execution_correlation_id: null, execution_result: null, intent_classification: null,
  cancel_requested_at: null, dispatch_lease_id: null,
});

const stored = () => mockDb.tables.community_ai_actions.find((r) => r.id === ACTION_ID)!;

function adapterWorld(opts: { policyUnreadableAfterClaim?: boolean } = {}) {
  let req: RequestRow | null = null;
  const engineCalls: Array<Record<string, unknown> | undefined> = [];
  const claimCorrelations: string[] = [];
  let claims = 0;
  const deps: CommunityAdapterDeps = {
    async getOrCreateRequest() {
      req ??= { id: 'req-1', state: 'requested', external_ref: null, detail: null, updated_at: ctx.now };
      return { ...req };
    },
    async transitionRequest(_org, _task, from, patch) {
      if (!req || req.state !== from) return false;
      req = { ...req, state: patch.state, external_ref: patch.external_ref ?? req.external_ref, detail: patch.detail ?? req.detail, updated_at: ctx.now };
      return true;
    },
    binding: { resolve: async () => ({ kind: 'bound', actionId: ACTION_ID, identity: provenIdentity }) },
    async readAction(org, id) {
      const r = mockDb.tables.community_ai_actions.find((x) => x.id === id && x.organization_id === org);
      return r ? ({ ...r } as CommunityActionRow) : null;
    },
    // Emulates claim_community_ai_action_for_execution: policy → evidence → CAS.
    async claimAction(org, id, _now, correlationId) {
      claims += 1;
      claimCorrelations.push(correlationId);
      const decision = await getCommunityExecutionPolicy({ organizationId: org, tenantId: org });
      const r = stored();
      if (!decision.ok || !evaluateCommunityApprovalEvidence(r as never).ok) return false;
      if (r.status !== 'approved' || r.cancel_requested_at || r.id !== id || r.organization_id !== org) return false;
      r.status = 'executing';
      // As the RPC does: the claim carries the attempt's correlation id.
      r.execution_correlation_id = correlationId;
      if (opts.policyUnreadableAfterClaim) {
        // The policy turns unreadable between the claim and the engine's own gate.
        __resetCommunityAiPlatformPolicyCacheForTests();
        mockDecision = { allowed: 'unreadable' } as never;
      }
      return true;
    },
    preflight: (row) => enginePreflight(row, defaultPreflightDeps),
    async channelPermitted() { return true; },
    executeAction: (async (action: any, approved: boolean, options?: Record<string, unknown>) => {
      engineCalls.push(options);
      return executeAction(action, approved, options as never);
    }) as unknown as CommunityAdapterDeps['executeAction'],
  };
  return { adapter: createCommunityAdapter(deps), engineCalls, claims: () => claims, claimCorrelations };
}

beforeEach(() => {
  __resetCommunityAiPlatformPolicyCacheForTests();
  mockRefusals.length = 0;
  mockDecision = { allowed: true, code: null, auto_rules_enabled: false, policy_version: '2026-11-01T00:00:00.000Z' };
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:comment:1' });
});

describe('LD-4: a human-approved journey step is not an auto-rule execution', () => {
  it('default policy (auto rules OFF): the approved step EXECUTES and is never left skipped', async () => {
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const w = adapterWorld();
    const r = await w.adapter.execute(ctx);
    expectContractResult(w.adapter, r);
    expect(r.disposition).toBe('completed');
    expect(stored().status).toBe('executed');
    expect(mockConnector).toHaveBeenCalledTimes(1);
    expect(w.claims()).toBe(1);
    expect(w.engineCalls).toHaveLength(1);
    expect(w.engineCalls[0]).toMatchObject({ source: 'orchestration', persist: true, expected_from_statuses: ['executing'] });
    expect(w.engineCalls[0]?.auto).not.toBe(true);
    expect(mockRefusals).toEqual([]);
  });

  it('tenant execution OFF: the step stays approved (not consumed); nothing is claimed or sent; one refusal record', async () => {
    mockDecision = { allowed: false, code: 'POLICY_EXECUTION_DISABLED', auto_rules_enabled: null, policy_version: '2026-11-01T00:00:00.000Z' };
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const before = { ...stored() };
    const w = adapterWorld();
    const r = await w.adapter.execute(ctx);
    expectContractResult(w.adapter, r);
    expect(r.disposition).toBe('needs_human');
    expect(stored()).toEqual(before);
    expect(stored().status).toBe('approved');
    expect(w.claims()).toBe(0);
    expect(w.engineCalls).toHaveLength(0);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRefusals).toHaveLength(1);
    expect(mockRefusals[0]).toMatchObject({ p_action_id: ACTION_ID, p_claim_point: 'orchestration', p_code: 'POLICY_EXECUTION_DISABLED' });
  });

  it('the platform kill switch: the same, the row is not consumed', async () => {
    mockDecision = { allowed: false, code: 'PLATFORM_KILL_SWITCH', auto_rules_enabled: null, policy_version: null };
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const w = adapterWorld();
    const r = await w.adapter.execute(ctx);
    expect(r.disposition).toBe('needs_human');
    expect(stored().status).toBe('approved');
    expect(w.claims()).toBe(0);
    expect(mockConnector).not.toHaveBeenCalled();
  });

  it.each([
    ['no approval of record (approved_at only, no evidence)', () => ({ ...baseRow(), approved_at: approvedAgo() })],
    ['an expired approval (older than 7 days)', () => withApprovalEvidence(baseRow(), { approvedAt: approvedAgo(8 * 24 * 3600_000) })],
    ['an AI-cleared row (requires_human_approval=false) with no evidence', () => ({ ...baseRow(), requires_human_approval: false, approved_at: approvedAgo() })],
  ])('%s: refused before the claim; nothing is consumed or sent', async (_n, make) => {
    mockDb = createFakeDb({ community_ai_actions: [make()] });
    const before = { ...stored() };
    const w = adapterWorld();
    const r = await w.adapter.execute(ctx);
    expectContractResult(w.adapter, r);
    expect(r.disposition).toBe('needs_human');
    expect(stored()).toEqual(before);
    expect(w.claims()).toBe(0);
    expect(w.engineCalls).toHaveLength(0);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(mockRefusals).toHaveLength(1);
    expect(mockRefusals[0]).toMatchObject({ p_claim_point: 'orchestration' });
  });

  it('F1: one correlation id per attempt — the claim and the engine get the same id', async () => {
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const w = adapterWorld();
    await w.adapter.execute(ctx);
    expect(w.claimCorrelations).toEqual([ctx.executionTaskId]);
    expect(w.engineCalls[0]?.correlation_id).toBe(ctx.executionTaskId);
  });

  it('F1: a post-claim pre-dispatch refusal (policy unreadable) gives the claim back: approved, re-claimable', async () => {
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const w = adapterWorld({ policyUnreadableAfterClaim: true });
    await w.adapter.execute(ctx);
    expect(w.claims()).toBe(1);
    expect(mockConnector).not.toHaveBeenCalled();
    expect(stored().status).toBe('approved');
    // Re-claimable: a fresh attempt (new request) with a readable policy executes it.
    __resetCommunityAiPlatformPolicyCacheForTests();
    mockDecision = { allowed: true, code: null, auto_rules_enabled: false, policy_version: '2026-11-01T00:00:00.000Z' };
    const w2 = adapterWorld();
    const r2 = await w2.adapter.execute(contractContext({ channel: 'community', personId: ctx.personId, now: new Date().toISOString(), executionTaskId: '55555555-5555-4555-8555-555555555555' }));
    expect(r2.disposition).toBe('completed');
    expect(stored().status).toBe('executed');
    expect(mockConnector).toHaveBeenCalledTimes(1);
  });

  it('an unreadable policy waits (transient) and consumes nothing', async () => {
    mockDecision = { allowed: 'maybe' } as never;
    mockDb = createFakeDb({ community_ai_actions: [withApprovalEvidence(baseRow(), { approvedAt: approvedAgo() })] });
    const w = adapterWorld();
    const r = await w.adapter.execute(ctx);
    expect(r.disposition).toBe('wait');
    expect(stored().status).toBe('approved');
    expect(w.claims()).toBe(0);
  });
});
