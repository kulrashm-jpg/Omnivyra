/**
 * Platform snapshot writer (Phase 37). Maps ALREADY-COMPOSED PluginSnapshots into historical
 * rows and persists them — NO plugin recalculation, NO second execution. The caller composes
 * once (e.g. a scheduled job using composePluginSnapshotMemoized) and hands the results here.
 */
import type { PluginSnapshot } from '../registry';
import type { HistoricalSnapshot } from './platformSnapshotTypes';
import { saveSnapshots } from './platformSnapshotRepository';

/** Pure projection of a composed PluginSnapshot → HistoricalSnapshot (no recompute). */
export function toHistoricalSnapshot(snap: PluginSnapshot, companyId: string, takenAt: string): HistoricalSnapshot {
  const maturityModule = snap.modules.find((m) => /maturity$/.test(m.key));
  return {
    companyId,
    takenAt,
    pluginId: snap.id,
    overallScore: Number(snap.health.score ?? 0),
    health: snap.health.overall,
    confidence: snap.confidence,
    freshness: { lastEvaluatedAt: snap.freshness.lastEvaluatedAt, stale: snap.freshness.stale },
    maturity: maturityModule?.score ?? null,
    businessImpact: { topDimensions: snap.businessImpact.topDimensions as string[], summary: snap.businessImpact.summary },
    recommendationIds: snap.recommendations.map((r) => r.key),
    moduleSummaries: snap.modules.map((m) => ({ key: m.key, score: m.score, status: m.status })),
  };
}

/** Persist a batch of composed snapshots for one company at one timestamp. */
export async function persistSnapshots(companyId: string, snapshots: PluginSnapshot[], takenAt: string): Promise<HistoricalSnapshot[]> {
  const rows = snapshots.map((s) => toHistoricalSnapshot(s, companyId, takenAt));
  await saveSnapshots(rows);
  return rows;
}
