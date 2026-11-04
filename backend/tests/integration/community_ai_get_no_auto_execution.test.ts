/**
 * P-8: viewing a community-AI dashboard (GET) must never cause an external
 * action. The three GET routes run the real evaluateEngagement and the real
 * evaluateAutoRules with a matching active auto rule and a policy that allows
 * auto rules; only the executor is a spy. The GETs must still return their
 * read-only payload, record the match as a pending action, and never call
 * executeAction. The ingestion worker path (autoExecute: true) still runs the
 * rule, so automation is not silently dropped.
 */
import type { NextApiRequest } from 'next';
import dashboardHandler from '../../../pages/api/community-ai/dashboard';
import platformHandler from '../../../pages/api/community-ai/platform/[platform]';
import postHandler from '../../../pages/api/community-ai/post/[platform]/[postId]';
import { evaluateEngagement } from '../../services/communityAiOmnivyraService';
import { executeAction } from '../../services/communityAiActionExecutor';
import { evaluateCommunityAiEngagement } from '../../services/omnivyraClientV1';
import { getProfile } from '../../services/companyProfileService';
import {
  actionStore,
  actionLogStore,
  autoRuleStore,
  buildQuery,
  createMockRes,
  resetCommunityAiStores,
} from './communityAiTestHarness';

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['tenant-1'],
    defaultCompanyId: 'tenant-1',
  }),
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['tenant-1'],
    defaultCompanyId: 'tenant-1',
  }),
}));
jest.mock('../../services/companyProfileService', () => ({ getProfile: jest.fn() }));
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: jest.fn().mockReturnValue(true),
  evaluateCommunityAiEngagement: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

// Policy explicitly allows auto rules, so the only thing that can stop the
// GET from executing is the GET path itself.
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({
    execution_enabled: true,
    auto_rules_enabled: true,
    require_human_approval: false,
    updated_at: '2026-11-01T00:00:00Z',
    updated_by: null,
  })),
}));

const playbook = {
  id: 'pb-1',
  name: 'Engage',
  status: 'active',
  execution_modes: { api: true },
};
jest.mock('../../services/playbooks/playbookService', () => ({
  listPlaybooks: jest.fn(async () => [playbook]),
  getPlaybookById: jest.fn(async () => playbook),
}));
jest.mock('../../services/playbooks/playbookEvaluator', () => ({
  evaluatePlaybookForEvent: jest.fn(() => ({
    primary_playbook: playbook,
    decision: { execution_mode: 'api', tone: { style: 'friendly' }, requires_approval: false },
  })),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({
  validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true, requires_approval: false })),
}));
jest.mock('../../services/executionGuardrailService', () => ({
  canExecuteAction: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/communityAiActionExecutor', () => ({
  executeAction: jest.fn(async () => ({ ok: true, status: 'executed' })),
  persistExecutionResult: jest.fn(async () => ({ ok: true })),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

const suggestedReply = {
  platform: 'linkedin',
  action_type: 'reply',
  target_id: 'comment-1',
  suggested_text: 'Thanks for sharing!',
  intent_scores: { community_engagement: 0.8 },
  risk_level: 'low',
  requires_human_approval: false,
  content_type: 'text',
};

const get = (query: Record<string, string>) =>
  ({ method: 'GET', headers: {}, query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', ...query } }) as unknown as NextApiRequest;

describe('community AI GET routes never auto-execute (P-8)', () => {
  beforeEach(() => {
    resetCommunityAiStores();
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValue(null);
    (executeAction as jest.Mock).mockClear();
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValue({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [suggestedReply],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    autoRuleStore.push({
      id: 'rule-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      rule_name: 'Auto reply',
      condition: { platform: 'linkedin' },
      action_type: 'reply',
      max_risk_level: 'medium',
      is_active: true,
    });
  });

  const routes: Array<[string, (req: NextApiRequest, res: any) => unknown, Record<string, string>]> = [
    ['dashboard', dashboardHandler as any, {}],
    ['platform/[platform]', platformHandler as any, { platform: 'linkedin' }],
    ['post/[platform]/[postId]', postHandler as any, { platform: 'linkedin', postId: 'post-1' }],
  ];

  it.each(routes)('GET %s returns its payload, records the match as pending, and calls no executor', async (_name, handler, query) => {
    const res = createMockRes();
    await handler(get(query), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(executeAction).not.toHaveBeenCalled();
    expect(actionLogStore.some((row) => row.event_type === 'auto_executed')).toBe(false);
    const rows = Array.from(actionStore.values());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('CR-X-01 (W1 D-01): the ingestion worker path records the match as pending and executes nothing without a human approval', async () => {
    await evaluateEngagement(
      { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', context: { source: 'engagement_evaluation' } } as any,
      { autoExecute: true },
    );
    expect(executeAction).not.toHaveBeenCalled();
    expect(Array.from(actionStore.values()).every((row) => row.status === 'pending')).toBe(true);
  });

  it('positive control: the ingestion worker path (autoExecute: true) runs the matching rule on a human-approved row', async () => {
    // What pages/api/community-ai/actions/approve.ts leaves behind (W1: a rule never approves).
    actionStore.set('act-approved', {
      id: 'act-approved', tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin',
      action_type: 'reply', target_id: 'comment-1', suggested_text: 'Thanks for sharing!', status: 'approved',
      approved_at: '2026-11-01T00:00:00Z', approved_by: 'user-1', requires_human_approval: true,
      execution_mode: 'api', playbook_id: 'pb-1', risk_level: 'low',
    });
    await evaluateEngagement(
      { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', context: { source: 'engagement_evaluation' } } as any,
      { autoExecute: true },
    );
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect((executeAction as jest.Mock).mock.calls[0][2]).toMatchObject({ source: 'auto' });
  });

  it('evaluateEngagement without options does not execute (fail closed for any new caller)', async () => {
    await evaluateEngagement({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' } as any);
    expect(executeAction).not.toHaveBeenCalled();
  });
});
