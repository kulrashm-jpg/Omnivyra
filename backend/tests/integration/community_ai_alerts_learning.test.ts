import type { NextApiRequest } from 'next';
import executiveAlertsHandler from '../../../pages/api/community-ai/executive-alerts';
import playbookLearningHandler from '../../../pages/api/community-ai/playbook-learning';
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

describe('Community-AI Executive Alerts', () => {
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
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic alerts without mutations', async () => {
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
        discovered_user_id: 'user-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
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
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
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
        total_actions_created: 3,
        total_actions_executed: 3,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
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
        total_actions_executed: 1,
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
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.alerts.length).toBeGreaterThan(0);
    expect(payload.alerts[0]).toEqual(
      expect.objectContaining({
        alert_type: expect.any(String),
        severity: expect.any(String),
        title: expect.any(String),
        reason: expect.any(String),
        supporting_metrics: expect.any(Object),
        first_detected_at: expect.anything(),
      })
    );
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Playbook Learning', () => {
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
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic learning states', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push(
      {
        id: 'playbook-1',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        created_at: '2024-02-01T00:00:00.000Z',
        name: 'Default Playbook',
      },
      {
        id: 'playbook-2',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        created_at: '2024-02-05T00:00:00.000Z',
        name: 'Secondary Playbook',
      }
    );
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 2,
        last_action_type: 'follow',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-03T00:00:00.000Z',
        last_seen_at: '2024-02-03T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-baseline-1',
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
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p2-only-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Secondary Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-12T01:00:00.000Z',
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
        playbook_id: 'playbook-3',
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
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const byPlaybook = new Map(payload.records.map((record: any) => [record.playbook_id, record]));
    const record1 = byPlaybook.get('playbook-1');
    const record2 = byPlaybook.get('playbook-2');

    expect(record1.learning_state).toBe('improving');
    expect(record1.confidence).toBe('low');
    expect(record1.supporting_signals.length).toBeGreaterThan(0);
    expect(record2.learning_state).toBe('insufficient_data');
    expect(actionLogStore.length).toBe(0);

    const res2 = createMockRes();
    await playbookLearningHandler(req, res2);
    expect(res2.json.mock.calls[0][0]).toEqual(payload);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
