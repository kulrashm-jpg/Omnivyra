import type { NextApiRequest, NextApiResponse } from 'next';
import dashboardHandler from '../../../pages/api/community-ai/dashboard';
import platformHandler from '../../../pages/api/community-ai/platform/[platform]';
import postHandler from '../../../pages/api/community-ai/post/[platform]/[postId]';
import actionsHandler from '../../../pages/api/community-ai/actions';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import historyHandler from '../../../pages/api/community-ai/actions/history';
import metricsHandler from '../../../pages/api/community-ai/metrics';
import networkIntelligenceHandler from '../../../pages/api/community-ai/network-intelligence';
import playbookEffectivenessHandler from '../../../pages/api/community-ai/playbook-effectiveness';
import executiveSummaryHandler from '../../../pages/api/community-ai/executive-summary';
import executiveExportHandler from '../../../pages/api/community-ai/executive-export';
import executiveNarrativeHandler from '../../../pages/api/community-ai/executive-narrative';
import wowComparisonHandler from '../../../pages/api/community-ai/wow-comparison';
import momComparisonHandler from '../../../pages/api/community-ai/mom-comparison';
import campaignBaselineHandler from '../../../pages/api/community-ai/campaign-baseline';
import executiveAlertsHandler from '../../../pages/api/community-ai/executive-alerts';
import playbookLearningHandler from '../../../pages/api/community-ai/playbook-learning';
import recommendationsHandler from '../../../pages/api/community-ai/recommendations';
import notificationsHandler from '../../../pages/api/community-ai/notifications';
import contentKpisHandler from '../../../pages/api/community-ai/content-kpis';
import trendsHandler from '../../../pages/api/community-ai/trends';
import webhooksHandler from '../../../pages/api/community-ai/webhooks';
import insightsHandler from '../../../pages/api/community-ai/insights';
import exportHandler from '../../../pages/api/community-ai/export';
import forecastHandler from '../../../pages/api/community-ai/forecast';
import forecastInsightsHandler from '../../../pages/api/community-ai/forecast-insights';
import forecastSimulateHandler from '../../../pages/api/community-ai/forecast-simulate';
import { renderExecutiveSummaryPdf } from '../../services/export/executivePdfRenderer';
import { getProfile } from '../../services/companyProfileService';
import {
  evaluateCommunityAiEngagement,
  evaluateCommunityAiInsights,
  evaluateCommunityAiForecastInsights,
  evaluateCommunityAiExecutiveNarrative,
} from '../../services/omnivyraClientV1';
import { executeAction as executeLinkedinAction } from '../../services/platformConnectors/linkedinConnector';
import { executeAction as executeCommunityAction } from '../../services/communityAiActionExecutor';
import { runCommunityAiScheduler } from '../../services/communityAiScheduler';

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

jest.mock('../../services/export/executivePdfRenderer', () => ({
  renderExecutiveSummaryPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

jest.mock('../../services/omnivyraClientV1', () => ({
  isOmniVyraEnabled: jest.fn().mockReturnValue(true),
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
  evaluateCommunityAiInsights: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      summary_insight: 'ok',
      key_findings: [],
      recommended_actions: [],
      risks: null,
      confidence_level: 0.5,
    },
  }),
  evaluateCommunityAiForecastInsights: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      explanation_summary: 'ok',
      key_drivers: [],
      risks: [],
      recommended_actions: [],
      confidence_level: 0.6,
    },
  }),
  evaluateCommunityAiExecutiveNarrative: jest.fn().mockResolvedValue({
    status: 'ok',
    data: {
      overview: 'Narrative overview',
      key_shifts: ['Shift one'],
      risks_to_watch: ['Risk one'],
      recommendations_to_review: ['Review one'],
      explicitly_not_recommended: ['Avoid one'],
      confidence_level: 0.72,
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: jest.fn().mockResolvedValue({ ok: true, platform: 'linkedin' }),
}));

jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn().mockResolvedValue({ success: true, screenshot_path: 'rpa-shot.png' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');
const { executeRpaTask } = jest.requireMock('../../services/rpaWorker/rpaWorkerService');

const actionStore = new Map<string, any>();
const actionLogStore: Array<any> = [];
const roleStore: Array<any> = [];
const notificationStore: Array<any> = [];
const analyticsStore: Array<any> = [];
const scheduledPostStore: Array<any> = [];
const tokenStore: Array<any> = [];
const playbookStore: Array<any> = [];
const webhookStore: Array<any> = [];
const autoRuleStore: Array<any> = [];
const networkIntelligenceStore: Array<any> = [];

const mockJsonResponse = (payload: any, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => (payload ? JSON.stringify(payload) : ''),
});

const defaultPlaybook = {
  id: 'playbook-1',
  tenant_id: 'tenant-1',
  organization_id: 'tenant-1',
  name: 'Default Playbook',
  scope: {
    platforms: ['linkedin'],
    content_types: ['text'],
    intents: ['community_engagement'],
  },
  tone: {
    style: 'professional',
    emoji_allowed: true,
    max_length: 280,
  },
  user_rules: {
    first_time_user: 'optional',
    influencer_user: 'require_approval',
    negative_sentiment: 'escalate',
    spam_user: 'ignore',
  },
  action_rules: {
    allow_reply: true,
    allow_like: true,
    allow_follow: true,
    allow_share: true,
    allow_dm: false,
  },
  automation_rules: {
    auto_execute_low_risk: true,
    require_human_approval_medium_risk: false,
    block_high_risk: true,
  },
  limits: {
    max_replies_per_hour: 100,
    max_follows_per_day: 100,
    max_actions_per_day: 1000,
  },
  execution_modes: {
    api_allowed: true,
    rpa_allowed: false,
    manual_only: false,
  },
  conflict_policy: {
    primary_wins: true,
    max_secondary_playbooks: 1,
  },
  safety: {
    block_urls: false,
    block_sensitive_topics: false,
    prohibited_words: [],
  },
  status: 'active',
};

const seedPlaybook = (overrides?: Record<string, any>) => {
  playbookStore.push({
    ...defaultPlaybook,
    ...overrides,
    scope: { ...defaultPlaybook.scope, ...(overrides?.scope || {}) },
    tone: { ...defaultPlaybook.tone, ...(overrides?.tone || {}) },
    user_rules: { ...defaultPlaybook.user_rules, ...(overrides?.user_rules || {}) },
    action_rules: { ...defaultPlaybook.action_rules, ...(overrides?.action_rules || {}) },
    automation_rules: { ...defaultPlaybook.automation_rules, ...(overrides?.automation_rules || {}) },
    limits: { ...defaultPlaybook.limits, ...(overrides?.limits || {}) },
    execution_modes: { ...defaultPlaybook.execution_modes, ...(overrides?.execution_modes || {}) },
    conflict_policy: { ...defaultPlaybook.conflict_policy, ...(overrides?.conflict_policy || {}) },
    safety: { ...defaultPlaybook.safety, ...(overrides?.safety || {}) },
  });
};

const buildQuery = (table: string) => {
  const state: {
    filters: Record<string, any>;
    update?: any;
    inFilter?: { field: string; values: any[] };
    order?: { field: string; ascending: boolean };
    lteFilter?: { field: string; value: string };
    gteFilter?: { field: string; value: string };
    insertRows?: any[];
    limitValue?: number;
  } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    gte: jest.fn((field: string, value: any) => {
      state.gteFilter = { field, value };
      return query;
    }),
    limit: jest.fn((value: number) => {
      state.limitValue = value;
      return query;
    }),
    lte: jest.fn((field: string, value: any) => {
      state.lteFilter = { field, value };
      return query;
    }),
    in: jest.fn((field: string, values: any[]) => {
      state.inFilter = { field, values };
      return query;
    }),
    order: jest.fn((field: string, options?: any) => {
      state.order = { field, ascending: options?.ascending !== false };
      return query;
    }),
    single: jest.fn(async () => {
      state.single = true;
      return resolveSelect(table, state);
    }),
    maybeSingle: jest.fn(async () => {
      state.single = true;
      return resolveSelect(table, state);
    }),
    not: jest.fn(() => query),
    then: (resolve: any, reject: any) => {
      const result = resolveSelect(table, state);
      return Promise.resolve(result).then(resolve, reject);
    },
    update: jest.fn((values: any) => {
      state.update = values;
      return {
        eq: jest.fn(async (field: string, value: any) => resolveUpdate(table, state, field, value)),
      };
    }),
    insert: jest.fn((rows: any) => {
      state.insertRows = Array.isArray(rows) ? rows : [rows];
      const chain: any = {
        select: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        then: (resolve: any, reject: any) => {
          const result = resolveInsert(table, state);
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    }),
    delete: jest.fn(() => ({
      eq: jest.fn(async (field: string, value: any) => resolveDelete(table, state, field, value)),
    })),
  };
  return query;
};

const resolveSelect = (table: string, state: any) => {
  if (table === 'community_ai_actions') {
    const id = state.filters.id;
    if (id) {
      const row = actionStore.get(id);
      return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
    }
    let rows = Array.from(actionStore.values());
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.platform) {
      rows = rows.filter((row) => row.platform === state.filters.platform);
    }
    if (state.filters.action_type) {
      rows = rows.filter((row) => row.action_type === state.filters.action_type);
    }
    if (state.filters.target_id) {
      rows = rows.filter((row) => row.target_id === state.filters.target_id);
    }
    if (state.filters.status) {
      rows = rows.filter((row) => row.status === state.filters.status);
    }
    if (state.lteFilter) {
      rows = rows.filter((row) => {
        const value = row[state.lteFilter.field];
        return value && value <= state.lteFilter.value;
      });
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_network_intelligence') {
    let rows = [...networkIntelligenceStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.platform) {
      rows = rows.filter((row) => row.platform === state.filters.platform);
    }
    if (state.filters.playbook_id) {
      rows = rows.filter((row) => row.playbook_id === state.filters.playbook_id);
    }
    if (state.gteFilter) {
      rows = rows.filter((row) => {
        const value = row[state.gteFilter.field];
        return value && value >= state.gteFilter.value;
      });
    }
    if (state.lteFilter) {
      rows = rows.filter((row) => {
        const value = row[state.lteFilter.field];
        return value && value <= state.lteFilter.value;
      });
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_action_logs') {
    let rows = [...actionLogStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.action_id) {
      rows = rows.filter((row) => row.action_id === state.filters.action_id);
    }
    if (state.inFilter && state.inFilter.field === 'action_id') {
      rows = rows.filter((row) => state.inFilter.values.includes(row.action_id));
    }
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending
          ? a[state.order.field].localeCompare(b[state.order.field])
          : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    return { data: rows, error: null };
  }
  if (table === 'scheduled_posts') {
    return { data: [...scheduledPostStore], error: null };
  }
  if (table === 'content_analytics') {
    let rows = analyticsStore.map((row) => {
      const scheduled = scheduledPostStore.find((post) => post.id === row.scheduled_post_id);
      return {
        ...row,
        scheduled_posts: scheduled
          ? {
              engagement_goals: scheduled.engagement_goals,
              users: { company_id: scheduled.company_id },
            }
          : null,
      };
    });
    const companyId = state.filters['scheduled_posts.users.company_id'];
    if (companyId) {
      rows = rows.filter((row) => row.scheduled_posts?.users?.company_id === companyId);
    }
    if (state.filters.platform) {
      rows = rows.filter((row) => row.platform === state.filters.platform);
    }
    if (state.gteFilter && state.gteFilter.field === 'date') {
      rows = rows.filter((row) => row.date >= state.gteFilter?.value);
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_notifications') {
    let rows = [...notificationStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.is_read !== undefined) {
      rows = rows.filter((row) => row.is_read === state.filters.is_read);
    }
    if (state.filters.event_type) {
      rows = rows.filter((row) => row.event_type === state.filters.event_type);
    }
    if (state.inFilter && state.inFilter.field === 'action_id') {
      rows = rows.filter((row) => state.inFilter.values.includes(row.action_id));
    }
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending
          ? a[state.order.field].localeCompare(b[state.order.field])
          : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    return { data: rows, error: null };
  }
  if (table === 'user_company_roles') {
    let rows = [...roleStore];
    if (state.filters.user_id) {
      rows = rows.filter((row) => row.user_id === state.filters.user_id);
    }
    if (state.filters.company_id) {
      rows = rows.filter((row) => row.company_id === state.filters.company_id);
    }
    if (state.filters.role) {
      rows = rows.filter((row) => row.role === state.filters.role);
    }
    if (state.filters.status) {
      rows = rows.filter((row) => row.status === state.filters.status);
    }
    if (typeof state.limitValue === 'number') {
      rows = rows.slice(0, state.limitValue);
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_platform_tokens') {
    let rows = [...tokenStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.platform) {
      rows = rows.filter((row) => row.platform === state.filters.platform);
    }
    if (typeof state.limitValue === 'number') {
      rows = rows.slice(0, state.limitValue);
    }
    if (state.single) {
      return rows.length > 0
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'not found' } };
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_playbooks') {
    let rows = [...playbookStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.id) {
      rows = rows.filter((row) => row.id === state.filters.id);
    }
    if (state.inFilter && state.inFilter.field === 'id') {
      rows = rows.filter((row) => state.inFilter.values.includes(row.id));
    }
    if (typeof state.limitValue === 'number') {
      rows = rows.slice(0, state.limitValue);
    }
    if (state.single) {
      return rows.length > 0
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'not found' } };
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_webhooks') {
    let rows = [...webhookStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.event_type) {
      rows = rows.filter((row) => row.event_type === state.filters.event_type);
    }
    if (state.filters.is_active !== undefined) {
      rows = rows.filter((row) => row.is_active === state.filters.is_active);
    }
    if (typeof state.limitValue === 'number') {
      rows = rows.slice(0, state.limitValue);
    }
    return { data: rows, error: null };
  }
  if (table === 'community_ai_auto_rules') {
    let rows = [...autoRuleStore];
    if (state.filters.tenant_id) {
      rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    }
    if (state.filters.organization_id) {
      rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    }
    if (state.filters.is_active !== undefined) {
      rows = rows.filter((row) => row.is_active === state.filters.is_active);
    }
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending
          ? a[state.order.field].localeCompare(b[state.order.field])
          : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    if (typeof state.limitValue === 'number') {
      rows = rows.slice(0, state.limitValue);
    }
    return { data: rows, error: null };
  }
  if (table === 'execution_guardrails') {
    return {
      data: state.single
        ? {
            auto_execution_enabled: true,
            daily_platform_limit: 999,
            per_post_reply_limit: 999,
            per_evaluation_limit: 999,
          }
        : [
            {
              auto_execution_enabled: true,
              daily_platform_limit: 999,
              per_post_reply_limit: 999,
              per_evaluation_limit: 999,
            },
          ],
      error: null,
    };
  }
  if (table === 'organization_plan_assignments') {
    return {
      data: state.single ? null : [],
      error: null,
    };
  }
  if (table === 'pricing_plans') {
    return {
      data: state.single ? null : [],
      error: null,
    };
  }
  if (table === 'usage_meter_monthly') {
    return {
      data: state.single
        ? { llm_total_tokens: 0, external_api_calls: 0, automation_executions: 0 }
        : [{ llm_total_tokens: 0, external_api_calls: 0, automation_executions: 0 }],
      error: null,
    };
  }
  return { data: null, error: null };
};

const resolveUpdate = (table: string, state: any, _field: string, value: any) => {
  if (table === 'community_ai_actions') {
    const row = actionStore.get(value);
    if (row) {
      actionStore.set(value, { ...row, ...(state.update || {}) });
    }
    return { data: row || null, error: null };
  }
  if (table === 'community_ai_auto_rules') {
    const index = autoRuleStore.findIndex((row) => row.id === value);
    if (index >= 0) {
      autoRuleStore[index] = { ...autoRuleStore[index], ...(state.update || {}) };
      return { data: autoRuleStore[index], error: null };
    }
    return { data: null, error: null };
  }
  return { data: null, error: null };
};

const resolveInsert = (table: string, state: any) => {
  if (table === 'community_ai_actions') {
    state.insertRows?.forEach((row) => {
      if (row?.id) {
        actionStore.set(row.id, row);
      }
    });
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_action_logs') {
    state.insertRows?.forEach((row) => actionLogStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_notifications') {
    state.insertRows?.forEach((row) => notificationStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_webhooks') {
    state.insertRows?.forEach((row) => webhookStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_auto_rules') {
    state.insertRows?.forEach((row) => autoRuleStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  return { data: null, error: null };
};

const resolveDelete = (table: string, _state: any, field: string, value: any) => {
  if (table === 'community_ai_auto_rules' && field === 'id') {
    const index = autoRuleStore.findIndex((row) => row.id === value);
    if (index >= 0) {
      autoRuleStore.splice(index, 1);
    }
    return { data: [], error: null };
  }
  if (table === 'community_ai_webhooks' && field === 'id') {
    const index = webhookStore.findIndex((row) => row.id === value);
    if (index >= 0) {
      webhookStore.splice(index, 1);
    }
    return { data: [], error: null };
  }
  return { data: [], error: null };
};

const createMockRes = () => {
  const headers: Record<string, string> = {};
  const res: Partial<NextApiResponse> & {
    json: jest.Mock;
    setHeader: jest.Mock;
    send: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    once: jest.Mock;
    emit: jest.Mock;
  } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    }),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
  };
  return res as NextApiResponse;
};

const setRole = (role: string, companyId = 'tenant-1') => {
  roleStore.push({
    user_id: 'user-1',
    company_id: companyId,
    role,
    status: 'active',
  });
};

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
    autoRuleStore.length = 0;
  });

  it('rejects requests without tenant_id', async () => {
    const req = { method: 'GET', query: { organization_id: 'tenant-1' } } as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects cross-tenant access', async () => {
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns structured response for dashboard', async () => {
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'friendly' });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
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
    } as NextApiRequest;
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
    } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        suggested_actions: expect.any(Array),
      })
    );
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
    } as NextApiRequest;
    const res = createMockRes();
    await postHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        suggested_actions: expect.any(Array),
      })
    );
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
    } as NextApiRequest;
    const res = createMockRes();
    await dashboardHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.suggested_actions[0].tone).toBe('professional');
  });
});

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
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
    const updated = actionStore.get('action-3');
    expect(updated.status).toBe('executed');
    expect(actionLogStore.some((log) => log.event_type === 'approved')).toBe(true);
    expect(actionLogStore.some((log) => log.event_type === 'executed')).toBe(true);
  });
});

