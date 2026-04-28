import type { NextApiRequest } from 'next';
import platformHandler from '../../../pages/api/community-ai/platform/[platform]';
import exportHandler from '../../../pages/api/community-ai/export';
import { getProfile } from '../../services/companyProfileService';
import { evaluateCommunityAiEngagement } from '../../services/omnivyraClientV1';
import {
  actionLogStore,
  actionStore,
  analyticsStore,
  autoRuleStore,
  buildQuery,
  createMockRes,
  notificationStore,
  roleStore,
  scheduledPostStore,
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

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
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

describe('Community-AI Auto Rules', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValue(null);
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
    tokenStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
  });

  it('auto-executes when rule matches', async () => {
    autoRuleStore.push({
      id: 'rule-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      rule_name: 'Auto reply on trending',
      condition: { platform: 'linkedin', content_type: 'text', trend: 'up' },
      action_type: 'reply',
      max_risk_level: 'medium',
      is_active: true,
      created_at: new Date().toISOString(),
    });
    tokenStore.push({ tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin', access_token: 'token' });
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValueOnce({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [
          {
            platform: 'linkedin',
            action_type: 'reply',
            target_id: 'post-1',
            suggested_text: 'Great insights!',
            intent_scores: { community_engagement: 0.8 },
            execution_mode: 'manual',
            risk_level: 'low',
            requires_human_approval: false,
            content_type: 'text',
            trend: 'up',
          },
        ],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' } } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    const rows = Array.from(actionStore.values());
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(actionLogStore.some((row) => row.event_type === 'auto_executed')).toBe(true);
  });

  it('keeps non-matching rule actions pending', async () => {
    autoRuleStore.push({
      id: 'rule-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      rule_name: 'Auto reply on video',
      condition: { platform: 'linkedin', content_type: 'video' },
      action_type: 'reply',
      max_risk_level: 'medium',
      is_active: true,
      created_at: new Date().toISOString(),
    });
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValueOnce({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [
          {
            platform: 'linkedin',
            action_type: 'reply',
            target_id: 'post-2',
            suggested_text: 'Nice update!',
            intent_scores: { community_engagement: 0.8 },
            risk_level: 'low',
            requires_human_approval: false,
            content_type: 'text',
          },
        ],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' } } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    expect(Array.from(actionStore.values())[0].status).toBe('pending');
  });

  it('never auto-executes high-risk actions', async () => {
    autoRuleStore.push({
      id: 'rule-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      rule_name: 'Auto reply high risk',
      condition: { platform: 'linkedin' },
      action_type: 'reply',
      max_risk_level: 'medium',
      is_active: true,
      created_at: new Date().toISOString(),
    });
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValueOnce({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [
          {
            platform: 'linkedin',
            action_type: 'reply',
            target_id: 'post-3',
            suggested_text: 'Check this out!',
            intent_scores: { community_engagement: 0.8 },
            risk_level: 'high',
            requires_human_approval: false,
            content_type: 'text',
          },
        ],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' } } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    expect(Array.from(actionStore.values())).toHaveLength(0);
    expect(actionLogStore.some((row) => row.event_type === 'auto_executed')).toBe(false);
  });

  it('blocks cross-tenant auto rules', async () => {
    autoRuleStore.push({
      id: 'rule-4',
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      rule_name: 'Other tenant rule',
      condition: { platform: 'linkedin' },
      action_type: 'reply',
      max_risk_level: 'medium',
      is_active: true,
      created_at: new Date().toISOString(),
    });
    (evaluateCommunityAiEngagement as jest.Mock).mockResolvedValueOnce({
      status: 'ok',
      data: {
        analysis: 'ok',
        suggested_actions: [
          {
            platform: 'linkedin',
            action_type: 'reply',
            target_id: 'post-4',
            suggested_text: 'Thanks!',
            intent_scores: { community_engagement: 0.8 },
            risk_level: 'low',
            requires_human_approval: false,
            content_type: 'text',
          },
        ],
        content_improvement: null,
        safety_classification: null,
        execution_links: null,
      },
    });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' } } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    expect(Array.from(actionStore.values())[0].status).toBe('pending');
  });

  it('enforces RBAC for auto-rules API', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' } } as NextApiRequest;
    const res = createMockRes();
    const autoRulesHandler = require('../../../pages/api/community-ai/auto-rules').default;
    await autoRulesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Community-AI Export', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
    tokenStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'kpis', format: 'csv' } } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('blocks cross-tenant export', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-2', type: 'kpis', format: 'csv' } } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns CSV file response', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({ id: 'export-1', company_id: 'tenant-1', engagement_goals: { likes: 1 }, content: 'Post content' });
    analyticsStore.push({
      scheduled_post_id: 'export-1',
      platform: 'linkedin',
      content_type: 'text',
      likes: 2,
      comments: 1,
      shares: 0,
      views: 10,
      engagement_rate: 0.5,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'kpis', format: 'csv' } } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns PDF with correct headers', async () => {
    setRole('VIEW_ONLY');
    (getProfile as jest.Mock).mockResolvedValueOnce({ name: 'Acme Co' });
    const req = { method: 'GET', query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'full-report', format: 'pdf' } } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    const dateStamp = new Date().toISOString().slice(0, 10);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="community-ai-report-${dateStamp}.pdf"`);
  });
});
