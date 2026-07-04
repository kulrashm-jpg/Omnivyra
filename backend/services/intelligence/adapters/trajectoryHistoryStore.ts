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

import type { ReportScoreHistoryStore } from './reportScoreHistoryAdapter';
import type { TrajectorySnapshot } from '../providerInterfaces';
import { getHistoricalStore } from '../historicalPersistence';

export class CanonicalTrajectoryHistoryStore implements ReportScoreHistoryStore {
  async loadSnapshots(companyId: string, limit: number): Promise<TrajectorySnapshot[]> {
    const records = await getHistoricalStore().loadSnapshots({ company_id: companyId, limit });
    return records.map((r) => ({
      observed_at: r.observed_at,
      authority_score: r.authority_score,
      ai_visibility_score: r.ai_visibility_score,
      maturity: r.maturity,
      pillar_scores: {},
    }));
  }
}
