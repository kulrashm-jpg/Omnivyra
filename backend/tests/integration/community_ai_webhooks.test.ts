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

describe('Community-AI Webhooks', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
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
    } as unknown as NextApiRequest;
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
    } as unknown as NextApiRequest;
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
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await webhooksHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.webhooks).toHaveLength(1);
  });

  // G3R #2 — an API failure is no longer terminal, so no webhook is emitted at
  // this point in the lifecycle.
  //
  // `communityAiActionExecutorRuntime.ts:573-593`: when `runApiExecution`
  // fails, the executor records a `fallback_triggered` metric and REPLACES the
  // result with a browser dispatch (`result = prepareBrowserDispatch(chain)`),
  // status `'dispatched'`. The webhook gate at :600-630 fires only on
  // `executed | sent_unverified | failed`, and the comment at :598 states the
  // contract directly: "'dispatched' is in-flight; /api/extension/action-result
  // will emit the terminal events."
  //
  // The original assertion (`expect(fetch).toHaveBeenCalled()`) encoded the
  // pre-fallback contract, where an API failure ended the lifecycle. It is
  // replaced by the deferral contract that now governs this step. The terminal
  // webhook itself is emitted from the extension action-result route, which is
  // a different surface and is not exercised here.
  it('defers the webhook when an API failure falls back to browser dispatch', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    webhookStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      event_type: 'failed',
      webhook_url: 'https://example.com/webhook',
      is_active: true,
    });
    // The action names `playbook_id: 'playbook-1'` but `resetCommunityAiStores`
    // clears `playbookStore`, so the executor returned PLAYBOOK_NOT_FOUND
    // (runtime :510) — a terminal 'failed' that returns BEFORE the webhook block
    // at :600, which is why no webhook was emitted regardless of the fallback.
    // Seeding the playbook the fixture already claims lets the action actually
    // reach the execution switch. `defaultPlaybook` allows api + reply on
    // linkedin, which is exactly what this action needs.
    seedPlaybook();
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
    const result = await executeCommunityAction(actionStore.get('webhook-1'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The API attempt failed and was replaced by a browser dispatch.
    expect(result.status).toBe('dispatched');
    // Non-terminal ⇒ the webhook is deferred, not lost.
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('does not call cross-tenant webhooks', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
    // G3R #3 — `headers` is part of the production request contract, not an
    // optional extra: `execute.ts:30` reads `req.headers['idempotency-key']`,
    // and Next.js always supplies it because NextApiRequest extends
    // IncomingMessage. Omitting it here made the handler throw before it could
    // reach the cross-tenant check this test exists to prove, so the assertion
    // was never actually exercised. The `as unknown as` cast is what allowed an
    // invalid request shape past the compiler.
    const req = {
      method: 'POST',
      headers: {},
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'webhook-2',
        approved: true,
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
