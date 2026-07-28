/**
 * I-B201 (assembly) — the ONE caller of the Intent builder for Phase B. Ingests observed evidence
 * (`intentFromEvidence`) and produces the canonical Understanding + projection. Foundation only: no
 * enrichment engines yet (Phase C) — score dimensions abstain until contributors exist. Deterministic
 * (`asOf` passed in). Mirrors the Lead/Company/Offering/Visitor/Journey assembly seam.
 */

import type { IntentUnderstanding, IntentProjection } from './types';
import type { IntentEvidenceInput } from './fromEvidence';
import { intentFromEvidence } from './fromEvidence';
import { buildIntentUnderstanding } from './builder';
import { projectIntent } from './projection';

export interface AssembledIntent { understanding: IntentUnderstanding; projection: IntentProjection; }

export function assembleIntentUnderstanding(input: IntentEvidenceInput): AssembledIntent {
  const a = intentFromEvidence(input);
  const understanding = buildIntentUnderstanding({ key: a.key, builtAt: input.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges, reasoning: a.reasoning });
  const projection = projectIntent(understanding, input.asOf);
  return { understanding, projection };
}
