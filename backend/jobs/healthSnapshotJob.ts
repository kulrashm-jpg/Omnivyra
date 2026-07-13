/**
 * healthSnapshotJob.ts — CSA-003: the daily Customer Health snapshot job.
 *
 * Observability + orchestration wrapper that persists one canonical health
 * snapshot per company per day, reusing the CSA-002 scheduler cadence (no second
 * scheduler). It consumes only the existing health authority
 * (buildAllCustomerHealth → generateHealthSnapshots); it computes no health of
 * its own. Idempotent (one row per company/day), fail-safe (never throws), and
 * emits HARDEN-001 metrics incl. health + risk distribution (§8).
 */

import { recordRawCounter, recordRawHistogram } from '../observability/metrics';
import {
  buildAllCustomerHealth,
  generateHealthSnapshots,
  type HealthResult,
  type HealthSnapshotResult,
} from '../services/health/customerHealthService';

export interface HealthSnapshotJobResult {
  ok: boolean;
  total: number;
  inserted: number;
  skipped: number;
  takenAt: string;
  stateDistribution: Record<string, number>;
  riskDistribution: Record<string, number>;
}

export interface HealthSnapshotJobDeps {
  build?: () => Promise<HealthResult[]>;
  generate?: (results: HealthResult[], takenAt: string) => Promise<HealthSnapshotResult>;
  now?: string;
}

function tally<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/**
 * Run one daily health snapshot pass. Idempotent, retry-safe, fail-safe.
 * Emits: csa.health_snapshot.generated / .duplicates / .failures / .duration_ms
 * and csa.health.distribution{state} / csa.health.risk_distribution{level}.
 */
export async function runHealthSnapshotJob(
  deps: HealthSnapshotJobDeps = {},
): Promise<HealthSnapshotJobResult> {
  const started = Date.now();
  const takenAt = deps.now ?? new Date().toISOString();
  const build = deps.build ?? (() => buildAllCustomerHealth({ now: takenAt }));
  const generate = deps.generate ?? generateHealthSnapshots;

  try {
    const results = await build();

    const stateDistribution = tally(results.map((r) => r.health.state));
    const riskDistribution = tally(results.map((r) => r.health.risk.level));
    for (const [state, count] of Object.entries(stateDistribution)) {
      recordRawCounter('csa.health.distribution', count, { state });
    }
    for (const [level, count] of Object.entries(riskDistribution)) {
      recordRawCounter('csa.health.risk_distribution', count, { level });
    }

    const res = await generate(results, takenAt);
    recordRawCounter('csa.health_snapshot.generated', res.inserted);
    if (res.skipped > 0) recordRawCounter('csa.health_snapshot.duplicates', res.skipped);
    recordRawHistogram('csa.health_snapshot.duration_ms', Date.now() - started);

    return { ok: true, total: res.total, inserted: res.inserted, skipped: res.skipped, takenAt, stateDistribution, riskDistribution };
  } catch {
    recordRawCounter('csa.health_snapshot.failures', 1);
    recordRawHistogram('csa.health_snapshot.duration_ms', Date.now() - started);
    return { ok: false, total: 0, inserted: 0, skipped: 0, takenAt, stateDistribution: {}, riskDistribution: {} };
  }
}
