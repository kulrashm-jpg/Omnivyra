/**
 * WS-2B — Visitor shadow observation (in-memory only).
 *
 * The shadow bundle was computed on every captured event and immediately discarded, so parity,
 * projection, confidence and provenance existed for one expression and then did not. This is the
 * smallest seam that makes them inspectable.
 *
 * ─── WHY A NEW SEAM AND NOT AN EXISTING ONE ────────────────────────────────────────────────────────
 * Two diagnostics already exist and neither fits. `summarizeVisitorRun` is a pure batch summarizer
 * over arrays — it aggregates a corpus, it does not receive an event. `runCompanyShadowParity` is an
 * offline harness explicitly "NEVER wired into any request path". The platform recorders
 * (`recordApi`, `recordCache`, …) take NUMBERS: parity would fit, projection and provenance could not.
 * So this is additive, and deliberately the smallest thing that closes the gap.
 *
 * ─── OBSERVATION, NOT STORAGE ──────────────────────────────────────────────────────────────────────
 * A bounded in-process ring. No database, no repository, no queue, no API, no schema, no file. The
 * buffer is capped and drops oldest-first, because an unbounded diagnostic on a live capture path is
 * a memory leak wearing a useful name. Process-local and non-durable BY DESIGN: durability is the
 * later persistence workstream's decision, not this one's.
 *
 * ─── DARK MEANS DARK ───────────────────────────────────────────────────────────────────────────────
 * `observeVisitorShadow(null)` records nothing and returns null. `computeVisitorUnderstandingShadow`
 * already returns null when `VISITOR_UNDERSTANDING_ENABLED` is off, so with the flag off nothing is
 * computed AND nothing is observed — the ring stays empty. The flag is not re-read here; a second
 * read could disagree with the first if the environment changed mid-call, and one authority per
 * decision is the point.
 *
 * ─── NEVER THROWS ──────────────────────────────────────────────────────────────────────────────────
 * This sits on a live capture path. A diagnostic that can break ingestion is worse than no diagnostic,
 * so every step is guarded and failure yields null rather than an exception.
 *
 * Deterministic: `observedAt` is the understanding's own `builtAt`. No clock is read here.
 */

import type { VisitorProjection } from './types';
import type { VisitorShadowBundle, VisitorShadowComparison } from './shadowRuntime';

/** How many observations are retained. Bounded so a live path cannot grow memory without limit. */
export const VISITOR_SHADOW_OBSERVATION_LIMIT = 50;

export interface VisitorShadowObservation {
  companyId: string;
  visitorId: string;
  /** The understanding's own builtAt — never a clock read. */
  observedAt: string;
  /** Field parity of the understanding against the raw input it was built from. */
  parity: number;
  /** Aggregate confidence of the projected understanding. */
  confidence: number;
  /** Distinct evidence source systems, sorted — the provenance behind this understanding. */
  provenance: string[];
  facetCount: number;
  evidenceCount: number;
  contradictionCount: number;
  /** The projected understanding, verbatim — so the projection is verifiable, not merely counted. */
  projection: VisitorProjection;
  /** The full field-level comparison, so a divergence can be inspected rather than inferred. */
  comparison: VisitorShadowComparison;
}

const ring: VisitorShadowObservation[] = [];

/**
 * Observe one shadow bundle. Returns the observation, or null when there was nothing to observe —
 * which is the flag-off case, since the bundle itself is null then.
 *
 * The bundle is READ, never recomputed: every value below is projected off what was already built.
 */
export function observeVisitorShadow(bundle: VisitorShadowBundle | null): VisitorShadowObservation | null {
  if (!bundle) return null;
  try {
    const { understanding, projection, comparison } = bundle;

    // Provenance is derived from the evidence already attached to the facets — the systems that
    // actually contributed, deduplicated and sorted so the value is stable across runs.
    const systems = new Set<string>();
    for (const facet of Object.values(understanding.facets)) {
      for (const e of facet.evidence) systems.add(e.source.system);
    }

    const observation: VisitorShadowObservation = {
      companyId: understanding.key.companyId,
      visitorId: understanding.key.visitorId,
      observedAt: understanding.builtAt,
      parity: comparison.parity,
      confidence: projection.confidence,
      provenance: [...systems].sort(),
      facetCount: comparison.facetCount,
      evidenceCount: comparison.evidenceCount,
      contradictionCount: comparison.contradictionCount,
      projection,
      comparison,
    };

    ring.push(observation);
    // Oldest-first eviction. `splice` rather than `shift` in a loop so a burst cannot leave the ring
    // temporarily over the cap.
    if (ring.length > VISITOR_SHADOW_OBSERVATION_LIMIT) {
      ring.splice(0, ring.length - VISITOR_SHADOW_OBSERVATION_LIMIT);
    }
    return observation;
  } catch {
    // A diagnostic must never break the path it observes.
    return null;
  }
}

/** Everything currently retained, oldest first. A copy — callers cannot mutate the ring. */
export function recentVisitorShadowObservations(): readonly VisitorShadowObservation[] {
  return [...ring];
}

/** The most recent observation, or null when nothing has been observed. */
export function latestVisitorShadowObservation(): VisitorShadowObservation | null {
  return ring.length ? ring[ring.length - 1] : null;
}

/** Test seam. Mirrors `__clearProvidersForTests` / `__resetForTests` elsewhere in the estate. */
export function __resetVisitorShadowObservationsForTests(): void {
  ring.length = 0;
}
