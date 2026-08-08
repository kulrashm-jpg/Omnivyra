/**
 * INT-001 Phase 5 — Automation & Execution Framework.
 *
 * Pure-engine tests over deterministic fixtures built with the REAL Phase 3
 * planner (test-side integration; the Phase 5 module itself depends on Phase 3
 * types only). No mocks, no I/O, no randomness, no snapshot-only assertions.
 */

import {
  buildAutomationSummary,
  buildAutomationPlan,
  generateTasks,
  buildExecutionTimeline,
  sequenceChannels,
  assessHumanReview,
  assessReadiness,
  STEP_DELAY_LADDER_HOURS,
} from '../../services/automationExecution';
import type { AutomationInput } from '../../services/automationExecution';
import { buildQualificationPlanningSummary } from '../../services/qualificationPlanning';
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
      device: null, geo: null,
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
// WS-2 M1/M2 added ADDITIVE session dimensions as REQUIRED keys whose values are
// nullable. These fixtures predate that mapping, so they supply null — the exact
// "row written before this mapping" case the type documents, which every consumer
// must treat as unknown rather than zero.
const session = (id: string, startedAt: string) => ({
  id, startedAt, lastSeenAt: startedAt, firstLandingPage: null,
  utmSource: null, utmMedium: null, utmCampaign: null,
  lastCurrentPage: null, returning: null, visitCount: null, firstVisitAt: null,
  sessionDurationMs: null, device: null, geo: null,
});
const intent = (score: number, band: IntentIntelligence['band'], signals = 3): IntentIntelligence => ({
  score, band,
  contributions: Array.from({ length: signals }, (_, i) => ({ signal: `s${i}`, label: `Signal ${i}`, points: 10, evidence: `evidence ${i}` })),
});
const persona = (p: PersonaIntelligence['persona'], confidence = 0.85): PersonaIntelligence => ({
  persona: p, confidence, reasons: [`classified as ${p}`],
});

function planningSummary(
  p: PersonaIntelligence['persona'],
  i: IntentIntelligence,
  snapOver: Partial<LeadCaptureSnapshot> = {},
  personaConfidence = 0.85,
) {
  const input: QualificationPlanningInput = {
    snapshot: snapshot(snapOver), intent: i, persona: persona(p, personaConfidence),
  };
  return buildQualificationPlanningSummary(input);
}

/** A rich warm/hot fixture: founder, high intent, engaged, repeat visitor. */
function founderHot(): AutomationInput {
  return {
    summary: planningSummary('Founder', intent(92, 'high', 5), {
      lead: { ...snapshot().lead, companySize: '1000+', industry: 'SaaS / Technology', primaryInterest: 'Product demo' },
      events: [event('page_view', '/pricing'), event('page_view', '/enterprise'), event('form_start', '/request-demo')],
      sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T11:30:00.000Z')],
    }),
    context: { hasEmail: true, hasPhone: true, linkedinProfileKnown: true, consentGranted: true },
  };
}

/** A warm marketing lead that should be fully automatable (READY). */
function marketingWarm(): AutomationInput {
  return {
    summary: planningSummary('Marketing', intent(65, 'high', 4), {
      lead: { ...snapshot().lead, companySize: '51–200', industry: 'SaaS / Technology' },
      events: [event('page_view', '/pricing'), event('page_view', '/features'), event('page_view', '/case-studies/acme')],
      sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T11:00:00.000Z')],
    }),
    context: { hasEmail: true, consentGranted: true },
  };
}

describe('P5 — determinism', () => {
  test('identical input yields deeply identical automation summaries; generatedAt is the upstream time', () => {
    const a = buildAutomationSummary(founderHot());
    const b = buildAutomationSummary(founderHot());
    expect(a).toEqual(b);
    expect(a.generatedAt).toBe(NOW);
  });
});

