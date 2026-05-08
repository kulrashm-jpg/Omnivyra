// Authority Trajectory adapter backed by a `report_score_history` persistence layer.
//
// Activated by `AUTHORITY_TRAJECTORY_ENABLED=true`. Reads historical report
// snapshots, computes authority velocity and trajectory classification.
//
// IMPORTANT: when fewer than 2 snapshots are available, the adapter returns
// `state: 'measured'` with `velocity: { ..., classification: 'insufficient_history' }`
// rather than synthesizing a velocity. Snapshots themselves are real persisted data.

import type {
  AuthorityTrajectoryProvider,
  AuthorityTrajectoryResult,
  TrajectorySnapshot,
} from '../providerInterfaces';
import { unavailableEvidence } from '../providerInterfaces';

// ── Persistence interface ─────────────────────────────────────────────────────
//
// The actual Supabase / DB implementation is a thin wrapper over this interface.
// Tests can swap in an in-memory store. Phase 3 ships the architecture; the live
// query against `report_score_history` is implemented when the env flag is on.

export interface ReportScoreHistoryStore {
  loadSnapshots(companyId: string, limit: number): Promise<TrajectorySnapshot[]>;
}

class NoopHistoryStore implements ReportScoreHistoryStore {
  async loadSnapshots(): Promise<TrajectorySnapshot[]> {
    return [];
  }
}

// ── Velocity & classification ─────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function velocityPer30d(snapshots: TrajectorySnapshot[], pick: (s: TrajectorySnapshot) => number | null): number | null {
  if (snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const days = daysBetween(first.observed_at, last.observed_at);
  if (days <= 0) return null;
  const firstValue = pick(first);
  const lastValue = pick(last);
  if (firstValue == null || lastValue == null) return null;
  const delta = lastValue - firstValue;
  return Number(((delta / days) * 30).toFixed(2));
}

function classify(snapshots: TrajectorySnapshot[]): AuthorityTrajectoryResult['velocity']['classification'] {
  if (snapshots.length < 2) return 'insufficient_history';
  const values = snapshots
    .map((s) => s.authority_score.value)
    .filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return 'insufficient_history';

  const first = values[0];
  const last = values[values.length - 1];
  const peak = Math.max(...values);
  const trough = Math.min(...values);
  const range = peak - trough;
  const trend = last - first;

  if (range > 18 && Math.abs(trend) < range * 0.4) return 'temporary_spike';
  if (trend >= 5 && Math.abs(trend) > range * 0.4) return 'sustained_growth';
  if (trend <= -5) return 'decay';
  if (range < 4) return 'stagnation';
  return 'sustained_growth';
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ReportScoreHistoryAdapter implements AuthorityTrajectoryProvider {
  public readonly id = 'report_score_history';
  private store: ReportScoreHistoryStore;

  constructor(store?: ReportScoreHistoryStore) {
    this.store = store ?? new NoopHistoryStore();
  }

  async isAvailable(): Promise<boolean> {
    return process.env.AUTHORITY_TRAJECTORY_ENABLED === 'true';
  }

  async lookup(params: { companyId: string }): Promise<AuthorityTrajectoryResult> {
    if (!params.companyId) {
      return {
        state: 'unavailable',
        snapshots: [],
        velocity: { authority_per_30d: null, ai_visibility_per_30d: null, classification: 'insufficient_history' },
        forecast: null,
        evidence: unavailableEvidence('Company id missing — cannot load trajectory.'),
        reason_unavailable: 'Company id missing — cannot load trajectory.',
      };
    }

    let snapshots: TrajectorySnapshot[];
    try {
      snapshots = await this.store.loadSnapshots(params.companyId, 24);
    } catch (error) {
      const reason = `Trajectory store query failed: ${error instanceof Error ? error.message : 'unknown error'}.`;
      return {
        state: 'unavailable',
        snapshots: [],
        velocity: { authority_per_30d: null, ai_visibility_per_30d: null, classification: 'insufficient_history' },
        forecast: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }

    const sorted = [...snapshots].sort(
      (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
    );

    const observedAt = sorted[sorted.length - 1]?.observed_at ?? null;
    return {
      state: sorted.length === 0 ? 'measured' : 'measured',
      snapshots: sorted,
      velocity: {
        authority_per_30d: velocityPer30d(sorted, (s) => s.authority_score.value),
        ai_visibility_per_30d: velocityPer30d(sorted, (s) => s.ai_visibility_score.value),
        classification: classify(sorted),
      },
      forecast: null, // Forecast lands in Phase 4 once a real time-series model is wired.
      evidence: {
        count: sorted.length,
        sources: ['trajectory_history'],
        freshness: { last_observed_at: observedAt, age_hours: null },
        observations: sorted.map((s) => ({
          signal: `snapshot:${s.observed_at}`,
          source: 'trajectory_history' as const,
          observed_at: s.observed_at,
        })),
      },
      reason_unavailable: null,
    };
  }
}
