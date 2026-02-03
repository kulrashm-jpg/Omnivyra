import type { NextApiRequest, NextApiResponse } from 'next';
import dashboardHandler from '../../../pages/api/community-ai/dashboard';
import platformHandler from '../../../pages/api/community-ai/platform/[platform]';
import postHandler from '../../../pages/api/community-ai/post/[platform]/[postId]';
import actionsHandler from '../../../pages/api/community-ai/actions';
import executeHandler from '../../../pages/api/community-ai/actions/execute';
import historyHandler from '../../../pages/api/community-ai/actions/history';
import metricsHandler from '../../../pages/api/community-ai/metrics';
import notificationsHandler from '../../../pages/api/community-ai/notifications';
import contentKpisHandler from '../../../pages/api/community-ai/content-kpis';
import trendsHandler from '../../../pages/api/community-ai/trends';
import { getProfile } from '../../services/companyProfileService';
import { evaluateCommunityAiEngagement } from '../../services/omnivyraClientV1';
import { executeAction as executeLinkedinAction } from '../../services/platformConnectors/linkedinConnector';
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
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: jest.fn().mockResolvedValue({ ok: true, platform: 'linkedin' }),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');

const actionStore = new Map<string, any>();
const actionLogStore: Array<any> = [];
const roleStore: Array<any> = [];
const notificationStore: Array<any> = [];
const analyticsStore: Array<any> = [];
const scheduledPostStore: Array<any> = [];

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
    single: jest.fn(async () => resolveSelect(table, state)),
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
    insert: jest.fn(async (rows: any) => {
      state.insertRows = Array.isArray(rows) ? rows : [rows];
      return resolveInsert(table, state);
    }),
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
  return { data: null, error: null };
};

const resolveInsert = (table: string, state: any) => {
  if (table === 'community_ai_action_logs') {
    state.insertRows?.forEach((row) => actionLogStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  if (table === 'community_ai_notifications') {
    state.insertRows?.forEach((row) => notificationStore.push(row));
    return { data: state.insertRows || [], error: null };
  }
  return { data: null, error: null };
};

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
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
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
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
    (executeLinkedinAction as jest.Mock).mockClear();
  });

  it('cannot execute without approval', async () => {
    setRole('CONTENT_PUBLISHER');
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
      status: 'pending',
    });
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'action-3', approved: true },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
    expect(executeLinkedinAction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const updated = actionStore.get('action-3');
    expect(updated.status).toBe('executed');
    expect(actionLogStore.some((log) => log.event_type === 'approved')).toBe(true);
    expect(actionLogStore.some((log) => log.event_type === 'executed')).toBe(true);
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
    (executeLinkedinAction as jest.Mock).mockClear();
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
    expect(updated.status).toBe('scheduled');
    expect(updated.scheduled_at).toBe(scheduledAt);
    expect(actionLogStore.some((log) => log.event_type === 'scheduled')).toBe(true);
  });

  it('scheduler executes due actions and logs execution', async () => {
    setRole('CONTENT_PUBLISHER');
    const past = new Date(Date.now() - 1000).toISOString();
    actionStore.set('action-11', {
      id: 'action-11',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-11',
      suggested_text: 'Appreciate it!',
      status: 'scheduled',
      scheduled_at: past,
      requires_human_approval: false,
    });
    await runCommunityAiScheduler(new Date());
    const updated = actionStore.get('action-11');
    expect(updated.status).toBe('executed');
    expect(actionLogStore.some((log) => log.event_type === 'executed')).toBe(true);
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

describe('Community-AI RBAC', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    actionStore.clear();
    actionLogStore.length = 0;
    roleStore.length = 0;
    notificationStore.length = 0;
    analyticsStore.length = 0;
    scheduledPostStore.length = 0;
  });

  it('viewer cannot approve or execute', async () => {
    setRole('VIEW_ONLY');
    actionStore.set('rbac-1', {
      id: 'rbac-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
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
    actionStore.set('rbac-2', {
      id: 'rbac-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
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
    actionStore.set('rbac-3', {
      id: 'rbac-3',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-3',
      suggested_text: 'Thanks!',
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
    actionStore.set('rbac-4', {
      id: 'rbac-4',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-4',
      suggested_text: 'Thanks!',
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

  it('role mismatch rejected with 403', async () => {
    setRole('VIEW_ONLY', 'tenant-2');
    actionStore.set('rbac-5', {
      id: 'rbac-5',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-5',
      suggested_text: 'Thanks!',
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
  });

  it('creates notification on execution success', async () => {
    setRole('CONTENT_PUBLISHER');
    actionStore.set('notify-1', {
      id: 'notify-1',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-1',
      suggested_text: 'Thanks!',
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
    (executeLinkedinAction as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'boom' });
    actionStore.set('notify-2', {
      id: 'notify-2',
      tenant_id: 'tenant-1',
      organization_id: 'tenant-1',
      platform: 'linkedin',
      action_type: 'reply',
      target_id: 'post-2',
      suggested_text: 'Thanks!',
      status: 'approved',
      requires_human_approval: false,
    });
    const req = {
      method: 'POST',
      body: { tenant_id: 'tenant-1', organization_id: 'tenant-1', action_id: 'notify-2', approved: true },
    } as NextApiRequest;
    const res = createMockRes();
    await executeHandler(req, res);
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

