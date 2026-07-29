/**
 * OI-B209 — Offering shadow runtime (pure). Builds the canonical Understanding from a seed and
 * measures FIELD parity vs that seed — ZERO production behaviour change, authoritative OFF, consumed
 * by nothing. `computeOfferingUnderstandingShadow` returns null when the flag is OFF (default).
 */

import type { OfferingUnderstanding, OfferingProjection } from './types';
import type { OfferingSeedInput } from './fromSeed';
import { offeringFromSeed } from './fromSeed';
import { buildOfferingUnderstanding } from './builder';
import { projectOffering } from './projection';
import { isOfferingUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface OfferingFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface OfferingShadowComparison { offeringId: string; divergences: OfferingFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

export function compareToLegacy(u: OfferingUnderstanding, seed: OfferingSeedInput): OfferingShadowComparison {
  const c = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['name', c.name, seed.name ?? null],
    ['offering_type', c.offering_type, seed.offeringType ?? null],
    ['category', c.category, seed.category ?? null],
    ['features', c.features, seed.features ?? []],
    ['pricing_plans', c.pricing_plans, seed.plans ?? []],
    ['differentiators', c.differentiators, seed.differentiators ?? []],
  ];
  const divergences: OfferingFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { offeringId: u.key.offeringId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface OfferingShadowBundle { understanding: OfferingUnderstanding; projection: OfferingProjection; comparison: OfferingShadowComparison; }

export function computeOfferingUnderstandingShadow(seed: OfferingSeedInput): OfferingShadowBundle | null {
  if (!isOfferingUnderstandingEnabled()) return null;
  const a = offeringFromSeed(seed);
  const understanding = buildOfferingUnderstanding({ key: a.key, builtAt: seed.asOf, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
  const projection = projectOffering(understanding, seed.asOf);
  const comparison = compareToLegacy(understanding, seed);
  return { understanding, projection, comparison };
}
