import type { NextApiRequest } from 'next';
import actionsHandler from '../../../pages/api/community-ai/actions';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import {
  actionLogStore,
  actionStore,
  analyticsStore,
  autoRuleStore,
  buildQuery,
  createMockRes,
  notificationStore,
  playbookStore,
  roleStore,
  scheduledPostStore,
  seedConnectedAccount,
  seedPlaybook,
  setRole,
  socialAccountStore,
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

// Bypass real AES decryption — read plaintext from socialAccountStore.
jest.mock('../../auth/tokenStore', () => {
  const harness = jest.requireActual('./communityAiTestHarness');
  return {
    getToken: jest.fn(async (socialAccountId: string) => {
      const row = harness.socialAccountStore.find((r: any) => r.id === socialAccountId);
      if (!row) return null;
      return {
        access_token: row.access_token,
        refresh_token: row.refresh_token ?? undefined,
        expires_at: row.token_expires_at ?? undefined,
        token_type: 'Bearer',
      };
    }),
    isTokenExpiringSoon: jest.fn(() => false),
    setToken: jest.fn(async () => {}),
  };
});

jest.mock('../../auth/tokenRefresh', () => ({
  refreshPlatformToken: jest.fn(async () => null),
  refreshTwitterTokenIfNeeded: jest.fn(async (input: any) => ({
    access_token: input.access_token,
    refresh_token: input.refresh_token ?? null,
    token_expires_at: input.token_expires_at ?? null,
    status: 'still_valid',
  })),
}));

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: jest.fn().mockResolvedValue({ success: true, platform_id: 'linkedin-post-1', platform: 'linkedin' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI RBAC', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
    tokenStore.length = 0;
    socialAccountStore.length = 0;
    playbookStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
    seedPlaybook();
  });

  it('viewer cannot approve or execute', async () => {
    setRole('VIEW_ONLY');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('rbac-1', {
      id: 'rbac-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'pending',
      requires_human_approval: true,
    });
    const approveReq = {
      method: 'POST',
      headers: {},
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'rbac-1',
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        approved: true,
      },
    } as NextApiRequest;
    const approveRes = createMockRes();
    await actionsHandler(approveReq, approveRes);
    expect(approveRes.status).toHaveBeenCalledWith(403);

    const execReq = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-1', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(403);
  });

  it('approver cannot execute', async () => {
    setRole('CONTENT_REVIEWER');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('rbac-2', {
      id: 'rbac-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'pending',
      requires_human_approval: true,
    });
    const execReq = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-2', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(403);
  });

  it('executor can execute', async () => {
    setRole('CONTENT_PUBLISHER');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('rbac-3', {
      id: 'rbac-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-3',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'approved',
      requires_human_approval: false,
    });
    const execReq = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-3', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(200);
  });

  it('admin can approve and execute', async () => {
    setRole('COMPANY_ADMIN');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    // Seed the action as already-approved with an approved_at timestamp:
    // the executor's approval-integrity gate (execute.ts:101) requires
    // approved_at to be set when requires_human_approval is true. The test's
    // intent is to verify the admin's ability to schedule + execute, not the
    // approval handler itself, so we pre-stage the approval state.
    actionStore.set('rbac-4', {
      id: 'rbac-4',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-4',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'approved',
      approved_at: new Date().toISOString(),
      requires_human_approval: true,
    });
    const approveReq = {
      method: 'POST',
      headers: {},
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'rbac-4',
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        approved: true,
      },
    } as NextApiRequest;
    const approveRes = createMockRes();
    await actionsHandler(approveReq, approveRes);
    expect(approveRes.status).toHaveBeenCalledWith(200);

    const execReq = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-4', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(200);
  });

  it('returns capability permissions for roles', async () => {
    const cases = [
      { role: 'VIEW_ONLY', expected: { canApprove: false, canExecute: false, canSchedule: false, canSkip: false, canManageConnectors: false } },
      { role: 'CONTENT_REVIEWER', expected: { canApprove: true, canExecute: false, canSchedule: true, canSkip: true, canManageConnectors: true } },
      { role: 'CONTENT_PUBLISHER', expected: { canApprove: false, canExecute: true, canSchedule: false, canSkip: false, canManageConnectors: true } },
      { role: 'COMPANY_ADMIN', expected: { canApprove: true, canExecute: true, canSchedule: true, canSkip: true, canManageConnectors: true } },
    ];

    for (const entry of cases) {
      roleStore.length = 0;
      actionStore.clear();
      setRole(entry.role);
      actionStore.set(`perm-${entry.role}`, {
        id: `perm-${entry.role}`,
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        action_type: 'reply',
        target_id: `post-${entry.role}`,
        suggested_text: 'Thanks!',
        status: 'pending',
        requires_human_approval: true,
        risk_level: 'low',
      });
      const req = { method: 'GET', headers: {}, query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' } } as NextApiRequest;
      const res = createMockRes();
      await actionsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].permissions).toEqual(entry.expected);
    }
  });

  it('role mismatch rejected with 403', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('rbac-5', {
      id: 'rbac-5',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-5',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'pending',
      requires_human_approval: true,
    });
    const req = {
      method: 'POST',
      headers: {},
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'rbac-5',
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        approved: true,
      },
    } as NextApiRequest;
    const res = createMockRes();
    await actionsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
