/**
 * J-B201 (shadow runtime) — Journey shadow runtime (pure). Builds the canonical Understanding from raw
 * touchpoints and measures FIELD parity vs that raw input — ZERO production behaviour change,
 * authoritative OFF, consumed by nothing. `computeJourneyUnderstandingShadow` returns null when the
 * flag is OFF (default).
 */

import type { JourneyUnderstanding, JourneyProjection } from './types';
import type { JourneyRawInput } from './fromRaw';
import { journeyFromRaw } from './fromRaw';
import { buildJourneyUnderstanding } from './builder';
import { projectJourney } from './projection';
import { isJourneyUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface JourneyFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface JourneyShadowComparison { journeyId: string; divergences: JourneyFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

export function compareToRaw(u: JourneyUnderstanding, raw: JourneyRawInput): JourneyShadowComparison {
  const c = toLegacyFields(u);
  const orderedStages = (raw.touchpoints ?? []).map((t) => t.stage).filter(Boolean);
  const expectedCurrent = orderedStages.length ? orderedStages[orderedStages.length - 1] : null;
  const pairs: Array<[string, unknown, unknown]> = [
    ['actor_ref', c.actor_ref, raw.actorRef ?? null],
    ['actor_type', c.actor_type, raw.actorType ?? null],
    ['status', c.status, raw.status ?? 'active'],
    ['current_stage', c.current_stage, expectedCurrent],
    ['touchpoint_count', c.touchpoint_count, (raw.touchpoints ?? []).length || null],
  ];
  const divergences: JourneyFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { journeyId: u.key.journeyId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface JourneyShadowBundle { understanding: JourneyUnderstanding; projection: JourneyProjection; comparison: JourneyShadowComparison; }

export function computeJourneyUnderstandingShadow(raw: JourneyRawInput): JourneyShadowBundle | null {
  if (!isJourneyUnderstandingEnabled()) return null;
  const a = journeyFromRaw(raw);
  const understanding = buildJourneyUnderstanding({ key: a.key, builtAt: raw.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges });
  const projection = projectJourney(understanding, raw.asOf);
  const comparison = compareToRaw(understanding, raw);
  return { understanding, projection, comparison };
}
