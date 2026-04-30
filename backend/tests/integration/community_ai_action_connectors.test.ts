import type { NextApiRequest } from 'next';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import { executeAction as executeCommunityAction } from '../../services/communityAiActionExecutor';
import { executeAction as executeLinkedinAction } from '../../services/platformConnectors/linkedinConnector';
import {
  actionLogStore,
  actionStore,
  analyticsStore,
  autoRuleStore,
  buildQuery,
  createMockRes,
  defaultPlaybook,
  mockJsonResponse,
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

// Mock the canonical token reader so the test bypasses real AES decryption.
// In production, getToken decrypts the access_token column from
// social_accounts; here we route the lookup through the in-memory
// socialAccountStore and return the plaintext that fixtures pushed.
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

// platformTokenService.getToken may invoke refreshPlatformToken if a token
// is "expiring soon" (which our isTokenExpiringSoon mock above forces to false,
// so this is defence-in-depth — never actually called by tests today).
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
  // Verified-success connector contract: response.success === true is the
  // signal that maps to status='executed' (vs 'sent_unverified' for the
  // permissive shape). See normalizeConnectorResponse in
  // backend/services/communityAiActionExecutor.ts.
  executeAction: jest.fn().mockResolvedValue({ success: true, platform_id: 'linkedin-post-1', platform: 'linkedin' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Action Execution', () => {
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
    (executeLinkedinAction as jest.Mock).mockClear();
    seedPlaybook();
  });

  it('cannot execute without approval', async () => {
    setRole('CONTENT_PUBLISHER');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('action-1', {
      id: 'action-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
      status: 'pending',
    });
    const req = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'action-1', approved: false },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(executeLinkedinAction).not.toHaveBeenCalled();
  });

  it('rejects tenant mismatch', async () => {
    setRole('CONTENT_PUBLISHER');
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('action-2', {
      id: 'action-2',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      status: 'pending',
    });
    const req = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'action-2', approved: true },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('executes and updates status on approval', async () => {
    setRole('CONTENT_PUBLISHER');
    actionStore.set('action-3', {
      id: 'action-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-3',
      suggested_text: 'Great post!',
      playbook_id: 'playbook-1',
      execution_mode: 'api',
      requires_human_approval: false,
      status: 'pending',
    });
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    const req = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'action-3', approved: true },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(actionStore.get('action-3')?.status).toBe('executed');
    expect(actionLogStore.some((log) => log.event_type === 'approved')).toBe(true);
    expect(actionLogStore.some((log) => log.event_type === 'executed')).toBe(true);
  });
});

describe('Community-AI Connectors', () => {
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
    (executeLinkedinAction as jest.Mock).mockClear();
    seedPlaybook();
  });

  afterEach(() => {
    (global as any).fetch = undefined;
  });

  it('falls back to browser when no platform token', async () => {
    // Post-API→Browser-fallback semantics: when execution_mode='api' fails
    // because no token is connected, the executor automatically queues a
    // browser dispatch via the extension. The result is `ok: true` with
    // `status: 'dispatched'`, `execution_mode: 'browser'`, and a
    // `response.fallback_from === 'api'` marker that records the original
    // API failure for audit (response.api_error).
    actionStore.set('token-1', {
      id: 'token-1',
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
    const result = await executeCommunityAction(actionStore.get('token-1'), true);
    expect(result.ok).toBe(true);
    expect(result.execution_mode).toBe('browser');
    expect(result.status).toBe('dispatched');
    expect((result.response as any)?.fallback_from).toBe('api');
    expect((result.response as any)?.api_error).toBe('PLATFORM_NOT_CONNECTED');
  });

  it('passes auth token to connector', async () => {
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    actionStore.set('token-2', {
      id: 'token-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      execution_mode: 'api',
      status: 'approved',
      requires_human_approval: false,
    });
    await executeCommunityAction(actionStore.get('token-2'), true);
    expect(executeLinkedinAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'token-2' }), 'token-1');
    // Post-consolidation: tokens are read from social_accounts, not from
    // community_ai_platform_tokens (which now holds metadata only).
    expect((supabase.from as jest.Mock).mock.calls.map((call) => call[0])).toContain('social_accounts');
  });

  it('cross-tenant token does not satisfy resolution; falls back to browser', async () => {
    // tenant-2 has a connected account, but the action belongs to tenant-1.
    // resolveSocialAccountIdForOrg('tenant-1') finds no roles for that org →
    // returns null → API execution fails with PLATFORM_NOT_CONNECTED →
    // executor falls back to browser dispatch. The fallback marker is
    // sufficient to assert tenant isolation worked.
    seedConnectedAccount({ tenantId: 'tenant-2', platform: 'linkedin', accessToken: 'token-2' });
    actionStore.set('token-3', {
      id: 'token-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-3',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      execution_mode: 'api',
      status: 'approved',
      requires_human_approval: false,
    });
    const result = await executeCommunityAction(actionStore.get('token-3'), true);
    expect(result.execution_mode).toBe('browser');
    expect((result.response as any)?.fallback_from).toBe('api');
    expect((result.response as any)?.api_error).toBe('PLATFORM_NOT_CONNECTED');
  });

  it('executes facebook connector with valid token', async () => {
    seedConnectedAccount({ platform: 'facebook', accessToken: 'token-1' });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ id: 'c1' }));
    const result = await executeCommunityAction({
      id: 'fb-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'facebook',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-1',
      requires_human_approval: false,
      execution_mode: 'api',
    }, true);
    expect(result.ok).toBe(true);
  });

  it('executes instagram connector with valid token', async () => {
    seedConnectedAccount({ platform: 'instagram', accessToken: 'token-1' });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ id: 'r1' }));
    const result = await executeCommunityAction({
      id: 'ig-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'instagram',
      action_type: 'reply',
      target_id: 'comment-1',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      requires_human_approval: false,
      execution_mode: 'api',
    }, true);
    expect(result.ok).toBe(true);
  });

  it('executes twitter connector with valid token', async () => {
    seedConnectedAccount({ platform: 'twitter', accessToken: 'token-1' });
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('/users/me')) {
        return mockJsonResponse({ data: { id: 'user-1' } });
      }
      return mockJsonResponse({ data: { id: 'tweet-1' } });
    });
    const result = await executeCommunityAction({
      id: 'tw-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'twitter',
      action_type: 'reply',
      target_id: 'tweet-1',
      suggested_text: 'Great!',
      playbook_id: 'playbook-1',
      requires_human_approval: false,
      execution_mode: 'api',
    }, true);
    expect(result.ok).toBe(true);
  });

  it('executes reddit connector with valid token', async () => {
    seedConnectedAccount({ platform: 'reddit', accessToken: 'token-1' });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ json: { data: {} } }));
    const result = await executeCommunityAction({
      id: 'rd-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 't3_post',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      requires_human_approval: false,
      execution_mode: 'api',
    }, true);
    expect(result.ok).toBe(true);
  });

  it('blocks execution when playbook disallows action', async () => {
    playbookStore.push({
      ...defaultPlaybook,
      id: 'playbook-block',
      action_rules: { ...defaultPlaybook.action_rules, allow_reply: false },
    });
    seedConnectedAccount({ platform: 'facebook', accessToken: 'token-1' });
    const result = await executeCommunityAction({
      id: 'fb-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'facebook',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-block',
      requires_human_approval: false,
      execution_mode: 'api',
    }, true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not allowed');
  });
});
