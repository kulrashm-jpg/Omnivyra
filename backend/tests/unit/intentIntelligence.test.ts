/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase B — canonical Intent Understanding tests + falsification.
 * Deterministic. Proves Intent is the 6th canonical Understanding (builder/projection/persistence/
 * graph/shadow/explainability), OWNS ONLY interpretation semantics, INTERPRETS observed evidence
 * deterministically (primary + competing intents), ABSTAINS without evidence, PUBLISHES references-only
 * edges (NO reasoning edges), and INTEGRATES NATIVELY through the UNMODIFIED Programs 1–6 graph +
 * cross-entity + platform APIs. Programs 1–6 run in regression.
 */

import {
  assembleIntentUnderstanding, buildIntentUnderstanding, intentFromEvidence, resolveIntentId,
  computeIntentUnderstandingShadow, isIntentUnderstandingEnabled, explainIntentAll,
  toShadowRecord, toLegacyFields, type IntentEvidenceInput,
} from '../../services/intentIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform, type CanonicalEntityUnderstanding } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

// Evidence supports 'evaluation' strongest, with 'comparison' also well-supported (competing) and 'research' weak/old.
const INPUT: IntentEvidenceInput = {
  companyId: 'C1', asOf: ASOF, source: 'web_analytics', intentId: 'INT-1001', actorRef: 'v-1001', actorType: 'visitor', objectRef: 'widget', objectType: 'offering',
  signals: [
    { objective: 'research', observedAt: '2026-05-01T00:00:00.000Z', weight: 0.6 },          // old ⇒ decayed
    { objective: 'evaluation', observedAt: '2026-07-20T00:00:00.000Z', weight: 0.9 },
    { objective: 'evaluation', observedAt: '2026-07-24T00:00:00.000Z', weight: 0.8 },
    { objective: 'comparison', observedAt: '2026-07-22T00:00:00.000Z', weight: 0.8 },
    { objective: 'comparison', observedAt: '2026-07-23T00:00:00.000Z', weight: 0.7 },
  ],
};

describe('I-B201/B202/B203 canonical Intent Understanding (6th entity; deterministic interpretation)', () => {
  it('interprets primary intent from freshness-weighted evidence; foundation score abstains', () => {
    const { understanding: u, projection: p } = assembleIntentUnderstanding(INPUT);
    expect(u.key).toEqual({ companyId: 'C1', intentId: 'int-1001' });
    expect(u.facets.primaryIntent.value?.objective).toBe('evaluation');   // strongest fresh evidence
    expect(u.score.overall).toBeNull();                                   // no engines yet (Phase B)
    expect(p.primaryObjective).toBe('evaluation');
    expect(p.abstained).toBe(false);
  });
  it('I-B204 competing intents: multiple simultaneously-supported objectives are represented (not chosen)', () => {
    const { understanding: u } = assembleIntentUnderstanding(INPUT);
    const cands = u.facets.competingIntents.value!.candidates!.map((c) => c.objective);
    expect(cands).toContain('evaluation');
    expect(cands).toContain('comparison');
    expect(cands).toContain('research');
    const p = assembleIntentUnderstanding(INPUT).projection;
    expect(p.competingObjectives).toContain('comparison');               // comparison competes with evaluation
    expect(p.competingObjectives).not.toContain('evaluation');           // primary is excluded from competing
  });
  it('I-B205 confidence/uncertainty represented via shared primitives', () => {
    const { understanding: u } = assembleIntentUnderstanding(INPUT);
    const c = u.facets.confidence.value!;
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.uncertainty).toBeCloseTo(1 - c.confidence!, 5);
    expect(c.abstained).toBe(false);
  });
});

describe('I-B206 abstention (no fabricated objective) + valid reasoning', () => {
  it('ABSTAINS with null primary intent + explicit unknown when no evidence', () => {
    const { understanding: u, projection: p } = assembleIntentUnderstanding({ companyId: 'C1', asOf: ASOF, intentId: 'empty', signals: [] });
    expect(u.facets.primaryIntent.value).toBeNull();
    expect(p.abstained).toBe(true);
    expect(p.primaryObjective).toBeNull();
    const trace = u.reasoning.find((t) => t.claim === 'primary_intent')!;
    expect(trace.conclusion).toBeNull();
    expect(trace.unknowns).toContain('insufficient_intent_evidence');
    expect(validateReasoning(trace).valid).toBe(true);                   // valid abstention
  });
  it('grounded reasoning trace when evidence present', () => {
    const { understanding: u } = assembleIntentUnderstanding(INPUT);
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(u.reasoning.find((t) => t.claim === 'primary_intent')?.conclusion).toBe('evaluation');
  });
});

describe('I-B208 graph publication — references-only (intent owns only its root; NO reasoning edges)', () => {
  it('every edge originates from the intent node; only intent_of/intent_toward relationships', () => {
    const { understanding: u } = assembleIntentUnderstanding(INPUT);
    expect(u.graph.root).toEqual({ type: 'intent', id: 'int-1001' });
    expect(u.graph.edges.every((e) => e.from.type === 'intent')).toBe(true);
    const rels = u.graph.edges.map((e) => `${e.type}:${e.to.type}`).sort();
    expect(rels).toContain('intent_of:visitor');
    expect(rels).toContain('intent_toward:offering');
    expect(u.graph.edges.some((e) => e.to.type === 'intent')).toBe(false);
  });
});

describe('I-B209 platform compatibility — consumed by UNMODIFIED Programs 1–6 APIs', () => {
  it('an IntentUnderstanding flows into openIntelligencePlatform natively (first-class citizen)', () => {
    const { understanding: intent } = assembleIntentUnderstanding(INPUT);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
    const _ok: CanonicalEntityUnderstanding = intent;
    const s = openIntelligencePlatform([intent, lead], ASOF, { focusKey: 'intent:int-1001', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('intent');
    expect(s.traverse('intent:int-1001', 'visitor:v-1001')).toEqual(['intent:int-1001', 'visitor:v-1001']);
    void _ok;
  });
});

describe('explainability + persistence + shadow (shared reuse, flag-gated, deterministic)', () => {
  it('explainability reuses shared framework; persistence + shadow shapes build; deterministic', () => {
    const { understanding: u, projection: p } = assembleIntentUnderstanding(INPUT);
    expect(Array.isArray(explainIntentAll(u))).toBe(true);
    expect(toLegacyFields(u).primary_objective).toBe('evaluation');
    expect(toShadowRecord(u, p, null).intent_id).toBe('int-1001');
    expect(assembleIntentUnderstanding(INPUT).understanding).toEqual(u);  // deterministic
    expect(resolveIntentId('INT-1001')).toBe('int-1001');
    expect(buildIntentUnderstanding({ key: { companyId: 'C1', intentId: 'x' }, builtAt: ASOF }).graph.root.type).toBe('intent');
  });
  it('shadow null when OFF (default), bundle when ON', () => {
    delete process.env.INTENT_UNDERSTANDING_ENABLED;
    expect(isIntentUnderstandingEnabled()).toBe(false);
    expect(computeIntentUnderstandingShadow(INPUT)).toBeNull();
    process.env.INTENT_UNDERSTANDING_ENABLED = 'true';
    expect(computeIntentUnderstandingShadow(INPUT)?.comparison.parity).toBeGreaterThan(0);
    delete process.env.INTENT_UNDERSTANDING_ENABLED;
  });
});
