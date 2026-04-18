import type { NextApiResponse } from 'next';

export const actionStore = new Map<string, any>();
export const actionLogStore: Array<any> = [];
export const roleStore: Array<any> = [];
export const notificationStore: Array<any> = [];
export const analyticsStore: Array<any> = [];
export const scheduledPostStore: Array<any> = [];
export const tokenStore: Array<any> = [];
export const playbookStore: Array<any> = [];
export const webhookStore: Array<any> = [];
export const autoRuleStore: Array<any> = [];
export const networkIntelligenceStore: Array<any> = [];

export const mockJsonResponse = (payload: any, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => (payload ? JSON.stringify(payload) : ''),
});

export const defaultPlaybook = {
  id: 'playbook-1',
  tenant_id: 'tenant-1',
  organization_id: 'tenant-1',
  name: 'Default Playbook',
  scope: { platforms: ['linkedin'], content_types: ['text'], intents: ['community_engagement'] },
  tone: { style: 'professional', emoji_allowed: true, max_length: 280 },
  user_rules: { first_time_user: 'optional', influencer_user: 'require_approval', negative_sentiment: 'escalate', spam_user: 'ignore' },
  action_rules: { allow_reply: true, allow_like: true, allow_follow: true, allow_share: true, allow_dm: false },
  automation_rules: { auto_execute_low_risk: true, require_human_approval_medium_risk: false, block_high_risk: true },
  limits: { max_replies_per_hour: 100, max_follows_per_day: 100, max_actions_per_day: 1000 },
  execution_modes: { api_allowed: true, rpa_allowed: false, manual_only: false },
  conflict_policy: { primary_wins: true, max_secondary_playbooks: 1 },
  safety: { block_urls: false, block_sensitive_topics: false, prohibited_words: [] },
  status: 'active',
};

