import handler from '../../../pages/api/recommendations/analytics';
import { supabase } from '../../db/supabaseClient';
import {
  createApiRequestMock,
  createMockRes,
  createSupabaseMock,
  getRbacMockImplementations,
} from '../utils';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () => require('../utils/setupApiTest').getRbacMockImplementations());

describe('Recommendation analytics', () => {
  const mockResponses = (table: string) => {
    if (table === 'recommendation_snapshots') {
      return { data: [{ id: 'rec-1', campaign_id: 'camp-1', confidence: 80, platforms: ['linkedin'], created_at: '2026-01-01T00:00:00Z' }], error: null };
    }
    if (table === 'recommendation_audit_logs') {
      return { data: [{ policy_id: 'policy-1', confidence: 80, final_score: 1.2, trend_sources_used: [{ source: 'YouTube Trends' }], created_at: '2026-01-01T00:00:00Z' }], error: null };
    }
    if (table === 'performance_feedback') {
      return { data: [{ campaign_id: 'camp-1', engagement_rate: 0.1, collected_at: '2026-01-01T00:00:00Z' }], error: null };
    }
    if (table === 'recommendation_policies') {
      return { data: [{ id: 'policy-1', name: 'Default Policy' }], error: null };
    }
    if (table === 'campaign_versions') {
      return { data: [{ campaign_id: 'camp-1', company_id: 'default' }], error: null };
    }
    return { data: [], error: null };
  };

  beforeEach(() => {
    const { from, rpc } = createSupabaseMock(mockResponses);
    (supabase as any).from.mockImplementation(from);
    (supabase as any).rpc.mockImplementation(rpc);
  });

  it('computes analytics and enforces admin gating', async () => {
    const req = createApiRequestMock({ method: 'GET', companyId: 'default' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const payload = res.body;
    expect(payload.totals.recommendations_count).toBe(1);
    expect(payload.by_platform[0].platform).toBe('linkedin');
    expect(payload.timeline[0].count).toBe(1);
    expect(payload.by_policy[0].policy_id).toBe('policy-1');
  });

  it('blocks non-admin access', async () => {
    const rbac = require('../../services/rbacService');
    (rbac.enforceRole as jest.Mock).mockImplementationOnce(async ({ res }: { res: any }) => {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    });
    const req = createApiRequestMock({ method: 'GET', companyId: 'default' });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });
});