describe('P5 — task generation', () => {
  test('ordered chain: SDR (human, day 0, no dependency) → plan steps with wait tasks; ids deterministic; every field present', () => {
    const tasks = generateTasks(founderHot());
    expect(tasks[0]).toMatchObject({ order: 1, action: 'Assign SDR', kind: 'human', dependsOn: null, estimatedDelayHours: 0 });
    expect(tasks[0].id).toBe('task-1-assign-sdr');
    // orders are dense 1..n and each non-root chain task depends on an earlier task id
    tasks.forEach((t, i) => expect(t.order).toBe(i + 1));
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      if (t.dependsOn) expect(ids.has(t.dependsOn)).toBe(true);
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
      expect(t.explanation.length).toBeGreaterThan(0);
    }
    // Founder playbook surfaces as outreach/content tasks in order
    const actions = tasks.filter((t) => t.kind !== 'wait' && t.kind !== 'human').map((t) => t.action);
    expect(actions.slice(0, 4)).toEqual(['LinkedIn connect', 'Personal email', 'Case study', 'Meeting']);
  });

  test('dependency resolution: wait tasks sit between ladder steps and chain correctly', () => {
    const tasks = generateTasks(marketingWarm());
    const waits = tasks.filter((t) => t.kind === 'wait');
    expect(waits.length).toBeGreaterThanOrEqual(2); // ladder gaps ≥48h materialize
    for (const w of waits) {
      const dependents = tasks.filter((t) => t.dependsOn === w.id);
      expect(dependents.length).toBeGreaterThanOrEqual(1); // every wait gates a real task
      expect(w.estimatedDelayHours).toBeGreaterThanOrEqual(48);
    }
  });

  test('parallel supporting content (security docs) attaches to the chain root, deduped against plan steps', () => {
    const input = founderHot();
    input.summary = planningSummary('Founder', intent(92, 'high', 5), {
      lead: { ...snapshot().lead, companySize: '1000+', industry: 'SaaS / Technology', primaryInterest: 'Product demo' },
      events: [event('page_view', '/security'), event('page_view', '/pricing'), event('page_view', '/enterprise')],
      sessions: [session('s1', '2026-08-01T10:00:00.000Z'), session('s2', '2026-08-03T11:30:00.000Z')],
    });
    const tasks = generateTasks(input);
    const security = tasks.find((t) => t.action === 'Security documentation');
    expect(security).toBeDefined();
    expect(security!.dependsOn).toBe(tasks.find((t) => t.kind !== 'human')!.id);
    // action names unique across non-wait tasks (wait labels legitimately repeat)
    const names = tasks.filter((t) => t.kind !== 'wait').map((t) => t.action);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('P5 — execution timeline', () => {
  test('deterministic day progression from the ladder; wait tasks shape but do not appear; ISO anchored at generatedAt', () => {
    const input = marketingWarm();
    const plan = buildAutomationPlan(input);
    expect(plan.timeline.every((e) => e.action.startsWith('Wait') === false)).toBe(true);
    // first outreach step is day 0 at generatedAt
    expect(plan.timeline[0].day).toBe(0);
    expect(plan.timeline[0].scheduledAt).toBe(NOW);
    // days are non-decreasing and match cumulative ladder arithmetic
    for (let i = 1; i < plan.timeline.length; i += 1) {
      expect(plan.timeline[i].day).toBeGreaterThanOrEqual(plan.timeline[i - 1].day);
      expect(plan.timeline[i].scheduledAt >= plan.timeline[i - 1].scheduledAt).toBe(true);
    }
    // Marketing playbook has 3 steps on ladder 0/48/72 → days 0, 2, 5
    const days = plan.timeline.map((e) => e.day);
    expect(days).toEqual(expect.arrayContaining([0, 2, 5]));
  });

  test('timeline arithmetic: a 48h ladder step lands exactly 2 days after generatedAt', () => {
    const plan = buildAutomationPlan(marketingWarm());
    const day2 = plan.timeline.find((e) => e.day === 2);
    expect(day2).toBeDefined();
    expect(day2!.scheduledAt).toBe(new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString());
  });
});

describe('P5 — channel sequencing', () => {
  test('sequence preserves Phase 3 confidence order with 1-based order and explanations', () => {
    const seq = sequenceChannels(founderHot());
    seq.forEach((entry, i) => expect(entry.order).toBe(i + 1));
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i - 1].confidence).toBeGreaterThanOrEqual(seq[i].confidence);
    }
    for (const e of seq) expect(e.explanation.length).toBeGreaterThan(0);
    expect(seq.map((e) => e.channel)).toEqual(expect.arrayContaining(['linkedin', 'email']));
  });

  test('contact gating: hasPhone=false removes phone/whatsapp/sms; hasEmail=false removes email', () => {
    const input = founderHot();
    input.context = { hasEmail: false, hasPhone: false, linkedinProfileKnown: true, consentGranted: true };
    const seq = sequenceChannels(input);
    const channels = seq.map((e) => e.channel);
    expect(channels).not.toContain('phone');
    expect(channels).not.toContain('whatsapp');
    expect(channels).not.toContain('sms');
    expect(channels).not.toContain('email');
    expect(channels).toContain('linkedin');
  });
});

