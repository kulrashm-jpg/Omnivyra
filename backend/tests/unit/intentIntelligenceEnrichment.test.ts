/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase C — Intent Intelligence Enrichment tests + falsification.
 * Deterministic. Proves the enrichment engines are evidence-first CONTRIBUTORS that ANALYZE the Phase-B
 * interpretation (builder stays sole owner): objective/evidence/confidence/conflict/context/
 * interpretation emit contributions + valid reasoning across the 4 intent dims and ABSTAIN without
 * evidence; scoring activates; competing intents preserved; abstention deterministic. Falsification:
 * ownership, determinism, graph references-only, platform compatibility. Programs 1–6 + Phase B run in
 * regression.
 */

import {
  assembleIntentIntelligence, runObjective, runEvidence, runConfidence, runConflict, runContext, runInterpretation,
  intentHealthSummary, type IntentIntelligenceContext,
} from '../../services/intentIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

// evaluation strongest & fresh; comparison close behind (competing/ambiguous); research old.
const CTX: IntentIntelligenceContext = {
  key: { companyId: 'C1', intentId: 'int-1001' }, asOf: ASOF,
  raw: {
    companyId: 'C1', asOf: ASOF, source: 'web_analytics', intentId: 'INT-1001', actorRef: 'v-1001', actorType: 'visitor', objectRef: 'widget', objectType: 'offering',
    signals: [
      { objective: 'research', observedAt: '2026-05-01T00:00:00.000Z', weight: 0.6 },
      { objective: 'evaluation', observedAt: '2026-07-20T00:00:00.000Z', weight: 0.9 },
      { objective: 'evaluation', observedAt: '2026-07-24T00:00:00.000Z', weight: 0.8 },
      { objective: 'comparison', observedAt: '2026-07-22T00:00:00.000Z', weight: 0.8 },
      { objective: 'comparison', observedAt: '2026-07-23T00:00:00.000Z', weight: 0.85 },
    ],
  },
  upstream: { visitorRef: 'v-1001', journeyRef: 'j-1001', offeringRef: 'widget' },
};

describe('I-C301..306 enrichment engines (contributors; evidence-first; valid reasoning)', () => {
  it('each engine emits contributions/reasoning; grounded; across the 4 intent dimensions', () => {
    const outs = [runObjective(CTX), runEvidence(CTX), runConfidence(CTX), runConflict(CTX), runContext(CTX), runInterpretation(CTX)];
    expect(outs.every((o) => !o.abstained)).toBe(true);
    expect(outs.flatMap((o) => o.reasoning).every((t) => validateReasoning(t).valid)).toBe(true);
    const dims = new Set(outs.flatMap((o) => o.contributions).map((c) => c.dimension));
    expect([...dims].sort()).toEqual(['breadth', 'clarity', 'recency', 'strength']);
  });
  it('engines ABSTAIN when their evidence is absent (no signals ⇒ nothing to analyze)', () => {
    const bare: IntentIntelligenceContext = { key: { companyId: 'C1', intentId: 'x' }, asOf: ASOF, raw: { companyId: 'C1', asOf: ASOF, intentId: 'x', signals: [] } };
    expect(runObjective(bare).abstained).toBe(true);
    expect(runEvidence(bare).abstained).toBe(true);
    expect(runConflict(bare).abstained).toBe(true);
  });
  it('I-C304 conflict engine DESCRIBES competing objectives (never resolves)', () => {
    const conflict = runConflict(CTX);
    expect(conflict.abstained).toBe(false);
    const trace = conflict.reasoning.find((t) => t.claim === 'interpretation_conflict')!;
    expect(['unresolved', 'resolved_lean']).toContain(trace.conclusion);
  });
});

describe('I-C (assembly) — scoring activates; builder sole owner; competing preserved; deterministic', () => {
  it('assembled understanding scores blended; primary + competing preserved from Phase B', () => {
    const { understanding: u, projection: p, health } = assembleIntentIntelligence(CTX);
    expect(u.score.overall).not.toBeNull();
    expect(u.score.dimensions.strength.value).not.toBeNull();
    expect(u.facets.primaryIntent.value?.objective).toBe('evaluation');   // Phase-B interpretation preserved
    expect(p.competingObjectives).toContain('comparison');                // competing preserved
    expect(u.graph.edges.every((e) => e.from.type === 'intent')).toBe(true);  // references-only preserved
    expect(health.primaryObjective).toBe('evaluation');
    expect(assembleIntentIntelligence(CTX).understanding).toEqual(u);     // deterministic
  });
});

describe('I-C307 health summary + I-C308 explainability (descriptive; valid)', () => {
  it('health summary combines dims descriptively; every trace valid', () => {
    const { understanding: u, health } = assembleIntentIntelligence(CTX);
    expect(health.competingObjectives.length).toBeGreaterThan(0);
    expect(health.strength).not.toBeNull();
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(intentHealthSummary(u)).toEqual(health);                        // pure
  });
});

describe('Falsification — ownership / graph references-only / platform compatibility', () => {
  it('graph unchanged & references-only (engines add NO edges); intent owns only its root', () => {
    const { understanding: u } = assembleIntentIntelligence(CTX);
    expect(u.graph.root).toEqual({ type: 'intent', id: 'int-1001' });
    expect(u.graph.edges.every((e) => e.from.type === 'intent')).toBe(true);
    expect(u.graph.edges.some((e) => e.to.type === 'intent')).toBe(false);
  });
  it('I-C309 enriched intent integrates via the UNMODIFIED platform (first-class citizen)', () => {
    const { understanding: intent } = assembleIntentIntelligence(CTX);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
    const s = openIntelligencePlatform([intent, lead], ASOF, { focusKey: 'intent:int-1001', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('intent');
    expect(s.traverse('intent:int-1001', 'visitor:v-1001')).toEqual(['intent:int-1001', 'visitor:v-1001']);
  });
});
