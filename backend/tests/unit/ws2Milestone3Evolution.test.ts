/**
 * WS-2 Milestone-3 — advanced lead intelligence (evolution).
 *
 * Covers multi-session replay, intent growth/decay/acceleration/persistence,
 * funnel progression and regression, journey evolution, qualification and
 * recommendation evolution, timeline projection, explainability, determinism,
 * regression and backward compatibility.
 */

import {
  assembleLeadCaptureSnapshot,
  analyzeBehavior,
  buildEvolutionIntelligence,
  buildLeadIntelligenceSummary,
  buildLeadTimeline,
  buildRecommendations,
  buildQualification,
  computeIntentIntelligence,
  classifyPersona,
  funnelStageOf,
  FUNNEL_STAGES,
  defaultEngineConfig,
  LEAD_RECOMMENDATION_KEYS,
} from '../../services/leadIntelligenceEngine';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../../services/leadIntelligenceOrchestration/engineVersion';

type Row = Record<string, unknown>;

const DAY = 86_400_000;
const T0 = Date.parse('2026-06-01T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

const session = (id: string, startMs: number, over: Row = {}): Row => ({
  id,
  started_at: iso(startMs),
  last_seen_at: iso(startMs + 600_000),
  first_landing_page: '/',
  last_current_page: 'https://x.com/pricing',
  metadata: { visitor: { visit_count: Number(id.replace(/\D/g, '')) || 1, returning_visitor: id !== 'vs-1', first_visit_at: iso(T0) } },
  ...over,
});

const evt = (id: string, name: string, atMs: number, url: string, sessionId: string, metadata: Row = {}): Row => ({
  id, event_name: name, page_url: url, visitor_session_id: sessionId, occurred_at: iso(atMs), metadata,
});

const assemble = (sessions: Row[], events: Row[], nowMs: number, leadCreatedMs: number | null = null) =>
  assembleLeadCaptureSnapshot({
    leadRow: {
      id: 'L1', company_id: 'co-1', email: 'cto@bigcorp.com',
      created_at: leadCreatedMs === null ? null : iso(leadCreatedMs),
      visitor_session_id: 'vs-1',
      metadata: { job_title: 'CTO', company_name: 'BigCorp' },
    },
    trackingEventRows: events,
    visitorSessionRows: sessions,
    touchpointRows: [],
    now: iso(nowMs),
  });

const evolutionOf = (sessions: Row[], events: Row[], nowMs: number, leadCreatedMs: number | null = null) =>
  buildEvolutionIntelligence(assemble(sessions, events, nowMs, leadCreatedMs));

/** A visitor whose engagement deepens over three sessions. */
const GROWING = {
  sessions: [session('vs-1', T0), session('vs-2', T0 + 2 * DAY), session('vs-3', T0 + 3 * DAY)],
  events: [
    evt('e1', 'page_view', T0 + 1000, 'https://x.com/blog/post', 'vs-1'),
    evt('e2', 'page_view', T0 + 2 * DAY + 1000, 'https://x.com/pricing', 'vs-2'),
    evt('e3', 'page_view', T0 + 2 * DAY + 2000, 'https://x.com/case-studies/acme', 'vs-2'),
    evt('e4', 'page_view', T0 + 3 * DAY + 1000, 'https://x.com/demo', 'vs-3'),
    evt('e5', 'page_view', T0 + 3 * DAY + 2000, 'https://x.com/security', 'vs-3'),
  ],
  now: T0 + 3 * DAY + 3600_000,
};

// ── 1. Multi-session replay ─────────────────────────────────────────────────

describe('M3 (1) — multi-session intelligence', () => {
  it('produces one checkpoint per session plus the present', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.intent.checkpoints.length).toBe(4); // 3 sessions + now
    expect(evo.intent.checkpoints.map((c) => c.sessionIndex)).toEqual([1, 2, 3, 4]);
    // Chronological by construction.
    const times = evo.intent.checkpoints.map((c) => Date.parse(c.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('each checkpoint sees only the evidence available at that moment', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    const counts = evo.intent.checkpoints.map((c) => c.eventsSoFar);
    // Monotonically non-decreasing — a replay can never lose evidence.
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(GROWING.events.length);
  });

  it('attributes each checkpoint the signals that FIRST appear there', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    const all = evo.intent.checkpoints.flatMap((c) => c.newSignals);
    expect(new Set(all).size).toBe(all.length);      // never reported twice
    expect(all).toContain('page:pricing');
    expect(all).toContain('page:demo');
  });

  it('bounds replay cost: checkpoints never exceed the configured cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => session(`vs-${i + 1}`, T0 + i * DAY));
    const evo = buildEvolutionIntelligence(assemble(many, GROWING.events, T0 + 61 * DAY), {
      ...defaultEngineConfig,
      evolution: { ...defaultEngineConfig.evolution, maxCheckpoints: 12 },
    });
    expect(evo.intent.checkpoints.length).toBeLessThanOrEqual(12);
    // Both ends survive the thinning — they carry the baseline and the present.
    // Checkpoints mark the END of a session, so the first is session 1's end.
    expect(Date.parse(evo.intent.checkpoints[0].at)).toBe(T0 + 600_000);
    expect(Date.parse(evo.intent.checkpoints[evo.intent.checkpoints.length - 1].at)).toBe(T0 + 61 * DAY);
  });

  it('is deterministic and independent of row order', () => {
    const a = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    const b = evolutionOf([...GROWING.sessions].reverse(), [...GROWING.events].reverse(), GROWING.now);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reuses the shared behaviour analysis rather than recomputing it', () => {
    const snap = assemble(GROWING.sessions, GROWING.events, GROWING.now);
    const shared = analyzeBehavior(snap, defaultEngineConfig);
    const withShared = buildEvolutionIntelligence(snap, defaultEngineConfig, shared);
    const standalone = buildEvolutionIntelligence(snap);
    expect(JSON.stringify(withShared)).toBe(JSON.stringify(standalone));
  });
});

