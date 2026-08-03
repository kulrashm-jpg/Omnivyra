/**
 * INT-001 Phase 3 — Qualification & Autonomous Planning.
 *
 * Pure-engine tests: no I/O, no mocks needed, no snapshots-only assertions.
 * Covers qualification math, urgency, company fit, confidence behaviour,
 * determinism, missing data, channel ordering, plan generation, recommended
 * actions, and the mandated scenario personas.
 */

import {
  buildQualificationPlanningSummary,
  assessQualification,
  evaluateUrgency,
  evaluateCompanyFit,
  evaluateBehavioralFit,
  recommendChannels,
  buildOutreachPlan,
  buildRecommendedActions,
  classifyEmail,
  DIMENSION_WEIGHTS,
} from '../../services/qualificationPlanning';
import type {
  QualificationPlanningInput,
  LeadCaptureSnapshot,
  IntentIntelligence,
  PersonaIntelligence,
} from '../../services/qualificationPlanning';

const NOW = '2026-08-03T12:00:00.000Z';

function snapshot(over: Partial<LeadCaptureSnapshot> = {}): LeadCaptureSnapshot {
  return {
    lead: {
      id: 'L1', email: 'jane@acme.com', name: 'Jane Doe', jobTitle: null,
      companyName: 'Acme', companySize: null, industry: null, country: null,
      primaryInterest: null, message: null, source: 'website', createdAt: '2026-08-03T11:00:00.000Z',
      ...(over.lead ?? {}),
    },
    events: over.events ?? [],
    sessions: over.sessions ?? [],
    touchpoints: over.touchpoints ?? [],
    now: over.now ?? NOW,
  };
}

const event = (name: string, pageUrl: string | null, occurredAt = '2026-08-03T11:30:00.000Z') => ({
  id: null, eventName: name, pageUrl, sessionId: 's1', occurredAt, metadata: {},
});
const session = (id: string, startedAt: string, landing: string | null = null) => ({
  id, startedAt, lastSeenAt: startedAt, firstLandingPage: landing,
  utmSource: null, utmMedium: null, utmCampaign: null,
});

const intent = (score: number, band: IntentIntelligence['band'], signals = 2): IntentIntelligence => ({
  score, band,
  contributions: Array.from({ length: signals }, (_, i) => ({ signal: `s${i}`, label: `Signal ${i}`, points: 10, evidence: `evidence ${i}` })),
});
const persona = (p: PersonaIntelligence['persona'], confidence = 0.8): PersonaIntelligence => ({
  persona: p, confidence, reasons: [`classified as ${p}`],
});

const input = (
  snap: LeadCaptureSnapshot,
  i: IntentIntelligence,
  p: PersonaIntelligence,
  context?: QualificationPlanningInput['context'],
): QualificationPlanningInput => ({ snapshot: snap, intent: i, persona: p, context });

// ── Foundations ──────────────────────────────────────────────────────────────

