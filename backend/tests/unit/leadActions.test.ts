/**
 * Phase 11 — Lead Actions & CRM Readiness engine (pure, deterministic).
 * Covers action generation + prioritization, readiness, qualification (Unknown stays
 * Unknown), CRM package, follow-up strategy, graceful degradation, determinism.
 */
import {
  buildLeadActionPlan,
  buildBuyingIntentProfile,
  type BuyingIntentInputs,
  type CanonicalLeadView,
} from '../../../lib/leadIntelligence';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: 'up1',
  identity: { email: 'jane@acme.com', phone: '+1 555' }, scores: { intent: 0.5 }, status: 'new',
  campaign: 'spring', content: null, referrer: null,
  utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: null, term: null },
  occurredAt: '2026-05-20T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
  attribution: { originalSource: 'website', originalChannel: 'social', campaign: 'spring', content: null, session: null, journey: null, referrer: null, utm: { source: 'linkedin', medium: 'social', campaign: 'spring', content: null, term: null }, identity: {}, sourceMetadata: { metadata: { company_name: 'Acme', company_size: '51–200', job_title: 'VP Marketing', name: 'Jane Doe' } } },
  ...over,
});

const intent = (v: CanonicalLeadView, inputs: Partial<BuyingIntentInputs> = {}) => buildBuyingIntentProfile({ view: v, ...inputs });
const ev = (o: Record<string, unknown>) => o;

describe('Phase 11 — Lead Action Plan', () => {
  it('decision-stage lead with phone → Call within 24 hours is the top critical action', () => {
    const v = view();
    const bi = intent(v, { events: [ev({ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' })] });
    const plan = buildLeadActionPlan({ view: v, buyingIntent: bi, now: NOW });
    expect(plan.actions[0].id).toBe('call_24h');
    expect(plan.actions[0].priority).toBe('critical');
    expect(plan.actions[0].category).toBe('immediate');
    expect(plan.actions[0].evidence.length).toBeGreaterThan(0);
    // sorted by priority then category
    for (let i = 1; i < plan.actions.length; i += 1) {
      const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      expect(order[plan.actions[i - 1].priority]).toBeLessThanOrEqual(order[plan.actions[i].priority]);
    }
  });

  it('enterprise company → escalate to enterprise sales', () => {
    const v = view({ attribution: { ...view().attribution, sourceMetadata: { metadata: { company_name: 'BigCo', company_size: '1000+' } } } });
    const plan = buildLeadActionPlan({ view: v, buyingIntent: intent(v), now: NOW });
    expect(plan.actions.some((a) => a.id === 'escalate_enterprise')).toBe(true);
    expect(plan.crmPackage.recommendedOwner).toBe('Enterprise sales');
  });

  it('readiness: email/call ready with contact; automation needs consent; crm partial when company missing', () => {
    const v = view({ identity: { email: 'a@b.com' }, attribution: { ...view().attribution, sourceMetadata: { metadata: { name: 'A' } } } });
    const plan = buildLeadActionPlan({ view: v, buyingIntent: intent(v), now: NOW });
    const r = Object.fromEntries(plan.readiness.map((x) => [x.channel, x]));
    expect(r.email.status).toBe('ready');
    expect(r.call.status).toBe('not_ready');
    expect(r.call.missingInformation).toContain('phone');
    expect(r.automation.status).toBe('not_ready'); // no consent on record
    expect(r.automation.missingInformation).toContain('marketing consent');
    expect(r.crm.status).toBe('partial'); // missing company only
    expect(r.crm.missingInformation).toContain('company');
  });

  it('qualification is evidence-backed; unsupported fields remain Unknown', () => {
    const v = view(); // VP title (authority), pricing not viewed, no demo
    const plan = buildLeadActionPlan({ view: v, buyingIntent: intent(v), now: NOW });
    const q = plan.qualification;
    expect(q.bant.authority.known).toBe(true);
    expect(q.bant.authority.value).toMatch(/Decision-maker/);
    expect(q.bant.budget.known).toBe(false); // no pricing engagement
    expect(q.bant.budget.value).toBe('Unknown');
    expect(q.bant.timeline.known).toBe(false);
    expect(q.bant.need.known).toBe(true); // derived from interests
    // MEDDIC: only supported fields filled
    expect(q.meddic.metrics.value).toBe('Unknown');
    expect(q.meddic.decisionProcess.value).toBe('Unknown');
    expect(q.meddic.economicBuyer.known).toBe(true); // VP → decision-maker
  });

  it('pricing engagement makes budget known (Evaluating)', () => {
    const v = view();
    const bi = intent(v, { events: [ev({ page_url: '/pricing', event_name: 'pageview', event_category: 'navigation' })] });
    const plan = buildLeadActionPlan({ view: v, buyingIntent: bi, now: NOW });
    expect(plan.qualification.bant.budget.known).toBe(true);
    expect(plan.qualification.bant.budget.value).toMatch(/Evaluating/);
  });

  it('CRM package is complete + deterministic with a checklist', () => {
    const v = view();
    const plan = buildLeadActionPlan({ view: v, buyingIntent: intent(v), now: NOW });
    const crm = plan.crmPackage;
    expect(crm.leadSummary).toBeTruthy();
    expect(crm.companySummary).toContain('Acme');
    expect(crm.buyingIntent.stage).toBe(plan.qualification.omnivyra.decisionStage);
    expect(crm.recommendedActions.length).toBeGreaterThan(0);
    expect(crm.nextFollowUpDate).toBe(plan.followUp.nextTouch.date);
    expect(crm.qualificationChecklist.map((c) => c.label)).toEqual(['Budget', 'Authority', 'Need', 'Timeline']);
  });

  it('follow-up strategy is stage-based + dated deterministically from `now`', () => {
    const v = view();
    const decision = buildLeadActionPlan({ view: v, buyingIntent: intent(v, { events: [ev({ page_url: '/request-demo', event_name: 'pageview', event_category: 'navigation' })] }), now: NOW });
    expect(decision.followUp.cadence).toBe('Daily until contacted');
    expect(decision.followUp.nextTouch.date).toBe('2026-06-02'); // +1 day
    expect(decision.followUp.nextTouch.channel).toBe('call'); // phone present
    expect(decision.followUp.expiry.date).toBe('2026-06-15'); // +14 days
    expect(decision.followUp.escalationRules.length).toBeGreaterThan(0);
  });

  it('graceful degradation: minimal view still produces a complete plan', () => {
    const v = view({ identity: {}, scores: {}, campaign: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, attribution: { ...view().attribution, campaign: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, sourceMetadata: {} } });
    const plan = buildLeadActionPlan({ view: v, buyingIntent: intent(v), now: NOW });
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.some((a) => a.id === 'enrich_identity')).toBe(true); // no contact
    expect(plan.readiness.find((r) => r.channel === 'crm')!.status).toBe('not_ready');
    expect(plan.qualification.bant.authority.value).toBe('Unknown');
  });

  it('fully deterministic: identical inputs → identical plan', () => {
    const v = view();
    const bi = intent(v);
    expect(buildLeadActionPlan({ view: v, buyingIntent: bi, now: NOW })).toEqual(buildLeadActionPlan({ view: v, buyingIntent: bi, now: NOW }));
  });
});