describe('Community-AI Platform Tokens', () => {
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
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
    expect(executeLinkedinAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'token-2' }),
      'token-1'
    );
    const tableCalls = (supabase.from as jest.Mock).mock.calls.map((call) => call[0]);
    expect(tableCalls).toContain('community_ai_platform_tokens');
  });

  it('rejects tenant mismatch token', async () => {
    tokenStore.push({
      tenant_id: 'tenant-2',
      organization_id: 'tenant-2',
      platform: 'linkedin',
      access_token: 'token-2',
    });
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
});

describe('Community-AI Connector Execution (API)', () => {
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
    seedPlaybook();
  });

  afterEach(() => {
    (global as any).fetch = undefined;
  });

  it('executes facebook connector with valid token', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'facebook',
      access_token: 'token-1',
    });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ id: 'c1' }));
    const result = await executeCommunityAction(
      {
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
      },
      true
    );
    expect(result.ok).toBe(true);
  });

  it('executes instagram connector with valid token', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'instagram',
      access_token: 'token-1',
    });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ id: 'r1' }));
    const result = await executeCommunityAction(
      {
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
      },
      true
    );
    expect(result.ok).toBe(true);
  });

  it('executes twitter connector with valid token', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'twitter',
      access_token: 'token-1',
    });
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('/users/me')) {
        return mockJsonResponse({ data: { id: 'user-1' } });
      }
      return mockJsonResponse({ data: { id: 'tweet-1' } });
    });
    const result = await executeCommunityAction(
      {
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
      },
      true
    );
    expect(result.ok).toBe(true);
  });

  it('executes reddit connector with valid token', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      access_token: 'token-1',
    });
    (global as any).fetch = jest.fn().mockResolvedValue(mockJsonResponse({ json: { data: {} } }));
    const result = await executeCommunityAction(
      {
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
      },
      true
    );
    expect(result.ok).toBe(true);
  });

  it('blocks execution when token missing', async () => {
    const result = await executeCommunityAction(
      {
        id: 'fb-2',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'facebook',
        action_type: 'reply',
        target_id: 'post-1',
        suggested_text: 'Hello!',
        playbook_id: 'playbook-1',
        requires_human_approval: false,
        execution_mode: 'api',
      },
      true
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Platform not connected');
  });

  it('blocks execution when playbook disallows action', async () => {
    playbookStore.push({
      ...defaultPlaybook,
      id: 'playbook-block',
      action_rules: { ...defaultPlaybook.action_rules, allow_reply: false },
    });
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'facebook',
      access_token: 'token-1',
    });
    const result = await executeCommunityAction(
      {
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
      },
      true
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not allowed');
  });
});

