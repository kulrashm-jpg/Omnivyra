/**
 * Reporting helper extension — campaigns aggregation.
 *
 * Proves getLeadsByStrategy (and by extension Variant/Asset, which share the
 * same internal aggregator) rolls up conversions, lead_ids, and DISTINCT
 * associated campaigns from the lead_attributions snapshot. DB layer mocked.
 */

const mockLeadAttribRows: any[] = [];
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: () => {
    const b: any = {};
    ['select', 'eq', 'not', 'gte', 'lte', 'order', 'upsert', 'insert'].forEach((m) => { b[m] = () => b; });
    b.limit = () => Promise.resolve({ data: mockLeadAttribRows, error: null });
    return b;
  },
}));
jest.mock('../../services/auditEventService', () => ({ __esModule: true, recordAuditEvent: jest.fn() }));

import { getLeadsByStrategy } from '../../services/attributionReportingService';

beforeEach(() => { mockLeadAttribRows.length = 0; });

describe('getLeadsByStrategy — conversions + distinct campaigns', () => {
  it('rolls up conversions, lead_ids, and distinct campaigns, sorted by conversions', async () => {
    mockLeadAttribRows.push(
      { creator_strategy_id: 'authority_play', lead_id: 'l1', utm_campaign: 'camp-A' },
      { creator_strategy_id: 'authority_play', lead_id: 'l2', utm_campaign: 'camp-A' },
      { creator_strategy_id: 'authority_play', lead_id: 'l3', utm_campaign: 'camp-B' },
      { creator_strategy_id: 'data_led', lead_id: 'l4', utm_campaign: 'camp-A' },
    );
    const rows = await getLeadsByStrategy({ companyId: 'comp-1' });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ creator_strategy_id: 'authority_play', conversions: 3 });
    expect(rows[0].lead_ids.sort()).toEqual(['l1', 'l2', 'l3']);
    expect(rows[0].campaigns.sort()).toEqual(['camp-A', 'camp-B']); // distinct
    expect(rows[1]).toMatchObject({ creator_strategy_id: 'data_led', conversions: 1, campaigns: ['camp-A'] });
  });

  it('returns empty when no creator-attributed rows', async () => {
    const rows = await getLeadsByStrategy({ companyId: 'comp-1' });
    expect(rows).toEqual([]);
  });
});
