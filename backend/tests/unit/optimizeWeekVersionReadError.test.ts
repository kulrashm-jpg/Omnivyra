/**
 * unread-error pkg 2: POST /api/campaigns/optimize-week. The campaign_versions readers now THROW
 * CampaignVersionReadError on a failed read (they used to answer "no version").
 *   - BEFORE the optimization write: a failed read is a retryable 503 and nothing is optimized;
 *   - AFTER the write (the version re-read): the optimization IS saved, so the answer is 200 with the
 *     saved result and health_report_status 'unavailable'. The health report is NOT saved from empty
 *     plans (it used to be, from the "no version" fallback).
 */
const mockOptimize = jest.fn(async (..._a: unknown[]) => ({ updated_week: { week_number: 1 }, change_summary: 'tightened', confidence: 0.8 }));
const mockResolved = jest.fn(async (..._a: unknown[]) => ({
  campaign: { objective: 'engagement' }, weekly_plan: [{ week_number: 1 }], daily_plan: [], duration_weeks: 4,
  campaign_version: { id: 'v1', status: 'approved', campaign_snapshot: { campaign: { objective: 'engagement' } } },
}) as unknown);
const mockGetLatest = jest.fn(async (..._a: unknown[]) => ({ id: 'v2', campaign_snapshot: { weekly_plan: [{ week_number: 1 }], daily_plan: [{ d: 1 }], campaign: {} } }) as unknown);
const mockSaveHealth = jest.fn(async (..._a: unknown[]) => undefined);

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'u1' })) }));
jest.mock('../../db/supabaseClient', () => {
  const b: any = { select: () => b, eq: () => b, then: (ok: any) => Promise.resolve({ data: [{ campaign_id: 'c1' }], error: null }).then(ok) };
  return { supabase: { from: () => b } };
});
jest.mock('../../services/externalApiService', () => ({ fetchTrendsFromApis: jest.fn(async () => []) }));
jest.mock('../../services/campaignOptimizationService', () => ({ optimizeCampaignWeek: (...a: unknown[]) => mockOptimize(...a) }));
jest.mock('../../services/campaignBlueprintService', () => ({
  getResolvedCampaignPlanContext: (...a: unknown[]) => mockResolved(...a),
  PrePlanningRequiredError: class extends Error {},
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn(async () => ({ geography: 'US' })) }));
jest.mock('../../services/campaignHealthService', () => ({ validateCampaignHealth: jest.fn(() => ({ status: 'ok', confidence: 1, issues: [], scores: {} })) }));
jest.mock('../../db/campaignVersionStore', () => ({
  ...jest.requireActual('../../db/campaignVersionStore'),
  getLatestCampaignVersion: (...a: unknown[]) => mockGetLatest(...a),
  saveCampaignHealthReport: (...a: unknown[]) => mockSaveHealth(...a),
}));
jest.mock('../../db/campaignApprovedVersionStore', () => ({ getLatestApprovedCampaignVersion: jest.fn(async () => null) }));
jest.mock('../../db/contentAssetStore', () => ({ listAssetsWithLatestContent: jest.fn(async () => []) }));
jest.mock('../../db/performanceStore', () => ({ getLatestLearningInsights: jest.fn(async () => null), getLatestAnalyticsReport: jest.fn(async () => null) }));
jest.mock('../../services/omnivyraFeedbackService', () => ({ sendLearningSnapshot: jest.fn(async () => undefined) }));

import { CampaignVersionReadError } from '../../db/campaignVersionStore';
import handler from '../../../pages/api/campaigns/optimize-week';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}
const post = () => ({ method: 'POST', url: '/x', headers: {}, query: {}, body: { campaignId: 'c1', weekNumber: 1, companyId: 'co1' } }) as any;
const readError = () => new CampaignVersionReadError('getLatestCampaignVersion', { message: 'boom' });

beforeEach(() => {
  mockOptimize.mockClear(); mockSaveHealth.mockClear();
  mockResolved.mockClear(); mockGetLatest.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('campaigns/optimize-week (unread-error pkg 2)', () => {
  it('CONTROL: optimizes, re-reads, and saves the health report', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(mockOptimize).toHaveBeenCalledTimes(1);
    expect(mockSaveHealth).toHaveBeenCalledTimes(1);
    expect(res.body.health_report).toMatchObject({ status: 'ok' });
  });

  it('a failed version read BEFORE the optimization is a 503 and nothing is optimized', async () => {
    mockResolved.mockRejectedValueOnce(readError());
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_VERSION_READ_FAILED' });
    expect(mockOptimize).not.toHaveBeenCalled();
  });

  it('a failed re-read AFTER the optimization: 200 with the saved result, health report unavailable and NOT saved from empty plans', async () => {
    mockGetLatest.mockRejectedValueOnce(readError());
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ change_summary: 'tightened', health_report: null, health_report_status: 'unavailable' });
    expect(mockOptimize).toHaveBeenCalledTimes(1);
    expect(mockSaveHealth).not.toHaveBeenCalled();
  });
});