describe('Community-AI RPA Execution', () => {
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
    seedPlaybook({
      execution_modes: {
        api_allowed: true,
        rpa_allowed: true,
        manual_only: false,
      },
    });
    (executeRpaTask as jest.Mock).mockClear();
    (executeRpaTask as jest.Mock).mockResolvedValue({
      success: true,
      screenshot_path: 'rpa-shot.png',
    });
  });

  it('blocks RPA when playbook disallows rpa_allowed', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-rpa-block',
      execution_modes: {
        api_allowed: true,
        rpa_allowed: false,
        manual_only: false,
      },
    });
    const result = await executeCommunityAction(
      {
        id: 'rpa-1',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        action_type: 'reply',
        target_id: 'https://reddit.com/r/test/comments/1',
        suggested_text: 'Hello!',
        playbook_id: 'playbook-rpa-block',
        requires_human_approval: false,
        execution_mode: 'rpa',
      },
      true
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('RPA');
    expect(executeRpaTask).not.toHaveBeenCalled();
  });

  it('executes RPA when execution_mode = rpa', async () => {
    const result = await executeCommunityAction(
      {
        id: 'rpa-2',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        action_type: 'reply',
        target_id: 'https://reddit.com/r/test/comments/2',
        suggested_text: 'Hello!',
        playbook_id: 'playbook-1',
        requires_human_approval: false,
        execution_mode: 'rpa',
      },
      true
    );
    expect(result.ok).toBe(true);
    expect(result.response?.screenshot_path).toBe('rpa-shot.png');
  });

  it('enqueues RPA task with expected payload', async () => {
    await executeCommunityAction(
      {
        id: 'rpa-3',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        action_type: 'reply',
        target_id: 'https://reddit.com/r/test/comments/3',
        suggested_text: 'Hello!',
        playbook_id: 'playbook-1',
        requires_human_approval: false,
        execution_mode: 'rpa',
      },
      true
    );
    expect(executeRpaTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        action_type: 'reply',
        target_url: 'https://reddit.com/r/test/comments/3',
        text: 'Hello!',
        action_id: 'rpa-3',
      })
    );
  });

  it('blocks RPA when playbook limits exceeded', async () => {
    playbookStore.length = 0;
    seedPlaybook({
      id: 'playbook-limit',
      limits: { max_replies_per_hour: 0 },
      execution_modes: {
        api_allowed: true,
        rpa_allowed: true,
        manual_only: false,
      },
    });
    const result = await executeCommunityAction(
      {
        id: 'rpa-4',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        action_type: 'reply',
        target_id: 'https://reddit.com/r/test/comments/4',
        suggested_text: 'Hello!',
        playbook_id: 'playbook-limit',
        requires_human_approval: false,
        execution_mode: 'rpa',
      },
      true
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Playbook limit exceeded');
    expect(executeRpaTask).not.toHaveBeenCalled();
  });

  it('scheduler triggers RPA execution path', async () => {
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      access_token: 'token-1',
    });
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('rpa-5', {
      id: 'rpa-5',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'reddit',
      action_type: 'reply',
      target_id: 'https://reddit.com/r/test/comments/5',
      suggested_text: 'Hello!',
      playbook_id: 'playbook-1',
      execution_mode: 'rpa',
      status: 'approved',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    expect(executeRpaTask).toHaveBeenCalled();
    const updated = actionStore.get('rpa-5');
    expect(updated.status).toBe('executed');
  });
});

