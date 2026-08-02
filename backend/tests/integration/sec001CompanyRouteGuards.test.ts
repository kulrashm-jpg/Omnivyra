/**
 * SEC-001 Phase 0 — company-scoped route guards.
 *
 * Proves the four Phase 0 routes honor the resolveCompanyAccess contract:
 * the guard runs after the method check and BEFORE any data access; a null
 * result (helper has written 400/401/403) short-circuits the handler with the
 * data layer untouched; a granted result leaves the 200/500 paths byte-
 * identical to the pre-guard handlers.
 *
 * The helper itself is covered in backend/tests/unit/resolveCompanyAccess.test.ts;
 * here it is mocked per the established endpoint-test convention.
 */
import learningsHandler from '../../../pages/api/companies/[id]/learnings';
import efficiencyHandler from '../../../pages/api/companies/[id]/efficiency-score';
import outcomeHistoryHandler from '../../../pages/api/companies/[id]/outcome-history';
import companyAnalyticsHandler from '../../../pages/api/governance/company-analytics';
import { createApiRequestMock, createMockRes } from '../utils';

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn(),
}));
jest.mock('../../services/learningDecayService', () => ({
  getEffectiveLearnings: jest.fn(),
}));
jest.mock('../../services/GovernanceAnalyticsService', () => ({
  getCompanyGovernanceAnalytics: jest.fn(),
}));

const mockTableResponses: Record<string, { data: any; error: any }> = {};
jest.mock('../../db/supabaseClient', () => {
  const { createSupabaseMock } = require('../utils/createSupabaseMock');
  return {
    supabase: createSupabaseMock(
      (table: string) => mockTableResponses[table] || { data: [], error: null }
    ),
  };
});

import { resolveCompanyAccess } from '../../services/contentArchitectService';
import { getEffectiveLearnings } from '../../services/learningDecayService';
import { getCompanyGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { supabase } from '../../db/supabaseClient';

const accessMock = resolveCompanyAccess as jest.Mock;
const learningsMock = getEffectiveLearnings as jest.Mock;
const analyticsMock = getCompanyGovernanceAnalytics as jest.Mock;
const fromMock = supabase.from as jest.Mock;

const grantAccess = (role = 'COMPANY_ADMIN') =>
  accessMock.mockResolvedValue({ userId: 'user-1', role });

/** Deny the way the real helper does: write the response, resolve null. */
const denyWith = (status: number, error: string) =>
  accessMock.mockImplementation(async (_req: any, res: any) => {
    res.status(status).json({ error });
    return null;
  });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockTableResponses)) delete mockTableResponses[key];
});