describe('P3 — foundations', () => {
  test('dimension weights sum to exactly 1', () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test('email classification: company / free / student / unknown', () => {
    expect(classifyEmail('a@acme.com')).toBe('company');
    expect(classifyEmail('a@gmail.com')).toBe('free');
    expect(classifyEmail('a@mit.edu')).toBe('student');
    expect(classifyEmail('a@cam.ac.uk')).toBe('student');
    expect(classifyEmail('not-an-email')).toBe('unknown');
    expect(classifyEmail(null)).toBe('unknown');
  });

  test('DETERMINISM: identical input produces deeply identical output (injected now, no randomness)', () => {
    const build = () => buildQualificationPlanningSummary(input(
      snapshot({
        events: [event('page_view', '/pricing'), event('cta_click', '/request-demo')],
        sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T10:00:00.000Z')],
      }),
      intent(70, 'high'),
      persona('Founder'),
    ));
    const a = build();
    const b = build();
    expect(a).toEqual(b);
    expect(a.generatedAt).toBe(NOW); // injected time, never the clock
  });
});

// ── Urgency engine ───────────────────────────────────────────────────────────

describe('P3 — urgency engine', () => {
  test('accumulates pricing/demo/enterprise/repeat/recency/company-email signals with explanations', () => {
    const u = evaluateUrgency(snapshot({
      events: [
        event('page_view', '/pricing'), event('page_view', '/pricing/plans'),
        event('page_view', '/enterprise'), event('page_view', '/request-demo'),
        event('page_view', '/compare/omnivyra-vs-x'),
      ],
      sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T11:30:00.000Z')],
    }));
    const names = u.signals.map((s) => s.signal);
    expect(names).toEqual(expect.arrayContaining([
      'demo_request', 'pricing_visits', 'enterprise_pages', 'comparison_pages',
      'repeat_visits', 'recent_activity', 'company_email',
    ]));
    expect(u.score).toBeGreaterThanOrEqual(75);
    expect(u.explanation).toContain('Urgency driven by');
  });

  test('free vs student email pull urgency down deterministically', () => {
    const base = { events: [event('page_view', '/pricing')] };
    const company = evaluateUrgency(snapshot(base));
    const free = evaluateUrgency(snapshot({ ...base, lead: { ...snapshot().lead, email: 'x@gmail.com' } }));
    const student = evaluateUrgency(snapshot({ ...base, lead: { ...snapshot().lead, email: 'x@mit.edu' } }));
    expect(company.score).toBeGreaterThan(free.score);
    expect(free.score).toBeGreaterThan(student.score);
  });

  test('empty snapshot: zero-ish score, low confidence, explicit no-signal explanation', () => {
    const u = evaluateUrgency(snapshot({ lead: { ...snapshot().lead, email: null, createdAt: null } }));
    expect(u.score).toBeLessThanOrEqual(5);
    expect(u.confidence).toBeLessThanOrEqual(0.35);
    expect(u.explanation).toBe('No urgency signals captured.');
  });
});

// ── Company fit engine ───────────────────────────────────────────────────────

describe('P3 — company fit engine', () => {
  test('ICP size + industry + company email raise the score; inputs raise confidence', () => {
    const fit = evaluateCompanyFit(snapshot({
      lead: { ...snapshot().lead, companySize: '51–200', industry: 'SaaS / Technology', country: 'US', primaryInterest: 'Lead intelligence' },
    }));
    expect(fit.score).toBeGreaterThanOrEqual(80);
    expect(fit.confidence).toBeGreaterThanOrEqual(0.6);
    expect(fit.signals.map((s) => s.signal)).toEqual(expect.arrayContaining(['company_size', 'industry', 'company_email_domain']));
  });

  test('missing-data handling: no firmographics → neutral score, LOW confidence, honest explanation', () => {
    const fit = evaluateCompanyFit(snapshot({ lead: { ...snapshot().lead, email: null, companyName: null } }));
    expect(fit.score).toBeGreaterThanOrEqual(30);
    expect(fit.score).toBeLessThanOrEqual(50);
    expect(fit.confidence).toBeLessThanOrEqual(0.3);
    expect(fit.explanation).toContain('No firmographic information');
  });

  test('caller context: known ICP + existing customer add explained signals', () => {
    const fit = evaluateCompanyFit(snapshot(), { knownIcpMatch: true, existingCustomer: true, organizationType: 'company' });
    expect(fit.signals.map((s) => s.signal)).toEqual(expect.arrayContaining(['known_icp', 'existing_customer', 'organization_type']));
    expect(fit.score).toBeGreaterThanOrEqual(75);
  });
});

// ── Qualification core ───────────────────────────────────────────────────────

describe('P3 — qualification', () => {
  test('total = Σ(score×weight) rounded; normalized = total/100; every dimension exposes score/weight/confidence/explanation', () => {
    const snap = snapshot();
    const dims = {
      urgency: evaluateUrgency(snap),
      companyFit: evaluateCompanyFit(snap),
      behavioralFit: evaluateBehavioralFit(snap),
    };
    const q = assessQualification(input(snap, intent(80, 'high'), persona('CEO', 0.9)), dims);
    const expected = Math.round(q.dimensions.reduce((s, d) => s + d.score * d.weight, 0));
    expect(q.totalScore).toBe(expected);
    expect(q.normalizedScore).toBeCloseTo(q.totalScore / 100, 3);
    expect(q.dimensions).toHaveLength(5);
    for (const d of q.dimensions) {
      expect(d.weight).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
      expect(d.explanation.length).toBeGreaterThan(0);
    }
    expect(q.reasoning[0]).toContain(`Total ${q.totalScore}/100`);
  });

  test('confidence is the weight-averaged dimension confidence and drops with missing data', () => {
    const rich = buildQualificationPlanningSummary(input(
      snapshot({
        lead: { ...snapshot().lead, companySize: '51–200', industry: 'SaaS / Technology' },
        events: Array.from({ length: 12 }, (_, i) => event('page_view', `/docs/${i}`)),
        sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T10:00:00.000Z')],
      }),
      intent(70, 'high', 5),
      persona('CTO', 0.9),
    ));
    const sparse = buildQualificationPlanningSummary(input(
      snapshot({ lead: { ...snapshot().lead, email: null } }),
      intent(0, 'none', 0),
      persona('Unknown', 0.1),
    ));
    expect(rich.confidence).toBeGreaterThan(sparse.confidence);
    expect(sparse.confidence).toBeLessThanOrEqual(0.4);
  });

  test('bands: hot ≥75, warm ≥50, cool ≥25, cold below', () => {
    const snap = snapshot();
    const dims = { urgency: evaluateUrgency(snap), companyFit: evaluateCompanyFit(snap), behavioralFit: evaluateBehavioralFit(snap) };
    const cold = assessQualification(input(snap, intent(0, 'none', 0), persona('Student', 0.9)), {
      urgency: { ...dims.urgency, score: 0 }, companyFit: { ...dims.companyFit, score: 0 }, behavioralFit: { ...dims.behavioralFit, score: 0 },
    });
    expect(['cold', 'cool']).toContain(cold.band);
    const hot = assessQualification(input(snap, intent(100, 'high', 5), persona('Founder', 1)), {
      urgency: { ...dims.urgency, score: 100 }, companyFit: { ...dims.companyFit, score: 100 }, behavioralFit: { ...dims.behavioralFit, score: 100 },
    });
    expect(hot.band).toBe('hot');
    expect(hot.totalScore).toBeGreaterThanOrEqual(90);
  });
});

// ── Channel intelligence ─────────────────────────────────────────────────────

describe('P3 — channel intelligence', () => {
  test('ordering is deterministic: confidence desc, fixed tiebreak; every entry carries reasoning', () => {
    const channels = recommendChannels(input(snapshot(), intent(60, 'medium'), persona('Founder', 0.9)));
    for (let i = 1; i < channels.length; i += 1) {
      expect(channels[i - 1].confidence).toBeGreaterThanOrEqual(channels[i].confidence);
    }
    for (const c of channels) expect(c.reasoning.length).toBeGreaterThan(0);
    // Founder with company email: LinkedIn and email lead the list.
    expect(channels.slice(0, 2).map((c) => c.channel).sort()).toEqual(['email', 'linkedin']);
  });

  test('developer persona surfaces github/discord/community; phone channels appear only when a phone exists', () => {
    const dev = recommendChannels(input(snapshot(), intent(40, 'medium'), persona('Developer', 0.8)));
    expect(dev.map((c) => c.channel)).toEqual(expect.arrayContaining(['github', 'discord', 'community']));
    expect(dev.map((c) => c.channel)).not.toContain('phone');
    const withPhone = recommendChannels(input(snapshot(), intent(40, 'medium'), persona('Developer', 0.8), { phoneNumber: '+1 555' }));
    expect(withPhone.map((c) => c.channel)).toEqual(expect.arrayContaining(['phone', 'whatsapp', 'sms']));
  });
});

// ── Planner + actions ────────────────────────────────────────────────────────

describe('P3 — outreach planner', () => {
  const planFor = (p: PersonaIntelligence['persona']) => {
    const inp = input(snapshot(), intent(70, 'high'), persona(p, 0.85));
    const snap = inp.snapshot;
    const q = assessQualification(inp, {
      urgency: evaluateUrgency(snap), companyFit: evaluateCompanyFit(snap), behavioralFit: evaluateBehavioralFit(snap),
    });
    return buildOutreachPlan(inp, q, recommendChannels(inp));
  };

  test('founder: LinkedIn → personal email → case study → meeting, ordered 1..4', () => {
    const plan = planFor('Founder');
    expect(plan.playbook).toBe('Founder');
    expect(plan.steps.map((s) => s.step)).toEqual(['LinkedIn connect', 'Personal email', 'Case study', 'Meeting']);
    expect(plan.steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(plan.confidence).toBeGreaterThan(0.4);
  });

  test('marketing: whitepaper → newsletter → demo; developer: docs → api → community → demo; agency: partner deck → referral → meeting', () => {
    expect(planFor('Marketing').steps.map((s) => s.step)).toEqual(['Whitepaper', 'Newsletter', 'Demo']);
    expect(planFor('Developer').steps.map((s) => s.step)).toEqual(['Technical docs', 'API guide', 'Community', 'Demo']);
    expect(planFor('Agency').steps.map((s) => s.step)).toEqual(['Partner deck', 'Referral program', 'Meeting']);
  });

  test('unknown persona falls back to the Default playbook with honest reasoning', () => {
    const plan = planFor('Unknown');
    expect(plan.playbook).toBe('Default');
    expect(plan.reasoning).toContain('default nurture sequence');
  });
});

describe('P3 — recommended actions', () => {
  test('hot enterprise lead: Assign SDR is critical and ranked first; ranks are 1..n unique', () => {
    const inp = input(
      snapshot({
        lead: { ...snapshot().lead, companySize: '1000+', industry: 'SaaS / Technology', primaryInterest: 'Product demo' },
        events: [event('page_view', '/pricing'), event('page_view', '/enterprise'), event('page_view', '/security')],
        sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T11:00:00.000Z')],
      }),
      intent(90, 'high', 5),
      persona('CEO', 0.9),
    );
    const summary = buildQualificationPlanningSummary(inp);
    expect(summary.qualification.band).toBe('hot');
    const actions = summary.recommendedActions;
    expect(actions[0]).toMatchObject({ action: 'Assign SDR', priority: 'critical', rank: 1 });
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['Schedule follow-up', 'Security documentation', 'Executive outreach']));
    expect(actions.map((a) => a.rank)).toEqual(actions.map((_, i) => i + 1)); // dense unique ranks
    for (const a of actions) expect(a.explanation.length).toBeGreaterThan(0);
  });

  test('comparison-page visitor gets the comparison guide; actions are de-duplicated', () => {
    const inp = input(
      snapshot({ events: [event('page_view', '/compare/us-vs-them'), event('page_view', '/docs/api')] }),
      intent(55, 'medium'),
      persona('Developer', 0.8),
    );
    const actions = buildRecommendedActions(inp, buildQualificationPlanningSummary(inp).qualification, evaluateUrgency(inp.snapshot));
    expect(actions.map((a) => a.action)).toContain('Send comparison guide');
    const names = actions.map((a) => a.action);
    expect(new Set(names).size).toBe(names.length); // no duplicates
  });
});

