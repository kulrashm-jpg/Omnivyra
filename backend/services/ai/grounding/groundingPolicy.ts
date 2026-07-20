/**
 * WAVE-2-001 — Canonical Grounding activation policy (realizes AI-CONTRACT-000 §C4
 * Grounding Contract: grounding floor + enforced freshness). Pure, deterministic.
 *
 * The grounding INFRASTRUCTURE already exists (contextAssimilationEngine computes a
 * `transparency` rollup: confidence, freshnessLabel, evidenceAvailable, freshestDays,
 * groundedFrom, missingContext). OMNI-AI-001 found it computed but NEVER ENFORCED.
 * This policy ENFORCES it — it does NOT build a new retrieval/ranking framework:
 *   - freshness: degrade confidence when data is aging/stale (never present stale as current),
 *   - floor: flag when required evidence is absent (grounding floor),
 *   - a structured GroundingDecision + observability for every grounding execution.
 */
export type FreshnessStatus = 'today' | 'recent' | 'aging' | 'stale' | 'unknown';

/** Confidence multiplier by freshness — stale data is trusted less. Deterministic. */
export const FRESHNESS_MULTIPLIER: Record<FreshnessStatus, number> = {
  today: 1.0, recent: 0.95, aging: 0.8, stale: 0.5, unknown: 0.7,
};

/** Grounding-floor confidence threshold. Below this (or with no evidence) the floor is breached. */
export const GROUNDING_FLOOR_THRESHOLD = 0.3;

/**
 * Derive the freshness STATUS from age in days (the canonical transparency stores
 * `freshestDays`, not a status label). `staleDays` default 14 matches the website
 * freshness engine's stale window.
 */
export function freshnessFromDays(days: number | null | undefined, staleDays = 14): FreshnessStatus {
  if (days === null || days === undefined || !Number.isFinite(days)) return 'unknown';
  if (days <= 1) return 'today';
  if (days <= 7) return 'recent';
  if (days <= staleDays) return 'aging';
  return 'stale';
}

/** Apply the freshness multiplier — enforced freshness. */
export function enforceFreshness(confidence: number, freshness: FreshnessStatus): number {
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  return Math.round(c * FRESHNESS_MULTIPLIER[freshness] * 1000) / 1000;
}

export interface GroundingTransparencyInput {
  /** Rollup confidence — accepts 0..1 or 0..100 (normalized internally). */
  confidence: number;
  freshestDays: number | null;
  evidenceAvailable: boolean;
  groundedFrom: string[];           // present source names
  missingContext: string[];
}

/** Normalize confidence to 0..1 (transparency stores 0..100). */
function normConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  const v = c > 1 ? c / 100 : c;
  return Math.max(0, Math.min(1, v));
}

export interface GroundingDecision {
  grounded: boolean;                // evidence present AND floor not breached
  freshnessStatus: FreshnessStatus;
  isStale: boolean;
  rawConfidence: number;
  /** Freshness-enforced confidence — the value that must be surfaced, never the raw one for stale data. */
  effectiveConfidence: number;
  floorBreached: boolean;           // required evidence absent / confidence below floor
  sourceCount: number;
  evidenceCount: number;
  missingContext: string[];
  freshestDays: number | null;
  /** Reason a fallback / degraded path applies (null when fully grounded). */
  fallbackReason: 'missing_evidence' | 'below_floor' | 'stale' | null;
}

/**
 * Evaluate grounding from the canonical transparency rollup. Deterministic; never
 * fabricates. `requireGrounding` marks the workflow as "Requires Grounding" so an
 * absent-evidence result reports a floor breach.
 */
export function evaluateGrounding(input: GroundingTransparencyInput, opts: { requireGrounding?: boolean } = {}): GroundingDecision {
  const freshnessStatus = freshnessFromDays(input.freshestDays);
  const isStale = freshnessStatus === 'stale';
  const rawConfidence = normConfidence(input.confidence);
  const effectiveConfidence = enforceFreshness(rawConfidence, freshnessStatus);
  const sourceCount = new Set((input.groundedFrom ?? []).filter(Boolean)).size;
  const evidenceCount = sourceCount; // one grounded source ≈ one evidence group (no dedicated evidence store yet)

  const noEvidence = !input.evidenceAvailable || sourceCount === 0;
  const belowFloor = effectiveConfidence < GROUNDING_FLOOR_THRESHOLD;
  const floorBreached = (opts.requireGrounding ?? false) && (noEvidence || belowFloor);

  const fallbackReason: GroundingDecision['fallbackReason'] =
    noEvidence ? 'missing_evidence' : belowFloor ? 'below_floor' : isStale ? 'stale' : null;

  return {
    grounded: input.evidenceAvailable && sourceCount > 0 && !floorBreached,
    freshnessStatus, isStale,
    rawConfidence, effectiveConfidence,
    floorBreached, sourceCount, evidenceCount,
    missingContext: input.missingContext ?? [],
    freshestDays: input.freshestDays ?? null,
    fallbackReason,
  };
}
