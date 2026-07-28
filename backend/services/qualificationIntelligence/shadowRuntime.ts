/**
 * Q-B201 (shadow runtime) — Qualification shadow runtime (pure). Evaluates a policy against observations
 * and measures FIELD parity vs a deterministic re-derivation of that input — ZERO production behaviour
 * change, authoritative OFF, consumed by nothing. `computeQualificationUnderstandingShadow` returns null
 * when the flag is OFF (default).
 */

import type { QualificationUnderstanding, QualificationProjection } from './types';
import type { QualificationEvaluationInput } from './fromPolicy';
import { qualificationFromPolicy } from './fromPolicy';
import { buildQualificationUnderstanding } from './builder';
import { projectQualification } from './projection';
import { isQualificationUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface QualificationFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface QualificationShadowComparison { qualificationId: string; divergences: QualificationFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

export function compareToInput(u: QualificationUnderstanding, input: QualificationEvaluationInput): QualificationShadowComparison {
  const c = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['actor_ref', c.actor_ref, input.actorRef ?? null],
    ['actor_type', c.actor_type, input.actorType ?? null],
    ['object_ref', c.object_ref, input.objectRef ?? null],
    ['policy_id', c.policy_id, input.policy.policyId],
    ['policy_version', c.policy_version, input.policy.policyVersion],
  ];
  const divergences: QualificationFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { qualificationId: u.key.qualificationId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface QualificationShadowBundle { understanding: QualificationUnderstanding; projection: QualificationProjection; comparison: QualificationShadowComparison; }

export function computeQualificationUnderstandingShadow(input: QualificationEvaluationInput): QualificationShadowBundle | null {
  if (!isQualificationUnderstandingEnabled()) return null;
  const a = qualificationFromPolicy(input);
  const understanding = buildQualificationUnderstanding({ key: a.key, builtAt: input.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges, reasoning: a.reasoning });
  const projection = projectQualification(understanding, input.asOf);
  const comparison = compareToInput(understanding, input);
  return { understanding, projection, comparison };
}
