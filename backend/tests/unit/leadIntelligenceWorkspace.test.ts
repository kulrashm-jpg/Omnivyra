/**
 * Phase 7 — Lead Intelligence Workspace repository integration.
 * The workspace consumes ONLY the read service: searchLeads (list/filter/search/
 * paginate), getLeadStats (overview), getLeadProfile (profile + timeline +
 * recommendation), exportLeads. Readers are injected with fixtures (no DB).
 */
import {
  searchLeads,
  getLeadStats,
  getLeadProfile,
  exportLeads,
  type LeadSourceReaders,
} from '../../services/leadIntelligence/leadIntelligenceReadService';
import { leadKeyFor, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email: 'jane@acme.com' }, scores: { intent: 0.82 }, status: 'new',
  campaign: 'spring', content: 'pricing', referrer: null,
  utm: { source: 'google', medium: 'cpc', campaign: 'spring', content: null, term: null },
  occurredAt: '2026-05-01T00:00:00Z',
  sourceRef: { table: 'leads', id: 'L1' },
  attribution: {
    originalSource: 'form_embed', originalChannel: 'cpc', campaign: 'spring', content: 'pricing',
    session: null, journey: null, referrer: null,
    utm: { source: 'google', medium: 'cpc', campaign: 'spring', content: null, term: null },
    identity: { email: 'jane@acme.com' },
    sourceMetadata: { name: 'Jane Doe', company_name: 'Acme', owner_user_id: 'u9' },
  },
  ...over,
});

function readersWith(views: CanonicalLeadView[]): LeadSourceReaders {
  return {
    durable: async () => views,
    activeLeads: async () => [],
    leads: async () => [],
    canonicalLeads: async () => [],
  };
}

describe('Phase 7 — Lead Intelligence Workspace', () => {
  const community = view({
    source: 'community', sourceLabel: 'Community', unifiedPersonId: 'up2', identity: { contactId: 'c2', platform: 'reddit' },
    scores: { intent: 0.3, total: 0.3 }, status: 'reviewing', campaign: null, content: 'migration help',
    sourceRef: { table: 'opportunity_feed_items', id: 'O1' },
    attribution: { ...view().attribution, campaign: null, content: 'migration help', sourceMetadata: { opportunity_type: 'migration_signal' } },
  });
  const all = [view(), community];

  it('unified list returns every source, paginated server-side', async () => {
    const r = await searchLeads({ companyId: 'co1', page: { limit: 1, offset: 0 } }, readersWith(all));
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(1); // server-paginated
    expect(['website', 'community']).toContain(r.rows[0].source);
  });

  it('repository search + filters (no client-side filtering)', async () => {
    expect((await searchLeads({ companyId: 'co1', search: 'acme' }, readersWith(all))).total).toBe(1);
    expect((await searchLeads({ companyId: 'co1', filters: { source: 'community' } }, readersWith(all))).total).toBe(1);
    expect((await searchLeads({ companyId: 'co1', filters: { status: 'new' } }, readersWith(all))).total).toBe(1);
    expect((await searchLeads({ companyId: 'co1', filters: { buyingIntentMin: 0.7 } }, readersWith(all))).total).toBe(1);
  });

  it('overview stats are repository-owned (no UI aggregation)', async () => {
    const s = await getLeadStats({ companyId: 'co1' }, readersWith(all));
    expect(s.total).toBe(2);
    expect(s.bySource).toEqual({ website: 1, community: 1 });
    expect(s.byStatus).toEqual({ new: 1, reviewing: 1 });
    expect(s.intentBands).toEqual({ high: 1, medium: 0, low: 1 });
    expect(s.withIdentity).toBe(2);
    expect(s.withCampaign).toBe(1);
  });

  it('profile hydrates every section + canonical timeline + recommendation', async () => {
    const key = leadKeyFor(view());
    const p = await getLeadProfile('co1', key, readersWith(all));
    expect(p).toBeTruthy();
    expect(p!.view.source).toBe('website');
    expect(p!.identity.email).toBe('jane@acme.com');
    expect(p!.campaign.campaign).toBe('spring');
    expect(p!.analytics.intent).toBe(0.82);
    expect(p!.crm.status).toBe('new');
    expect(p!.summary).toContain('Website');
    expect(p!.recommendedNextAction).toBe('Reach out now — high buying intent');
    // canonical timeline (built via the repository's buildTimeline), provenance preserved
    expect(p!.timeline).toHaveLength(1);
    expect(p!.timeline[0].eventType).toBe('lead_captured');
    expect(p!.timeline[0].origin).toBe('leads');
    expect(p!.timeline[0].source).toBe('website');
  });

  it('profile deep-link key matches the list row key (1:1 resolution)', async () => {
    const list = await searchLeads({ companyId: 'co1' }, readersWith(all));
    for (const row of list.rows) {
      const p = await getLeadProfile('co1', leadKeyFor(row), readersWith(all));
      expect(p).toBeTruthy();
      expect(p!.view.source).toBe(row.source);
    }
  });

  it('export uses the repository export (CSV + Excel), no duplicated logic', async () => {
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', readersWith(all));
    expect(csv.contentType).toContain('text/csv');
    expect(csv.filename).toBe('lead-intelligence.csv');
    expect(csv.body).toContain('Acme');
    const xls = await exportLeads({ companyId: 'co1' }, 'excel', readersWith(all));
    expect(xls.contentType).toContain('ms-excel');
  });

  it('empty dataset → empty list/stats/profile', async () => {
    const empty = readersWith([]);
    expect((await searchLeads({ companyId: 'co1' }, empty)).total).toBe(0);
    expect((await getLeadStats({ companyId: 'co1' }, empty)).total).toBe(0);
    expect(await getLeadProfile('co1', leadKeyFor(view()), empty)).toBeNull();
  });

  it('tenant isolation: wrong company / bad key → no leak', async () => {
    expect((await searchLeads({ companyId: 'other' }, readersWith(all))).total).toBe(0);
    expect(await getLeadProfile('other', leadKeyFor(view()), readersWith(all))).toBeNull();
    expect(await getLeadProfile('co1', 'bogus-key', readersWith(all))).toBeNull();
  });

  it('large dataset stays server-paginated (no N+1 surfaced to consumer)', async () => {
    const many = Array.from({ length: 500 }, (_, i) => view({ sourceRef: { table: 'leads', id: `L${i}` }, occurredAt: `2026-05-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
    const r = await searchLeads({ companyId: 'co1', page: { limit: 50, offset: 100 } }, readersWith(many));
    expect(r.total).toBe(500);
    expect(r.rows).toHaveLength(50);
    expect(r.offset).toBe(100);
  });
});