// ── 2. Intent evolution ─────────────────────────────────────────────────────

describe('M3 (2) — intent evolution', () => {
  it('detects growth and reports every required field on a transition', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(['growing', 'accelerating']).toContain(evo.intent.trend);
    expect(evo.intent.transitions.length).toBeGreaterThan(0);

    for (const t of evo.intent.transitions) {
      expect(t.previous).toEqual(expect.objectContaining({ score: expect.any(Number), band: expect.any(String) }));
      expect(t.current).toEqual(expect.objectContaining({ score: expect.any(Number), band: expect.any(String) }));
      expect(t.triggeringEvidence.length).toBeGreaterThan(0);
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.reasoning.length).toBeGreaterThan(0);
      expect(['growth', 'decay', 'flat']).toContain(t.direction);
      expect(t.current.score - t.previous.score).toBe(t.delta);
    }
  });

  it('tracks peak, current and decay from peak', () => {
    // Busy first week, then a month of silence: recency points age out.
    const evo = evolutionOf(GROWING.sessions, GROWING.events, T0 + 40 * DAY);
    expect(evo.intent.peakScore).toBeGreaterThanOrEqual(evo.intent.currentScore);
    expect(evo.intent.decayFromPeak).toBe(evo.intent.peakScore - evo.intent.currentScore);
    expect(evo.intent.peakAt).not.toBeNull();
  });

  it('detects decay after a long silence, with evidence naming the cause', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, T0 + 40 * DAY);
    expect(['decaying', 'dormant']).toContain(evo.intent.trend);
    const decayTransition = evo.intent.transitions.find((t) => t.direction === 'decay');
    expect(decayTransition?.triggeringEvidence.join(' ')).toContain('aged out');
  });

  it('reports dormancy past the configured threshold', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, T0 + 200 * DAY);
    expect(evo.intent.trend).toBe('dormant');
  });

  it('detects acceleration when the latest gain exceeds its own history', () => {
    const sessions = [session('vs-1', T0), session('vs-2', T0 + DAY), session('vs-3', T0 + 2 * DAY)];
    const events = [
      evt('e1', 'page_view', T0 + 1000, 'https://x.com/blog/a', 'vs-1'),
      evt('e2', 'page_view', T0 + DAY + 1000, 'https://x.com/blog/b', 'vs-2'),
      // A burst of high-value pages in the final session.
      evt('e3', 'page_view', T0 + 2 * DAY + 1000, 'https://x.com/pricing', 'vs-3'),
      evt('e4', 'page_view', T0 + 2 * DAY + 2000, 'https://x.com/demo', 'vs-3'),
      evt('e5', 'page_view', T0 + 2 * DAY + 3000, 'https://x.com/enterprise', 'vs-3'),
    ];
    const evo = evolutionOf(sessions, events, T0 + 2 * DAY + 7200_000);
    expect(evo.intent.trend).toBe('accelerating');
  });

  it('reports persistence and a growth rate per day', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.intent.persistenceDays).toBeGreaterThan(0);
    expect(evo.intent.growthRatePerDay).not.toBeNull();
  });

  it('a single-session lead has no transitions but still explains itself', () => {
    const evo = evolutionOf([session('vs-1', T0)], [evt('e1', 'page_view', T0 + 1000, 'https://x.com/pricing', 'vs-1')], T0 + 3600_000);
    // Nothing moved, so there is nothing to report as a change — but the
    // reading still explains itself rather than returning a bare number.
    expect(evo.intent.transitions).toEqual([]);
    expect(evo.intent.trend).toBe('stable');
    expect(evo.intent.reasoning).toContain('intent');
    expect(evo.intent.confidence).toBeGreaterThan(0);
  });

  it('an empty snapshot degrades cleanly', () => {
    const evo = evolutionOf([], [], T0);
    expect(evo.intent.trend).toBe('unknown');
    expect(evo.intent.checkpoints).toEqual([]);
    expect(evo.intent.reasoning).toContain('No captured activity');
    expect(evo.funnel.stage).toBe('unaware');
    expect(evo.journey.state).toBe('new');
  });

  it('confidence rises with the number of observation points', () => {
    const one = evolutionOf([session('vs-1', T0)], [evt('e1', 'page_view', T0 + 1000, 'https://x.com/pricing', 'vs-1')], T0 + 3600_000);
    const many = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(many.intent.confidence).toBeGreaterThan(one.intent.confidence);
  });
});

