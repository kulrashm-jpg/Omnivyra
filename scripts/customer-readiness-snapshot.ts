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

import { getCustomerReadiness } from '../backend/services/customerReadinessService';
import { generateReadinessSnapshots } from '../backend/services/customerReadinessSnapshotService';

(async () => {
  const takenAt = new Date().toISOString();
  const { tenants } = await getCustomerReadiness({});
  const res = await generateReadinessSnapshots(tenants, takenAt);
  console.log(`[readiness-snapshot] ${takenAt} | total=${res.total} inserted=${res.inserted} skipped=${res.skipped} (already-today)`);
})().catch((e) => {
  console.error('[readiness-snapshot] FAILED:', e?.message ?? e);
  process.exit(1);
});
