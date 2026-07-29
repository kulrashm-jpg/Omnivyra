/**
 * QUALIFICATION-INTELLIGENCE-PROGRAM-008 / Phase C — Qualification Intelligence Enrichment tests + falsification.
 * Deterministic. Proves the enrichment engines are evidence-first CONTRIBUTORS that ANALYZE the Phase-B
 * evaluation (builder stays sole owner): criteria/evidence/confidence/policy/context/evaluation emit
 * contributions + valid reasoning across the 3 qualification dims and ABSTAIN without evidence; scoring
 * activates; policy remains immutable (never modified); abstention deterministic. Falsification:
 * ownership, determinism, graph references-only, platform compatibility. Programs 1–7 + Phase B run in
 * regression.
 */

import {
  assembleQualificationIntelligence, runCriteria, runEvidence, runConfidence, runPolicy, runContext, runEvaluation,
  qualificationHealthSummary, type QualificationIntelligenceContext, type QualificationPolicy,
} from '../../services/qualificationIntelligence';
import { validateReasoning } from '../../services/intelligence/canonical';
import { openIntelligencePlatform } from '../../services/intelligencePlatform';
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

const CTX: QualificationIntelligenceContext = {
  key: { companyId: 'C1', qualificationId: 'q-1' }, asOf: ASOF,
  raw: {
    companyId: 'C1', asOf: ASOF, source: 'crm', qualificationId: 'q-1', actorRef: 'L1', actorType: 'lead', objectRef: 'widget', objectType: 'offering', policy: POLICY,
    observations: [
      { criterionId: 'budget', outcome: 'satisfied', observedAt: '2026-07-20T00:00:00.000Z' },
      { criterionId: 'authority', outcome: 'satisfied', observedAt: '2026-07-22T00:00:00.000Z' },
      { criterionId: 'need', outcome: 'unsatisfied', observedAt: '2026-07-24T00:00:00.000Z' },
      { criterionId: 'timing', outcome: 'satisfied', observedAt: '2026-07-23T00:00:00.000Z' },
    ],
  },
  upstream: { visitorRef: 'v-1', intentRef: 'int-1', offeringRef: 'widget' },
};

describe('Q-C301..306 enrichment engines (contributors; policy-backed; valid reasoning)', () => {
  it('each engine emits contributions/reasoning; grounded; across the 3 qualification dimensions', () => {
    const outs = [runCriteria(CTX), runEvidence(CTX), runConfidence(CTX), runPolicy(CTX), runContext(CTX), runEvaluation(CTX)];
    expect(outs.every((o) => !o.abstained)).toBe(true);
    expect(outs.flatMap((o) => o.reasoning).every((t) => validateReasoning(t).valid)).toBe(true);
    const dims = new Set(outs.flatMap((o) => o.contributions).map((c) => c.dimension));
    expect([...dims].sort()).toEqual(['completeness', 'fit', 'readiness']);
  });
  it('engines ABSTAIN when their evidence is absent', () => {
    const bare: QualificationIntelligenceContext = { key: { companyId: 'C1', qualificationId: 'x' }, asOf: ASOF, raw: { companyId: 'C1', asOf: ASOF, qualificationId: 'x', policy: POLICY, observations: [] } };
    expect(runEvidence(bare).abstained).toBe(true);
    expect(runContext({ key: bare.key, asOf: ASOF }).abstained).toBe(true);
    expect(runConfidence(bare).abstained).toBe(true);   // baseline abstains ⇒ confidence engine abstains
  });
  it('Q-C304 policy engine DESCRIBES policy application; NEVER modifies the policy', () => {
    const before = JSON.stringify(POLICY);
    const policyOut = runPolicy(CTX);
    expect(policyOut.abstained).toBe(false);
    expect(JSON.stringify(POLICY)).toBe(before);        // policy immutable — untouched
    const trace = policyOut.reasoning.find((t) => t.claim === 'policy_application')!;
    expect(trace.assumptions.some((a) => /immutable/.test(a))).toBe(true);
  });
});

describe('Q-C (assembly) — scoring activates; builder sole owner; policy immutable; deterministic', () => {
  it('assembled understanding scores blended; Phase-B state preserved; policy provenance kept', () => {
    const { understanding: u, projection: p, health } = assembleQualificationIntelligence(CTX);
    expect(u.score.overall).not.toBeNull();
    expect(u.score.dimensions.fit.value).not.toBeNull();
    expect(u.facets.state.value?.status).toBe('nurture');        // Phase-B: required 'need' unsatisfied, mandatory ok
    expect(u.facets.policy.value?.policyVersion).toBe(3);        // provenance preserved
    expect(p.unsatisfied).toContain('need');
    expect(u.graph.edges.every((e) => e.from.type === 'qualification')).toBe(true);
    expect(health.status).toBe('nurture');
    expect(assembleQualificationIntelligence(CTX).understanding).toEqual(u);   // deterministic
  });
});

describe('Q-C307 health summary + Q-C308 explainability (descriptive; valid)', () => {
  it('health summary combines dims descriptively; every trace valid', () => {
    const { understanding: u, health } = assembleQualificationIntelligence(CTX);
    expect(health.satisfiedCount).toBe(3);
    expect(health.unsatisfiedCount).toBe(1);
    expect(health.fit).not.toBeNull();
    expect(u.reasoning.every((t) => validateReasoning(t).valid)).toBe(true);
    expect(qualificationHealthSummary(u)).toEqual(health);                     // pure
  });
});

describe('Falsification — ownership / graph references-only / platform compatibility', () => {
  it('graph unchanged & references-only (engines add NO edges); qualification owns only its root', () => {
    const { understanding: u } = assembleQualificationIntelligence(CTX);
    expect(u.graph.root).toEqual({ type: 'qualification', id: 'q-1' });
    expect(u.graph.edges.every((e) => e.from.type === 'qualification')).toBe(true);
    expect(u.graph.edges.some((e) => e.to.type === 'qualification')).toBe(false);
  });
  it('Q-C309 enriched qualification integrates via the UNMODIFIED platform (first-class citizen)', () => {
    const { understanding: qual } = assembleQualificationIntelligence(CTX);
    const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
    const s = openIntelligencePlatform([qual, lead], ASOF, { focusKey: 'qualification:q-1', depth: 2 });
    expect(s.context().entities.map((e) => e.type)).toContain('qualification');
    expect(s.traverse('qualification:q-1', 'lead:L1')).toEqual(['qualification:q-1', 'lead:L1']);
  });
});
