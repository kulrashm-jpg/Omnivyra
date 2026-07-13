/**
 * readinessSnapshotJob.ts — CSA-002: the daily Customer Readiness snapshot job.
 *
 * The observability + orchestration wrapper that ACTIVATES the existing
 * readiness-history platform (closes audit G27/G32). It reuses — and never
 * duplicates — the existing authorities:
 *   - getCustomerReadiness()          → the ONE readiness calculation (§3)
 *   - generateReadinessSnapshots()    → the ONE snapshot authority (§1, idempotent)
 * and emits HARDEN-001 metrics (§7). It performs NO readiness calculation and NO
 * snapshot modelling of its own.
 *
 * Idempotency (§6) is inherited from generateReadinessSnapshots: one snapshot per
 * company per UTC day (ON CONFLICT (company_id, snapshot_date) DO NOTHING), so a
 * same-day rerun / retry / resume inserts 0. Fail-safe: never throws.
 */

import { recordRawCounter, recordRawHistogram } from '../observability/metrics';
import { getCustomerReadiness, type CompanyReadiness } from '../services/customerReadinessService';
import {
  generateReadinessSnapshots,
  type SnapshotResult,
} from '../services/customerReadinessSnapshotService';

export interface ReadinessSnapshotJobResult {
  ok: boolean;
  /** Companies for which readiness was computed this run. */
  total: number;
  /** Snapshots actually written (new company/day rows). */
  inserted: number;
  /** Duplicate snapshots skipped (already taken today). */
  skipped: number;
  takenAt: string;
}

export interface ReadinessSnapshotJobDeps {
  /** Enumerate + compute readiness for every company (default: the real authority). */
  getReadiness?: () => Promise<{ tenants: CompanyReadiness[] }>;
  /** Persist the snapshots idempotently (default: the real snapshot authority). */
  generate?: (tenants: CompanyReadiness[], takenAt: string) => Promise<SnapshotResult>;
  /** Injectable clock for determinism/testing. */
  now?: string;
}

/**
 * Run one daily readiness snapshot pass. Idempotent, retry-safe, fail-safe.
 * Emits: csa.readiness_snapshot.generated / .duplicates / .failures / .duration_ms.
 */
export async function runReadinessSnapshotJob(
  deps: ReadinessSnapshotJobDeps = {},
): Promise<ReadinessSnapshotJobResult> {
  const started = Date.now();
  const takenAt = deps.now ?? new Date().toISOString();
  const getReadiness = deps.getReadiness ?? (() => getCustomerReadiness({}));
  const generate = deps.generate ?? generateReadinessSnapshots;

  try {
    const { tenants } = await getReadiness();
    const res = await generate(tenants, takenAt);

    recordRawCounter('csa.readiness_snapshot.generated', res.inserted);
    if (res.skipped > 0) recordRawCounter('csa.readiness_snapshot.duplicates', res.skipped);
    recordRawHistogram('csa.readiness_snapshot.duration_ms', Date.now() - started);

    return { ok: true, total: res.total, inserted: res.inserted, skipped: res.skipped, takenAt };
  } catch {
    recordRawCounter('csa.readiness_snapshot.failures', 1);
    recordRawHistogram('csa.readiness_snapshot.duration_ms', Date.now() - started);
    return { ok: false, total: 0, inserted: 0, skipped: 0, takenAt };
  }
}
