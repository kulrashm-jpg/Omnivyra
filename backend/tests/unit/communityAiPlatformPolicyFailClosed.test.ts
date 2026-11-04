/**
 * H-1 (read error): an unreadable community_ai_platform_policy must fail
 * closed. A missing row (read succeeded, nothing configured) turns auto
 * rules off and leaves the manual defaults as they were.
 */

type PolicyRead = () => Promise<{ data: unknown; error: unknown }>;

let policyRead: PolicyRead = async () => ({ data: [], error: null });
const auditInserts: unknown[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'community_ai_platform_policy') {
        const chain: any = {
          select: () => chain,
          order: () => chain,
          limit: () => policyRead(),
        };
        return chain;
      }
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
  getCommunityAiPlatformPolicy,
  __resetCommunityAiPlatformPolicyCacheForTests,
} from '../../services/communityAiPlatformPolicyService';
import { evaluateAutoRules } from '../../services/communityAiAutoRuleService';
import { listPlaybooks } from '../../services/playbooks/playbookService';

describe('community AI platform policy — unreadable store fails closed (H-1)', () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    __resetCommunityAiPlatformPolicyCacheForTests();
    auditInserts.length = 0;
    (listPlaybooks as jest.Mock).mockClear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    debug.mockRestore();
  });

  it('a returned query error yields execution off, auto rules off, human approval required', async () => {
    policyRead = async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied secret-ish detail' },
    });
    const policy = await getCommunityAiPlatformPolicy();
    expect(policy.execution_enabled).toBe(false);
    expect(policy.auto_rules_enabled).toBe(false);
    expect(policy.require_human_approval).toBe(true);
    // Logged without the driver message.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('COMMUNITY_AI_POLICY_UNREADABLE_FAIL_CLOSED');
    expect(logged).toContain('42501');
    expect(logged).not.toContain('secret-ish');
  });

  it('a thrown read yields the fail-closed policy', async () => {
    policyRead = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const policy = await getCommunityAiPlatformPolicy();
    expect(policy).toMatchObject({
      execution_enabled: false,
      auto_rules_enabled: false,
      require_human_approval: true,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ECONNREFUSED');
  });

  it('the fail-closed result is not cached: the next readable call returns the stored row', async () => {
    policyRead = async () => ({ data: null, error: { code: 'PGRST000' } });
    expect((await getCommunityAiPlatformPolicy()).execution_enabled).toBe(false);
    policyRead = async () => ({
      data: [
        {
          execution_enabled: true,
          auto_rules_enabled: true,
          require_human_approval: false,
          updated_at: '2026-11-01T00:00:00Z',
          updated_by: null,
        },
      ],
      error: null,
    });
    const policy = await getCommunityAiPlatformPolicy();
    expect(policy.execution_enabled).toBe(true);
    expect(policy.updated_at).toBe('2026-11-01T00:00:00Z');
  });

  it('missing row (read ok, no policy configured) does not authorise auto rules and requires human approval (W1 D-01, CR-X-01)', async () => {
    policyRead = async () => ({ data: [], error: null });
    const policy = await getCommunityAiPlatformPolicy();
    expect(policy).toMatchObject({
      execution_enabled: true,
      auto_rules_enabled: false,
      require_human_approval: true,
    });
  });

  it('a stored row is honoured as written', async () => {
    policyRead = async () => ({
      data: [
        {
          execution_enabled: true,
          auto_rules_enabled: false,
          require_human_approval: true,
          updated_at: null,
          updated_by: null,
        },
      ],
      error: null,
    });
    const policy = await getCommunityAiPlatformPolicy();
    expect(policy.auto_rules_enabled).toBe(false);
    expect(policy.require_human_approval).toBe(true);
  });

  it('evaluateAutoRules does not proceed to rule evaluation when the policy read errors', async () => {
    policyRead = async () => ({ data: null, error: { code: '57014' } });
    const out = await evaluateAutoRules({
      tenant_id: 't1',
      organization_id: 'o1',
      platform: 'linkedin',
      suggested_actions: [{ action_type: 'like', target_id: 'urn:1' }],
    });
    expect(out.autoExecuted).toBe(0);
    expect(listPlaybooks).not.toHaveBeenCalled();
    expect(JSON.stringify(auditInserts)).toContain('auto_rules_enabled');
  });
});
