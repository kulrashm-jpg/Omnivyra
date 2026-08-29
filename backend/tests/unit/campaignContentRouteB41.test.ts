/**
 * B4.1 — POST/GET /api/content campaign authorization (phase brief §3, §12, §14 C).
 *
 * Exercises the REAL route handler with the tenant guard and the campaign
 * ownership resolver mocked, so the assertions are about the route's own
 * decisions rather than a restatement of them.
 *
 * The rule under test: campaignId is an ownership claim and is never trusted
 * from the client. A campaign belonging to another company must never produce
 * canonical content, and companyId always comes from the authorized scope.
 */

const mockEnforce = jest.fn();
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => mockEnforce(...a),
}));

const mockResolveCampaignCompanyId = jest.fn();
jest.mock('../../services/campaignAccessService', () => ({
  resolveCampaignCompanyId: (...a: unknown[]) => mockResolveCampaignCompanyId(...a),
}));

const mockCreateContent = jest.fn();
const mockListContent = jest.fn();
jest.mock('../../services/content/contentService', () => ({
  createContent: (...a: unknown[]) => mockCreateContent(...a),
  listContent: (...a: unknown[]) => mockListContent(...a),
}));

// The route factory wraps the handler; keep it transparent for this test.
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler from '../../../pages/api/content/index';

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';
const CAMPAIGN_B = '44444444-4444-4444-4444-444444444444';
const CAMPAIGN_A = '33333333-3333-3333-3333-333333333333';

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

/** Caller is authenticated and authorized for COMPANY_A. */
const reqFor = (body: Record<string, unknown>) => ({
  method: 'POST',
  query: { companyId: COMPANY_A },
  body,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnforce.mockResolvedValue({ userId: 'u1', companyId: COMPANY_A });
  mockCreateContent.mockResolvedValue({ id: 'content-1', campaignId: null });
  mockListContent.mockResolvedValue([]);
});

describe('B4.1 · §14 C — cross-tenant campaignId is rejected', () => {
  it('a campaign owned by company B is refused for a company A caller', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(COMPANY_B);
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaignId: CAMPAIGN_B }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CROSS_TENANT_CAMPAIGN' }),
    );
    // The decisive assertion: NO canonical content was created.
    expect(mockCreateContent).not.toHaveBeenCalled();
  });

  it('an unresolvable campaign is refused as not-found, not silently accepted', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaignId: 'ghost' }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CAMPAIGN_NOT_FOUND' }),
    );
    expect(mockCreateContent).not.toHaveBeenCalled();
  });

  it('snake_case campaign_id is validated too (no alias bypass)', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(COMPANY_B);
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaign_id: CAMPAIGN_B }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockCreateContent).not.toHaveBeenCalled();
  });
});

describe('B4.1 · §3 — an owned campaign is accepted', () => {
  it('a same-company campaign reaches createContent with the authorized scope', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(COMPANY_A);
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaignId: CAMPAIGN_A }) as never, res as never);

    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    const input = mockCreateContent.mock.calls[0][0];
    expect(input.campaignId).toBe(CAMPAIGN_A);
    expect(input.companyId).toBe(COMPANY_A);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('companyId is taken from the authorized scope, never from the body', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(COMPANY_A);
    const res = mkRes();
    await handler(
      reqFor({ contentType: 'post', body: 'x', campaignId: CAMPAIGN_A, companyId: COMPANY_B, company_id: COMPANY_B }) as never,
      res as never,
    );
    expect(mockCreateContent.mock.calls[0][0].companyId).toBe(COMPANY_A);
  });
});

describe('B4.1 · §13 — no campaign supplied', () => {
  it('omitted campaignId ⇒ null, and no ownership lookup is performed', async () => {
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x' }) as never, res as never);

    expect(mockResolveCampaignCompanyId).not.toHaveBeenCalled();
    expect(mockCreateContent.mock.calls[0][0].campaignId).toBeNull();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('a blank campaignId is treated as absent, not as an id to resolve', async () => {
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaignId: '   ' }) as never, res as never);

    expect(mockResolveCampaignCompanyId).not.toHaveBeenCalled();
    expect(mockCreateContent.mock.calls[0][0].campaignId).toBeNull();
  });

  it('existing non-campaign creation is unchanged (201 + content returned)', async () => {
    const res = mkRes();
    await handler(reqFor({ contentType: 'thread', body: 'y' }) as never, res as never);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreateContent.mock.calls[0][0].contentType).toBe('thread');
  });
});

describe('B4.1 · §4 — GET campaign filtering', () => {
  const getReq = (query: Record<string, unknown>) => ({
    method: 'GET', query: { companyId: COMPANY_A, ...query }, body: {},
  });

  it('campaignId is forwarded to listContent alongside the authorized company', async () => {
    const res = mkRes();
    await handler(getReq({ campaignId: CAMPAIGN_A }) as never, res as never);

    expect(mockListContent).toHaveBeenCalledTimes(1);
    const [companyId, filter] = mockListContent.mock.calls[0];
    expect(companyId).toBe(COMPANY_A);
    expect(filter.campaignId).toBe(CAMPAIGN_A);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('a foreign campaignId cannot widen the scope — company stays the authorized one', async () => {
    const res = mkRes();
    await handler(getReq({ campaignId: CAMPAIGN_B, companyId: COMPANY_A }) as never, res as never);
    expect(mockListContent.mock.calls[0][0]).toBe(COMPANY_A);
  });

  it('no campaignId ⇒ no campaign filter is sent', async () => {
    const res = mkRes();
    await handler(getReq({}) as never, res as never);
    const filter = mockListContent.mock.calls[0][1];
    expect(filter?.campaignId).toBeUndefined();
  });

  it('company keys in the query never reach the filter', async () => {
    const res = mkRes();
    await handler(getReq({ campaignId: CAMPAIGN_A }) as never, res as never);
    const filter = mockListContent.mock.calls[0][1];
    expect(filter.companyId).toBeUndefined();
    expect(filter.company_id).toBeUndefined();
  });
});

describe('B4.1 — guard ordering', () => {
  it('an unauthorized caller never reaches campaign resolution or content creation', async () => {
    mockEnforce.mockResolvedValue(null); // guard already responded
    const res = mkRes();
    await handler(reqFor({ contentType: 'post', body: 'x', campaignId: CAMPAIGN_A }) as never, res as never);

    expect(mockResolveCampaignCompanyId).not.toHaveBeenCalled();
    expect(mockCreateContent).not.toHaveBeenCalled();
  });

  it('an invalid contentType is rejected before any campaign lookup', async () => {
    const res = mkRes();
    await handler(reqFor({ contentType: 'newsletter', campaignId: CAMPAIGN_A }) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockResolveCampaignCompanyId).not.toHaveBeenCalled();
  });
});
