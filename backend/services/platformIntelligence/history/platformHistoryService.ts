/**
 * Platform history service (Phase 37). Read surface over persisted snapshots — latest /
 * previous / history / timeline + per-metric historical series. Pure reads; no recompute.
 */
import type { HistoricalSnapshot } from './platformSnapshotTypes';
import { listSnapshots, latestSnapshot, previousSnapshot } from './platformSnapshotRepository';

export const getLatestSnapshot = latestSnapshot;
export const getPreviousSnapshot = previousSnapshot;

export async function getHistory(companyId: string, pluginId: string): Promise<HistoricalSnapshot[]> {
  return listSnapshots(companyId, pluginId);
}

/** All plugins' snapshots for a company, oldest → newest (cross-domain timeline). */
export async function getTimeline(companyId: string): Promise<HistoricalSnapshot[]> {
  return listSnapshots(companyId);
}

// ---- per-metric historical series (oldest → newest) ----
export async function historicalScores(companyId: string, pluginId: string): Promise<number[]> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.overallScore);
}
export async function historicalConfidence(companyId: string, pluginId: string): Promise<number[]> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.confidence);
}
export async function historicalHealth(companyId: string, pluginId: string): Promise<string[]> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.health);
}
export async function historicalMaturity(companyId: string, pluginId: string): Promise<Array<number | null>> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.maturity);
}
export async function historicalRecommendationCounts(companyId: string, pluginId: string): Promise<number[]> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.recommendationIds.length);
}
export async function historicalFreshness(companyId: string, pluginId: string): Promise<Array<{ takenAt: string; stale: boolean }>> {
  return (await listSnapshots(companyId, pluginId)).map((s) => ({ takenAt: s.takenAt, stale: s.freshness.stale }));
}
export async function historicalModuleScores(companyId: string, pluginId: string, moduleKey: string): Promise<Array<number | null>> {
  return (await listSnapshots(companyId, pluginId)).map((s) => s.moduleSummaries.find((m) => m.key === moduleKey)?.score ?? null);
}