describe('GET /api/companies/[id]/learnings', () => {
  test('anonymous: 401 from guard, data layer never touched', async () => {
    denyWith(401, 'UNAUTHORIZED');
    const res = createMockRes();
    await learningsHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    expect(learningsMock).not.toHaveBeenCalled();
  });

  test('non-member: 403 from guard, data layer never touched', async () => {
    denyWith(403, 'FORBIDDEN_ROLE');
    const res = createMockRes();
    await learningsHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(403);
    expect(learningsMock).not.toHaveBeenCalled();
  });

  test('member: 200 with unchanged response shape and limit clamp intact', async () => {
    grantAccess();
    const rows = [{ id: 'l1', pattern: 'p', effective_score: 0.9 }];
    learningsMock.mockResolvedValue(rows);
    const res = createMockRes();
    await learningsHandler(
      createApiRequestMock({ id: 'company-1', query: { limit: '8' } }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(rows);
    expect(accessMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'company-1');
    expect(learningsMock).toHaveBeenCalledWith('company-1', { limit: 8 });
  });

  test('missing id: guard invoked with undefined and its 400 short-circuits', async () => {
    denyWith(400, 'companyId required');
    const res = createMockRes();
    await learningsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(400);
    expect(accessMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
    expect(learningsMock).not.toHaveBeenCalled();
  });

  test('service failure with access granted: existing 500 path unchanged', async () => {
    grantAccess();
    learningsMock.mockRejectedValue(new Error('db down'));
    const res = createMockRes();
    await learningsHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });

  test('non-GET: 405 before the guard runs', async () => {
    const res = createMockRes();
    await learningsHandler(createApiRequestMock({ method: 'POST', id: 'company-1' }), res);
    expect(res.statusCode).toBe(405);
    expect(accessMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/companies/[id]/efficiency-score', () => {
  test('anonymous: 401 from guard, no DB access', async () => {
    denyWith(401, 'UNAUTHORIZED');
    const res = createMockRes();
    await efficiencyHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test('member with a score row: 200 row unchanged', async () => {
    grantAccess();
    const row = {
      efficiency_tier: 'efficient',
      discount_multiplier: 0.9,
      credits_per_outcome_avg: 12,
      credits_saved_total: 40,
      total_outcomes: 5,
      computed_at: '2026-08-01T00:00:00Z',
    };
    mockTableResponses['credit_efficiency_scores'] = { data: row, error: null };
    const res = createMockRes();
    await efficiencyHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(row);
  });

  test('member with no row: default standard-tier object unchanged', async () => {
    grantAccess();
    mockTableResponses['credit_efficiency_scores'] = { data: null, error: null };
    const res = createMockRes();
    await efficiencyHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      efficiency_tier: 'standard',
      discount_multiplier: 1.0,
      credits_per_outcome_avg: 0,
      credits_saved_total: 0,
      total_outcomes: 0,
    });
  });

  test('DB error with access granted: existing 500 path unchanged', async () => {
    grantAccess();
    mockTableResponses['credit_efficiency_scores'] = {
      data: null,
      error: { message: 'invalid input syntax for type uuid' },
    };
    const res = createMockRes();
    await efficiencyHandler(createApiRequestMock({ id: 'not-a-uuid' }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'invalid input syntax for type uuid' });
  });
});

describe('GET /api/companies/[id]/outcome-history', () => {
  test('anonymous: 401 from guard, no DB access', async () => {
    denyWith(401, 'UNAUTHORIZED');
    const res = createMockRes();
    await outcomeHistoryHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test('non-member: 403 from guard, no DB access', async () => {
    denyWith(403, 'FORBIDDEN_ROLE');
    const res = createMockRes();
    await outcomeHistoryHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(403);
    expect(fromMock).not.toHaveBeenCalled();
  });

  test('member: 200 with rows unchanged', async () => {
    grantAccess();
    const rows = [
      { campaign_id: 'c1', outcome_score: 80, credits_per_outcome: 3, leads_generated: 7, top_content_type: 'text', snapshot_at: '2026-08-01' },
    ];
    mockTableResponses['campaign_outcomes'] = { data: rows, error: null };
    const res = createMockRes();
    await outcomeHistoryHandler(createApiRequestMock({ id: 'company-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(rows);
  });
});

describe('GET /api/governance/company-analytics', () => {
  test('missing companyId: route’s own 400 with exact message; guard never called', async () => {
    const res = createMockRes();
    await companyAnalyticsHandler(createApiRequestMock({}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'companyId is required' });
    expect(accessMock).not.toHaveBeenCalled();
    expect(analyticsMock).not.toHaveBeenCalled();
  });

  test('anonymous: 401 from guard, service never called', async () => {
    denyWith(401, 'UNAUTHORIZED');
    const res = createMockRes();
    await companyAnalyticsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(analyticsMock).not.toHaveBeenCalled();
  });

  test('non-member: 403 from guard, service never called', async () => {
    denyWith(403, 'FORBIDDEN_ROLE');
    const res = createMockRes();
    await companyAnalyticsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(403);
    expect(analyticsMock).not.toHaveBeenCalled();
  });

  test('member: 200 with analytics unchanged', async () => {
    grantAccess();
    const analytics = { companyId: 'company-1', totalCampaigns: 2, activeCampaigns: 1 };
    analyticsMock.mockResolvedValue(analytics);
    const res = createMockRes();
    await companyAnalyticsHandler(createApiRequestMock({ companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(analytics);
    expect(analyticsMock).toHaveBeenCalledWith('company-1');
  });

  test('service throw with access granted: propagates (factory rethrows) — semantics unchanged', async () => {
    grantAccess();
    analyticsMock.mockRejectedValue(new Error('governance boom'));
    const res = createMockRes();
    await expect(
      companyAnalyticsHandler(createApiRequestMock({ companyId: 'company-1' }), res)
    ).rejects.toThrow('governance boom');
  });

  test('non-GET: 405 before the guard runs', async () => {
    const res = createMockRes();
    await companyAnalyticsHandler(createApiRequestMock({ method: 'POST', companyId: 'company-1' }), res);
    expect(res.statusCode).toBe(405);
    expect(accessMock).not.toHaveBeenCalled();
  });
});
