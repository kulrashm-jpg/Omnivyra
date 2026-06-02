/**
 * Creator Conversion Intelligence API — surfacing + conversion-rate quality.
 *
 * Strategy, variant, AND asset now go through the rate path, so all three carry
 * the display-only quality fields (exposed_sessions / conversion_rate /
 * confidence). Proves share aggregation, the quality fields, graceful
 * degradation, and the empty states.
 */

jest.mock('../../services/userContextService', () => ({
  __esModule: true,
  resolveUserContext: jest.fn(async () => ({ defaultCompanyId: 'comp-1' })),
  enforceCompanyAccess: jest.fn(async () => true),
}));
jest.mock('../../services/attributionReportingService', () => ({
  __esModule: true,
  getStrategyConversionRate: jest.fn(),
  getVariantConversionRate: jest.fn(),
  getAssetConversionRate: jest.fn(),
  getCampaignConversionRate: jest.fn(),
  getPlatformConversionRate: jest.fn(),
  getContentTypeConversionRate: jest.fn(),
}));

import handler from '../../../pages/api/engagement/creator-conversion';
import { resolveUserContext } from '../../services/userContextService';
import {
  getStrategyConversionRate,
  getVariantConversionRate,
  getAssetConversionRate,
  getCampaignConversionRate,
  getPlatformConversionRate,
  getContentTypeConversionRate,
} from '../../services/attributionReportingService';

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  res.end = () => res;
  return res;
}
const req = (query: Record<string, string> = {}) => ({ method: 'GET', query: { organization_id: 'comp-1', ...query } }) as any;

beforeEach(() => {
  (getStrategyConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
  (getVariantConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
  (getAssetConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
  (getCampaignConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
  (getPlatformConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
  (getContentTypeConversionRate as jest.Mock).mockReset().mockResolvedValue([]);
});

describe('creator-conversion API', () => {
  it('computes share AND passes through conversion-rate quality (strategy)', async () => {
    (getStrategyConversionRate as jest.Mock).mockResolvedValue([
      { id: 'authority_play', conversions: 14, exposed_sessions: 200, conversion_rate: 0.07, confidence: 'low', campaigns: ['camp-A', 'camp-B'] },
      { id: 'data_led', conversions: 6, exposed_sessions: 40, conversion_rate: 0.15, confidence: 'insufficient', campaigns: ['camp-A'] },
    ]);
    const res = mockRes();
    await handler(req(), res);

    const s = res.body.strategies;
    expect(s.total_conversions).toBe(20);
    expect(s.items[0]).toMatchObject({ id: 'authority_play', conversions: 14, conversion_share: 0.7, exposed_sessions: 200, conversion_rate: 0.07, confidence: 'low' });
    expect(s.items[1].confidence).toBe('insufficient');
  });

  it('variant now carries rate quality at parity with strategy/asset', async () => {
    (getVariantConversionRate as jest.Mock).mockResolvedValue([
      { id: 'v2_punchy', conversions: 9, exposed_sessions: 150, conversion_rate: 0.06, confidence: 'low', campaigns: ['camp-A'] },
    ]);
    (getAssetConversionRate as jest.Mock).mockResolvedValue([
      { id: 'asset-77', conversions: 2, exposed_sessions: 12, conversion_rate: 0.1667, confidence: 'insufficient', campaigns: [] },
    ]);
    const res = mockRes();
    await handler(req(), res);

    expect(res.body.variants.items[0]).toMatchObject({ id: 'v2_punchy', conversions: 9, confidence: 'low', exposed_sessions: 150, conversion_rate: 0.06 });
    expect(res.body.assets.items[0]).toMatchObject({ id: 'asset-77', confidence: 'insufficient', exposed_sessions: 12 });
  });

  it('marketing-effectiveness dimensions (campaign/platform/content-type) carry rate quality', async () => {
    (getCampaignConversionRate as jest.Mock).mockResolvedValue([{ id: 'camp-A', conversions: 12, exposed_sessions: 300, conversion_rate: 0.04, confidence: 'low', campaigns: ['camp-A'] }]);
    (getPlatformConversionRate as jest.Mock).mockResolvedValue([{ id: 'linkedin', conversions: 8, exposed_sessions: 100, conversion_rate: 0.08, confidence: 'insufficient', campaigns: ['camp-A'] }]);
    (getContentTypeConversionRate as jest.Mock).mockResolvedValue([{ id: 'carousel', conversions: 5, exposed_sessions: 50, conversion_rate: 0.1, confidence: 'insufficient', campaigns: ['camp-A'] }]);
    const res = mockRes();
    await handler(req(), res);

    expect(res.body.campaigns.items[0]).toMatchObject({ id: 'camp-A', conversions: 12, confidence: 'low', exposed_sessions: 300 });
    expect(res.body.platforms.items[0]).toMatchObject({ id: 'linkedin', conversions: 8, exposed_sessions: 100 });
    expect(res.body.content_types.items[0]).toMatchObject({ id: 'carousel', conversions: 5 });
    expect(res.body.attribution_available).toBe(true);
  });

  it('graceful degradation: a throwing helper → that category unavailable, not a 500', async () => {
    (getStrategyConversionRate as jest.Mock).mockRejectedValue(new Error('column "creator_strategy_id" does not exist'));
    (getVariantConversionRate as jest.Mock).mockResolvedValue([{ id: 'v1', conversions: 3, exposed_sessions: 20, conversion_rate: 0.15, confidence: 'insufficient', campaigns: [] }]);
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.strategies.available).toBe(false);
    expect(res.body.strategies.items).toEqual([]);
    expect(res.body.variants.available).toBe(true);
    expect(res.body.attribution_available).toBe(true);
  });

  it('all helpers throw (pre-migration) → attribution_available false', async () => {
    const boom = new Error('column does not exist');
    (getStrategyConversionRate as jest.Mock).mockRejectedValue(boom);
    (getVariantConversionRate as jest.Mock).mockRejectedValue(boom);
    (getAssetConversionRate as jest.Mock).mockRejectedValue(boom);
    (getCampaignConversionRate as jest.Mock).mockRejectedValue(boom);
    (getPlatformConversionRate as jest.Mock).mockRejectedValue(boom);
    (getContentTypeConversionRate as jest.Mock).mockRejectedValue(boom);
    const res = mockRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.attribution_available).toBe(false);
  });

  it('legacy / non-creator campaigns → available but empty', async () => {
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.attribution_available).toBe(true);
    expect(res.body.strategies.items).toEqual([]);
    expect(res.body.variants.items).toEqual([]);
    expect(res.body.assets.items).toEqual([]);
  });

  it('missing organization id (no query, no default company) → 400', async () => {
    (resolveUserContext as jest.Mock).mockResolvedValueOnce(null);
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });
});
