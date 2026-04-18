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
    playbookStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
    (executeLinkedinAction as jest.Mock).mockClear();
    seedPlaybook();
  });

  it('cannot execute without approval', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', access_token: 'token-1' });
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
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'action-1', approved: false },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(executeLinkedinAction).not.toHaveBeenCalled();
  });

  it('rejects tenant mismatch', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', access_token: 'token-1' });
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
      requires_human_approval: false,
      status: 'pending',
    });
    const req = {
      method: 'POST',
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
    playbookStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
    (executeLinkedinAction as jest.Mock).mockClear();
    seedPlaybook();
  });

  afterEach(() => {
    (global as any).fetch = undefined;
  });

  it('fails when no platform token', async () => {
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
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Platform not connected');
  });

  it('passes auth token to connector', async () => {
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', access_token: 'token-1' });
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
    expect((supabase.from as jest.Mock).mock.calls.map((call) => call[0])).toContain('community_ai_platform_tokens');
  });

  it('rejects tenant mismatch token', async () => {
    tokenStore.push({ tenant_id: 'tenant-2', organization_id: 'tenant-2', platform: 'linkedin', access_token: 'token-2' });
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
    expect(result.error).toBe('Platform not connected');
  });

  it('executes facebook connector with valid token', async () => {
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'facebook', access_token: 'token-1' });
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
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'instagram', access_token: 'token-1' });
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
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'twitter', access_token: 'token-1' });
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
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'reddit', access_token: 'token-1' });
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
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'facebook', access_token: 'token-1' });
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
