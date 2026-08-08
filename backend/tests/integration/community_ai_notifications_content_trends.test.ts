import type { NextApiRequest } from 'next';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import notificationsHandler from '../../../pages/api/community-ai/notifications';
import contentKpisHandler from '../../../pages/api/community-ai/content-kpis';
import trendsHandler from '../../../pages/api/community-ai/trends';
import { executeAction as executeCommunityAction } from '../../services/communityAiActionExecutor';
import {
  actionStore,
  analyticsStore,
  buildQuery,
  createMockRes,
  notificationStore,
  resetCommunityAiStores,
  scheduledPostStore,
  seedPlaybook,
  setRole,
  tokenStore,
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

/**
 * G2R2 — required by the failure test below, which now drives a TERMINAL failure through the RPA
 * mode. `communityAiActionExecutorContracts.ts:11` imports `executeRpaTask` from here.
 */
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn().mockResolvedValue({ success: false, error: 'boom' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI Notifications', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    /**
     * G2R2 — both actions below carry `playbook_id: 'playbook-1'`, but this suite never seeded a
     * playbook. `getPlaybookById` therefore threw and
     * communityAiActionExecutorRuntime.ts:505-511 returned `PLAYBOOK_NOT_FOUND` — an EARLY return at
     * line 510, before the notify blocks at ~600-620. No notification was emitted because the action
     * never executed, which is correct production behaviour, not a notification defect.
     *
     * `resetCommunityAiStores()` clears `playbookStore`, so the seed must follow it. `seedPlaybook()`
     * is the harness's own helper, already used by community_ai_action_connectors,
     * community_ai_history_metrics, community_ai_insights_forecast and community_ai_rbac — this
     * suite was simply the one that omitted it.
     */
    seedPlaybook();
  });

  it('creates notification on execution success', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    actionStore.set('notify-1', {
      id: 'notify-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'approved',
      requires_human_approval: false,
    });
    // G2R: `headers` is required. `readIdempotencyKey` (execute.ts:30) reads
    // `req.headers['idempotency-key']`, and a real Next.js request always carries a headers object,
    // so omitting it threw before the handler could run. Empty is the honest default: this test
    // sends no idempotency key, and the handler already falls back to `body.idempotency_key`.
    const req = {
      method: 'POST',
      headers: {},
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'notify-1', approved: true },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(notificationStore.some((note) => note.event_type === 'executed')).toBe(true);
  });

  /**
   * G2R2 — this test previously used `execution_mode: 'api'` with a failing LinkedIn connector and
   * expected a `failed` notification. That expectation is OBSOLETE: the executor now performs a
   * single API → Browser fallback (communityAiActionExecutorRuntime.ts:572-590), so an API failure
   * resolves to `{ ok: true, status: 'dispatched', execution_mode: 'browser', fallback_from: 'api' }`
   * — verified by direct execution. `dispatched` is deliberately NOT notified:
   * runtime.ts:598 states "Notify + webhook only on terminal outcomes. 'dispatched' is in-flight;
   * /api/extension/action-result will emit the terminal events."
   *
   * The notify-on-failure branch is still live production behaviour, so the test is re-pointed at a
   * genuinely TERMINAL failure instead of being weakened or deleted. RPA has no fallback: a failing
   * `executeRpaTask` returns `{ ok: false, status: 'failed' }` (contracts.ts:580-587), which reaches
   * the notify block. `defaultPlaybook` sets `rpa_allowed: false`, so a dedicated RPA-permitting
   * playbook is seeded — otherwise the playbook gate rejects the action before execution and, again,
   * nothing is notified.
   */
  it('creates notification on execution failure', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    seedPlaybook({ id: 'playbook-rpa', execution_modes: { rpa_allowed: true } });
    actionStore.set('notify-2', {
      id: 'notify-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-rpa',
      execution_mode: 'rpa',
      status: 'approved',
      requires_human_approval: false,
    });
    await executeCommunityAction(actionStore.get('notify-2'), true);
    expect(notificationStore.some((note) => note.event_type === 'failed')).toBe(true);
  });

  it('enforces tenant isolation for notifications', async () => {
    setRole('VIEW_ONLY');
    notificationStore.push({
      id: 'note-1',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      action_id: 'x',
      event_type: 'executed',
      message: 'done',
      is_read: false,
      created_at: new Date().toISOString(),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await notificationsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.notifications).toHaveLength(0);
  });

  it('returns unread notifications ordered by created_at desc', async () => {
    setRole('VIEW_ONLY');
    notificationStore.push(
      {
        id: 'note-2',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'a',
        event_type: 'approved',
        message: 'approved',
        is_read: false,
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'note-3',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'b',
        event_type: 'executed',
        message: 'executed',
        is_read: false,
        created_at: '2024-01-02T00:00:00.000Z',
      }
    );
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await notificationsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.notifications[0].id).toBe('note-3');
    expect(payload.notifications[1].id).toBe('note-2');
  });
});

