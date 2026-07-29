/**
 * Q-B202..B206 — Qualification ingestion / policy evaluation (pure, deterministic). EVALUATES a
 * versioned, typed, IMMUTABLE policy (declarative criteria) against per-criterion observations, yielding
 * a canonical evaluation: qualification state + rationale + satisfied/unsatisfied/unknown criteria +
 * confidence/uncertainty/abstention + policy provenance, plus references-only graph edges. DESCRIPTIVE
 * only — it evaluates current facts, it does NOT prescribe/recommend/decide/predict. The policy owns
 * nothing; it is input. Chronology derives from evidence (`observedAt`). No evaluable criteria ⇒ abstain
 * (state null + explicit unknown), never a fabricated state.
 */

import type { QualificationFacets, QualificationStatus, QualificationActorType, QualificationPolicy, EvidenceRef } from './types';
import type { GraphEdge, ReasoningTrace } from '../intelligence/canonical';
import { facet, evidenceRef, facetConfidenceFromEvidence, clamp01, reasoningTrace } from '../intelligence/canonical';
import { qualificationEdge } from './graph';

export type CriterionOutcome = 'satisfied' | 'unsatisfied' | 'unknown';
export interface CriterionObservation { criterionId: string; outcome: CriterionOutcome; label?: string; observedAt: string; source?: string; }
export interface QualificationEvaluationInput {
  companyId: string;
  asOf: string;
  source?: string;
  qualificationId: string;
  actorRef?: string | null;
  actorType?: QualificationActorType;
  objectRef?: string | null;
  objectType?: string;               // 'offering' | 'company'
  policy: QualificationPolicy;       // versioned typed IMMUTABLE input
  observations?: CriterionObservation[];
}