// ── 3. Funnel progression ───────────────────────────────────────────────────

describe('M3 (3) — funnel progression', () => {
  it('places a lead at the deepest stage its evidence supports', () => {
    const snap = assemble(GROWING.sessions, GROWING.events, GROWING.now);
    const { stage, evidence } = funnelStageOf(snap, analyzeBehavior(snap, defaultEngineConfig), defaultEngineConfig);
    expect(stage).toBe('decision'); // demo page viewed
    expect(evidence.length).toBeGreaterThan(0);
  });

  it('records advancement transitions with evidence and reasoning', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.funnel.advancementCount).toBeGreaterThan(0);
    for (const t of evo.funnel.transitions) {
      expect(FUNNEL_STAGES).toContain(t.from);
      expect(FUNNEL_STAGES).toContain(t.to);
      expect(['advance', 'regress']).toContain(t.direction);
      expect(t.evidence.length).toBeGreaterThan(0);
      expect(t.reasoning.length).toBeGreaterThan(0);
      expect(t.confidence).toBeGreaterThan(0);
    }
    // Advancement order is strictly deepening.
    const advances = evo.funnel.transitions.filter((t) => t.direction === 'advance');
    for (const a of advances) expect(FUNNEL_STAGES.indexOf(a.to)).toBeGreaterThan(FUNNEL_STAGES.indexOf(a.from));
  });

  it('keeps the furthest stage reached even if later reads are shallower', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.funnel.furthestStage).toBe('decision');
    expect(FUNNEL_STAGES.indexOf(evo.funnel.furthestStage)).toBeGreaterThanOrEqual(FUNNEL_STAGES.indexOf(evo.funnel.stage));
  });

  it('exposes a full funnel history aligned to the checkpoints', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.funnel.history.length).toBe(evo.intent.checkpoints.length);
    expect(evo.funnel.history.map((h) => h.at)).toEqual(evo.intent.checkpoints.map((c) => c.at));
    // Stages never go backwards for a purely additive event history.
    const depths = evo.funnel.history.map((h) => FUNNEL_STAGES.indexOf(h.stage));
    for (let i = 1; i < depths.length; i += 1) expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
    expect(evo.funnel.regressed).toBe(false);
  });

  it('reports progress confidence and reasoning', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.funnel.confidence).toBeGreaterThan(0);
    expect(evo.funnel.reasoning).toContain('advancement');
  });
});

// ── 4. Journey evolution ────────────────────────────────────────────────────

