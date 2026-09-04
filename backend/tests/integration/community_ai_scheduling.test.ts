import type { NextApiRequest } from 'next';
import actionsHandler from '../../../pages/api/community-ai/actions';
import { runCommunityAiScheduler } from '../../services/communityAiScheduler';
import { executeAction as executeLinkedinAction } from '../../services/platformConnectors/linkedinConnector';
import {
  actionLogStore,
  actionStore,
  buildQuery,
  createMockRes,
  playbookStore,
  resetCommunityAiStores,
  seedConnectedAccount,
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

// G3R #7 — mirror the certified token seam from
// community_ai_action_connectors.test.ts. Production `getToken`
// (platformTokenService.ts:141) resolves org -> users -> social_accounts and
// then decrypts via auth/tokenStore; this routes that lookup through the
// in-memory socialAccountStore and returns the plaintext the fixture seeded.
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

// Defence-in-depth: isTokenExpiringSoon is forced false above, so the refresh
// branch of getToken is never reached by these tests.
jest.mock('../../auth/tokenRefresh', () => ({
  refreshPlatformToken: jest.fn(async () => null),
  refreshTwitterTokenIfNeeded: jest.fn(async (input: any) => ({
    access_token: input.access_token,
    refresh_token: input.refresh_token ?? null,
    token_expires_at: input.token_expires_at ?? null,
    status: 'still_valid',
  })),
}));

// G3R #7 — the mock must speak the connector contract. `normalizeConnectorResponse`
// (communityAiActionExecutorContracts.ts:463-489) reads `success` as the
// discriminant: `success === true` => 'verified' => status 'executed'. The old
// `{ ok: true, platform }` shape has no `success` field at all, so it fell to the
// legacy-connector inference branch, was classed 'permissive', and produced
// 'sent_unverified'. The real linkedinConnector returns
// `{ success: true, platform_id, platform_response }` (linkedinConnector.ts:109),
// which is what this now mirrors.
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: jest.fn().mockResolvedValue({
    success: true,
    platform_id: 'urn:li:comment:1',
    platform_response: { ok: true, platform: 'linkedin' },
  }),
}));

jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn().mockResolvedValue({ success: true, screenshot_path: 'rpa-shot.png' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');
const { executeRpaTask } = jest.requireMock('../../services/rpaWorker/rpaWorkerService');

describe('Community-AI Scheduling', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    resetCommunityAiStores();
    (executeLinkedinAction as jest.Mock).mockClear();
    (executeRpaTask as jest.Mock).mockClear();
    seedPlaybook();
  });

  it('schedules an action and logs event', async () => {
    setRole('CONTENT_REVIEWER');
    actionStore.set('action-10', {
      id: 'action-10',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-10',
      suggested_text: 'Thanks!',
      status: 'pending',
      requires_human_approval: false,
    });
    const scheduledAt = new Date(Date.now() + 60000).toISOString();
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'action-10',
        status: 'scheduled',
        scheduled_at: scheduledAt,
        approved: true,
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await actionsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const updated = actionStore.get('action-10');
    expect(updated.status).toBe('pending');
    expect(updated.scheduled_at).toBe(scheduledAt);
    expect(actionLogStore.some((log) => log.event_type === 'scheduled')).toBe(true);
  });

  it('scheduler executes due actions and logs execution', async () => {
    setRole('CONTENT_PUBLISHER');
    // With `execution_mode: 'api'` the playbook gate now applies — it is skipped
    // only for 'manual' (runtime :536). The fixture already names
    // `playbook_id: 'playbook-1'`, but `resetCommunityAiStores` clears
    // `playbookStore`, so the action would return PLAYBOOK_NOT_FOUND. Seeding the
    // playbook it already claims completes the fixture.
    // The API branch then needs a CONNECTED account. The original fixture wrote
    // to `tokenStore` (community_ai_platform_tokens), which after the token
    // consolidation holds metadata only — no token columns. `getToken`
    // (platformTokenService.ts:148-152) resolves org -> users -> social_accounts,
    // so the legacy row could never satisfy it and the action failed with
    // 'Platform not connected'. `seedConnectedAccount` is the harness helper that
    // writes the post-consolidation shape (social_accounts row + active
    // membership), and is what the sibling connectors suite already uses.
    seedConnectedAccount({ platform: 'linkedin', accessToken: 'token-1' });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('action-11', {
      id: 'action-11',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-11',
      suggested_text: 'Appreciate it!',
      playbook_id: 'playbook-1',
      // G3R #7 — declares the mode this test intends to exercise rather than
      // relying on inference. When `execution_mode` is absent,
      // `resolveExecutionMode` (communityAiActionExecutorContracts.ts:393-414)
      // probes for a token and returns 'api' only if one is found, else
      // 'browser' — which dispatches and persists as 'pending'. That inference,
      // combined with the dead token fixture below, is what produced the original
      // 'pending'. Declaring the mode pins the intent so this test cannot
      // silently degrade to the browser path again. Matches the sibling
      // convention in community_ai_webhooks.test.ts.
      execution_mode: 'api',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('action-11');
    expect(updated.status).toBe('executed');
    expect(actionLogStore.some((log) => log.event_type === 'executed')).toBe(true);
  });

  it('scheduler executes RPA action without API token', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-rpa-enabled',
      execution_modes: {
        api_allowed: true,
        rpa_allowed: true,
        manual_only: false,
      },
    });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('rpa-sched-1', {
      id: 'rpa-sched-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 'https://reddit.com/r/test/comments/a',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-rpa-enabled',
      execution_mode: 'rpa',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('rpa-sched-1');
    expect(updated.status).toBe('executed');
    expect(executeRpaTask).toHaveBeenCalled();
  });

  it('scheduler fails RPA action when playbook disallows rpa_allowed', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-rpa-disabled',
      execution_modes: {
        api_allowed: true,
        rpa_allowed: false,
        manual_only: false,
      },
    });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('rpa-sched-2', {
      id: 'rpa-sched-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 'https://reddit.com/r/test/comments/b',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-rpa-disabled',
      execution_mode: 'rpa',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('rpa-sched-2');
    expect(updated.status).toBe('failed');
    expect(executeRpaTask).not.toHaveBeenCalled();
  });

  it('scheduler enforces limits for RPA actions', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-rpa-limit',
      limits: { max_replies_per_hour: 0 },
      execution_modes: {
        api_allowed: true,
        rpa_allowed: true,
        manual_only: false,
      },
    });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('rpa-sched-3', {
      id: 'rpa-sched-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 'https://reddit.com/r/test/comments/c',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-rpa-limit',
      execution_mode: 'rpa',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('rpa-sched-3');
    expect(updated.status).toBe('failed');
    expect(executeRpaTask).not.toHaveBeenCalled();
  });

  it('scheduler logs RPA execution result with screenshot', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-rpa-enabled-2',
      execution_modes: {
        api_allowed: true,
        rpa_allowed: true,
        manual_only: false,
      },
    });
    (executeRpaTask as jest.Mock).mockResolvedValueOnce({
      success: true,
      screenshot_path: 'rpa-shot.png',
    });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('rpa-sched-4', {
      id: 'rpa-sched-4',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 'https://reddit.com/r/test/comments/d',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-rpa-enabled-2',
      execution_mode: 'rpa',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('rpa-sched-4');
    expect(updated.execution_result?.response?.screenshot_path).toBe('rpa-shot.png');
    expect(
      actionLogStore.some(
        (log) => log.event_type === 'executed' && log.event_payload?.response?.execution_mode === 'rpa'
      )
    ).toBe(true);
  });

  it('scheduler skips when token missing', async () => {
    setRole('CONTENT_PUBLISHER');
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('action-11b', {
      id: 'action-11b',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-11b',
      suggested_text: 'Appreciate it!',
      execution_mode: 'api',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
      playbook_id: 'playbook-1',
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('action-11b');
    expect(updated.status).toBe('failed');
    expect(
      actionLogStore.some(
        (log) => log.event_type === 'failed' && log.event_payload?.error === 'Platform not connected'
      )
    ).toBe(true);
  });

  it('rejects scheduling for tenant mismatch', async () => {
    setRole('CONTENT_REVIEWER');
    actionStore.set('action-12', {
      id: 'action-12',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-12',
      suggested_text: 'Thanks!',
      status: 'pending',
      requires_human_approval: false,
    });
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        action_id: 'action-12',
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        approved: true,
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await actionsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
