/**
 * unread-error pkg 2: governance/campaign-status and governance/simulate-policy returned `err.message` in
 * their 500. Now that the campaign_versions readers THROW on a failed read, that would have sent PostgREST
 * text to the client. A CampaignVersionReadError is a retryable 503 with a generic message; any other
 * error is a generic 500. Neither carries the error text.
 */
const SECRET = 'relation "campaign_versions" permission detail XYZ';

const mockGetVersion = jest.fn();
jest.mock('../../db/campaignVersionStore', () => ({
  ...jest.requireActual('../../db/campaignVersionStore'),
  getLatestCampaignVersionByCampaignId: (...a: unknown[]) => mockGetVersion(...a),
}));
jest.mock('../../db/supabaseClient', () => {
  const b: any = { select: () => b, eq: () => b, order: () => b, limit: () => b, maybeSingle: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => b } };
});
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: 'u1' }, error: null })) }));
jest.mock('../../middleware/authMiddleware', () => ({ requireCompanyAccess: jest.fn(async () => true) }));
jest.mock('../../services/campaignBlueprintService', () => ({ getBlueprintBlockReason: jest.fn(() => null) }));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../governance/GovernancePolicyRegistry', () => ({
  getGovernancePolicy: jest.fn(() => ({ version: '1.0.0' })),
  PolicyVersionNotFoundError: class extends Error {},
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({ runPrePlanning: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { CampaignVersionReadError } from '../../db/campaignVersionStore';
import campaignStatus from '../../../pages/api/governance/campaign-status';
import simulatePolicy from '../../../pages/api/governance/simulate-policy';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}

const ROUTES: Array<[string, any, Record<string, string>]> = [
  ['governance/campaign-status', campaignStatus, { campaignId: 'c1' }],
  ['governance/simulate-policy', simulatePolicy, { campaignId: 'c1', policyVersion: '1.0.0', companyId: 'co1' }],
];

beforeEach(() => {
  mockGetVersion.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe.each(ROUTES)('%s', (_name, route, query) => {
  it('a FAILED campaign_versions read is a retryable 503, and the error text never reaches the client', async () => {
    mockGetVersion.mockRejectedValueOnce(new CampaignVersionReadError('getLatestCampaignVersionByCampaignId', { message: SECRET }));
    const res = mockRes();
    await route({ method: 'GET', url: '/x', headers: {}, query, body: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_VERSION_READ_FAILED' });
    expect(JSON.stringify(res.body)).not.toContain('XYZ');
  });

  it('any OTHER error is a generic 500 that no longer echoes err.message', async () => {
    mockGetVersion.mockRejectedValueOnce(new Error(SECRET));
    const res = mockRes();
    await route({ method: 'GET', url: '/x', headers: {}, query, body: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('XYZ');
  });
});