describe('Community-AI Webhooks', () => {
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

describe('Community-AI Scheduling', () => {
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
    } as NextApiRequest;
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
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
    } as NextApiRequest;
    const res = createMockRes();
    await actionsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('Community-AI Action History', () => {
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

describe('Community-AI Network Intelligence', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns tenant-scoped records and aggregates', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records).toHaveLength(2);
    expect(payload.summaries.totals.discovered_users).toBe(2);
    expect(payload.summaries.totals.actions_created).toBe(4);
    expect(payload.summaries.totals.actions_executed).toBe(2);
    const playbookSummary = payload.summaries.by_playbook.find(
      (entry: any) => entry.key === 'playbook-1'
    );
    expect(playbookSummary.actions_created).toBe(4);
    expect(playbookSummary.actions_executed).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await networkIntelligenceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Playbook Effectiveness', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns correct counts and rates', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'automate',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records).toHaveLength(1);
    const record = payload.records[0];
    expect(record.discovered_users_count).toBe(2);
    expect(record.eligible_users_count).toBe(1);
    expect(record.ineligible_users_count).toBe(1);
    expect(record.actions_created_count).toBe(4);
    expect(record.actions_executed_count).toBe(2);
    expect(record.execution_rate).toBe(0.5);
    expect(record.automation_level).toBe('assist');
    expect(record.top_platforms[0].platform).toBe('linkedin');
  });

  it('filters by date range', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-old',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-01T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-01-01T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-new',
        discovery_source: 'post',
        first_seen_at: '2024-01-10T00:00:00.000Z',
        last_seen_at: '2024-01-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        start_date: '2024-01-05T00:00:00.000Z',
        end_date: '2024-01-12T00:00:00.000Z',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.records[0].discovered_users_count).toBe(1);
    expect(payload.records[0].actions_created_count).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookEffectivenessHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Summary', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns correct executive metrics', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-2',
        playbook_name: 'Growth Playbook',
        automation_level: 'automate',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'twitter',
        discovered_user_id: 'user-c',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-3',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.total_discovered_users).toBe(2);
    expect(summary.total_eligible_users).toBe(1);
    expect(summary.total_actions_created).toBe(4);
    expect(summary.total_actions_executed).toBe(2);
    expect(summary.execution_rate).toBe(0.5);
    expect(summary.automation_mix.assist).toBeCloseTo(0.5);
    expect(summary.automation_mix.automate).toBeCloseTo(0.5);
    expect(summary.top_playbooks_by_volume[0].playbook_id).toBe('playbook-1');
    expect(summary.top_playbooks_by_quality[0].playbook_id).toBe('playbook-1');
  });

  it('filters by date range', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-old',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-01T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-01T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-new',
        discovery_source: 'post',
        first_seen_at: '2024-01-10T00:00:00.000Z',
        last_seen_at: '2024-01-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'observe',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        start_date: '2024-01-05T00:00:00.000Z',
        end_date: '2024-01-12T00:00:00.000Z',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    const summary = res.json.mock.calls[0][0].summary;
    expect(summary.total_discovered_users).toBe(1);
    expect(summary.total_actions_created).toBe(2);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveSummaryHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Narrative', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
    (evaluateCommunityAiExecutiveNarrative as jest.Mock).mockClear();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns narrative and enforces tenant isolation', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Growth Playbook',
        automation_level: 'automate',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.narrative).toEqual(
      expect.objectContaining({
        overview: 'Narrative overview',
        key_shifts: ['Shift one'],
        risks_to_watch: ['Risk one'],
        recommendations_to_review: ['Review one'],
        explicitly_not_recommended: ['Avoid one'],
      })
    );

    const callArgs = (evaluateCommunityAiExecutiveNarrative as jest.Mock).mock.calls[0][0];
    expect(callArgs.executive_summary.total_discovered_users).toBe(1);
    expect(actionLogStore.length).toBe(0);
  });

  it('calls OmniVyra once', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveNarrativeHandler(req, res);
    expect(evaluateCommunityAiExecutiveNarrative).toHaveBeenCalledTimes(1);
  });
});

