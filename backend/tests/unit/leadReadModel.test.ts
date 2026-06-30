import { toCanonicalLeadView, projectExistingRow, InMemoryLeadIntelligenceReader, type CanonicalLead } from '../../../lib/leadIntelligence';

describe('Canonical Lead Intelligence read model', () => {
  it('projects an ingested lead to the view', () => {
    const lead: CanonicalLead = {
      organizationId: 'co1', source: 'crm', unifiedPersonId: 'up1', ingestedAt: 'x',
      identity: { email: 'a@b.com', unifiedPersonId: 'up1' },
      attribution: { originalSource: 'hubspot', originalChannel: null, campaign: 'q3', content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: 'q3', content: null, term: null }, identity: {}, sourceMetadata: { deal_value: 9000 } },
      scores: { total: 80 }, status: 'qualified', occurredAt: '2026-01-01',
    };
    const v = toCanonicalLeadView(lead);
    expect(v.source).toBe('crm');
    expect(v.sourceLabel).toBe('CRM');
    expect(v.unifiedPersonId).toBe('up1');
    expect(v.campaign).toBe('q3');
    expect(v.attribution.sourceMetadata.deal_value).toBe(9000);
  });

  it('bridges a legacy row into the canonical view (no migration)', () => {
    const v = projectExistingRow('community', { id: 'o1', organization_id: 'org1', opportunity_type: 'buying_intent', total_score: 0.9, status: 'new' });
    expect(v.source).toBe('community');
    expect(v.organizationId).toBe('org1');
    expect(v.scores.total).toBe(0.9);
    expect(v.sourceRef).toEqual({ table: 'opportunity_feed_items', id: 'o1' });
  });

  it('in-memory reader filters by org + source', () => {
    const r = new InMemoryLeadIntelligenceReader();
    r.add(projectExistingRow('website', { id: '1', company_id: 'co1', source: 'form_embed', email: 'a@b.com' }));
    r.add(projectExistingRow('community', { id: '2', organization_id: 'co1', opportunity_type: 'buying_intent' }));
    expect(r.list({ organizationId: 'co1' })).toHaveLength(2);
    expect(r.list({ organizationId: 'co1', source: 'website' })).toHaveLength(1);
  });
});