// ── Mandated end-to-end scenarios ────────────────────────────────────────────

describe('P3 — scenarios', () => {
  test('EMPTY INTELLIGENCE: minimal lead still produces a complete, low-confidence summary', () => {
    const summary = buildQualificationPlanningSummary(input(
      snapshot({ lead: { ...snapshot().lead, id: null, email: null, companyName: null, createdAt: null } }),
      intent(0, 'none', 0),
      persona('Unknown', 0),
    ));
    expect(summary.leadId).toBeNull();
    expect(['cold', 'cool']).toContain(summary.qualification.band);
    expect(summary.confidence).toBeLessThanOrEqual(0.4);
    expect(summary.recommendedPlan.playbook).toBe('Default');
    expect(summary.recommendedActions.length).toBeGreaterThan(0); // follow-up always exists
    expect(summary.generatedAt).toBe(NOW);
  });

  test('HIGH-INTENT ENTERPRISE: hot band, SDR critical, executive outreach, LinkedIn/email lead channels', () => {
    const summary = buildQualificationPlanningSummary(input(
      snapshot({
        lead: { ...snapshot().lead, companySize: '1000+', industry: 'Financial Services', primaryInterest: 'Product demo', country: 'US' },
        events: [event('page_view', '/enterprise'), event('page_view', '/pricing'), event('page_view', '/security'), event('form_start', '/request-demo')],
        sessions: [session('s1', '2026-07-30T10:00:00.000Z'), session('s2', '2026-08-03T11:45:00.000Z')],
      }),
      intent(92, 'high', 5),
      persona('Founder', 0.9),
    ));
    expect(summary.qualification.band).toBe('hot');
    expect(summary.overallScore).toBe(summary.qualification.totalScore);
    expect(summary.recommendedActions[0].action).toBe('Assign SDR');
    expect(summary.recommendedActions.map((a) => a.action)).toContain('Executive outreach');
    expect(summary.recommendedChannels[0].channel).toMatch(/linkedin|email/);
    expect(summary.recommendedPlan.playbook).toBe('Founder');
  });

  test('RESEARCHER (student email, content-only behaviour): cold/cool with reduced urgency', () => {
    const summary = buildQualificationPlanningSummary(input(
      snapshot({
        lead: { ...snapshot().lead, email: 'phd@stanford.edu', companyName: null },
        events: [event('page_view', '/blog/how-it-works'), event('page_view', '/docs/architecture')],
      }),
      intent(15, 'low', 1),
      persona('Student', 0.8),
    ));
    expect(['cold', 'cool']).toContain(summary.qualification.band);
    expect(summary.urgency.signals.map((s) => s.signal)).toContain('student_email');
    expect(summary.recommendedActions.map((a) => a.action)).not.toContain('Assign SDR');
  });

  test('DEVELOPER: technical plan, github/community channels, technical demo + API docs actions', () => {
    const summary = buildQualificationPlanningSummary(input(
      snapshot({
        lead: { ...snapshot().lead, email: 'dev@startup.io', jobTitle: 'Backend Engineer' },
        events: [event('page_view', '/docs/api'), event('page_view', '/developers/quickstart')],
      }),
      intent(50, 'medium', 3),
      persona('Developer', 0.85),
    ));
    expect(summary.recommendedPlan.steps.map((s) => s.step)).toEqual(['Technical docs', 'API guide', 'Community', 'Demo']);
    expect(summary.recommendedChannels.map((c) => c.channel)).toEqual(expect.arrayContaining(['github', 'community']));
    expect(summary.recommendedActions.map((a) => a.action)).toEqual(expect.arrayContaining(['Technical demo', 'API documentation']));
  });

  test('AGENCY: partner-track plan and partner-program action', () => {
    const summary = buildQualificationPlanningSummary(input(
      snapshot({ lead: { ...snapshot().lead, industry: 'Marketing / Agency' } }),
      intent(45, 'medium'),
      persona('Agency', 0.8),
    ));
    expect(summary.recommendedPlan.steps.map((s) => s.step)).toEqual(['Partner deck', 'Referral program', 'Meeting']);
    expect(summary.recommendedActions.map((a) => a.action)).toContain('Partner program');
  });

  test('REPEAT VISITOR: multiple sessions raise urgency + behaviour vs an identical single-session lead', () => {
    const base = {
      events: [event('page_view', '/pricing'), event('page_view', '/features')],
    };
    const once = buildQualificationPlanningSummary(input(
      snapshot({ ...base, sessions: [session('s1', '2026-08-03T11:00:00.000Z')] }),
      intent(50, 'medium'), persona('Marketing', 0.7),
    ));
    const repeat = buildQualificationPlanningSummary(input(
      snapshot({
        ...base,
        sessions: [
          session('s1', '2026-07-28T10:00:00.000Z'),
          session('s2', '2026-08-01T10:00:00.000Z'),
          session('s3', '2026-08-03T11:00:00.000Z'),
        ],
      }),
      intent(50, 'medium'), persona('Marketing', 0.7),
    ));
    expect(repeat.urgency.score).toBeGreaterThan(once.urgency.score);
    expect(repeat.behavioralFit.score).toBeGreaterThan(once.behavioralFit.score);
    expect(repeat.urgency.signals.map((s) => s.signal)).toEqual(expect.arrayContaining(['repeat_visits', 'multiple_sessions']));
    expect(repeat.qualification.totalScore).toBeGreaterThan(once.qualification.totalScore);
  });
});
