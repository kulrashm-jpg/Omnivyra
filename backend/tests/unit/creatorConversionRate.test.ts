/**
 * Conversion-rate quality helpers — getStrategyConversionRate +
 * classifyConversionConfidence.
 *
 * Proves leads ÷ distinct exposed sessions (lead_attributions numerator,
 * campaign_touchpoints distinct visitor_session_id denominator), null rate on
 * zero exposure, and the two-axis confidence tiers. DB layer mocked per table.
 */

const mockTables: Record<string, any[]> = {};
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const b: any = {};
    ['select', 'eq', 'not', 'gte', 'lte', 'order'].forEach((m) => { b[m] = () => b; });
    b.limit = () => Promise.resolve({ data: mockTables[table] ?? [], error: null });
    return b;
  },
}));
jest.mock('../../services/auditEventService', () => ({ __esModule: true, recordAuditEvent: jest.fn() }));

import {
  getStrategyConversionRate,
  getVariantConversionRate,
  getCampaignConversionRate,
  getPlatformConversionRate,
  getContentTypeConversionRate,
  classifyConversionConfidence,
} from '../../services/attributionReportingService';

beforeEach(() => {
  mockTables.lead_attributions = [];
  mockTables.campaign_touchpoints = [];
});

describe('classifyConversionConfidence (two-axis tiers)', () => {
  it('classifies on volume AND exposure', () => {
    expect(classifyConversionConfidence(5, 50)).toBe('insufficient');   // both low
    expect(classifyConversionConfidence(9, 1000)).toBe('insufficient'); // volume gates down
    expect(classifyConversionConfidence(10, 100)).toBe('low');
    expect(classifyConversionConfidence(25, 400)).toBe('medium');
    expect(classifyConversionConfidence(50, 1000)).toBe('high');
    expect(classifyConversionConfidence(50, 500)).toBe('medium');       // exposure gates down
  });
});

describe('getStrategyConversionRate', () => {
  it('computes conversions ÷ distinct exposed sessions, with tier + campaigns', async () => {
    mockTables.lead_attributions = [
      { creator_strategy_id: 's1', lead_id: 'l1', utm_campaign: 'c1' },
      { creator_strategy_id: 's1', lead_id: 'l2', utm_campaign: 'c1' },
      { creator_strategy_id: 's1', lead_id: 'l3', utm_campaign: 'c2' },
      { creator_strategy_id: 's2', lead_id: 'l4', utm_campaign: 'c1' },
    ];
    mockTables.campaign_touchpoints = [
      { creator_strategy_id: 's1', visitor_session_id: 'sess1' },
      { creator_strategy_id: 's1', visitor_session_id: 'sess1' }, // dup → distinct dedups
      { creator_strategy_id: 's1', visitor_session_id: 'sess2' },
      { creator_strategy_id: 's1', visitor_session_id: 'sess3' },
      { creator_strategy_id: 's2', visitor_session_id: 'sess9' },
    ];

    const rows = await getStrategyConversionRate({ companyId: 'comp-1' });

    const s1 = rows.find((r) => r.id === 's1')!;
    expect(s1.conversions).toBe(3);
    expect(s1.exposed_sessions).toBe(3);          // sess1, sess2, sess3 (deduped)
    expect(s1.conversion_rate).toBe(1);           // 3 / 3
    expect(s1.confidence).toBe('insufficient');   // below the Low floor
    expect(s1.campaigns.sort()).toEqual(['c1', 'c2']);
  });

  it('returns null rate when there are no exposed sessions (avoids /0)', async () => {
    mockTables.lead_attributions = [{ creator_strategy_id: 's3', lead_id: 'l9', utm_campaign: 'c1' }];
    mockTables.campaign_touchpoints = []; // no exposure recorded
    const rows = await getStrategyConversionRate({ companyId: 'comp-1' });
    expect(rows[0]).toMatchObject({ id: 's3', conversions: 1, exposed_sessions: 0, conversion_rate: null, confidence: 'insufficient' });
  });
});

describe('getVariantConversionRate (parity with strategy/asset)', () => {
  it('computes variant rate from variant_id numerator + denominator', async () => {
    mockTables.lead_attributions = [
      { variant_id: 'v1', lead_id: 'l1', utm_campaign: 'c1' },
      { variant_id: 'v1', lead_id: 'l2', utm_campaign: 'c1' },
    ];
    mockTables.campaign_touchpoints = [
      { variant_id: 'v1', visitor_session_id: 'sess1' },
      { variant_id: 'v1', visitor_session_id: 'sess2' },
    ];
    const rows = await getVariantConversionRate({ companyId: 'comp-1' });
    expect(rows[0]).toMatchObject({ id: 'v1', conversions: 2, exposed_sessions: 2, conversion_rate: 1, confidence: 'insufficient' });
  });
});

describe('marketing-effectiveness rates (campaign / platform / content-type)', () => {
  it('getCampaignConversionRate: utm_campaign ÷ campaign-keyed sessions', async () => {
    mockTables.lead_attributions = [
      { utm_campaign: 'camp-A', lead_id: 'l1' },
      { utm_campaign: 'camp-A', lead_id: 'l2' },
    ];
    mockTables.campaign_touchpoints = [
      { campaign: 'camp-A', visitor_session_id: 's1' },
      { campaign: 'camp-A', visitor_session_id: 's2' },
    ];
    const rows = await getCampaignConversionRate({ companyId: 'comp-1' });
    expect(rows[0]).toMatchObject({ id: 'camp-A', conversions: 2, exposed_sessions: 2, conversion_rate: 1, confidence: 'insufficient' });
  });

  it('getPlatformConversionRate: utm_source ÷ source-keyed sessions', async () => {
    mockTables.lead_attributions = [{ utm_source: 'linkedin', lead_id: 'l1', utm_campaign: 'camp-A' }];
    mockTables.campaign_touchpoints = [{ source: 'linkedin', visitor_session_id: 's1' }];
    const rows = await getPlatformConversionRate({ companyId: 'comp-1' });
    expect(rows[0]).toMatchObject({ id: 'linkedin', conversions: 1, exposed_sessions: 1, conversion_rate: 1 });
  });

  it('getContentTypeConversionRate: parses {type}_wN_dN from utm_content', async () => {
    mockTables.lead_attributions = [
      { utm_content: 'carousel_w1_d1', lead_id: 'l1', utm_campaign: 'camp-A' },
      { utm_content: 'carousel_w2_d3', lead_id: 'l2', utm_campaign: 'camp-A' },
    ];
    mockTables.campaign_touchpoints = [
      { content: 'carousel_w1_d1', visitor_session_id: 's1' },
      { content: 'image_w1_d1', visitor_session_id: 's2' },
    ];
    const rows = await getContentTypeConversionRate({ companyId: 'comp-1' });
    const carousel = rows.find((r) => r.id === 'carousel')!;
    expect(carousel).toMatchObject({ id: 'carousel', conversions: 2, exposed_sessions: 1, conversion_rate: 2, confidence: 'insufficient' });
  });
});