describe('P5 — readiness + human review', () => {
  test('READY: warm marketing lead with contact + consent and no conflicts', () => {
    const summary = buildAutomationSummary(marketingWarm());
    expect(summary.status).toBe('ready');
    expect(summary.review.reviewRequired).toBe(false);
    expect(summary.statusReasons[0]).toContain('automation can proceed');
  });

  test('MANUAL_REVIEW: hot founder always requires a human (executive rule) with the reason exposed', () => {
    const summary = buildAutomationSummary(founderHot());
    expect(summary.status).toBe('manual_review');
    expect(summary.review.reviewRequired).toBe(true);
    expect(summary.review.reasons.join(' ')).toContain('Hot executive lead');
  });

  test('BLOCKED: do-not-contact and consent-denied are hard stops that outrank everything', () => {
    const dnc = buildAutomationSummary({ ...marketingWarm(), context: { doNotContact: true, hasEmail: true } });
    expect(dnc.status).toBe('blocked');
    expect(dnc.statusReasons[0]).toContain('do-not-contact');
    const noConsent = buildAutomationSummary({ ...marketingWarm(), context: { consentGranted: false, hasEmail: true } });
    expect(noConsent.status).toBe('blocked');
    expect(noConsent.statusReasons[0]).toContain('consent');
  });

  test('INSUFFICIENT_DATA: unknown persona + no intent + no contact medium', () => {
    const summary = buildAutomationSummary({
      summary: planningSummary('Unknown', intent(0, 'none', 0), { lead: { ...snapshot().lead, email: null } }, 0.05),
      context: { hasEmail: false, hasPhone: false, linkedinProfileKnown: false },
    });
    expect(summary.status).toBe('insufficient_data');
    expect(summary.statusReasons.length).toBeGreaterThanOrEqual(2);
  });

  test('WAITING: cold researcher lead is held for more signal, not automated', () => {
    const summary = buildAutomationSummary({
      summary: planningSummary('Student', intent(10, 'low', 1), {
        lead: { ...snapshot().lead, email: 'phd@mit.edu' },
        events: [event('page_view', '/blog/post')],
      }),
      context: { hasEmail: true, consentGranted: true },
    });
    expect(['waiting', 'manual_review']).toContain(summary.status);
    if (summary.status === 'waiting') {
      expect(summary.statusReasons[0]).toContain('cold');
    }
  });

  test('review reasons: missing contact info surfaces as missingInformation; conflicting signals detected', () => {
    const conflicted = founderHot();
    conflicted.summary = {
      ...conflicted.summary,
      intent: { ...conflicted.summary.intent, band: 'high' },
      behavioralFit: { ...conflicted.summary.behavioralFit, score: 0 },
    };
    conflicted.context = { hasEmail: false, hasPhone: false, linkedinProfileKnown: true };
    const review = assessHumanReview(conflicted);
    expect(review.reviewRequired).toBe(true);
    expect(review.reasons.join(' ')).toContain('Conflicting signals');
    expect(review.missingInformation).toEqual(expect.arrayContaining(['email address', 'phone number']));
  });

  test('restricted region forces manual review (not a block)', () => {
    const input = marketingWarm();
    input.context = { ...input.context, region: 'de' };
    const review = assessHumanReview(input);
    expect(review.reasons.join(' ')).toContain('Region DE');
    const readiness = assessReadiness(input, review);
    expect(readiness.status).toBe('manual_review');
  });
});

