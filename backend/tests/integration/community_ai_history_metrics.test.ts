import type { NextApiRequest } from 'next';
import historyHandler from '../../../pages/api/community-ai/actions/history';
import metricsHandler from '../../../pages/api/community-ai/metrics';
import {
  actionLogStore,
  actionStore,
  buildQuery,
  createMockRes,
  resetCommunityAiStores,
  seedPlaybook,
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

describe('Community-AI Action History', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    seedPlaybook({
      execution_modes: {
        api_allowed: false,
        rpa_allowed: false,
        manual_only: true,
      },
    });
  });

  it('rejects history request without tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET', query: { action_id: 'action-20' } } as NextApiRequest;
    const res = createMockRes();
    await historyHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects cross-tenant history access', async () => {
    setRole('VIEW_ONLY');
    actionStore.set('action-21', {
      id: 'action-21',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
    });
    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'action-21',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await historyHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns ordered audit log records', async () => {
    setRole('VIEW_ONLY');
    actionStore.set('action-22', {
      id: 'action-22',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
    });
    actionLogStore.push(
      {
        action_id: 'action-22',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'approved',
        event_payload: null,
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        action_id: 'action-22',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'executed',
        event_payload: { ok: true },
        created_at: '2024-01-02T00:00:00.000Z',
      }
    );
    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'action-22',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await historyHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const events = res.json.mock.calls[0][0].events;
    expect(events[0].event_type).toBe('executed');
    expect(events[1].event_type).toBe('approved');
  });

  it('filters history by action_id', async () => {
    setRole('VIEW_ONLY');
    actionStore.set('action-23', {
      id: 'action-23',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
    });
    actionLogStore.push(
      {
        action_id: 'action-23',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'approved',
        event_payload: null,
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        action_id: 'action-24',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'approved',
        event_payload: null,
        created_at: '2024-01-03T00:00:00.000Z',
      }
    );
    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'action-23',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await historyHandler(req, res);
    const events = res.json.mock.calls[0][0].events;
    expect(events).toHaveLength(1);
    expect(events[0].action_id).toBe('action-23');
  });
});

describe('Community-AI Metrics', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    seedPlaybook();
  });

  it('rejects metrics request without tenant/org', async () => {
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await metricsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns correct shape and counts', async () => {
    actionStore.set('m1', {
      id: 'm1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      status: 'pending',
      risk_level: 'high',
    });
    actionStore.set('m2', {
      id: 'm2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      status: 'executed',
      risk_level: 'low',
    });
    actionLogStore.push({
      action_id: 'm2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      event_type: 'executed',
      event_payload: null,
      created_at: new Date().toISOString(),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await metricsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.total_actions).toBe(2);
    expect(payload.actions_by_status.pending).toBe(1);
    expect(payload.actions_by_status.executed).toBe(1);
    expect(payload.actions_by_risk.high).toBe(1);
    expect(payload.actions_by_risk.low).toBe(1);
    expect(typeof payload.last_24h_executions).toBe('number');
  });

  it('does not include cross-tenant actions', async () => {
    actionStore.set('m3', {
      id: 'm3',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      status: 'failed',
      risk_level: 'high',
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await metricsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.total_actions).toBe(0);
  });
});
