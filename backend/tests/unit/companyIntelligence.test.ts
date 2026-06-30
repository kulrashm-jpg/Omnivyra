/**
 * Phase 12 — Company Intelligence & Account Buying Intent (pure, deterministic).
 * Covers company key resolution, multi-contact aggregation, stakeholder classification,
 * account journey, interest aggregation, readiness, action plan, determinism, degrade.
 */
import {
  buildCompanyIntelligence,
  resolveCompanyKey,
  summarizeCompanyIntelligence,
  buildBuyingIntentProfile,
  type CompanyContact,
  type CanonicalLeadView,
} from '../../../lib/leadIntelligence';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

const view = (over: Partial<CanonicalLeadView> = {}, meta: Record<string, unknown> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: { email: 'person@acme.com' }, scores: { intent: 0.4 }, status: 'new',
  campaign: 'spring', content: null, referrer: null,
  utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: null, term: null },
  occurredAt: '2026-05-20T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
  attribution: { originalSource: 'website', originalChannel: 'social', campaign: 'spring', content: null, session: null, journey: null, referrer: null, utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: null, term: null }, identity: {}, sourceMetadata: { metadata: { company_name: 'Acme', company_size: '51–200', ...meta } } },
  ...over,
});

const contact = (v: CanonicalLeadView, events?: Array<Record<string, unknown>>): CompanyContact => ({ view: v, buyingIntent: buildBuyingIntentProfile({ view: v, events }) });