describe('Community-AI Week-over-Week Comparison', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('separates windows and computes deltas', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-11T00:00:00.000Z',
        last_seen_at: '2024-02-11T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-3',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 0,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-03T00:00:00.000Z',
        last_seen_at: '2024-02-03T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-2',
        discovery_source: 'comment',
        first_seen_at: '2024-02-04T00:00:00.000Z',
        last_seen_at: '2024-02-04T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-04T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-other',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    const eligible = byMetric.get('eligible_users');
    const created = byMetric.get('actions_created');
    const executed = byMetric.get('actions_executed');
    const rate = byMetric.get('execution_rate');

    expect(eligible.current_value).toBe(2);
    expect(eligible.previous_value).toBe(1);
    expect(eligible.delta_percent).toBeCloseTo(100);
    expect(eligible.trend).toBe('up');

    expect(created.current_value).toBe(3);
    expect(created.previous_value).toBe(2);
    expect(created.delta_percent).toBeCloseTo(50);

    expect(executed.current_value).toBe(2);
    expect(executed.previous_value).toBe(1);
    expect(executed.delta_percent).toBeCloseTo(100);

    expect(rate.current_value).toBeCloseTo(2 / 3);
    expect(rate.previous_value).toBeCloseTo(0.5);
    expect(rate.delta_percent).toBeCloseTo(((2 / 3 - 0.5) / 0.5) * 100);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await wowComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Month-over-Month Comparison', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('uses a different window than wow and computes deltas', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-11T00:00:00.000Z',
        last_seen_at: '2024-02-11T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-2',
        discovery_source: 'comment',
        first_seen_at: '2024-01-21T00:00:00.000Z',
        last_seen_at: '2024-01-21T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-01-21T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-wow-only',
        discovery_source: 'comment',
        first_seen_at: '2024-02-04T00:00:00.000Z',
        last_seen_at: '2024-02-04T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-04T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-other',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    const eligible = byMetric.get('eligible_users');
    const created = byMetric.get('actions_created');
    const executed = byMetric.get('actions_executed');

    expect(eligible.current_value).toBe(4);
    expect(eligible.previous_value).toBe(0);
    expect(eligible.delta_percent).toBeCloseTo(100);
    expect(created.current_value).toBe(10);
    expect(created.previous_value).toBe(0);
    expect(executed.current_value).toBe(8);
    expect(executed.previous_value).toBe(0);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await momComparisonHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Campaign Baseline', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    playbookStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', playbook_id: 'playbook-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('aligns baseline window and computes lift', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push({
      id: 'playbook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      created_at: '2024-02-01T00:00:00.000Z',
      name: 'Default Playbook',
    });
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'campaign-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 1,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'campaign-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'follow',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'baseline-1',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'comment',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'other-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', playbook_id: 'playbook-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.windows.campaign_window.start).toBe('2024-02-01T00:00:00.000Z');
    expect(payload.windows.baseline_window.end).toBe('2024-02-01T00:00:00.000Z');

    const byMetric = new Map(payload.metrics.map((metric: any) => [metric.metric, metric]));
    const eligible = byMetric.get('eligible_users');
    const created = byMetric.get('actions_created');
    const executed = byMetric.get('actions_executed');
    const rate = byMetric.get('execution_rate');

    expect(eligible.campaign_value).toBe(1);
    expect(eligible.baseline_value).toBe(1);
    expect(eligible.lift_percent).toBeCloseTo(0);
    expect(eligible.outcome).toBe('matched');

    expect(created.campaign_value).toBe(3);
    expect(created.baseline_value).toBe(1);
    expect(created.lift_percent).toBeCloseTo(200);
    expect(created.outcome).toBe('outperformed');

    expect(executed.campaign_value).toBe(2);
    expect(executed.baseline_value).toBe(0);
    expect(executed.outcome).toBe('outperformed');

    expect(rate.campaign_value).toBeCloseTo(2 / 3);
    expect(rate.baseline_value).toBeCloseTo(0);
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await campaignBaselineHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Alerts', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    playbookStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic alerts without mutations', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push({
      id: 'playbook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      created_at: '2024-02-01T00:00:00.000Z',
      name: 'Default Playbook',
    });
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-11T00:00:00.000Z',
        last_seen_at: '2024-02-11T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-03T00:00:00.000Z',
        last_seen_at: '2024-02-03T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 3,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'baseline-1',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'comment',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'other-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.alerts.length).toBeGreaterThan(0);
    expect(payload.alerts[0]).toEqual(
      expect.objectContaining({
        alert_type: expect.any(String),
        severity: expect.any(String),
        title: expect.any(String),
        reason: expect.any(String),
        supporting_metrics: expect.any(Object),
        first_detected_at: expect.anything(),
      })
    );
    expect(actionLogStore.length).toBe(0);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveAlertsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Playbook Learning', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    playbookStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic learning states', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push(
      {
        id: 'playbook-1',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        created_at: '2024-02-01T00:00:00.000Z',
        name: 'Default Playbook',
      },
      {
        id: 'playbook-2',
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        created_at: '2024-02-05T00:00:00.000Z',
        name: 'Secondary Playbook',
      }
    );
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-current-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-current-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 2,
        last_action_type: 'follow',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-previous-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-03T00:00:00.000Z',
        last_seen_at: '2024-02-03T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 2,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-03T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p1-baseline-1',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'comment',
        last_action_at: '2024-01-20T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'p2-only-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-12T00:00:00.000Z',
        last_seen_at: '2024-02-12T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Secondary Playbook',
        automation_level: 'observe',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-12T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'other-1',
        discovery_source: 'comment',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-3',
        playbook_name: 'Other Playbook',
        automation_level: 'observe',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'comment',
        last_action_at: '2024-02-10T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const byPlaybook = new Map(
      payload.records.map((record: any) => [record.playbook_id, record])
    );
    const record1 = byPlaybook.get('playbook-1');
    const record2 = byPlaybook.get('playbook-2');

    expect(record1.learning_state).toBe('improving');
    expect(record1.confidence).toBe('low');
    expect(record1.supporting_signals.length).toBeGreaterThan(0);
    expect(record2.learning_state).toBe('insufficient_data');
    expect(actionLogStore.length).toBe(0);

    const res2 = createMockRes();
    await playbookLearningHandler(req, res2);
    expect(res2.json.mock.calls[0][0]).toEqual(payload);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await playbookLearningHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Recommendations', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-02-15T00:00:00.000Z'));
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    playbookStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns deterministic recommendations and requires review', async () => {
    setRole('VIEW_ONLY');
    playbookStore.push({
      id: 'playbook-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      created_at: '2024-02-01T00:00:00.000Z',
      name: 'Default Playbook',
    });
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'rec-1',
        discovery_source: 'post',
        first_seen_at: '2024-02-10T00:00:00.000Z',
        last_seen_at: '2024-02-10T00:00:00.000Z',
        classification: 'prospect',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'like',
        last_action_at: '2024-02-10T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'rec-2',
        discovery_source: 'post',
        first_seen_at: '2024-02-11T00:00:00.000Z',
        last_seen_at: '2024-02-11T00:00:00.000Z',
        classification: 'peer',
        eligibility: false,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 0,
        last_action_type: 'follow',
        last_action_at: '2024-02-11T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'rec-3',
        discovery_source: 'comment',
        first_seen_at: '2024-01-20T00:00:00.000Z',
        last_seen_at: '2024-01-20T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 1,
        total_actions_executed: 1,
        last_action_type: 'comment',
        last_action_at: '2024-01-20T01:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.recommendations.length).toBeGreaterThan(0);
    payload.recommendations.forEach((rec: any) => {
      expect(rec.requires_review).toBe(true);
    });
    expect(actionLogStore.length).toBe(0);

    const res2 = createMockRes();
    await recommendationsHandler(req, res2);
    expect(res2.json.mock.calls[0][0]).toEqual(payload);
  });

  it('blocks non-GET requests', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await recommendationsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('Community-AI Executive Export', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    networkIntelligenceStore.length = 0;
    roleStore.length = 0;
    actionLogStore.length = 0;
    (executeLinkedinAction as jest.Mock).mockClear();
    (renderExecutiveSummaryPdf as jest.Mock).mockClear();
  });

  it('enforces RBAC', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveExportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns PDF headers and enforces tenant isolation', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push(
      {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        discovered_user_id: 'user-a',
        discovery_source: 'post',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        classification: 'prospect',
        eligibility: true,
        playbook_id: 'playbook-1',
        playbook_name: 'Default Playbook',
        automation_level: 'assist',
        total_actions_created: 3,
        total_actions_executed: 2,
        last_action_type: 'like',
        last_action_at: '2024-01-02T01:00:00.000Z',
      },
      {
        tenant_id: 'tenant-2',
        organization_id: 'tenant-2',
        platform: 'reddit',
        discovered_user_id: 'user-b',
        discovery_source: 'comment',
        first_seen_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-03T00:00:00.000Z',
        classification: 'peer',
        eligibility: true,
        playbook_id: 'playbook-2',
        playbook_name: 'Growth Playbook',
        automation_level: 'automate',
        total_actions_created: 5,
        total_actions_executed: 5,
        last_action_type: 'follow',
        last_action_at: '2024-01-03T02:00:00.000Z',
      }
    );

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveExportHandler(req, res);

    const headerCalls = res.setHeader.mock.calls;
    expect(headerCalls).toEqual(
      expect.arrayContaining([
        ['Content-Type', 'application/pdf'],
        [expect.stringMatching(/content-disposition/i), expect.stringMatching(/community-ai-executive-\d{4}-\d{2}-\d{2}\.pdf/)],
      ])
    );

    const renderCalls = (renderExecutiveSummaryPdf as jest.Mock).mock.calls;
    expect(renderCalls.length).toBeGreaterThan(0);
    const input = renderCalls[0][0];
    expect(input.summary.total_discovered_users).toBe(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not create action logs or touch automation', async () => {
    setRole('VIEW_ONLY');
    networkIntelligenceStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      discovered_user_id: 'user-a',
      discovery_source: 'post',
      first_seen_at: '2024-01-01T00:00:00.000Z',
      last_seen_at: '2024-01-02T00:00:00.000Z',
      classification: 'prospect',
      eligibility: true,
      playbook_id: 'playbook-1',
      playbook_name: 'Default Playbook',
      automation_level: 'assist',
      total_actions_created: 1,
      total_actions_executed: 0,
      last_action_type: 'like',
      last_action_at: '2024-01-02T01:00:00.000Z',
    });

    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await executiveExportHandler(req, res);

    expect(actionLogStore.length).toBe(0);
    expect(executeLinkedinAction).not.toHaveBeenCalled();
  });
});

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
    playbookStore.length = 0;
    webhookStore.length = 0;
    autoRuleStore.length = 0;
    seedPlaybook();
  });

  it('viewer cannot approve or execute', async () => {
    setRole('VIEW_ONLY');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-1', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(403);
  });

  it('approver cannot execute', async () => {
    setRole('CONTENT_REVIEWER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-2', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(403);
  });

  it('executor can execute', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-3', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(200);
  });

  it('admin can approve and execute', async () => {
    setRole('COMPANY_ADMIN');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    actionStore.set('rbac-4', {
      id: 'rbac-4',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-4',
      suggested_text: 'Thanks!',
      playbook_id: 'playbook-1',
      status: 'pending',
      requires_human_approval: true,
    });
    const approveReq = {
      method: 'POST',
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
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'rbac-4', approved: true },
    } as NextApiRequest;
    const execRes = createMockRes();
    await executeHandler(execReq, execRes);
    expect(execRes.status).toHaveBeenCalledWith(200);
  });

  it('returns capability permissions for roles', async () => {
    const cases = [
      {
        role: 'VIEW_ONLY',
        expected: {
          canApprove: false,
          canExecute: false,
          canSchedule: false,
          canSkip: false,
          canManageConnectors: false,
        },
      },
      {
        role: 'CONTENT_REVIEWER',
        expected: {
          canApprove: true,
          canExecute: false,
          canSchedule: true,
          canSkip: true,
          canManageConnectors: true,
        },
      },
      {
        role: 'CONTENT_PUBLISHER',
        expected: {
          canApprove: false,
          canExecute: true,
          canSchedule: false,
          canSkip: false,
          canManageConnectors: true,
        },
      },
      {
        role: 'COMPANY_ADMIN',
        expected: {
          canApprove: true,
          canExecute: true,
          canSchedule: true,
          canSkip: true,
          canManageConnectors: true,
        },
      },
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

      const req = {
        method: 'GET',
        query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
      } as NextApiRequest;
      const res = createMockRes();
      await actionsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.permissions).toEqual(entry.expected);
    }
  });

  it('role mismatch rejected with 403', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
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

describe('Community-AI Notifications', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
    tokenStore.length = 0;
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
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'notify-1', approved: true },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(notificationStore.some((note) => note.event_type === 'executed')).toBe(true);
  });

  it('creates notification on execution failure', async () => {
    setRole('CONTENT_PUBLISHER');
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token-1',
    });
    (executeLinkedinAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'boom' });
    actionStore.set('notify-2', {
      id: 'notify-2',
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
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
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
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
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

    scheduledPostStore.push({
      id: 'trend-1',
      company_id: 'tenant-1',
      engagement_goals: { likes: 10, comments: 2, shares: 1 },
    });
    scheduledPostStore.push({
      id: 'trend-2',
      company_id: 'tenant-1',
      engagement_goals: { likes: 10, comments: 2, shares: 1 },
    });

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

describe('Community-AI Insights', () => {
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
    seedPlaybook();
  });

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls OmniVyra with KPIs + trends + anomalies', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'insight-1',
      company_id: 'tenant-1',
      engagement_goals: { likes: 5, comments: 2, shares: 1 },
      content: 'Post content',
    });
    analyticsStore.push({
      scheduled_post_id: 'insight-1',
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 3,
      shares: 2,
      views: 50,
      engagement_rate: 1,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(evaluateCommunityAiInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        kpis: expect.any(Object),
        trends: expect.any(Array),
        anomalies: expect.any(Array),
      })
    );
  });

  it('returns structured insight response', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.summary_insight).toBeDefined();
    expect(payload.key_findings).toBeDefined();
    expect(payload.recommended_actions).toBeDefined();
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'insight-2',
      company_id: 'tenant-2',
      engagement_goals: { likes: 5 },
    });
    analyticsStore.push({
      scheduled_post_id: 'insight-2',
      platform: 'linkedin',
      content_type: 'text',
      likes: 1,
      comments: 0,
      shares: 0,
      views: 10,
      engagement_rate: 0.1,
      date: new Date().toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await insightsHandler(req, res);
    expect(evaluateCommunityAiInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        kpis: expect.objectContaining({ by_platform: [] }),
      })
    );
  });
});

