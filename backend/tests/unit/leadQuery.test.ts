import { applyLeadQuery, dedupeViews, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const v = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: {}, scores: {}, status: null, campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-01-01T00:00:00Z',
  sourceRef: null,
  attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  ...over,
});

describe('Unified lead query', () => {
  const data = [
    v({ source: 'website', identity: { email: 'a@b.com' }, campaign: 'q3', status: 'new', scores: { intent: 0.9 }, occurredAt: '2026-03-01T00:00:00Z', sourceRef: { table: 'leads', id: '1' } }),
    v({ source: 'community', identity: { contactId: 'c9' }, status: 'reviewing', scores: { total: 0.4 }, occurredAt: '2026-02-01T00:00:00Z', sourceRef: { table: 'opportunity_feed_items', id: '2' }, attribution: { ...v().attribution, sourceMetadata: { opportunity_type: 'buying_intent', owner_user_id: 'u1' } } }),
    v({ source: 'crm', identity: { email: 'z@b.com' }, status: 'qualified', scores: { total: 0.6 }, occurredAt: '2026-01-15T00:00:00Z', sourceRef: { table: 'canonical_leads', id: '3' } }),
    v({ organizationId: 'co2', source: 'website', sourceRef: { table: 'leads', id: '9' } }),
  ];

  it('tenant-scopes (never leaks across companies)', () => {
    expect(applyLeadQuery(data, { companyId: 'co1' }).total).toBe(3);
    expect(applyLeadQuery(data, { companyId: 'co2' }).total).toBe(1);
  });

  it('filters by source / campaign / status / owner / buyingIntentMin / date', () => {
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { source: 'community' } }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { campaign: 'q3' } }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { status: 'qualified' } }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { owner: 'u1' } }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { buyingIntentMin: 0.5 } }).total).toBe(2);
    expect(applyLeadQuery(data, { companyId: 'co1', filters: { dateFrom: '2026-02-15T00:00:00Z' } }).total).toBe(1);
  });

  it('searches across identity / source / campaign / status', () => {
    expect(applyLeadQuery(data, { companyId: 'co1', search: 'a@b.com' }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', search: 'qualified' }).total).toBe(1);
    expect(applyLeadQuery(data, { companyId: 'co1', search: 'community' }).total).toBe(1);
  });

  it('sorts (occurredAt desc default; intent) and paginates deterministically', () => {
    const r = applyLeadQuery(data, { companyId: 'co1' });
    expect(r.rows[0].sourceRef?.id).toBe('1'); // newest
    const byIntent = applyLeadQuery(data, { companyId: 'co1', sort: { by: 'intent', order: 'desc' } });
    expect(byIntent.rows[0].scores.intent ?? byIntent.rows[0].scores.total).toBe(0.9);
    const page = applyLeadQuery(data, { companyId: 'co1', page: { limit: 1, offset: 1 } });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(page.offset).toBe(1);
  });

  it('dedupes identical source rows (durable wins by order)', () => {
    const dup = [
      v({ source: 'website', status: 'durable', sourceRef: { table: 'leads', id: '1' } }),
      v({ source: 'website', status: 'legacy', sourceRef: { table: 'leads', id: '1' } }),
    ];
    const out = dedupeViews(dup);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('durable');
  });
});
