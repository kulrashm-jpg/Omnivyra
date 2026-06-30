/**
 * Platform snapshot scheduler (Phase 39). Config-driven orchestration over the snapshot job —
 * manual (one company), daily (a set of companies). Future cron integration calls runDaily
 * (or the /api/platform/history/run endpoint) on a schedule. No framework redesign; it only
 * sequences runPlatformSnapshotJob and ensures the durable store is wired.
 */
import { runPlatformSnapshotJob, type SnapshotJobResult } from './platformSnapshotJob';
import { ensureHistoryStore } from './historyStoreBootstrap';

/** Manual run for a single company. */
export async function runManualSnapshot(companyId: string, nowMs?: number): Promise<SnapshotJobResult> {
  ensureHistoryStore();
  return runPlatformSnapshotJob(companyId, nowMs != null ? { nowMs } : {});
}

/** Daily run across the supplied companies (caller resolves the active-company set). */
export async function runDailySnapshots(companyIds: string[], nowMs?: number): Promise<SnapshotJobResult[]> {
  ensureHistoryStore();
  const out: SnapshotJobResult[] = [];
  for (const companyId of companyIds) {
    out.push(await runPlatformSnapshotJob(companyId, nowMs != null ? { nowMs } : {}));
  }
  return out;
}
