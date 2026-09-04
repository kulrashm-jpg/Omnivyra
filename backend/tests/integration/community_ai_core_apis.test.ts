import type { NextApiRequest } from 'next';
import dashboardHandler from '../../../pages/api/community-ai/dashboard';
import platformHandler from '../../../pages/api/community-ai/platform/[platform]';
import postHandler from '../../../pages/api/community-ai/post/[platform]/[postId]';
import { getProfile } from '../../services/companyProfileService';
import { evaluateCommunityAiEngagement } from '../../services/omnivyraClientV1';
import {
  actionLogStore,
  actionStore,
  analyticsStore,
  autoRuleStore,
  buildQuery,
  createMockRes,
  networkIntelligenceStore,
  notificationStore,
  playbookStore,
  roleStore,
  scheduledPostStore,
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

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));

// G3R #4-6 — bridge the existing profile fixture into the migrated read seam.
//
// The community-AI routes stopped reading `companyProfileService.getProfile`.
// `pages/api/community-ai/utils.ts:3` now imports
// `getCanonicalProfile as getProfile` from `context/canonicalProfileAdapter`,
// and that adapter reads through `companyProfileServiceRest1Rest2Pulse.getProfile`
// (canonicalProfileAdapter.ts:36 -> :305). The mock above therefore stopped
// being consumed, `resolveBrandVoice` (utils.ts:43-48) fell through to its
// 'professional' default, and every brand_voice expectation failed.
//
// Rather than introduce a second profile abstraction, this delegates the
// migrated seam to the SAME jest.fn the tests already configure, so each test's
// existing `mockResolvedValueOnce(...)` setup semantics are preserved exactly —
// the certified WS-2C bridge pattern from company_context_contract.test.ts.
// `requireActual` is spread first so every other export of that module keeps its
// real implementation; only the profile read is redirected.
jest.mock('../../services/companyProfileServiceRest1Rest2Pulse', () => ({
  ...jest.requireActual('../../services/companyProfileServiceRest1Rest2Pulse'),
  getProfile: (...args: unknown[]) =>
    (jest.requireMock('../../services/companyProfileService') as { getProfile: jest.Mock }).getProfile(...args),
}));

jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: jest.fn().mockReturnValue(true),
  evaluateCommunityAiEngagement: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      analysis: 'ok',
      suggested_actions: [],
      content_improvement: null,
      safety_classification: null,
      execution_links: null,
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

describe('Community-AI APIs', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    (getProfile as jest.Mock).mockResolvedValue(null);
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
    networkIntelligenceStore.length = 0;
  });

  it('rejects requests without tenant_id', async () => {
    const req = { method: 'GET', query: { organization_id: 'tenant-1' } } as unknown as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects cross-tenant access', async () => {
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns structured response for dashboard', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'friendly' });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_voice: 'friendly',
        priority_items: expect.any(Object),
        platform_overview: expect.any(Array),
        content_type_summary: expect.any(Array),
        action_summary: expect.any(Object),
      })
    );
    expect(evaluateCommunityAiEngagement).toHaveBeenCalled();
  });

  it('uses default brand_voice when profile missing', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce(null);
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(evaluateCommunityAiEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ brand_voice: 'professional' })
    );
  });

  it('returns suggested actions array for platform', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'authoritative' });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'LinkedIn' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ suggested_actions: expect.any(Array) }));
    expect(evaluateCommunityAiEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ brand_voice: 'authoritative' })
    );
  });

  it('returns suggested actions array for post', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'educational' });
    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'LinkedIn',
        postId: 'post-1',
      },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await postHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ suggested_actions: expect.any(Array) }));
    expect(evaluateCommunityAiEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ brand_voice: 'educational' })
    );
  });

  it('normalizes suggested action tone to brand_voice', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'professional' });
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValueOnce({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [{ action_type: 'reply', tone: 'casual' }],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.json.mock.calls[0][0].suggested_actions[0].tone).toBe('professional');
  });
});
