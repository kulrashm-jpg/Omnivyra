/**
 * Phase 9 — lead-profile enrichment projections (pure). Verifies the rich website
 * attribution captured in metadata.web_attribution becomes first-class typed sections
 * (visitor journey, campaign attribution, content references, behaviour, source detail).
 */
import {
  visitorJourneyProjection,
  campaignAttributionProjection,
  contentReferenceProjection,
  websiteBehaviourProjection,
  sourceDetailProjection,
  type CanonicalLeadView,
} from '../../../lib/leadIntelligence';

const webView = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: 'up1',
  identity: { email: 'jane@acme.com', anonymousId: 'anon1' }, scores: { intent: 0.8 }, status: 'new',
  campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null },
  occurredAt: '2026-06-01T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
  attribution: {
    originalSource: 'website', originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null,
    utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {},
    sourceMetadata: {
      visitor_session_id: 'sess1', website_id: 'w1',
      attribution: { utm_source: 'google', utm_medium: 'cpc', referrer: 'https://g.com', landing_page: 'https://omnivyra.com/?utm_source=google' },
      metadata: {
        company_name: 'Acme', intent: 'request_demo', primary_interest: 'Product demo',
        web_attribution: {
          utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: 'ad1', utm_term: 'crm',
          referrer: 'https://g.com', first_referrer: 'https://blog.omnivyra.com/post', landing_page: 'https://omnivyra.com/?utm_source=google',
          current_page: 'https://omnivyra.com/request-demo', session_id: 'sess1', anonymous_id: 'anon1',
          journey_id: 'j1', campaign_id: 'cmp1', content_id: 'ct1', asset_id: 'as1', cta_id: 'cta1', form_id: 'f1', website_id: 'w1',
        },
      },
    },
  },
  ...over,
});

describe('Phase 9 — profile enrichment projections', () => {
  it('visitor journey is projected from web_attribution + sessions', () => {
    const j = visitorJourneyProjection(webView(), [{ id: 's1' }, { id: 's2' }]);
    expect(j.firstLandingPage).toBe('https://omnivyra.com/?utm_source=google');
    expect(j.currentLandingPage).toBe('https://omnivyra.com/request-demo');
    expect(j.referrer).toBe('https://g.com');
    expect(j.firstReferrer).toBe('https://blog.omnivyra.com/post');
    expect(j.sessionId).toBe('sess1');
    expect(j.visitorId).toBe('anon1');
    expect(j.journeyId).toBe('j1');
    expect(j.visitCount).toBe(2);
    expect(j.returnVisitor).toBe(true);
  });

  it('campaign attribution is projected (not buried in metadata)', () => {
    const c = campaignAttributionProjection(webView());
    expect(c).toEqual({ campaignId: 'cmp1', campaignName: 'spring', campaignType: 'cpc', campaignSource: 'google', campaignMedium: 'cpc', campaignContent: 'ad1', campaignTerm: 'crm' });
  });

  it('content references are projected', () => {
    const r = contentReferenceProjection(webView());
    expect(r).toMatchObject({ contentId: 'ct1', assetId: 'as1', ctaId: 'cta1', formId: 'f1', websiteId: 'w1' });
    expect(r.contentType).toBe('request_demo');
  });

  it('website behaviour reuses buildContentIntelligence over existing tracking', () => {
    const events = [
      { event_category: 'navigation', event_name: 'pageview', page_url: '/blog/ai', scroll_depth: 80, time_on_page: 45 },
      { event_name: 'cta_click' },
      { event_name: 'asset_download', metadata: { asset_id: 'a1' } },
    ];
    const b = websiteBehaviourProjection({ events, sessionCount: 3 });
    expect(b.pagesViewed).toBe(1);
    expect(b.blogPagesViewed).toBe(1);
    expect(b.ctaClicks).toBe(1);
    expect(b.downloads).toBe(1);
    expect(b.assetsViewed).toBe(1);
    expect(b.scrollDepth).toBe(80);
    expect(b.timeOnPageSeconds).toBe(45);
    expect(b.returnVisits).toBe(2); // 3 sessions − 1
  });

  it('source detail builds a human-readable breadcrumb', () => {
    const s = sourceDetailProjection(webView());
    expect(s.path[0]).toBe('Website');
    expect(s.path).toContain('google');
    expect(s.path).toContain('spring');
    expect(s.label).toContain('Website → ');
  });

  it('degrades cleanly for a non-website lead (no web_attribution)', () => {
    const community = webView({
      source: 'community', sourceLabel: 'Community',
      attribution: { originalSource: 'community', originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: { opportunity_type: 'buying_intent' } },
    });
    const j = visitorJourneyProjection(community, []);
    expect(j.firstReferrer).toBeNull();
    expect(j.visitCount).toBeNull();
    expect(sourceDetailProjection(community).path[0]).toBe('Community');
  });
});
