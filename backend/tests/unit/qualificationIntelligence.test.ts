/**
 * QUALIFICATION-INTELLIGENCE-PROGRAM-008 / Phase B — canonical Qualification Understanding tests + falsification.
 * Deterministic. Proves Qualification is the 7th canonical Understanding (builder/projection/persistence/
 * graph/shadow/explainability), OWNS ONLY evaluation semantics, treats POLICY as versioned typed INPUT,
 * EVALUATES deterministically (state + satisfied/unsatisfied/unknown), ABSTAINS when unevaluable,
 * PUBLISHES references-only edges (NO reasoning/policy edges), and INTEGRATES NATIVELY through the
 * UNMODIFIED Programs 1–7 graph + cross-entity + platform APIs. Programs 1–7 run in regression.
 */

import {
  assembleQualificationUnderstanding, buildQualificationUnderstanding, qualificationFromPolicy, resolveQualificationId,
  computeQualificationUnderstandingShadow, isQualificationUnderstandingEnabled, explainQualificationAll,
  toShadowRecord, toLegacyFields, type QualificationEvaluationInput, type QualificationPolicy,
} from '../../services/qualificationIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform, type CanonicalEntityUnderstanding } from '../../services/intelligencePlatform';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

const POLICY: QualificationPolicy = {
  policyId: 'icp-v1', policyVersion: 3,
  criteria: [
    { id: 'budget', kind: 'mandatory' },
    { id: 'authority', kind: 'required' },
    { id: 'need', kind: 'required' },
    { id: 'timing', kind: 'optional' },
  ],
};

function input(id: string, obs: QualificationEvaluationInput['observations']): QualificationEvaluationInput {
  return { companyId: 'C1', asOf: ASOF, source: 'crm', qualificationId: id, actorRef: 'L1', actorType: 'lead', objectRef: 'widget', objectType: 'offering', policy: POLICY, observations: obs };
}

describe('Q-B201/B202/B204 canonical Qualification Understanding (7th entity; deterministic evaluation)', () => {
  it('evaluates QUALIFIED when all mandatory + required criteria satisfied; score abstains (foundation)', () => {
    const { understanding: u, projection: p } = assembleQualificationUnderstanding(input('q-1', [
      { criterionId: 'budget', outcome: 'satisfied', observedAt: '2026-07-20T00:00:00.000Z' },
      { criterionId: 'authority', outcome: 'satisfied', observedAt: '2026-07-21T00:00:00.000Z' },
      { criterionId: 'need', outcome: 'satisfied', observedAt: '2026-07-22T00:00:00.000Z' },
    ]));
    expect(u.key).toEqual({ companyId: 'C1', qualificationId: 'q-1' });
    expect(u.facets.state.value?.status).toBe('qualified');
    expect(u.facets.evaluation.value?.satisfied).toEqual(['authority', 'budget', 'need']);   // sorted
    expect(u.score.overall).toBeNull();                                                       // no engines (Phase B)
    expect(p.status).toBe('qualified');
    expect(p.abstained).toBe(false);
  });
  it('evaluates DISQUALIFIED when a mandatory criterion is unsatisfied', () => {
    const { understanding: u } = assembleQualificationUnderstanding(input('q-2', [
      { criterionId: 'budget', outcome: 'unsatisfied', observedAt: ASOF },
      { criterionId: 'authority', outcome: 'satisfied', observedAt: ASOF },
    ]));
    expect(u.facets.state.value?.status).toBe('disqualified');
    expect(u.facets.evaluation.value?.unsatisfied).toContain('budget');
  });
  it('evaluates REVIEW when a required criterion is unknown (mandatory satisfied)', () => {
    const { understanding: u } = assembleQualificationUnderstanding(input('q-3', [
      { criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF },
      { criterionId: 'authority', outcome: 'satisfied', observedAt: ASOF },
      // 'need' (required) unobserved ⇒ unknown
    ]));
    expect(u.facets.state.value?.status).toBe('review');
    expect(u.facets.evaluation.value?.unknown).toContain('need');
  });
});

describe('Q-B203 policy as versioned typed input (provenance recorded; policy owns nothing)', () => {
  it('policy id + version recorded in facet + reasoning provenance; not owned', () => {
    const { understanding: u, projection: p } = assembleQualificationUnderstanding(input('q-1', [
      { criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF },
      { criterionId: 'authority', outcome: 'satisfied', observedAt: ASOF },
      { criterionId: 'need', outcome: 'satisfied', observedAt: ASOF },
    ]));
    expect(u.facets.policy.value).toEqual({ policyId: 'icp-v1', policyVersion: 3, criteriaCount: 4 });
    expect(p.policyVersion).toBe(3);
    const trace = u.reasoning.find((t) => t.claim === 'qualification_state')!;
    expect(trace.assumptions.some((a) => a.includes('icp-v1@v3'))).toBe(true);   // policy provenance in trace
  });
});

