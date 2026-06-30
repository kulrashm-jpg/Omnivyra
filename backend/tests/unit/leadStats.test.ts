import { computeLeadStats, activeLeadsCompatibilityFilter, countBySource, filterLeads, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const v = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: {}, scores: {}, status: null, campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: null, sourceRef: null,
  attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  ...over,
});

describe('Repository-owned lead stats + compatibility', () => {
  const data = [
    v({ source: 'website', identity: { email: 'a@b.com' }, campaign: 'q3', status: 'new', scores: { intent: 0.9 } }),
    v({ source: 'community', status: 'reviewing', scores: { total: 0.5 } }),
    v({ source: 'community', status: 'new', scores: { total: 0.2 } }),
    v({ source: 'crm', identity: { email: 'z@b.com' }, status: 'qualified', scores: { total: 0.8 } }),
  ];

  it('computes counts, source/status breakdown, intent bands, identity/campaign coverage', () => {
    const s = computeLeadStats(data);
    expect(s.total).toBe(4);
    expect(s.bySource).toEqual({ website: 1, community: 2, crm: 1 });
    expect(s.byStatus).toEqual({ new: 2, reviewing: 1, qualified: 1 });
    expect(s.intentBands).toEqual({ high: 2, medium: 1, low: 1 });
    expect(s.withIdentity).toBe(2);
    expect(s.withCampaign).toBe(1);
  });

  it('Active Leads compatibility = community scope only', () => {
    expect(activeLeadsCompatibilityFilter(data)).toHaveLength(2);
    expect(activeLeadsCompatibilityFilter(data).every((x) => x.source === 'community')).toBe(true);
  });

  it('countBySource limits to requested sources', () => {
    expect(countBySource(data, ['community', 'partner'])).toEqual({ community: 2, partner: 0 });
  });

  it('stats respect upstream filters (filterLeads is unpaged)', () => {
    const filtered = filterLeads(data, { companyId: 'co1', filters: { source: 'community' } });
    expect(computeLeadStats(filtered).total).toBe(2);
  });
});
