import {
  routeToCanonicalInput, SOURCE_ADAPTERS, CANONICAL_LEAD_SOURCES,
  websiteAdapter, engagementAdapter, communityAdapter, marketPulseAdapter, crmAdapter,
} from '../../../lib/leadIntelligence';

describe('Source adapters + routing', () => {
  it('registry covers every canonical source', () => {
    for (const src of CANONICAL_LEAD_SOURCES) expect(typeof SOURCE_ADAPTERS[src]).toBe('function');
  });

  it('website adapter unifies tenant + resolves source from leads.source', () => {
    const i = websiteAdapter({ id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed', utm_source: 'g' });
    expect(i.organizationId).toBe('co1');
    expect(i.source).toBe('website');
    expect(i.identity.email).toBe('a@b.com');
    expect(i.attribution.utm.source).toBe('g');
    expect(i.sourceRef).toEqual({ table: 'leads', id: 'l1' });
    expect(websiteAdapter({ company_id: 'co1', source: 'webhook' }).source).toBe('webhook');
  });

  it('engagement adapter maps lead_signals(engagement) with platform identity', () => {
    const i = engagementAdapter({ id: 's1', organization_id: 'org1', platform: 'linkedin', platform_user_id: 'u42', intent_score: 0.8, total_score: 0.75, content_text: 'need a demo' });
    expect(i.source).toBe('engagement');
    expect(i.organizationId).toBe('org1');
    expect(i.identity.platform).toBe('linkedin');
    expect(i.identity.externalKeys?.['linkedin:user']).toBe('u42');
    expect(i.scores?.intent).toBe(0.8);
    expect(i.scores?.total).toBe(0.75);
  });

  it('community adapter maps opportunity_feed_items', () => {
    const i = communityAdapter({ id: 'o1', organization_id: 'org1', opportunity_type: 'buying_intent', contact_id: 'c9', total_score: 0.9, status: 'new' });
    expect(i.source).toBe('community');
    expect(i.status).toBe('new');
    expect(i.identity.contactId).toBe('c9');
    expect(i.attribution.sourceMetadata.opportunity_type).toBe('buying_intent');
  });

  it('marketpulse adapter bridges marketpulse_signals', () => {
    const i = marketPulseAdapter({ id: 'm1', company_id: 'co1', signal_category: 'hiring', title: 'Acme hiring', summary: 'x', confidence_score: 0.6 });
    expect(i.source).toBe('marketpulse');
    expect(i.display?.title).toBe('Acme hiring');
    expect(i.attribution.sourceMetadata.signal_category).toBe('hiring');
  });

  it('crm adapter uses unified_source when present', () => {
    const i = crmAdapter({ id: 'cl1', company_id: 'co1', source: 'hubspot', unified_source: { category: 'crm', origin: 'integration' }, qualification_score: 80, unified_person_id: 'up1' });
    expect(i.source).toBe('crm');
    expect(i.scores?.total).toBe(80);
    expect(i.identity.unifiedPersonId).toBe('up1');
  });

  it('routeToCanonicalInput dispatches by source', () => {
    expect(routeToCanonicalInput('manual', { company_id: 'co1', email: 'a@b.com' }).source).toBe('manual');
    expect(routeToCanonicalInput('referral', { company_id: 'co1' }).source).toBe('referral');
  });
});