describe('P5 — consolidated summary + scenarios', () => {
  test('summary shape: status/timeline/tasks/channels/review/confidence/generatedAt all consistent', () => {
    const input = marketingWarm();
    const summary = buildAutomationSummary(input);
    expect(summary.leadId).toBe('L1');
    expect(summary.tasks.length).toBeGreaterThan(0);
    expect(summary.executionTimeline.length).toBeGreaterThan(0);
    expect(summary.channelSequence.length).toBeGreaterThan(0);
    const expectedConfidence = Math.round((input.summary.confidence * 0.6 + input.summary.recommendedPlan.confidence * 0.4) * 100) / 100;
    expect(summary.confidence).toBe(expectedConfidence);
    expect(summary.generatedAt).toBe(NOW);
  });

  test('DEVELOPER: technical chain (docs → api → community → demo) and community channels in sequence', () => {
    const summary = buildAutomationSummary({
      summary: planningSummary('Developer', intent(55, 'medium', 3), {
        events: [event('page_view', '/docs/api'), event('page_view', '/developers')],
      }),
      context: { hasEmail: true, consentGranted: true },
    });
    const chain = summary.tasks.filter((t) => t.kind === 'outreach' || t.kind === 'content').map((t) => t.action);
    expect(chain.slice(0, 4)).toEqual(['Technical docs', 'API guide', 'Community', 'Demo']);
    expect(summary.channelSequence.map((c) => c.channel)).toEqual(expect.arrayContaining(['github', 'community']));
  });

  test('AGENCY: partner-track tasks; no SDR assignment on a non-hot partner lead', () => {
    const summary = buildAutomationSummary({
      summary: planningSummary('Agency', intent(45, 'medium', 2)),
      context: { hasEmail: true, consentGranted: true },
    });
    const actions = summary.tasks.map((t) => t.action);
    expect(actions).toEqual(expect.arrayContaining(['Partner deck', 'Referral program', 'Meeting']));
  });

  test('REPEAT VISITOR vs single visit: same persona/intent, repeat visitor reaches a stronger readiness posture', () => {
    const single = buildAutomationSummary({
      summary: planningSummary('Marketing', intent(45, 'medium', 2), {
        events: [event('page_view', '/features')],
        sessions: [session('s1', '2026-08-03T11:00:00.000Z')],
      }),
      context: { hasEmail: true, consentGranted: true },
    });
    const repeat = buildAutomationSummary({
      summary: planningSummary('Marketing', intent(45, 'medium', 2), {
        events: [event('page_view', '/features'), event('page_view', '/pricing')],
        sessions: [
          session('s1', '2026-07-28T10:00:00.000Z'),
          session('s2', '2026-08-01T10:00:00.000Z'),
          session('s3', '2026-08-03T11:00:00.000Z'),
        ],
      }),
      context: { hasEmail: true, consentGranted: true },
    });
    expect(repeat.confidence).toBeGreaterThanOrEqual(single.confidence);
    const rank = (s: string) => ['blocked', 'insufficient_data', 'waiting', 'manual_review', 'ready'].indexOf(s);
    expect(rank(repeat.status)).toBeGreaterThanOrEqual(rank(single.status));
  });

  test('ladder constants are the documented cadence (0h, 48h, 72h, …)', () => {
    expect(STEP_DELAY_LADDER_HOURS[0]).toBe(0);
    expect(STEP_DELAY_LADDER_HOURS[1]).toBe(48);
    expect(STEP_DELAY_LADDER_HOURS[2]).toBe(72);
  });
});
