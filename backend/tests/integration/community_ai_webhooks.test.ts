import type { NextApiRequest } from 'next';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import webhooksHandler from '../../../pages/api/community-ai/webhooks';
import { executeAction as executeCommunityAction } from '../../services/communityAiActionExecutor';
import { executeAction as executeLinkedinAction } from '../../services/platformConnectors/linkedinConnector';
import {
  actionStore,
  buildQuery,
  createMockRes,
  resetCommunityAiStores,
  seedConnectedAccount,
  seedPlaybook,
  setRole,
  tokenStore,
  webhookStore,
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

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: jest.fn().mockResolvedValue({ ok: true, platform: 'linkedin' }),
}));

jest.mock('../../auth/tokenStore', () => ({
  getToken: jest.fn(async (socialAccountId: string) => {
    const { socialAccountStore } = jest.requireActual('./communityAiTestHarness');
    const row = socialAccountStore.find((account: any) => account.id === socialAccountId);
    return row?.access_token ? { access_token: row.access_token, refresh_token: row.refresh_token ?? null } : null;
  }),
  isTokenExpiringSoon: jest.fn(() => false),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Webhooks', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    seedPlaybook();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    (global as any).fetch = undefined;
  });

  it('creates webhook per tenant', async () => {
    setRole('COMPANY_ADMIN');
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'failed',
        webhook_url: 'https://example.com/webhook',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await webhooksHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('enforces RBAC for webhook management', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        event_type: 'failed',
        webhook_url: 'https://example.com/webhook',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await webhooksHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('viewer can read webhooks', async () => {
    setRole('VIEW_ONLY');
    webhookStore.push({
      id: 'hook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      event_type: 'failed',
      webhook_url: 'https://example.com/webhook',
      is_active: true,
      created_at: new Date().toISOString(),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await webhooksHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.webhooks).toHaveLength(1);
  });

  it('calls webhook on action failure', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    webhookStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      event_type: 'failed',
      webhook_url: 'https://example.com/webhook',
      is_active: true,
    });
    (executeLinkedinAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'boom' });
    actionStore.set('webhook-1', {
      id: 'webhook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      execution_mode: 'api',
      status: 'approved',
      requires_human_approval: false,
    });
    await executeCommunityAction(actionStore.get('webhook-1'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('does not call cross-tenant webhooks', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    webhookStore.push({
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      event_type: 'failed',
      webhook_url: 'https://example.com/webhook',
      is_active: true,
    });
    (executeLinkedinAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'boom' });
    actionStore.set('webhook-2', {
      id: 'webhook-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'approved',
      requires_human_approval: false,
    });
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'webhook-2',
        approved: true,
      },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
