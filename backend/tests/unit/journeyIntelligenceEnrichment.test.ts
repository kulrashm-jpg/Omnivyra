/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase C — Journey Intelligence Enrichment tests + falsification.
 * Deterministic. Proves the enrichment engines are evidence-first CONTRIBUTORS (builder stays sole
 * owner): progression/momentum/continuity/completion/milestone/transition emit contributions + valid
 * reasoning across the 4 journey dims and ABSTAIN without evidence; scoring activates; the health
 * summary is descriptive (no prediction/recommendation). Falsification: ownership, chronology,
 * determinism, graph references-only, platform compatibility. Programs 1–5 + Phase B run in regression.
 */

import {
  assembleJourneyIntelligence, runProgression, runMomentum, runContinuity, runCompletion, runMilestone, runTransition,
  journeyHealthSummary, type JourneyIntelligenceContext,
} from '../../services/journeyIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

// Touchpoints intentionally out of order — chronology must be derived from observedAt.
const CTX: JourneyIntelligenceContext = {
  key: { companyId: 'C1', journeyId: 'j-1001' }, asOf: ASOF,
  raw: {
    companyId: 'C1', asOf: ASOF, source: 'web_analytics', journeyId: 'J-1001', actorRef: 'v-1001', actorType: 'visitor', companyRef: 'C1', status: 'active',
    pendingStages: ['purchase'],
    touchpoints: [
      { entityType: 'offering', entityId: 'widget', observedAt: '2026-07-20T00:00:00.000Z', stage: 'decide', milestone: 'demo_requested' },
      { entityType: 'content', entityId: 'landing', observedAt: '2026-06-01T00:00:00.000Z', stage: 'aware' },
      { entityType: 'offering', entityId: 'widget', observedAt: '2026-07-01T00:00:00.000Z', stage: 'evaluate', milestone: 'pricing_viewed' },
      { entityType: 'content', entityId: 'whitepaper', observedAt: '2026-06-10T00:00:00.000Z', stage: 'aware' },
    ],
  },
};

describe('J-C301..306 enrichment engines (contributors; evidence-first; valid reasoning)', () => {
  it('each engine emits contributions + grounded reasoning across the 4 journey dimensions', () => {
    const outs = [runProgression(CTX), runMomentum(CTX), runContinuity(CTX), runCompletion(CTX), runMilestone(CTX), runTransition(CTX)];
    expect(outs.every((o) => !o.abstained)).toBe(true);
    expect(outs.flatMap((o) => o.reasoning).every((t) => validateReasoning(t).valid)).toBe(true);
    const dims = new Set(outs.flatMap((o) => o.contributions).map((c) => c.dimension));
    expect([...dims].sort()).toEqual(['completion', 'continuity', 'momentum', 'progression']);
  });
  it('engines ABSTAIN when their evidence is absent', () => {
    const bare: JourneyIntelligenceContext = { key: { companyId: 'C1', journeyId: 'x' }, asOf: ASOF, raw: { companyId: 'C1', asOf: ASOF, journeyId: 'x' } };
    expect(runProgression(bare).abstained).toBe(true);
    expect(runMilestone(bare).abstained).toBe(true);
    expect(runTransition(bare).abstained).toBe(true);
  });
});

describe('J-C (assembly) — scoring activates; builder sole owner; deterministic; chronology correct', () => {
  it('assembled understanding has non-abstaining scores; ordering derives from chronology', () => {
    const { understanding: u, projection: p, health } = assembleJourneyIntelligence(CTX);
    expect(u.score.overall).not.toBeNull();                         // contributors activate scoring
    expect(u.score.dimensions.progression.value).not.toBeNull();
    expect(u.score.dimensions.momentum.value).not.toBeNull();
    const times = u.facets.touchpoints.value!.ordered!.map((t) => t.at);
    expect(times).toEqual([...times].sort());                       // chronological despite out-of-order input
    expect(u.facets.stages.value!.current).toBe('decide');
    expect(p.overallScore).toBe(u.score.overall);
    expect(health.currentStage).toBe('decide');
    expect(assembleJourneyIntelligence(CTX).understanding).toEqual(u); // deterministic
  });
});

describe('J-C307 health summary (descriptive, no prediction) + J-C308 explainability', () => {
  it('health summary combines dimensions descriptively; every trace valid', () => {
    const { understanding: u, health } = assembleJourneyIntelligence(CTX);
    expect(health.milestoneCount).toBe(2);
    expect(health.transitionCount).toBe(2);
    expect(health.progression).not.toBeNull();
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(journeyHealthSummary(u)).toEqual(health);                // pure
  });
});

describe('Falsification — ownership / graph references-only / platform compatibility', () => {
  it('graph unchanged & references-only (engines add NO edges); journey owns only its root', () => {
    const { understanding: u } = assembleJourneyIntelligence(CTX);
    expect(u.graph.root).toEqual({ type: 'journey', id: 'j-1001' });
    expect(u.graph.edges.every((e) => e.from.type === 'journey')).toBe(true);
    expect(u.graph.edges.some((e) => e.type === 'transitioned_to')).toBe(false); // order stays in facets
  });
  it('J-C309 enriched journey integrates via the UNMODIFIED platform (first-class citizen)', () => {
    const { understanding: journey } = assembleJourneyIntelligence(CTX);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
    const s = openIntelligencePlatform([journey, lead], ASOF, { focusKey: 'journey:j-1001', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('journey');
    expect(s.traverse('journey:j-1001', 'visitor:v-1001')).toEqual(['journey:j-1001', 'visitor:v-1001']);
  });
});