describe('Community-AI Content KPIs', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  it('rejects content-kpis request without tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await contentKpisHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns correct shape', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'post-1',
      company_id: 'tenant-1',
      engagement_goals: { likes: 5, comments: 2, shares: 1 },
    });
    analyticsStore.push({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 5,
      shares: 2,
      views: 100,
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await contentKpisHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.by_platform).toBeDefined();
    expect(payload.by_content_type).toBeDefined();
    expect(payload.by_platform[0].platform).toBe('linkedin');
  });

  it('blocks cross-tenant aggregation', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'post-2',
      company_id: 'tenant-2',
      engagement_goals: { likes: 5 },
    });
    analyticsStore.push({
      scheduled_post_id: 'post-2',
      platform: 'linkedin',
      content_type: 'text',
      likes: 1,
      comments: 1,
      shares: 0,
      views: 10,
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await contentKpisHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.by_platform).toHaveLength(0);
  });
});

describe('Community-AI Trends', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await trendsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('detects up/down trends and anomaly', async () => {
    setRole('VIEW_ONLY');
    const today = new Date();
    const currentDate = new Date(today);
    currentDate.setDate(today.getDate() - 1);
    const previousDate = new Date(today);
    previousDate.setDate(today.getDate() - 10);

    scheduledPostStore.push(
      {
        id: 'trend-1',
        company_id: 'tenant-1',
        engagement_goals: { likes: 10, comments: 2, shares: 1 },
      },
      {
        id: 'trend-2',
        company_id: 'tenant-1',
        engagement_goals: { likes: 10, comments: 2, shares: 1 },
      }
    );

    analyticsStore.push(
      {
        scheduled_post_id: 'trend-1',
        platform: 'linkedin',
        content_type: 'text',
        likes: 5,
        comments: 1,
        shares: 1,
        views: 50,
        engagement_rate: 1,
        date: previousDate.toISOString().slice(0, 10),
      },
      {
        scheduled_post_id: 'trend-1',
        platform: 'linkedin',
        content_type: 'text',
        likes: 20,
        comments: 5,
        shares: 2,
        views: 80,
        engagement_rate: 2,
        date: currentDate.toISOString().slice(0, 10),
      },
      {
        scheduled_post_id: 'trend-2',
        platform: 'linkedin',
        content_type: 'text',
        likes: 100,
        comments: 0,
        shares: 0,
        views: 5,
        engagement_rate: 0.1,
        date: currentDate.toISOString().slice(0, 10),
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await trendsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    const trend = payload.trends.find((item: any) => item.metric === 'likes');
    expect(trend).toBeTruthy();
    expect(['up', 'down', 'flat']).toContain(trend.trend);
    expect(payload.anomalies.length).toBeGreaterThan(0);
  });

  it('blocks cross-tenant aggregation', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'trend-3',
      company_id: 'tenant-2',
      engagement_goals: { likes: 10 },
    });
    analyticsStore.push({
      scheduled_post_id: 'trend-3',
      platform: 'linkedin',
      content_type: 'text',
      likes: 50,
      comments: 2,
      shares: 1,
      views: 100,
      engagement_rate: 1,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await trendsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.trends).toHaveLength(0);
  });
});