describe('M3 (4) — journey evolution', () => {
  it('derives ordered, deduplicated milestones', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now, T0 + 3 * DAY + 60_000);
    const keys = evo.journey.milestones.map((m) => m.key);
    expect(keys).toContain('first_visit');
    expect(keys).toContain('first_pricing');
    expect(keys).toContain('first_demo');
    expect(keys).toContain('lead_submitted');
    expect(new Set(keys).size).toBe(keys.length); // each milestone once
    const times = evo.journey.milestones.map((m) => Date.parse(m.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const m of evo.journey.milestones) expect(m.evidence.length).toBeGreaterThan(0);
  });

  it('reports an active journey while engagement continues', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(['active', 'accelerating']).toContain(evo.journey.state);
  });

  it('detects stagnation and then dormancy as silence lengthens', () => {
    expect(evolutionOf(GROWING.sessions, GROWING.events, T0 + 20 * DAY).journey.state).toBe('stagnant');
    expect(evolutionOf(GROWING.sessions, GROWING.events, T0 + 120 * DAY).journey.state).toBe('dormant');
  });

  it('measures acceleration from the visitor’s own return cadence', () => {
    const fast = [session('vs-1', T0), session('vs-2', T0 + 10 * DAY), session('vs-3', T0 + 11 * DAY)];
    const evo = evolutionOf(fast, [evt('e1', 'page_view', T0 + 1000, 'https://x.com/pricing', 'vs-1')], T0 + 11 * DAY + 3600_000);
    expect(evo.journey.acceleration).not.toBeNull();
    expect(evo.journey.acceleration!).toBeGreaterThan(1); // returning faster
  });

  it('reports journey confidence and reasoning', () => {
    const evo = evolutionOf(GROWING.sessions, GROWING.events, GROWING.now);
    expect(evo.journey.confidence).toBeGreaterThan(0);
    expect(evo.journey.reasoning).toContain('milestone');
  });
});

// ── 5. Qualification + recommendation evolution ─────────────────────────────

describe('M3 (5) — qualification extensions', () => {
  const inputs = () => {
    const snapshot = assemble(GROWING.sessions, GROWING.events, GROWING.now);
    const behavior = analyzeBehavior(snapshot, defaultEngineConfig);
    const intent = computeIntentIntelligence(snapshot, defaultEngineConfig, behavior);
    const persona = classifyPersona(snapshot, defaultEngineConfig, behavior);
    const evolution = buildEvolutionIntelligence(snapshot, defaultEngineConfig, behavior);
    return { snapshot, behavior, intent, persona, evolution };
  };

  it('adds evolution evidence WITHOUT changing any score (no duplicate scoring)', () => {
    const { snapshot, behavior, intent, persona, evolution } = inputs();
    const without = buildQualification({ snapshot, intent, persona }, defaultEngineConfig, behavior);
    const withEvo = buildQualification({ snapshot, intent, persona, evolution }, defaultEngineConfig, behavior);

    expect(withEvo.totalScore).toBe(without.totalScore);
    expect(withEvo.band).toBe(without.band);
    expect(withEvo.sections.map((s) => s.score)).toEqual(without.sections.map((s) => s.score));
    expect(withEvo.sections.map((s) => s.weightedScore)).toEqual(without.sections.map((s) => s.weightedScore));
    // ...but the reasoning is richer.
    const behaviourReason = withEvo.sections.find((s) => s.key === 'behavior')!.reason;
    expect(behaviourReason).toContain('funnel stage');
    expect(behaviourReason).toContain('observed across');
  });

  it('surfaces intent trend in urgency reasoning', () => {
    const { snapshot, behavior, intent, persona } = inputs();
    const stale = buildEvolutionIntelligence(assemble(GROWING.sessions, GROWING.events, T0 + 200 * DAY));
    const q = buildQualification({ snapshot, intent, persona, evolution: stale }, defaultEngineConfig, behavior);
    expect(q.sections.find((s) => s.key === 'urgency')!.reason).toContain('dormant');
  });

  it('keeps the section count and reproducible total', () => {
    const { snapshot, behavior, intent, persona, evolution } = inputs();
    const q = buildQualification({ snapshot, intent, persona, evolution }, defaultEngineConfig, behavior);
    expect(q.sections).toHaveLength(5);
    expect(q.totalScore).toBe(Math.min(100, Math.max(0, Math.round(q.sections.reduce((a, s) => a + s.weightedScore, 0)))));
  });
});

