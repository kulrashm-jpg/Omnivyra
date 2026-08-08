import type { NextApiRequest } from 'next';
import campaignBaselineHandler from '../../../pages/api/community-ai/campaign-baseline';
import {
  actionLogStore,
  buildQuery,
  createMockRes,
  networkIntelligenceStore,
  playbookStore,
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

describe('Community-AI Campaign Baseline', () => {
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
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', playbook_id: 'playbook-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('aligns baseline window and computes lift', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push({
      id: 'playbook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      created_at: '2024-02-01T00:00:00.000Z',
      name: 'Default Playbook',
    });
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'campaign-1',
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
        discovered_user_id: 'campaign-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'baseline-1',
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
        last_action_type: 'comment',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'other-1',
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
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', playbook_id: 'playbook-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.windows.campaign_window.start).toBe('2024-02-01T00:00:00.000Z');
    expect(payload.windows.baseline_window.end).toBe('2024-02-01T00:00:00.000Z');

    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    expect(byMetric.get('eligible_users').campaign_value).toBe(1);
    expect(byMetric.get('eligible_users').baseline_value).toBe(1);
    expect(byMetric.get('actions_created').campaign_value).toBe(3);
    expect(byMetric.get('actions_created').baseline_value).toBe(1);
    expect(byMetric.get('actions_executed').campaign_value).toBe(2);
    expect(byMetric.get('actions_executed').baseline_value).toBe(0);
    expect(byMetric.get('execution_rate').campaign_value).toBeCloseTo(2 / 3);
    expect(byMetric.get('execution_rate').baseline_value).toBeCloseTo(0);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
