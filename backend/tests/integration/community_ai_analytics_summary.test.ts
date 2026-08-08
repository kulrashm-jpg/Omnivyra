import type { NextApiRequest } from 'next';
import networkIntelligenceHandler from '../../../pages/api/community-ai/network-intelligence';
import playbookEffectivenessHandler from '../../../pages/api/community-ai/playbook-effectiveness';
import executiveSummaryHandler from '../../../pages/api/community-ai/executive-summary';
import {
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

describe('Community-AI Network Intelligence', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns tenant-scoped records and aggregates', async () => {
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
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records).toHaveLength(2);
    expect(payload.summaries.totals.discovered_users).toBe(2);
    expect(payload.summaries.totals.actions_created).toBe(4);
    expect(payload.summaries.totals.actions_executed).toBe(2);
    const playbookSummary = payload.summaries.by_playbook.find(
      (entry: any) => entry.key === 'playbook-1'
    );
    expect(playbookSummary.actions_created).toBe(4);
    expect(playbookSummary.actions_executed).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Playbook Effectiveness', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns correct counts and rates', async () => {
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
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'automate',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records).toHaveLength(1);
    const record = payload.records[0];
    expect(record.discovered_users_count).toBe(2);
    expect(record.eligible_users_count).toBe(1);
    expect(record.ineligible_users_count).toBe(1);
    expect(record.actions_created_count).toBe(4);
    expect(record.actions_executed_count).toBe(2);
    expect(record.execution_rate).toBe(0.5);
    expect(record.automation_level).toBe('assist');
    expect(record.top_platforms[0].platform).toBe('linkedin');
  });

  it('filters by date range', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-old',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-01T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-01-01T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-new',
        discovery_source: 'post',
        first_seen_at: '2024-01-10T00:00:00.000Z',
        last_seen_at: '2024-01-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        start_date: '2024-01-05T00:00:00.000Z',
        end_date: '2024-01-12T00:00:00.000Z',
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records[0].discovered_users_count).toBe(1);
    expect(payload.records[0].actions_created_count).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Summary', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns correct executive metrics', async () => {
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
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-2',
        playbook_name: 'Growth Playbook',
        automation_level: 'automate',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-3',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.total_discovered_users).toBe(2);
    expect(summary.total_eligible_users).toBe(1);
    expect(summary.total_actions_created).toBe(4);
    expect(summary.total_actions_executed).toBe(2);
    expect(summary.execution_rate).toBe(0.5);
    expect(summary.automation_mix.assist).toBeCloseTo(0.5);
    expect(summary.automation_mix.automate).toBeCloseTo(0.5);
    expect(summary.top_playbooks_by_volume[0].playbook_id).toBe('playbook-1');
    expect(summary.top_playbooks_by_quality[0].playbook_id).toBe('playbook-1');
  });

  it('filters by date range', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-old',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-01T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-01T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-new',
        discovery_source: 'post',
        first_seen_at: '2024-01-10T00:00:00.000Z',
        last_seen_at: '2024-01-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        start_date: '2024-01-05T00:00:00.000Z',
        end_date: '2024-01-12T00:00:00.000Z',
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.total_discovered_users).toBe(1);
    expect(summary.total_actions_created).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
