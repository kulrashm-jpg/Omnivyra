/**
 * H-1 (read error), kept under Prompt 3 (OD-1): the community execution policy is
 * tenant-scoped and fails closed. An unreadable policy refuses (POLICY_UNREADABLE),
 * is logged without the driver message and is never cached; a missing tenant row
 * refuses (POLICY_MISSING) — there is no global fallback and no permissive default.
 */

type PolicyRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

let policyRpc: PolicyRpc = async () => ({ data: [], error: null });
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const auditInserts: unknown[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return policyRpc(fn, args);
    }),
    from: jest.fn((table: string) => {
      if (table === 'audit_logs') {
        return {
          insert: (row: unknown) => {
            auditInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table in test: ${table}`);
    }),
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table === 'audit_logs') {
      return { insert: (row: unknown) => { auditInserts.push(row); return Promise.resolve({ error: null }); } };
    }
    throw new Error(`unexpected owned table in test: ${table}`);
  },
}));

jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: jest.fn(async () => ({ ok: true, status: 'executed' })),
  persistExecutionResult: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/communityAiActionLogService', () => ({
  logCommunityAiActionEvent: jest.fn(async () => undefined),
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: jest.fn(async () => []),
  getPlaybookById: jest.fn(async () => null),
}));
jest.mock('../../services/executionGuardrailService', () => ({
  canExecuteAction: jest.fn(async () => ({ allowed: true })),
}));

import {
  getCommunityExecutionPolicy,
  __resetCommunityAiPlatformPolicyCacheForTests,
} from '../../services/communityAiPlatformPolicyService';
import { evaluateAutoRules } from '../../services/communityAiAutoRuleService';
import { listPlaybooks } from '../../services/playbooks/playbookService';

const ORG = '00000000-0000-4000-8000-0000000000b1';
const scope = { organizationId: ORG, tenantId: ORG };

describe('community execution policy — unreadable store fails closed (H-1, OD-1)', () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    __resetCommunityAiPlatformPolicyCacheForTests();
    auditInserts.length = 0;
    rpcCalls.length = 0;
    (listPlaybooks as jest.Mock).mockClear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    debug.mockRestore();
  });

  it('a returned RPC error refuses with POLICY_UNREADABLE, logged without the driver message', async () => {
    policyRpc = async () => ({ data: null, error: { code: '42501', message: 'permission denied secret-ish detail' } });
    expect(await getCommunityExecutionPolicy(scope)).toEqual({ ok: false, code: 'POLICY_UNREADABLE' });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('COMMUNITY_AI_POLICY_UNREADABLE_FAIL_CLOSED');
    expect(logged).toContain('42501');
    expect(logged).not.toContain('secret-ish');
  });

  it('a thrown RPC refuses, without the error text in the log', async () => {
    policyRpc = async () => { throw new Error('connect ECONNREFUSED'); };
    expect(await getCommunityExecutionPolicy(scope)).toEqual({ ok: false, code: 'POLICY_UNREADABLE' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ECONNREFUSED');
  });

  it('the unreadable result is not cached: the next readable call returns the decision', async () => {
    policyRpc = async () => ({ data: null, error: { code: 'PGRST000' } });
    expect((await getCommunityExecutionPolicy(scope)).ok).toBe(false);
    policyRpc = async () => ({
      data: [{ allowed: true, code: null, auto_rules_enabled: false, policy_version: '2026-11-01T00:00:00Z' }],
      error: null,
    });
    expect(await getCommunityExecutionPolicy(scope)).toEqual({
      ok: true,
      policy: { execution_enabled: true, auto_rules_enabled: false },
      version: '2026-11-01T00:00:00Z',
    });
    expect(rpcCalls).toHaveLength(2);
  });

  it('missing tenant row (read ok, nothing configured) refuses POLICY_MISSING — no default allows execution', async () => {
    policyRpc = async () => ({ data: [{ allowed: false, code: 'POLICY_MISSING', auto_rules_enabled: null, policy_version: null }], error: null });
    expect(await getCommunityExecutionPolicy(scope)).toEqual({ ok: false, code: 'POLICY_MISSING' });
  });

  it('a stored tenant row is honoured as decided by the database', async () => {
    policyRpc = async () => ({ data: [{ allowed: true, code: null, auto_rules_enabled: true, policy_version: null }], error: null });
    expect(await getCommunityExecutionPolicy(scope)).toMatchObject({ ok: true, policy: { auto_rules_enabled: true } });
    expect(rpcCalls[0]).toEqual({ fn: 'community_execution_policy_decision', args: { p_org: ORG, p_tenant: ORG } });
  });

  it('evaluateAutoRules does not proceed to rule evaluation when the policy read errors', async () => {
    policyRpc = async () => ({ data: null, error: { code: '57014' } });
    const out = await evaluateAutoRules({
      tenant_id: ORG,
      organization_id: ORG,
      platform: 'linkedin',
      suggested_actions: [{ action_type: 'like', target_id: 'urn:1' }],
    } as any);
    expect(out.autoExecuted).toBe(0);
    expect(listPlaybooks).not.toHaveBeenCalled();
    expect(JSON.stringify(auditInserts)).toContain('auto_rules_enabled');
    expect(JSON.stringify(auditInserts)).toContain('POLICY_UNREADABLE');
  });

  it('evaluateAutoRules does not proceed when execution is allowed but auto rules are not', async () => {
    policyRpc = async () => ({ data: [{ allowed: true, code: null, auto_rules_enabled: false, policy_version: null }], error: null });
    const out = await evaluateAutoRules({
      tenant_id: ORG, organization_id: ORG, platform: 'linkedin',
      suggested_actions: [{ action_type: 'like', target_id: 'urn:1' }],
    } as any);
    expect(out.autoExecuted).toBe(0);
    expect(listPlaybooks).not.toHaveBeenCalled();
    expect(JSON.stringify(auditInserts)).toContain('POLICY_AUTO_RULES_DISABLED');
  });

  it('evaluateAutoRules reads THIS tenant\'s policy, and refuses a tenant/org mismatch without a read', async () => {
    policyRpc = async () => ({ data: [{ allowed: true, code: null, auto_rules_enabled: true, policy_version: null }], error: null });
    const out = await evaluateAutoRules({
      tenant_id: '00000000-0000-4000-8000-0000000000b2', organization_id: ORG, platform: 'linkedin',
      suggested_actions: [{ action_type: 'like', target_id: 'urn:1' }],
    } as any);
    expect(out.autoExecuted).toBe(0);
    expect(rpcCalls).toHaveLength(0);
    expect(JSON.stringify(auditInserts)).toContain('POLICY_SCOPE_INVALID');
  });
});
