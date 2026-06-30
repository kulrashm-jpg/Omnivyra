/**
 * Phase 9 — getEnrichedLeadProfile end-to-end: base profile (Phase 7 contract intact)
 * PLUS the new enrichment sections, hydrating existing tracking via bounded reads.
 * Readers injected; ownedDbTable mocked for the aux (tracking) reads.
 */
const dbRows: Record<string, any[]> = { tracking_events: [], campaign_touchpoints: [], visitor_sessions: [] };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret; b.eq = ret;
    b.limit = () => Promise.resolve({ data: dbRows[table] ?? [], error: null });
    return b;
  },
}));

import { getEnrichedLeadProfile, getBuyingIntentProfile, getLeadActionPlan, getCompanyIntelligence, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import { leadKeyFor, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const view: CanonicalLeadView = {
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
      metadata: { company_name: 'Acme', intent: 'request_demo', web_attribution: { utm_source: 'google', utm_campaign: 'spring', first_referrer: 'https://blog.omnivyra.com/x', session_id: 'sess1', journey_id: 'j1', asset_id: 'as1', cta_id: 'cta1' } },
    },
  },
};

const readers: LeadSourceReaders = {
  durable: async () => [view],
  activeLeads: async () => [],
  leads: async () => [],
  canonicalLeads: async () => [],
};

beforeEach(() => { dbRows.tracking_events = []; dbRows.campaign_touchpoints = []; dbRows.visitor_sessions = []; });

describe('Phase 9 — getEnrichedLeadProfile', () => {
  it('returns the base profile PLUS enrichment sections', async () => {
    dbRows.visitor_sessions = [{ id: 's1' }, { id: 's2' }];
    dbRows.tracking_events = [{ event_category: 'navigation', event_name: 'pageview', page_url: '/blog/x', scroll_depth: 60 }, { event_name: 'cta_click' }];
    const p = await getEnrichedLeadProfile('co1', leadKeyFor(view), readers);
    expect(p).toBeTruthy();
    // base (Phase 7) contract intact
    expect(p!.view.source).toBe('website');
    expect(p!.summary).toContain('Website');
    expect(p!.recommendedNextAction).toBeTruthy();
    expect(p!.timeline.length).toBeGreaterThan(0);
    // enrichment
    expect(p!.visitorJourney.firstReferrer).toBe('https://blog.omnivyra.com/x');
    expect(p!.visitorJourney.journeyId).toBe('j1');
    expect(p!.visitorJourney.visitCount).toBe(2);
    expect(p!.campaignAttribution.campaignName).toBe('spring');
    expect(p!.campaignAttribution.campaignSource).toBe('google');
    expect(p!.contentReferences.assetId).toBe('as1');
    expect(p!.contentReferences.ctaId).toBe('cta1');
    expect(p!.websiteBehaviour.pagesViewed).toBe(1);
    expect(p!.websiteBehaviour.ctaClicks).toBe(1);
    expect(p!.websiteBehaviour.returnVisits).toBe(1);
    expect(p!.sourceDetail.path[0]).toBe('Website');
    // Phase 10 — buying intent integrated into the enriched profile
    expect(p!.buyingIntent).toBeTruthy();
    expect(typeof p!.buyingIntent.score).toBe('number');
    expect(p!.buyingIntent.decisionStage).toBeTruthy();
    expect(p!.buyingIntent.scoreBreakdown.length).toBeGreaterThan(0);
    // Phase 11 — action plan integrated into the enriched profile
    expect(p!.actionPlan).toBeTruthy();
    expect(p!.actionPlan.actions.length).toBeGreaterThan(0);
    expect(p!.actionPlan.readiness.length).toBe(5);
    expect(p!.actionPlan.crmPackage.qualificationChecklist.length).toBe(4);
    expect(p!.actionPlan.followUp.nextTouch.date).toBeTruthy();
    // Phase 12 — company summary embedded (lead belongs to a known company "Acme")
    expect(p!.company).toBeTruthy();
    expect(p!.company!.companyName).toBe('Acme');
    expect(p!.company!.contactCount).toBe(1);
    expect(p!.company!.accountStage).toBeTruthy();
  });

  it('getCompanyIntelligence aggregates by company key + is tenant-isolated', async () => {
    const ci = await getCompanyIntelligence('co1', 'acme', readers);
    expect(ci).toBeTruthy();
    expect(ci!.account.companyKey).toBe('acme');
    expect(ci!.account.contactCount).toBe(1);
    expect(ci!.buyingIntent.scoreBreakdown.length).toBeGreaterThan(0);
    expect(ci!.readiness.length).toBe(5);
    // tenant isolation + unknown company
    expect(await getCompanyIntelligence('other', 'acme', readers)).toBeNull();
    expect(await getCompanyIntelligence('co1', 'no-such-company', readers)).toBeNull();
  });

  it('getLeadActionPlan is reusable standalone + tenant-isolated', async () => {
    const plan = await getLeadActionPlan('co1', leadKeyFor(view), readers);
    expect(plan).toBeTruthy();
    expect(plan!.actions.length).toBeGreaterThan(0);
    expect(plan!.readiness.map((r) => r.channel).sort()).toEqual(['automation', 'call', 'crm', 'email', 'nurture']);
    expect(plan!.qualification.bant.budget).toBeDefined();
    expect(await getLeadActionPlan('other', leadKeyFor(view), readers)).toBeNull();
    expect(await getLeadActionPlan('co1', 'bogus', readers)).toBeNull();
  });

  it('getBuyingIntentProfile is reusable standalone + tenant-isolated', async () => {
    dbRows.tracking_events = [{ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' }];
    const bi = await getBuyingIntentProfile('co1', leadKeyFor(view), readers);
    expect(bi).toBeTruthy();
    expect(bi!.score).toBeGreaterThan(0);
    expect(bi!.scoreBreakdown.some((b) => b.label.startsWith('Viewed pricing'))).toBe(true);
    expect(bi!.provenance.length).toBeGreaterThan(0);
    // tenant isolation + not-found
    expect(await getBuyingIntentProfile('other', leadKeyFor(view), readers)).toBeNull();
    expect(await getBuyingIntentProfile('co1', 'bogus', readers)).toBeNull();
  });

  it('not found → null; tenant mismatch → null', async () => {
    expect(await getEnrichedLeadProfile('co1', 'bogus', readers)).toBeNull();
    expect(await getEnrichedLeadProfile('other', leadKeyFor(view), readers)).toBeNull();
  });

  it('behaviour degrades to zeros when no tracking exists (no new telemetry)', async () => {
    const p = await getEnrichedLeadProfile('co1', leadKeyFor(view), readers);
    expect(p!.websiteBehaviour.pagesViewed).toBe(0);
    expect(p!.websiteBehaviour.ctaClicks).toBe(0);
  });
});
