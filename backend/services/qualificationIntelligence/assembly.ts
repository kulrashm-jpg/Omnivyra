/**
 * Q-B201 (assembly) — the ONE caller of the Qualification builder for Phase B. Evaluates a versioned
 * policy against observations (`qualificationFromPolicy`) and produces the canonical Understanding +
 * projection. Foundation only: no enrichment engines yet (Phase C) — score dimensions abstain until
 * contributors exist. Deterministic (`asOf` passed in). Mirrors the Lead/Company/Offering/Visitor/
 * Journey/Intent assembly seam.
 */

import type { QualificationUnderstanding, QualificationProjection } from './types';
import type { QualificationEvaluationInput } from './fromPolicy';
import { qualificationFromPolicy } from './fromPolicy';
import { buildQualificationUnderstanding } from './builder';
import { projectQualification } from './projection';

export interface AssembledQualification { understanding: QualificationUnderstanding; projection: QualificationProjection; }

export function assembleQualificationUnderstanding(input: QualificationEvaluationInput): AssembledQualification {
  const a = qualificationFromPolicy(input);
  const understanding = buildQualificationUnderstanding({ key: a.key, builtAt: input.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges, reasoning: a.reasoning });
  const projection = projectQualification(understanding, input.asOf);
  return { understanding, projection };
}
