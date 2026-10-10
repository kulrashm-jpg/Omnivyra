// Canonical trajectory history store.
//
// BETA-PHASE2-EXEC-001 (free-provider activation foundation): bridges the
// Authority Trajectory adapter's `ReportScoreHistoryStore` slot onto the SAME
// canonical historical store the rest of the report already reads/writes
// (`getHistoricalStore()` — used by change-intelligence at builder :1368 and
// forecast at :1386, and written by `persistCanonicalSnapshot`).
//
// Before this bridge the registry constructed `ReportScoreHistoryAdapter` with
// no store, so it fell back to `NoopHistoryStore` and returned zero snapshots
// even with `AUTHORITY_TRAJECTORY_ENABLED=true` — the trajectory display could
// never populate while change-intelligence/forecast (same data, different
// store) could. This unifies the two on one source of truth.
//
// Honesty guarantees (no scoring/aggregation/provider change):
//   - Reads ONLY what was actually persisted. Empty store → `[]` →
//     the adapter reports `insufficient_history` and the report's
//     `authority_trajectory.available` stays `false`. No synthesis.
//   - Maps the canonical `ReportSnapshotRecord` to the adapter's
//     `TrajectorySnapshot` verbatim. `pillar_scores` is intentionally empty:
//     the trajectory adapter computes velocity/classification from
//     authority_score + ai_visibility_score only and never reads pillar_scores.
//   - COMPARABILITY: `ReportScoreHistoryAdapter.velocityPer30d` / `classify`
//     take the FIRST and LAST point of whatever this store returns and divide
//     the difference by the elapsed days. That is a delta, so the same rule as
//     change-intelligence and forecast applies: the series must be ONE
//     comparability identity or the velocity measures our instrument rather
//     than the company. The adapter's `ReportScoreHistoryStore` interface is
//     `(companyId, limit)` and carries no identity, so — unlike the other two
//     readers, which are handed the current run's identity — the basis here is
//     the identity of the NEWEST stored snapshot: the series is anchored on
//     the most recent thing actually measured. When that snapshot carries no
//     recorded identity the series is empty and the adapter reports
//     `insufficient_history`; it never falls back to the unfiltered rows.

import type { ReportScoreHistoryStore } from './reportScoreHistoryAdapter';
import type { TrajectorySnapshot } from '../providerInterfaces';
import { getHistoricalStore } from '../historicalPersistence';
import { filterComparableSnapshots, readComparabilityIdentity } from '../comparabilityIdentity';

export class CanonicalTrajectoryHistoryStore implements ReportScoreHistoryStore {
  async loadSnapshots(companyId: string, limit: number): Promise<TrajectorySnapshot[]> {
    const records = await getHistoricalStore().loadSnapshots({ company_id: companyId, limit });
    // Both store implementations order observed_at DESC, but the anchor is
    // chosen by value rather than by position so an ordering change cannot
    // silently re-base the trajectory on an older run.
    const newest = records.reduce<(typeof records)[number] | null>(
      (latest, record) => (latest == null || record.observed_at > latest.observed_at ? record : latest),
      null,
    );
    const basis = newest ? readComparabilityIdentity(newest) : null;
    return filterComparableSnapshots(basis, records).map((r) => ({
      observed_at: r.observed_at,
      authority_score: r.authority_score,
      ai_visibility_score: r.ai_visibility_score,
      maturity: r.maturity,
      pillar_scores: {},
    }));
  }
}
