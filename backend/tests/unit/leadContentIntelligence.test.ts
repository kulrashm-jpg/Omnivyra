import { buildContentIntelligence, buildCampaignIntelligence, type CanonicalLeadInput } from '../../../lib/leadIntelligence';

describe('Content intelligence builder', () => {
  it('aggregates pages, blogs, forms, downloads, time, scroll, conversions — nothing discarded', () => {
    const ci = buildContentIntelligence({
      events: [
        { event_category: 'navigation', event_name: 'pageview', page_url: '/pricing', time_on_page: 30, scroll_depth: 60 },
        { event_category: 'navigation', event_name: 'pageview', page_url: '/features', time_on_page: 20, scroll_depth: 80 },
        { event_name: 'form_submit', event_category: 'conversion', metadata: { form_id: 'f1' } },
        { event_name: 'download', page_url: '/wp.pdf' },
        { event_category: 'engagement', event_name: 'cta_click', metadata: { asset_id: 'a1' } },
      ],
      blogSessions: [{ url_slug: 'how-to', time_seconds: 45, scroll_depth: 90 }],
      touchpoints: [{ campaign: 'q3' }],
    });
    expect(ci.pagesViewed.sort()).toEqual(['/features', '/pricing']);
    expect(ci.blogs).toEqual(['how-to']);
    expect(ci.forms).toEqual(['f1']);
    expect(ci.downloads).toEqual(['/wp.pdf']);
    expect(ci.assets).toEqual(['a1']);
    expect(ci.campaignsTouched).toEqual(['q3']);
    expect(ci.conversions).toBe(1);
    expect(ci.maxScrollDepth).toBe(90);
    expect(ci.timeSpentSeconds).toBe(95);
    expect(ci.journeySummary).toContain('2 pages');
  });

  it('empty inputs yield a safe zeroed summary', () => {
    const ci = buildContentIntelligence({});
    expect(ci.pagesViewed).toEqual([]);
    expect(ci.timeSpentSeconds).toBe(0);
    expect(ci.maxScrollDepth).toBe(0);
  });
});

describe('Campaign intelligence builder', () => {
  it('extracts campaign/content/asset ids from attribution metadata', () => {
    const lead: CanonicalLeadInput = {
      organizationId: 'co1', source: 'website', identity: {},
      display: { title: 'Q3 Whitepaper' },
      attribution: {
        originalSource: 'linkedin', originalChannel: 'social', campaign: 'q3', content: 'wp', session: null, journey: null, referrer: null,
        utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {},
        sourceMetadata: { campaign_id: 'c1', campaign_type: 'awareness', content_id: 'ct1', content_type: 'pdf', asset_id: 'as1' },
      },
    };
    const ci = buildCampaignIntelligence(lead);
    expect(ci).toEqual({ campaign: 'q3', campaignId: 'c1', campaignType: 'awareness', channel: 'social', contentId: 'ct1', contentType: 'pdf', contentTitle: 'Q3 Whitepaper', assetId: 'as1' });
  });
});
