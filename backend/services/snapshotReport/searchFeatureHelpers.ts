/**
 * DG-001 — the Report 1 SERP-feature surface.
 *
 * Turns the feature observations competitor discovery already gathered into the
 * report's `search_visibility.features` block. It counts and states; it does not
 * interpret.
 *
 * ─── WHY THIS IS SEPARATE FROM THE ORGANIC SURFACE ────────────────────────
 * `bestPosition`, `queriesRanked`, `state` and `observations` are organic
 * search visibility. A People Also Ask entry, a knowledge panel or an ad is not
 * an organic rank, and folding one in would silently redefine a customer-facing
 * evidence state. Keeping the two in different functions with different shapes
 * is what makes that mistake hard to make by accident.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 * No answer-readiness score, no coverage percentage, no opportunity, no
 * recommendation. Those are DG-007's, and DG-001's job is to establish the
 * evidence they will read — not to pre-empt their conclusions.
 */

import type {
  SnapshotSearchFeatures,
  SnapshotSearchFeatureObservation,
} from '../snapshotReportTypes';
import type { SerpResultType } from '../serp/serpResultTypes';

/** Acquisition status as the competitor engine reports it. */
type AcquisitionStatus = 'ok' | 'unavailable' | 'failed' | null;

/**
 * Build the feature block.
 *
 * @param observations feature rows harvested from the same SERP responses.
 * @param organicQueryCount how many queries produced an own-domain observation;
 *        used only to tell "acquisition never ran" from "it ran and found none".
 * @param acquisitionStatus the run's own status, mirrored rather than re-derived.
 */
export function buildSearchFeatures(
  observations: readonly SnapshotSearchFeatureObservation[],
  organicQueryCount: number,
  acquisitionStatus: AcquisitionStatus,
): SnapshotSearchFeatures {
  // Acquisition never produced anything: mirror the parent surface's reason
  // rather than claiming "no features exist", which we did not establish.
  const acquisitionRan = acquisitionStatus === 'ok' || organicQueryCount > 0;
  if (!acquisitionRan) {
    return {
      state: acquisitionStatus === 'failed' ? 'failed' : 'unavailable',
      observed: [],
      counts: {},
    };
  }

  // Deterministic tally. Insertion order follows first appearance, so the same
  // input always produces the same object — a report diffed against itself must
  // not show spurious churn.
  const counts: Partial<Record<SerpResultType, number>> = {};
  for (const observation of observations) {
    counts[observation.result_type] = (counts[observation.result_type] ?? 0) + 1;
  }

  return {
    // "We looked and there were none" is a real finding, and is not the same as
    // "we could not look" — which the branch above already returned.
    state: observations.length > 0 ? 'measured' : 'insufficient_signal',
    observed: [...observations],
    counts,
  };
}
