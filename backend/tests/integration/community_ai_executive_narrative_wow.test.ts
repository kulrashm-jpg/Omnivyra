import type { NextApiRequest } from 'next';
import executiveNarrativeHandler from '../../../pages/api/community-ai/executive-narrative';
import wowComparisonHandler from '../../../pages/api/community-ai/wow-comparison';
import { evaluateCommunityAiExecutiveNarrative } from '../../services/omnivyraClientV1';
import {
  actionLogStore,
  buildQuery,
  createMockRes,
  networkIntelligenceStore,
  resetCommunityAiStores,
  setRole,
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

jest.mock('../../services/omnivyraClientV1', () => ({
  isOmniVyraEnabled: jest.fn().mockReturnValue(true),
  evaluateCommunityAiExecutiveNarrative: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      overview: 'Narrative overview',
      key_shifts: ['Shift one'],
      risks_to_watch: ['Risk one'],
      recommendations_to_review: ['Review one'],
      explicitly_not_recommended: ['Avoid one'],
      confidence_level: 0.72,
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Executive Narrative', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    (evaluateCommunityAiExecutiveNarrative as jest.Mock).mockClear();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns narrative and enforces tenant isolation', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Growth Playbook',
        automation_level: 'automate',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.narrative).toEqual(
      expect.objectContaining({
        overview: 'Narrative overview',
        key_shifts: ['Shift one'],
        risks_to_watch: ['Risk one'],
        recommendations_to_review: ['Review one'],
        explicitly_not_recommended: ['Avoid one'],
      })
    );
    const callArgs = (evaluateCommunityAiExecutiveNarrative as jest.Mock).mock.calls[0][0];
    expect(callArgs.executive_summary.total_discovered_users).toBe(1);
    expect(actionLogStore.length).toBe(0);
  });

  it('calls OmniVyra once', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);
    expect(evaluateCommunityAiExecutiveNarrative).toHaveBeenCalledTimes(1);
  });
});

describe('Community-AI Week-over-Week Comparison', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('separates windows and computes deltas', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-11T00:00:00.000Z',
        last_seen_at: '2024-02-11T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-3',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 0,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-03T00:00:00.000Z',
        last_seen_at: '2024-02-03T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-2',
        discovery_source: 'comment',
        first_seen_at: '2024-02-04T00:00:00.000Z',
        last_seen_at: '2024-02-04T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-04T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-other',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    expect(byMetric.get('eligible_users').current_value).toBe(2);
    expect(byMetric.get('eligible_users').previous_value).toBe(1);
    expect(byMetric.get('actions_created').current_value).toBe(3);
    expect(byMetric.get('actions_executed').current_value).toBe(2);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