/** Deterministic canonical id: slug of qualificationId (exact — same id ⇒ same qualification). */
export function resolveQualificationId(qualificationId: string): string {
  return String(qualificationId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'qualification';
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedQualification { key: { companyId: string; qualificationId: string }; facets: Partial<QualificationFacets>; evidence: EvidenceRef[]; edges: GraphEdge[]; reasoning: ReasoningTrace[]; }

export function qualificationFromPolicy(input: QualificationEvaluationInput): AdoptedQualification {
  const src = input.source ?? 'qualification_eval';
  const id = resolveQualificationId(input.qualificationId);
  const policy = input.policy;
  const evidence: EvidenceRef[] = [];
  const edges: GraphEdge[] = [];
  const reasoning: ReasoningTrace[] = [];
  const facets: Partial<QualificationFacets> = {};
  const one = <T>(cond: boolean, name: keyof QualificationFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };
  const mk = (label: string, value: string | number | boolean, at: string, kind: 'structured' | 'observed' | 'inferred' = 'observed'): EvidenceRef => {
    const e = evidenceRef({ id: `qualification:${label}:${src}:${at}`, kind, label, value, source: { system: src }, observedAt: at, recordedAt: at });
    evidence.push(e); return e;
  };

  // Identity + policy provenance (always). actor/object are REFERENCES (never re-owned); policy is INPUT.
  one(true, 'identity', { canonical_id: id, actorRef: input.actorRef ?? null, actorType: input.actorType, objectRef: input.objectRef ?? null, objectType: input.objectType, policyId: policy.policyId }, [mk('qualification', id, input.asOf, 'structured')]);
  one(true, 'policy', { policyId: policy.policyId, policyVersion: policy.policyVersion, criteriaCount: policy.criteria.length }, [mk('policy', `${policy.policyId}@v${policy.policyVersion}`, input.asOf, 'structured')]);
  if (has(input.actorRef)) edges.push(qualificationEdge(id, 'qualifies', input.actorType === 'visitor' ? 'visitor' : 'lead', input.actorRef!, [mk('actor', input.actorRef!, input.asOf, 'structured')], 0.7));
  if (has(input.objectRef)) edges.push(qualificationEdge(id, 'qualified_for', (input.objectType === 'company' ? 'company' : 'offering') as any, input.objectRef!, [mk('object', input.objectRef!, input.asOf, 'structured')], 0.6));

  // Map observations by criterion id (deterministic; default 'unknown' when unobserved).
  const obsById = new Map<string, CriterionObservation>();
  for (const o of input.observations ?? []) obsById.set(o.criterionId, o);
  const outcomeOf = (cid: string): CriterionOutcome => obsById.get(cid)?.outcome ?? 'unknown';

  // Deterministic criterion classification (sorted by id).
  const criteria = [...policy.criteria].sort((a, b) => a.id.localeCompare(b.id));
  const satisfied: string[] = [], unsatisfied: string[] = [], unknown: string[] = [];
  const criterionEv: EvidenceRef[] = [];
  for (const c of criteria) {
    const outcome = outcomeOf(c.id);
    const o = obsById.get(c.id);
    if (o) criterionEv.push(mk(`criterion:${c.id}:${outcome}`, o.label ?? outcome, o.observedAt, 'observed'));
    if (outcome === 'satisfied') satisfied.push(c.id);
    else if (outcome === 'unsatisfied') unsatisfied.push(c.id);
    else unknown.push(c.id);
  }
  const total = criteria.length;
  const completeness = total ? Number(((satisfied.length + unsatisfied.length) / total).toFixed(4)) : 0;
  one(true, 'evaluation', { satisfied, unsatisfied, unknown, completeness }, criterionEv);

  // Deterministic state derivation (specificity order). Policy criteria drive the state.
  const kindOf = new Map(criteria.map((c) => [c.id, c.kind]));
  const isMand = (cid: string) => kindOf.get(cid) === 'mandatory';
  const isReqOrMand = (cid: string) => kindOf.get(cid) === 'mandatory' || kindOf.get(cid) === 'required';
  const reqMand = criteria.filter((c) => isReqOrMand(c.id)).map((c) => c.id);
  const mandatoryUnsat = unsatisfied.filter(isMand);
  const reqMandUnknown = unknown.filter(isReqOrMand);
  const reqMandUnsat = unsatisfied.filter(isReqOrMand);
  const allReqMandSatisfied = reqMand.length > 0 && reqMand.every((cid) => satisfied.includes(cid));

  let status: QualificationStatus | null;
  let rationale: string;
  const evaluable = satisfied.length + unsatisfied.length;
  if (total === 0 || evaluable === 0) { status = null; rationale = 'no evaluable criteria'; }
  else if (mandatoryUnsat.length) { status = 'disqualified'; rationale = `mandatory criteria unsatisfied: ${mandatoryUnsat.join(', ')}`; }
  else if (allReqMandSatisfied) { status = 'qualified'; rationale = 'all required + mandatory criteria satisfied'; }
  else if (reqMandUnknown.length) { status = 'review'; rationale = `required criteria unknown: ${reqMandUnknown.join(', ')}`; }
  else if (reqMandUnsat.length) { status = 'nurture'; rationale = `required criteria unsatisfied: ${reqMandUnsat.join(', ')}`; }
  else { status = 'unqualified'; rationale = 'no required/mandatory criteria satisfied'; }

  const confidence = facetConfidenceFromEvidence(criterionEv);
  const uncertainty = clamp01(1 - confidence);
  const abstained = status === null;

  one(true, 'state', { status: status ?? undefined, rationale }, criterionEv.length ? criterionEv : [mk('state', rationale, input.asOf, 'inferred')]);
  one(true, 'confidence', { confidence: abstained ? 0 : confidence, uncertainty: abstained ? 1 : uncertainty, abstained }, criterionEv.length ? criterionEv : [mk('confidence', abstained ? 'abstain' : confidence, input.asOf, 'inferred')]);

  reasoning.push(reasoningTrace({
    claim: 'qualification_state',
    conclusion: status,
    because: abstained ? [] : criterionEv.filter((e) => e.label.startsWith('criterion:')),
    confidence: abstained ? 0 : confidence,
    method: 'deterministic',
    assumptions: [`policy=${policy.policyId}@v${policy.policyVersion}`, rationale, `completeness=${completeness}`],
    unknowns: abstained ? ['insufficient_criteria_evidence'] : (reqMandUnknown.length ? [`unknown required criteria: ${reqMandUnknown.join(', ')}`] : []),
  }));

  return { key: { companyId: input.companyId, qualificationId: id }, facets, evidence, edges, reasoning };
}
