import type { NextApiRequest } from 'next';
import momComparisonHandler from '../../../pages/api/community-ai/mom-comparison';
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

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Month-over-Month Comparison', () => {
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
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('uses a different window than wow and computes deltas', async () => {
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
        discovered_user_id: 'user-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-2',
        discovery_source: 'comment',
        first_seen_at: '2024-01-21T00:00:00.000Z',
        last_seen_at: '2024-01-21T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-01-21T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-wow-only',
        discovery_source: 'comment',
        first_seen_at: '2024-02-04T00:00:00.000Z',
        last_seen_at: '2024-02-04T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
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
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    expect(byMetric.get('eligible_users').current_value).toBe(4);
    expect(byMetric.get('eligible_users').previous_value).toBe(0);
    expect(byMetric.get('actions_created').current_value).toBe(10);
    expect(byMetric.get('actions_created').previous_value).toBe(0);
    expect(byMetric.get('actions_executed').current_value).toBe(8);
    expect(byMetric.get('actions_executed').previous_value).toBe(0);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
