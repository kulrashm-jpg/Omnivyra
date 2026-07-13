/**
 * Daily Customer Readiness Snapshot job (Phase 12H).
 *
 * Computes the current readiness model for every company and persists ONE snapshot
 * per company per day into customer_readiness_snapshots. Rerun-safe (idempotent).
 * No emails, notifications, recommendations, or any other side effects.
 *
 * Run (cron / scheduler):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/customer-readiness-snapshot.ts
 */

// CSA-002: this manual entry point now delegates to the SAME job runner the
// scheduler uses (backend/jobs/readinessSnapshotJob), so there is one snapshot
// path whether run by cron or by hand — no duplicate orchestration.
import { runReadinessSnapshotJob } from '../backend/jobs/readinessSnapshotJob';

(async () => {
  const res = await runReadinessSnapshotJob();
  console.log(`[readiness-snapshot] ${res.takenAt} | total=${res.total} inserted=${res.inserted} skipped=${res.skipped} (already-today)`);
  if (!res.ok) process.exit(1);
})().catch((e) => {
  console.error('[readiness-snapshot] FAILED:', e?.message ?? e);
  process.exit(1);
});