describe('Phase 12 — Company Intelligence', () => {
  it('resolves a deterministic company key (name → domain; free email = unknown)', () => {
    expect(resolveCompanyKey(view())).toBe('acme'); // company_name
    expect(resolveCompanyKey(view({ identity: { email: 'jane@beta.io' } }, {}))).toBe('acme'); // name still wins
    const noName = view({ identity: { email: 'jane@beta.io' } });
    (noName.attribution.sourceMetadata as any).metadata = {};
    expect(resolveCompanyKey(noName)).toBe('beta.io'); // domain fallback
    const free = view({ identity: { email: 'jane@gmail.com' } });
    (free.attribution.sourceMetadata as any).metadata = {};
    expect(resolveCompanyKey(free)).toBeNull(); // free provider → unknown company
  });

  it('aggregates multi-contact intent with an explainable breakdown', () => {
    const dm = contact(view({ identity: { email: 'ceo@acme.com', phone: '+1' }, sourceRef: { table: 'leads', id: 'L1' } }, { job_title: 'CEO' }), [{ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' }]);
    const champ = contact(view({ identity: { email: 'mgr@acme.com' }, scores: { intent: 0.8 }, sourceRef: { table: 'leads', id: 'L2' } }, { job_title: 'Marketing Manager' }), [{ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' }]);
    const ci = buildCompanyIntelligence({ companyKey: 'acme', companyName: 'Acme', contacts: [dm, champ], now: NOW });
    expect(ci.account.contactCount).toBe(2);
    expect(ci.buyingIntent.score).toBeGreaterThan(0);
    expect(ci.buyingIntent.scoreBreakdown.some((b) => b.label.startsWith('Top contact intent'))).toBe(true);
    expect(ci.buyingIntent.scoreBreakdown.some((b) => b.label.startsWith('Multi-threading'))).toBe(true);
    expect(ci.buyingIntent.scoreBreakdown.some((b) => b.label.startsWith('Stakeholder coverage'))).toBe(true);
    // every breakdown point is explained
    expect(ci.buyingIntent.scoreBreakdown.every((b) => b.label && b.source && b.points > 0)).toBe(true);
  });

  it('classifies stakeholders deterministically + reports missing roles', () => {
    const ceo = contact(view({ identity: { email: 'ceo@acme.com' }, sourceRef: { table: 'leads', id: 'L1' } }, { job_title: 'Chief Executive Officer' }));
    const analyst = contact(view({ identity: { email: 'a@acme.com' }, sourceRef: { table: 'leads', id: 'L2' } }, { job_title: 'Marketing Analyst' }));
    const anon = contact(view({ identity: { email: 'x@acme.com' }, scores: {}, sourceRef: { table: 'leads', id: 'L3' } }, {})); // no title, no signal
    const ci = buildCompanyIntelligence({ companyKey: 'acme', contacts: [ceo, analyst, anon], now: NOW });
    const roles = Object.fromEntries(ci.stakeholders.identified.map((s) => [s.contact, s.role]));
    expect(roles['ceo@acme.com']).toBe('decision_maker');
    expect(roles['a@acme.com']).toBe('influencer'); // mid-level title
    expect(roles['x@acme.com']).toBe('unknown'); // no evidence → Unknown stays Unknown
    expect(ci.stakeholders.missing).toContain('champion');
    expect(ci.stakeholders.missing).toContain('evaluator');
  });

  it('builds a merged account journey with provenance', () => {
    const a = contact(view({ identity: { email: 'a@acme.com' }, occurredAt: '2026-05-10T00:00:00Z', campaign: 'spring', sourceRef: { table: 'leads', id: 'L1' } }));
    const b = contact(view({ identity: { email: 'b@acme.com' }, occurredAt: '2026-05-25T00:00:00Z', campaign: 'launch', sourceRef: { table: 'leads', id: 'L2' } }));
    const ci = buildCompanyIntelligence({ companyKey: 'acme', contacts: [a, b], now: NOW });
    expect(ci.journey.firstTouch).toBe('2026-05-10T00:00:00Z');
    expect(ci.journey.latestTouch).toBe('2026-05-25T00:00:00Z');
    expect(ci.journey.activeCampaigns.sort()).toEqual(['launch', 'spring']);
    expect(ci.journey.timelineSummary.length).toBe(2);
    expect(ci.journey.timelineSummary[0].contact).toBe('a@acme.com'); // chronological
  });

  it('aggregates interests across contacts with contributing contacts + strength', () => {
    const a = contact(view({ identity: { email: 'a@acme.com' }, campaign: 'lead-generation', sourceRef: { table: 'leads', id: 'L1' } }));
    const b = contact(view({ identity: { email: 'b@acme.com' }, content: 'crm integration', campaign: 'crm-campaign', sourceRef: { table: 'leads', id: 'L2' } }));
    const ci = buildCompanyIntelligence({ companyKey: 'acme', contacts: [a, b], now: NOW });
    expect(ci.interests.length).toBeGreaterThan(0);
    const leadGen = ci.interests.find((i) => i.interest === 'Lead Generation');
    expect(leadGen).toBeTruthy();
    expect(leadGen!.contributingContacts.length).toBeGreaterThan(0);
    expect(['strong', 'moderate', 'weak']).toContain(ci.interests[0].strength);
    for (let i = 1; i < ci.interests.length; i += 1) expect(ci.interests[i - 1].score).toBeGreaterThanOrEqual(ci.interests[i].score);
  });

  it('readiness + actions reflect stakeholders, multi-threading, enterprise', () => {
    const ceo = contact(view({ identity: { email: 'ceo@acme.com', phone: '+1' }, sourceRef: { table: 'leads', id: 'L1' } }, { job_title: 'CEO', company_size: '1000+' }));
    const champ = contact(view({ identity: { email: 'mgr@acme.com' }, scores: { intent: 0.8 }, sourceRef: { table: 'leads', id: 'L2' } }, { company_size: '1000+', job_title: 'Manager' }));
    const ci = buildCompanyIntelligence({ companyKey: 'acme', companyName: 'Acme', contacts: [ceo, champ], now: NOW });
    const rd = Object.fromEntries(ci.readiness.map((r) => [r.motion, r]));
    expect(rd.executive_outreach.status).toBe('ready'); // reachable decision-maker
    expect(rd.multi_thread.status).toBe('ready'); // 2 engaged
    expect(rd.enterprise_motion.status).toBe('ready'); // enterprise + roles
    expect(ci.actions.some((a) => a.id === 'engage_decision_maker')).toBe(true);
    expect(ci.actions.some((a) => a.id === 'escalate_enterprise')).toBe(true);
    expect(ci.actions[0].evidence.length).toBeGreaterThan(0);
  });

  it('graceful degradation: single anonymous contact still produces a profile', () => {
    const lone = contact(view({ identity: {}, scores: {}, sourceRef: { table: 'leads', id: 'L1' } }, {}));
    const ci = buildCompanyIntelligence({ companyKey: 'acme', contacts: [lone], now: NOW });
    expect(ci.account.contactCount).toBe(1);
    // one captured contact = not multi-threaded (partial, not ready)
    expect(ci.readiness.find((r) => r.motion === 'multi_thread')!.status).toBe('partial');
    expect(ci.actions.some((a) => a.id === 'multi_thread')).toBe(true);
    expect(summarizeCompanyIntelligence(ci).multiThreaded).toBe(false);
  });

  it('fully deterministic: identical contacts → identical profile', () => {
    const c = [contact(view({ sourceRef: { table: 'leads', id: 'L1' } }))];
    expect(buildCompanyIntelligence({ companyKey: 'acme', contacts: c, now: NOW })).toEqual(buildCompanyIntelligence({ companyKey: 'acme', contacts: c, now: NOW }));
  });
});