describe('M3 (6) — recommendation evolution', () => {
  const recsFor = (nowMs: number) => {
    const snapshot = assemble(GROWING.sessions, GROWING.events, nowMs);
    const behavior = analyzeBehavior(snapshot, defaultEngineConfig);
    const intent = computeIntentIntelligence(snapshot, defaultEngineConfig, behavior);
    const persona = classifyPersona(snapshot, defaultEngineConfig, behavior);
    const evolution = buildEvolutionIntelligence(snapshot, defaultEngineConfig, behavior);
    const qualification = buildQualification({ snapshot, intent, persona, evolution }, defaultEngineConfig, behavior);
    return buildRecommendations({ snapshot, intent, persona, qualification, segments: [], evolution }, defaultEngineConfig, behavior);
  };

  it('changes the next best action when the lead goes dormant', () => {
    const active = recsFor(GROWING.now).nextBestAction;
    const dormant = recsFor(T0 + 200 * DAY).nextBestAction;
    expect(dormant.value).not.toBe(active.value);
    expect(dormant.value).toContain('Re-engagement');
    expect(dormant.explanation).toContain('Dormant');
  });

  it('reports risk indicators traced to evidence', () => {
    const dormant = recsFor(T0 + 200 * DAY).riskIndicators;
    expect(dormant.value.join(' ')).toContain('dormant');
    expect(dormant.explanation).toContain('Derived from');
    const healthy = recsFor(GROWING.now).riskIndicators;
    expect(healthy.value.length).toBeGreaterThan(0);
    expect(healthy.explanation.length).toBeGreaterThan(0);
  });

  it('reports opportunity maturity from funnel depth and direction', () => {
    const m = recsFor(GROWING.now).opportunityMaturity;
    expect(m.value).toContain('Late stage');
    expect(m.explanation).toContain('furthest reached');
    expect(m.confidence).toBeGreaterThan(0);
  });

  it('evolves recommended owner with funnel depth', () => {
    const owner = recsFor(GROWING.now).recommendedOwner;
    expect(owner.explanation).toMatch(/decision|currently/);
    const dormantOwner = recsFor(T0 + 200 * DAY).recommendedOwner;
    expect(dormantOwner.value).toContain('nurture');
  });

  it('evolves recommended timing with momentum', () => {
    const timing = recsFor(GROWING.now).bestContactTime;
    expect(timing.explanation).toMatch(/Contact within|intent trend/);
  });

  it('every recommendation — new ones included — stays fully explainable', () => {
    const recs = recsFor(GROWING.now) as unknown as Record<string, { explanation: string; confidence: number }>;
    for (const { key } of LEAD_RECOMMENDATION_KEYS) {
      expect(recs[key]).toBeDefined();
      expect(recs[key].explanation.length).toBeGreaterThan(0);
      expect(recs[key].confidence).toBeGreaterThan(0);
    }
  });
});

// ── 6. Timeline + envelope + compatibility ──────────────────────────────────

