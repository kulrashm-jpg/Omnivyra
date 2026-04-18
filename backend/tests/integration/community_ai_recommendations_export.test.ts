import type { NextApiRequest } from 'next';
import recommendationsHandler from '../../../pages/api/community-ai/recommendations';
import executiveExportHandler from '../../../pages/api/community-ai/executive-export';
import { renderExecutiveSummaryPdf } from '../../services/export/executivePdfRenderer';
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

jest.mock('../../services/export/executivePdfRenderer', () => ({
  renderExecutiveSummaryPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Recommendations', () => {
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
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic recommendations and requires review', async () => {
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
        discovered_user_id: 'rec-1',
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
        discovered_user_id: 'rec-2',
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
        discovered_user_id: 'rec-3',
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
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.recommendations.length).toBeGreaterThan(0);
    payload.recommendations.forEach((rec: any) => {
      expect(rec.requires_review).toBe(true);
    });
    expect(actionLogStore.length).toBe(0);

    const res2 = createMockRes();
    await recommendationsHandler(req, res2);
    expect(res2.json.mock.calls[0][0]).toEqual(payload);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Export', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    (renderExecutiveSummaryPdf as jest.Mock).mockClear();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveExportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns PDF headers and enforces tenant isolation', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'export-1',
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
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'export-2',
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
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveExportHandler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(renderExecutiveSummaryPdf).toHaveBeenCalled();
  });
});