describe('Community-AI Forecast', () => {
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

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'GET' } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns forecast array', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-1';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: i <= 7 ? 5 : 20,
        comments: i <= 7 ? 2 : 6,
        shares: i <= 7 ? 1 : 4,
        views: i <= 7 ? 50 : 120,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        forecast: expect.any(Array),
        risk_flags: expect.any(Array),
      })
    );
  });

  it('filters by platform and content type', async () => {
    setRole('VIEW_ONLY');
    const postIdA = 'forecast-3';
    const postIdB = 'forecast-4';
    scheduledPostStore.push(
      {
        id: postIdA,
        company_id: 'tenant-1',
        engagement_goals: { likes: 1 },
        content: 'Post content',
      },
      {
        id: postIdB,
        company_id: 'tenant-1',
        engagement_goals: { likes: 1 },
        content: 'Post content',
      }
    );
    const today = new Date();
    for (let i = 1; i <= 10; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postIdA,
        platform: 'linkedin',
        content_type: 'text',
        likes: 4,
        comments: 1,
        shares: 1,
        views: 40,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
      analyticsStore.push({
        scheduled_post_id: postIdB,
        platform: 'instagram',
        content_type: 'image',
        likes: 6,
        comments: 2,
        shares: 1,
        views: 60,
        engagement_rate: 0.6,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        platform: 'linkedin',
        content_type: 'text',
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.forecast.every((row: any) => row.platform === 'linkedin')).toBe(true);
    expect(payload.forecast.every((row: any) => row.content_type === 'text')).toBe(true);
  });

  it('returns data for CSV export', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-csv';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const date = new Date();
    date.setDate(date.getDate() - 3);
    analyticsStore.push({
      scheduled_post_id: postId,
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 3,
      shares: 2,
      views: 80,
      engagement_rate: 0.5,
      date: date.toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.forecast.length).toBeGreaterThan(0);
  });

  it('includes risk reason in CSV export data', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-risk-reason';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: i <= 7 ? 2 : 50,
        comments: i <= 7 ? 1 : 20,
        shares: i <= 7 ? 1 : 10,
        views: i <= 7 ? 20 : 200,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.risk_flags.length).toBeGreaterThan(0);
    expect(payload.risk_flags[0]).toHaveProperty('reason');
  });

  it('detects risk flag on drop', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-2';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: i <= 7 ? 2 : 50,
        comments: i <= 7 ? 1 : 20,
        shares: i <= 7 ? 1 : 10,
        views: i <= 7 ? 20 : 200,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.risk_flags.length).toBeGreaterThan(0);
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Community-AI Forecast Insights', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (getProfile as jest.Mock).mockResolvedValueOnce({ brand_voice: 'professional' });
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
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls OmniVyra with forecast + trends + anomalies', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-insights-1';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const date = new Date();
    date.setDate(date.getDate() - 3);
    analyticsStore.push({
      scheduled_post_id: postId,
      platform: 'linkedin',
      content_type: 'text',
      likes: 10,
      comments: 3,
      shares: 2,
      views: 80,
      engagement_rate: 0.5,
      date: date.toISOString().slice(0, 10),
    });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(evaluateCommunityAiForecastInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        forecast: expect.any(Array),
        trends: expect.any(Array),
        anomalies: expect.any(Array),
        kpis: expect.any(Object),
      })
    );
  });

  it('returns structured response', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        explanation_summary: expect.any(String),
        key_drivers: expect.any(Array),
        risks: expect.any(Array),
        recommended_actions: expect.any(Array),
        confidence_level: expect.any(Number),
      })
    );
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2' },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastInsightsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Community-AI Forecast Simulation', () => {
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

  it('requires tenant/org', async () => {
    setRole('VIEW_ONLY');
    const req = { method: 'POST', body: { scenario: {} } } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns baseline + simulated forecast', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-1';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: i <= 7 ? 5 : 20,
        comments: i <= 7 ? 2 : 6,
        shares: i <= 7 ? 1 : 4,
        views: i <= 7 ? 50 : 120,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { posting_frequency_change: 1, engagement_boost_factor: 10 },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        baseline_forecast: expect.any(Array),
        simulated_forecast: expect.any(Array),
        delta: expect.any(Array),
        risk_flags: expect.any(Array),
      })
    );
  });

  it('applies content_type_mix adjustments', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-2';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'video',
        likes: 10,
        comments: 3,
        shares: 2,
        views: 80,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { content_type_mix: { video: 20 } },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.simulated_forecast[0].predicted_views).toBeGreaterThan(
      payload.baseline_forecast[0].predicted_views
    );
  });

  it('rejects invalid content_type_mix', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { content_type_mix: { text: 80, video: 30 } },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns consistent results for same scenario', async () => {
    setRole('VIEW_ONLY');
    const postId = 'forecast-sim-3';
    scheduledPostStore.push({
      id: postId,
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
    const today = new Date();
    for (let i = 1; i <= 14; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      analyticsStore.push({
        scheduled_post_id: postId,
        platform: 'linkedin',
        content_type: 'text',
        likes: 5,
        comments: 2,
        shares: 1,
        views: 50,
        engagement_rate: 0.5,
        date: date.toISOString().slice(0, 10),
      });
    }
    const req = {
      method: 'POST',
      body: {
        tenant_id: 'tenant-1',
        organization_id: 'tenant-1',
        scenario: { posting_frequency_change: 1, engagement_boost_factor: 5 },
      },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    const first = (res.json as jest.Mock).mock.calls[0][0];
    const res2 = createMockRes();
    await forecastSimulateHandler(req, res2);
    const second = (res2.json as jest.Mock).mock.calls[0][0];
    expect(second.delta).toEqual(first.delta);
  });

  it('blocks cross-tenant access', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-2', scenario: {} },
    } as NextApiRequest;
    const res = createMockRes();
    await forecastSimulateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

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
    tokenStore.push({
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      access_token: 'token',
    });
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    const rows = Array.from(actionStore.values());
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    const rows = Array.from(actionStore.values());
    expect(rows.length).toBe(0);
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', platform: 'linkedin' },
    } as NextApiRequest;
    const res = createMockRes();
    await platformHandler(req, res);
    const rows = Array.from(actionStore.values());
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
  });

  it('enforces RBAC for auto-rules API', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1' },
    } as NextApiRequest;
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'kpis', format: 'csv' },
    } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('blocks cross-tenant export', async () => {
    setRole('VIEW_ONLY');
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-2', type: 'kpis', format: 'csv' },
    } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns CSV file response', async () => {
    setRole('VIEW_ONLY');
    scheduledPostStore.push({
      id: 'export-1',
      company_id: 'tenant-1',
      engagement_goals: { likes: 1 },
      content: 'Post content',
    });
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
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'kpis', format: 'csv' },
    } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns PDF with correct headers', async () => {
    setRole('VIEW_ONLY');
    (getProfile as jest.Mock).mockResolvedValueOnce({ name: 'Acme Co' });
    const req = {
      method: 'GET',
      query: { tenant_id: 'tenant-1', organization_id: 'tenant-1', type: 'full-report', format: 'pdf' },
    } as NextApiRequest;
    const res = createMockRes();
    await exportHandler(req, res);
    const dateStamp = new Date().toISOString().slice(0, 10);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="community-ai-report-${dateStamp}.pdf"`
    );
  });
});