export const seedPlaybook = (overrides?: Record<string, any>) => {
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

export const resetCommunityAiStores = () => {
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
};

const resolveSelect = (table: string, state: any) => {
  if (table === 'community_ai_actions') {
    const id = state.filters.id;
    if (id) {
      const row = actionStore.get(id);
      return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
    }
    let rows = Array.from(actionStore.values());
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.platform) rows = rows.filter((row) => row.platform === state.filters.platform);
    if (state.filters.action_type) rows = rows.filter((row) => row.action_type === state.filters.action_type);
    if (state.filters.target_id) rows = rows.filter((row) => row.target_id === state.filters.target_id);
    if (state.filters.status) rows = rows.filter((row) => row.status === state.filters.status);
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
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.platform) rows = rows.filter((row) => row.platform === state.filters.platform);
    if (state.filters.playbook_id) rows = rows.filter((row) => row.playbook_id === state.filters.playbook_id);
    if (state.gteFilter) rows = rows.filter((row) => row[state.gteFilter.field] && row[state.gteFilter.field] >= state.gteFilter.value);
    if (state.lteFilter) rows = rows.filter((row) => row[state.lteFilter.field] && row[state.lteFilter.field] <= state.lteFilter.value);
    return { data: rows, error: null };
  }
  if (table === 'community_ai_action_logs') {
    let rows = [...actionLogStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.action_id) rows = rows.filter((row) => row.action_id === state.filters.action_id);
    if (state.inFilter && state.inFilter.field === 'action_id') rows = rows.filter((row) => state.inFilter.values.includes(row.action_id));
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending ? a[state.order.field].localeCompare(b[state.order.field]) : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    return { data: rows, error: null };
  }
  if (table === 'scheduled_posts') return { data: [...scheduledPostStore], error: null };
  if (table === 'content_analytics') {
    let rows = analyticsStore.map((row) => {
      const scheduled = scheduledPostStore.find((post) => post.id === row.scheduled_post_id);
      return {
        ...row,
        scheduled_posts: scheduled ? { engagement_goals: scheduled.engagement_goals, users: { company_id: scheduled.company_id } } : null,
      };
    });
    const companyId = state.filters['scheduled_posts.users.company_id'];
    if (companyId) rows = rows.filter((row) => row.scheduled_posts?.users?.company_id === companyId);
    if (state.filters.platform) rows = rows.filter((row) => row.platform === state.filters.platform);
    if (state.gteFilter?.field === 'date') rows = rows.filter((row) => row.date >= state.gteFilter.value);
    return { data: rows, error: null };
  }
  if (table === 'community_ai_notifications') {
    let rows = [...notificationStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.is_read !== undefined) rows = rows.filter((row) => row.is_read === state.filters.is_read);
    if (state.filters.event_type) rows = rows.filter((row) => row.event_type === state.filters.event_type);
    if (state.inFilter?.field === 'action_id') rows = rows.filter((row) => state.inFilter.values.includes(row.action_id));
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending ? a[state.order.field].localeCompare(b[state.order.field]) : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    return { data: rows, error: null };
  }
  if (table === 'user_company_roles') {
    let rows = [...roleStore];
    if (state.filters.user_id) rows = rows.filter((row) => row.user_id === state.filters.user_id);
    if (state.filters.company_id) rows = rows.filter((row) => row.company_id === state.filters.company_id);
    if (state.filters.role) rows = rows.filter((row) => row.role === state.filters.role);
    if (state.filters.status) rows = rows.filter((row) => row.status === state.filters.status);
    if (typeof state.limitValue === 'number') rows = rows.slice(0, state.limitValue);
    return { data: rows, error: null };
  }
  if (table === 'community_ai_platform_tokens') {
    let rows = [...tokenStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.platform) rows = rows.filter((row) => row.platform === state.filters.platform);
    if (typeof state.limitValue === 'number') rows = rows.slice(0, state.limitValue);
    if (state.single) return rows.length > 0 ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: rows, error: null };
  }
  if (table === 'community_ai_playbooks') {
    let rows = [...playbookStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.id) rows = rows.filter((row) => row.id === state.filters.id);
    if (state.inFilter?.field === 'id') rows = rows.filter((row) => state.inFilter.values.includes(row.id));
    if (typeof state.limitValue === 'number') rows = rows.slice(0, state.limitValue);
    if (state.single) return rows.length > 0 ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: rows, error: null };
  }
  if (table === 'community_ai_webhooks') {
    let rows = [...webhookStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.event_type) rows = rows.filter((row) => row.event_type === state.filters.event_type);
    if (state.filters.is_active !== undefined) rows = rows.filter((row) => row.is_active === state.filters.is_active);
    if (typeof state.limitValue === 'number') rows = rows.slice(0, state.limitValue);
    return { data: rows, error: null };
  }
  if (table === 'community_ai_auto_rules') {
    let rows = [...autoRuleStore];
    if (state.filters.tenant_id) rows = rows.filter((row) => row.tenant_id === state.filters.tenant_id);
    if (state.filters.organization_id) rows = rows.filter((row) => row.organization_id === state.filters.organization_id);
    if (state.filters.is_active !== undefined) rows = rows.filter((row) => row.is_active === state.filters.is_active);
    if (state.order) {
      rows.sort((a, b) =>
        state.order?.ascending ? a[state.order.field].localeCompare(b[state.order.field]) : b[state.order.field].localeCompare(a[state.order.field])
      );
    }
    if (typeof state.limitValue === 'number') rows = rows.slice(0, state.limitValue);
    return { data: rows, error: null };
  }
  if (table === 'execution_guardrails') {
    const value = { auto_execution_enabled: true, daily_platform_limit: 999, per_post_reply_limit: 999, per_evaluation_limit: 999 };
    return { data: state.single ? value : [value], error: null };
  }
  if (table === 'organization_plan_assignments' || table === 'pricing_plans') return { data: state.single ? null : [], error: null };
  if (table === 'usage_meter_monthly') {
    const value = { llm_total_tokens: 0, external_api_calls: 0, automation_executions: 0 };
    return { data: state.single ? value : [value], error: null };
  }
  return { data: null, error: null };
};