describe('Q-B (abstention) — no evaluable criteria ⇒ abstain (null state + unknown, valid reasoning)', () => {
  it('ABSTAINS with null status when all criteria unknown', () => {
    const { understanding: u, projection: p } = assembleQualificationUnderstanding(input('q-empty', []));
    expect(u.facets.state.value?.status).toBeUndefined();
    expect(p.status).toBeNull();
    expect(p.abstained).toBe(true);
    const trace = u.reasoning.find((t) => t.claim === 'qualification_state')!;
    expect(trace.conclusion).toBeNull();
    expect(trace.unknowns).toContain('insufficient_criteria_evidence');
    expect(validateReasoning(trace).valid).toBe(true);
  });
  it('grounded reasoning trace when criteria evaluated', () => {
    const { understanding: u } = assembleQualificationUnderstanding(input('q-1', [{ criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF }, { criterionId: 'authority', outcome: 'satisfied', observedAt: ASOF }, { criterionId: 'need', outcome: 'satisfied', observedAt: ASOF }]));
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
  });
});

describe('Q-B208 graph publication — references-only (qualification owns only its root; NO reasoning/policy edges)', () => {
  it('every edge originates from the qualification node; only qualifies/qualified_for', () => {
    const { understanding: u } = assembleQualificationUnderstanding(input('q-1', [{ criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF }]));
    expect(u.graph.root).toEqual({ type: 'qualification', id: 'q-1' });
    expect(u.graph.edges.every((e) => e.from.type === 'qualification')).toBe(true);
    const rels = u.graph.edges.map((e) => `${e.type}:${e.to.type}`).sort();
    expect(rels).toContain('qualifies:lead');
    expect(rels).toContain('qualified_for:offering');
    expect(u.graph.edges.some((e) => e.to.type === 'qualification')).toBe(false);
  });
});

describe('Q-B209 platform compatibility — consumed by UNMODIFIED Programs 1–7 APIs', () => {
  it('a QualificationUnderstanding flows into openIntelligencePlatform natively (first-class citizen)', () => {
    const { understanding: qual } = assembleQualificationUnderstanding(input('q-1', [{ criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF }]));
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
    const _ok: CanonicalEntityUnderstanding = qual;
    const s = openIntelligencePlatform([qual, lead], ASOF, { focusKey: 'qualification:q-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('qualification');
    expect(s.traverse('qualification:q-1', 'lead:L1')).toEqual(['qualification:q-1', 'lead:L1']);
    void _ok;
  });
});

describe('explainability + persistence + shadow (shared reuse, flag-gated, deterministic)', () => {
  it('explainability + persistence + shadow shapes build; deterministic; ids resolve', () => {
    const inp = input('q-1', [{ criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF }, { criterionId: 'authority', outcome: 'satisfied', observedAt: ASOF }, { criterionId: 'need', outcome: 'satisfied', observedAt: ASOF }]);
    const { understanding: u, projection: p } = assembleQualificationUnderstanding(inp);
    expect(Array.isArray(explainQualificationAll(u))).toBe(true);
    expect(toLegacyFields(u).status).toBe('qualified');
    expect(toShadowRecord(u, p, null).qualification_id).toBe('q-1');
    expect(assembleQualificationUnderstanding(inp).understanding).toEqual(u);   // deterministic
    expect(resolveQualificationId('Q-1')).toBe('q-1');
    expect(buildQualificationUnderstanding({ key: { companyId: 'C1', qualificationId: 'x' }, builtAt: ASOF }).graph.root.type).toBe('qualification');
  });
  it('shadow null when OFF (default), bundle when ON', () => {
    const inp = input('q-1', [{ criterionId: 'budget', outcome: 'satisfied', observedAt: ASOF }]);
    delete process.env.QUALIFICATION_UNDERSTANDING_ENABLED;
    expect(isQualificationUnderstandingEnabled()).toBe(false);
    expect(computeQualificationUnderstandingShadow(inp)).toBeNull();
    process.env.QUALIFICATION_UNDERSTANDING_ENABLED = 'true';
    expect(computeQualificationUnderstandingShadow(inp)?.comparison.parity).toBeGreaterThan(0);
    delete process.env.QUALIFICATION_UNDERSTANDING_ENABLED;
  });
});
