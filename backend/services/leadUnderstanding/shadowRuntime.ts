/**
 * LI-B109 — Shadow runtime (pure, deterministic). The canonical platform runs ALONGSIDE the
 * existing implementation with ZERO production behavior change: it measures parity/divergence
 * against the legacy `CanonicalLeadScores` (0..1) and is gated OFF by default. Shadow-first only —
 * nothing here reads or writes production state.
 */

import type { CanonicalLeadScores } from '../../../lib/leadIntelligence/types';
import type { LeadUnderstanding, LeadProjection, ShadowComparison, ShadowDivergence, ScoreDimension } from './types';
import { LEAD_FACET_NAMES } from './types';
import { buildLeadUnderstanding, projectLead, type BuildInput } from './projection';
import { isLeadUnderstandingEnabled } from './flags';

/** Canonical dimension → legacy field. opportunity/priority have no legacy counterpart (not compared). */
const LEGACY_MAP: Partial<Record<ScoreDimension, keyof CanonicalLeadScores>> = { intent: 'intent', icp: 'icp', urgency: 'urgency' };

/** Compare a canonical understanding to the legacy scores. Abstain-vs-abstain counts as agreement. */
export function compareToLegacy(u: LeadUnderstanding, legacy: CanonicalLeadScores, opts: { tolerance?: number } = {}): ShadowComparison {
  const tol = opts.tolerance ?? 0.1;
  const divergences: ShadowDivergence[] = [];
  const cmp = (dimension: ScoreDimension | 'overall', canonical: number | null, legacyVal: number | null): void => {
    const delta = canonical != null && legacyVal != null ? Number(Math.abs(canonical - legacyVal).toFixed(4)) : null;
    const agree = (canonical == null && legacyVal == null) || (delta != null && delta <= tol);
    divergences.push({ dimension, canonical, legacy: legacyVal, delta, agree });
  };
  for (const [dim, field] of Object.entries(LEGACY_MAP) as Array<[ScoreDimension, keyof CanonicalLeadScores]>) {
    cmp(dim, u.score.dimensions[dim].value, legacy[field] ?? null);
  }
  cmp('overall', u.score.overall, legacy.total ?? null);

  const comparable = divergences.filter((d) => !(d.canonical == null && d.legacy == null));
  const agreeing = divergences.filter((d) => d.agree).length;
  const facetCount = LEAD_FACET_NAMES.filter((n) => u.facets[n].value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;

  return {
    leadKey: u.key.leadKey,
    divergences,
    facetCount,
    evidenceCount,
    contradictionCount: u.contradictions.length,
    parity: divergences.length ? Number((agreeing / divergences.length).toFixed(4)) : 1,
  };
}

export interface LeadShadowBundle { understanding: LeadUnderstanding; projection: LeadProjection; comparison: ShadowComparison; }

/**
 * Flag-gated shadow entry point. Returns null when the shadow flag is OFF (default) — no work, no
 * side effects. Mirrors the Company/Offering `compute*Shadow` posture.
 */
export function computeLeadUnderstandingShadow(input: BuildInput, legacy: CanonicalLeadScores, opts: { tolerance?: number; projectedAt?: string } = {}): LeadShadowBundle | null {
  if (!isLeadUnderstandingEnabled()) return null;
  const understanding = buildLeadUnderstanding(input);
  const projection = projectLead(understanding, opts.projectedAt ?? input.builtAt);
  const comparison = compareToLegacy(understanding, legacy, { tolerance: opts.tolerance });
  return { understanding, projection, comparison };
}
