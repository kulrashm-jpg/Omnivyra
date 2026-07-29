/**
 * V-A101 (assembly) — the ONE caller of the Visitor builder for Phase A. Ingests a raw visitor
 * (`visitorFromRaw`) and produces the canonical Understanding + projection. Foundation only: no
 * enrichment engines yet (they arrive in Phase B) — score dimensions abstain until contributors exist.
 * Deterministic (`asOf` passed in). Mirrors the Lead/Company/Offering assembly seam.
 */

import type { VisitorUnderstanding, VisitorProjection } from './types';
import type { VisitorRawInput } from './fromRaw';
import { visitorFromRaw } from './fromRaw';
import { buildVisitorUnderstanding } from './builder';
import { projectVisitor } from './projection';

export interface AssembledVisitor { understanding: VisitorUnderstanding; projection: VisitorProjection; }

export function assembleVisitorUnderstanding(raw: VisitorRawInput): AssembledVisitor {
  const a = visitorFromRaw(raw);
  const understanding = buildVisitorUnderstanding({ key: a.key, builtAt: raw.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges });
  const projection = projectVisitor(understanding, raw.asOf);
  return { understanding, projection };
}
