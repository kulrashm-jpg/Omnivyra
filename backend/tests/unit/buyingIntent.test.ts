/**
 * Phase 10 — Buying Intent Intelligence engine (pure, deterministic, explainable).
 * Covers score calculation, evidence weighting, interest ranking, journey
 * summarization, decision stage, recommendations, graceful degradation, determinism.
 */
import { buildBuyingIntentProfile, type BuyingIntentInputs, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: 'up1',
  identity: { email: 'jane@acme.com', anonymousId: 'anon1' }, scores: { intent: 0.5 }, status: 'new',
  campaign: 'spring', content: 'pricing', referrer: null,
  utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: 'carousel', term: null },
  occurredAt: '2026-06-01T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
  attribution: { originalSource: 'website', originalChannel: 'social', campaign: 'spring', content: 'pricing', session: null, journey: null, referrer: null, utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: 'carousel', term: null }, identity: {}, sourceMetadata: { metadata: { intent: 'request_demo', web_attribution: { landing_page: 'https://omnivyra.com/' } } } },
  ...over,
});

const ev = (over: Record<string, unknown>) => over;

describe('Phase 10 — Buying Intent engine', () => {
  it('score = sum of deterministic evidence weights, fully explained', () => {
    const inputs: BuyingIntentInputs = {
      view: view({ scores: { intent: 0.8 } }),
      events: [
        ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' }),
        ev({ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' }),
        ev({ event_name: 'cta_click' }),
      ],
      sessions: [{ id: 's1' }, { id: 's2' }],
    };
    const p = buildBuyingIntentProfile(inputs);
    const byLabel = Object.fromEntries(p.scoreBreakdown.map((b) => [b.label, b.points]));
    expect(byLabel['Viewed pricing']).toBe(20);
    expect(p.scoreBreakdown.find((b) => b.label.startsWith('Requested a demo'))!.points).toBe(25);
    expect(p.scoreBreakdown.find((b) => b.label.startsWith('Submitted a lead form'))!.points).toBe(15);
    expect(p.scoreBreakdown.find((b) => b.label.startsWith('High scored intent'))!.points).toBe(20);
    expect(p.scoreBreakdown.find((b) => b.label.startsWith('Returned to the site'))!.points).toBe(12);
    // sum is clamped to 100; total raw exceeds 100 here
    expect(p.score).toBe(100);
    // every breakdown point is explainable (has label/level/source)
    expect(p.scoreBreakdown.every((b) => b.label && b.level && b.source && b.points > 0)).toBe(true);
  });

  it('evidence weighting: levels match the deterministic table', () => {
    const p = buildBuyingIntentProfile({ view: view(), events: [ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' })] });
    const pricing = p.evidence.find((e) => e.type === 'pricing_view')!;
    expect(pricing.level).toBe('very_high');
    expect(pricing.points).toBe(20);
    expect(pricing.source).toBe('tracking');
  });

  it('interest ranking is derived from evidence keywords (no LLM)', () => {
    const p = buildBuyingIntentProfile({ view: view({ campaign: 'lead-generation-campaign', content: 'crm integration roi' }) });
    const names = p.interestProfile.map((i) => i.interest);
    expect(names).toContain('Lead Generation');
    expect(names).toContain('CRM');
    expect(names).toContain('Integrations');
    expect(names).toContain('ROI');
    // ranked descending by score
    for (let i = 1; i < p.interestProfile.length; i += 1) {
      expect(p.interestProfile[i - 1].score).toBeGreaterThanOrEqual(p.interestProfile[i].score);
    }
    // signals are traceable
    expect(p.interestProfile[0].signals.length).toBeGreaterThan(0);
  });

  it('decision stage: deterministic thresholds + signal presence', () => {
    const demo = buildBuyingIntentProfile({ view: view(), events: [ev({ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' })] });
    expect(demo.decisionStage).toBe('decision');

    const shortlist = buildBuyingIntentProfile({ view: view({ scores: {} }), events: [ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' }), ev({ page_url: '/case-studies/acme', event_name: 'pageview', event_category: 'navigation' })] });
    expect(shortlist.decisionStage).toBe('shortlisting');

    const customer = buildBuyingIntentProfile({ view: view({ status: 'won' }) });
    expect(customer.decisionStage).toBe('customer');

    // signal-only community lead with weak signal → awareness (not a form submit)
    const awareness = buildBuyingIntentProfile({ view: view({ source: 'community', sourceLabel: 'Community', scores: { intent: 0.2 }, campaign: null, content: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, attribution: { ...view().attribution, campaign: null, content: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, sourceMetadata: {} } }) });
    expect(awareness.decisionStage).toBe('awareness');
  });

  it('decision journey is summarized + provenance-preserving', () => {
    const p = buildBuyingIntentProfile({ view: view(), events: [ev({ page_url: '/blog/x', event_name: 'pageview', event_category: 'navigation' }), ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' })] });
    const labels = p.decisionJourney.map((s) => s.label);
    expect(labels[0]).toBe('Website'); // source first
    expect(labels).toContain('Blog');
    expect(labels).toContain('Pricing');
    expect(labels[labels.length - 1]).toBe('Converted');
    expect(p.decisionJourney.every((s) => typeof s.provenance === 'string')).toBe(true);
  });

  it('recommendations are deterministic + traceable to evidence/stage', () => {
    const p = buildBuyingIntentProfile({ view: view(), events: [ev({ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' })] });
    expect(p.recommendations.recommendedNextAction).toContain('schedule'); // decision-stage action
    expect(p.recommendations.likelyInterests.length).toBeGreaterThan(0);
    expect(p.recommendations.likelyConcerns.length).toBeGreaterThan(0);
    expect(p.recommendations.campaignToMention).toBe('spring');
    // no pricing viewed → pricing concern surfaces
    expect(p.concerns.join(' ')).toMatch(/Pricing/i);
  });

  it('graceful degradation: works from the view alone (no events/touchpoints/sessions)', () => {
    const p = buildBuyingIntentProfile({ view: view({ scores: {}, campaign: null, content: null, utm: { source: null, medium: null, campaign: null, content: null, term: null } }) });
    expect(typeof p.score).toBe('number');
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.evidence.length).toBeGreaterThan(0); // at least lead_captured
    expect(p.interestProfile.length).toBeGreaterThan(0); // Lead Generation floor
    expect(p.decisionStage).toBeTruthy();
  });

  it('fully deterministic: identical inputs → identical output', () => {
    const inputs: BuyingIntentInputs = { view: view(), events: [ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' })], sessions: [{ id: 's1' }] };
    expect(buildBuyingIntentProfile(inputs)).toEqual(buildBuyingIntentProfile(inputs));
  });

  it('confidence reflects evidence breadth + provenance lists sources', () => {
    const p = buildBuyingIntentProfile({ view: view({ scores: { intent: 0.8 } }), events: [ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' })] });
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(100);
    expect(p.provenance).toContain('tracking');
  });
});