const resolveUpdate = (table: string, state: any, _field: string, value: any) => {
  if (table === 'community_ai_actions') {
    const row = actionStore.get(value);
    if (row) actionStore.set(value, { ...row, ...(state.update || {}) });
    return { data: row || null, error: null };
  }
  if (table === 'community_ai_auto_rules') {
    const index = autoRuleStore.findIndex((row) => row.id === value);
    if (index >= 0) {
      autoRuleStore[index] = { ...autoRuleStore[index], ...(state.update || {}) };
      return { data: autoRuleStore[index], error: null };
    }
  }
  return { data: null, error: null };
};

const resolveInsert = (table: string, state: any) => {
  if (table === 'community_ai_actions') {
    state.insertRows?.forEach((row: any) => row?.id && actionStore.set(row.id, row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_action_logs') {
    state.insertRows?.forEach((row: any) => actionLogStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_notifications') {
    state.insertRows?.forEach((row: any) => notificationStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_webhooks') {
    state.insertRows?.forEach((row: any) => webhookStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_auto_rules') {
    state.insertRows?.forEach((row: any) => autoRuleStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  return { data: null, error: null };
};

const resolveDelete = (table: string, _state: any, field: string, value: any) => {
  if (table === 'community_ai_auto_rules' && field === 'id') {
    const index = autoRuleStore.findIndex((row) => row.id === value);
    if (index >= 0) autoRuleStore.splice(index, 1);
  }
  if (table === 'community_ai_webhooks' && field === 'id') {
    const index = webhookStore.findIndex((row) => row.id === value);
    if (index >= 0) webhookStore.splice(index, 1);
  }
  return { data: [], error: null };
};

export const buildQuery = (table: string) => {
  const state: {
    filters: Record<string, any>;
    update?: any;
    inFilter?: { field: string; values: any[] };
    order?: { field: string; ascending: boolean };
    lteFilter?: { field: string; value: string };
    gteFilter?: { field: string; value: string };
    insertRows?: any[];
    limitValue?: number;
    single?: boolean;
  } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => { state.filters[field] = value; return query; }),
    gte: jest.fn((field: string, value: any) => { state.gteFilter = { field, value }; return query; }),
    limit: jest.fn((value: number) => { state.limitValue = value; return query; }),
    lte: jest.fn((field: string, value: any) => { state.lteFilter = { field, value }; return query; }),
    in: jest.fn((field: string, values: any[]) => { state.inFilter = { field, values }; return query; }),
    order: jest.fn((field: string, options?: any) => { state.order = { field, ascending: options?.ascending !== false }; return query; }),
    single: jest.fn(async () => { state.single = true; return resolveSelect(table, state); }),
    maybeSingle: jest.fn(async () => { state.single = true; return resolveSelect(table, state); }),
    not: jest.fn(() => query),
    then: (resolve: any, reject: any) => Promise.resolve(resolveSelect(table, state)).then(resolve, reject),
    update: jest.fn((values: any) => {
      state.update = values;
      return { eq: jest.fn(async (field: string, value: any) => resolveUpdate(table, state, field, value)) };
    }),
    insert: jest.fn((rows: any) => {
      state.insertRows = Array.isArray(rows) ? rows : [rows];
      const chain: any = {
        select: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        then: (resolve: any, reject: any) => Promise.resolve(resolveInsert(table, state)).then(resolve, reject),
      };
      return chain;
    }),
    delete: jest.fn(() => ({
      eq: jest.fn(async (field: string, value: any) => resolveDelete(table, state, field, value)),
    })),
  };
  return query;
};

export const createMockRes = () => {
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
    setHeader: jest.fn((key: string, value: string) => { headers[key.toLowerCase()] = value; }),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
  };
  return res as NextApiResponse;
};

export const setRole = (role: string, companyId = 'tenant-1') => {
  roleStore.push({ user_id: 'user-1', company_id: companyId, role, status: 'active' });
};
