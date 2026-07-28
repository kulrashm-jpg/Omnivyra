/**
 * J-B201 (assembly) — the ONE caller of the Journey builder for Phase B. Ingests raw touchpoints
 * (`journeyFromRaw`) and produces the canonical Understanding + projection. Foundation only: no
 * enrichment engines yet (Phase C) — score dimensions abstain until contributors exist. Deterministic
 * (`asOf` passed in). Mirrors the Lead/Company/Offering/Visitor assembly seam.
 */

import type { JourneyUnderstanding, JourneyProjection } from './types';
import type { JourneyRawInput } from './fromRaw';
import { journeyFromRaw } from './fromRaw';
import { buildJourneyUnderstanding } from './builder';
import { projectJourney } from './projection';

export interface AssembledJourney { understanding: JourneyUnderstanding; projection: JourneyProjection; }

export function assembleJourneyUnderstanding(raw: JourneyRawInput): AssembledJourney {
  const a = journeyFromRaw(raw);
  const understanding = buildJourneyUnderstanding({ key: a.key, builtAt: raw.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges });
  const projection = projectJourney(understanding, raw.asOf);
  return { understanding, projection };
}