describe('M3 (7) — timeline extensions', () => {
  const built = () => {
    const snapshot = assemble(GROWING.sessions, GROWING.events, GROWING.now, T0 + 3 * DAY + 60_000);
    const evolution = buildEvolutionIntelligence(snapshot);
    return { snapshot, evolution, timeline: buildLeadTimeline(snapshot, { evolution }, defaultEngineConfig) };
  };

  it('projects journey milestones, funnel transitions and intent shifts', () => {
    const { timeline } = built();
    const types = new Set(timeline.map((t) => t.type));
    expect(types.has('journey_milestone')).toBe(true);
    expect(types.has('funnel_transition')).toBe(true);
    expect(timeline.some((t) => t.label.startsWith('Advanced to '))).toBe(true);
  });

  it('does not duplicate the entries it derives from', () => {
    const { timeline } = built();
    const keys = timeline.map((t) => `${t.type}|${t.label}|${t.occurredAt}`);
    expect(new Set(keys).size).toBe(keys.length);
    // first_visit / lead_submitted are already represented by tracking+capture.
    expect(timeline.filter((t) => t.type === 'journey_milestone' && t.label === 'First visit')).toHaveLength(0);
    expect(timeline.filter((t) => t.label === 'Lead Submitted')).toHaveLength(1);
  });

  it('keeps deterministic chronological ordering', () => {
    const { timeline } = built();
    const times = timeline.map((t) => Date.parse(t.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(JSON.stringify(built().timeline)).toBe(JSON.stringify(built().timeline));
  });

  it('omitting evolution yields exactly the pre-M3 timeline', () => {
    const { snapshot } = built();
    const withoutEvo = buildLeadTimeline(snapshot, {}, defaultEngineConfig);
    expect(withoutEvo.every((t) => !['journey_milestone', 'funnel_transition', 'intent_shift'].includes(t.type))).toBe(true);
  });
});

describe('M3 — envelope, explainability, regression, compatibility', () => {
  it('the summary carries evolution and stays deterministic', () => {
    const a = buildLeadIntelligenceSummary(assemble(GROWING.sessions, GROWING.events, GROWING.now));
    const b = buildLeadIntelligenceSummary(assemble(GROWING.sessions, GROWING.events, GROWING.now));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.evolution.intent.checkpoints.length).toBeGreaterThan(0);
    expect(a.evolution.funnel.stage).toBe('decision');
    expect(a.evolution.journey.milestones.length).toBeGreaterThan(0);
  });

  it('every evolution object exposes confidence AND reasoning', () => {
    const s = buildLeadIntelligenceSummary(assemble(GROWING.sessions, GROWING.events, GROWING.now));
    for (const part of [s.evolution.intent, s.evolution.funnel, s.evolution.journey]) {
      expect(part.confidence).toBeGreaterThan(0);
      expect(part.reasoning.length).toBeGreaterThan(0);
    }
    // No opaque scoring: every transition names what caused it.
    for (const t of s.evolution.intent.transitions) expect(t.triggeringEvidence.length).toBeGreaterThan(0);
    for (const t of s.evolution.funnel.transitions) expect(t.evidence.length).toBeGreaterThan(0);
  });

  it('the engine version moved so existing records regenerate with evolution', () => {
    expect(ENGINE_VERSION).toBe('lie-2.1.0');
    // Shape is still schema 2 — additive fields only, old readers unaffected.
    expect(INTELLIGENCE_SCHEMA_VERSION).toBe(2);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2]);
  });

  it('pre-M3 intelligence is unchanged: same intent, persona and qualification', () => {
    const snapshot = assemble(GROWING.sessions, GROWING.events, GROWING.now);
    const behavior = analyzeBehavior(snapshot, defaultEngineConfig);
    const summary = buildLeadIntelligenceSummary(snapshot);
    expect(summary.intent).toEqual(computeIntentIntelligence(snapshot, defaultEngineConfig, behavior));
    expect(summary.persona).toEqual(classifyPersona(snapshot, defaultEngineConfig, behavior));
    expect(summary.qualification.sections).toHaveLength(5);
  });

  it('a lead with no sessions or events still produces a complete envelope', () => {
    const empty = buildLeadIntelligenceSummary(assemble([], [], T0));
    expect(empty.evolution.intent.trend).toBe('unknown');
    expect(empty.evolution.funnel.stage).toBe('unaware');
    expect(empty.recommendations.riskIndicators.value.length).toBeGreaterThan(0);
    expect(empty.recommendations.opportunityMaturity.value).toBeTruthy();
    expect(JSON.stringify(empty)).not.toContain('undefined');
  });

  it('recommendations still work when evolution is not supplied (pre-M3 callers)', () => {
    const snapshot = assemble(GROWING.sessions, GROWING.events, GROWING.now);
    const behavior = analyzeBehavior(snapshot, defaultEngineConfig);
    const intent = computeIntentIntelligence(snapshot, defaultEngineConfig, behavior);
    const persona = classifyPersona(snapshot, defaultEngineConfig, behavior);
    const qualification = buildQualification({ snapshot, intent, persona }, defaultEngineConfig, behavior);
    const recs = buildRecommendations({ snapshot, intent, persona, qualification, segments: [] }, defaultEngineConfig, behavior);
    expect(recs.riskIndicators.value).toEqual(['No elevated risk detected']);
    expect(recs.opportunityMaturity.value).toBe('Unknown');
    expect(recs.nextBestAction.explanation.length).toBeGreaterThan(0);
  });
});
