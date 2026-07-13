/**
 * lifecycleSnapshotJob.ts — CSA-004: the daily Customer Lifecycle snapshot job.
 *
 * Observability + orchestration wrapper that persists one canonical lifecycle
 * snapshot per company per day, reusing the CSA scheduler cadence (no second
 * scheduler). It builds health once and reuses it for both lifecycle
 * classification and the snapshot rows (no double gathering). Idempotent (one
 * row per company/day), fail-safe (never throws), and emits HARDEN-001 metrics
 * incl. lifecycle distribution + transition counts (§8).
 */

import { recordRawCounter, recordRawHistogram } from '../observability/metrics';
import { buildAllCustomerHealth } from '../services/health/customerHealthService';
import {
  buildAllCustomerLifecycle,
  generateLifecycleSnapshots,
  type LifecycleSnapshotResult,
} from '../services/lifecycle/customerLifecycleService';
import type { CustomerLifecycle } from '../../lib/lifecycle/customerLifecycle';

export interface LifecycleBuild {
  lifecycles: CustomerLifecycle[];
  health: Map<string, { score: number; state: string }>;
}

export interface LifecycleSnapshotJobResult {
  ok: boolean;
  total: number;
  inserted: number;
  skipped: number;
  takenAt: string;
  stageDistribution: Record<string, number>;
  transitionCounts: Record<string, number>;
}

export interface LifecycleSnapshotJobDeps {
  build?: (now: string) => Promise<LifecycleBuild>;
  generate?: (
    lifecycles: CustomerLifecycle[],
    health: Map<string, { score: number; state: string }>,
    takenAt: string,
  ) => Promise<LifecycleSnapshotResult>;
  now?: string;
}

function tally(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** Default: build health once, reuse it for lifecycle classification + rows. */
async function defaultBuild(now: string): Promise<LifecycleBuild> {
  const healths = await buildAllCustomerHealth({ now });
  const health = new Map(healths.map((h) => [h.health.companyId, { score: h.health.score, state: h.health.state }]));
  const lifecycles = await buildAllCustomerLifecycle({ now, buildHealth: async () => healths });
  return { lifecycles, health };
}

/**
 * Run one daily lifecycle snapshot pass. Idempotent, retry-safe, fail-safe.
 * Emits: csa.lifecycle_snapshot.generated / .duplicates / .failures /
 * .duration_ms, and csa.lifecycle.distribution{stage} /
 * csa.lifecycle.transitions{direction}.
 */
export async function runLifecycleSnapshotJob(
  deps: LifecycleSnapshotJobDeps = {},
): Promise<LifecycleSnapshotJobResult> {
  const started = Date.now();
  const takenAt = deps.now ?? new Date().toISOString();
  const build = deps.build ?? defaultBuild;
  const generate = deps.generate ?? ((l, h, t) => generateLifecycleSnapshots(l, h, t));

  try {
    const { lifecycles, health } = await build(takenAt);

    const stageDistribution = tally(lifecycles.map((l) => l.stage));
    const transitionCounts = tally(lifecycles.filter((l) => l.transition.changed).map((l) => l.transition.direction));
    for (const [stage, count] of Object.entries(stageDistribution)) {
      recordRawCounter('csa.lifecycle.distribution', count, { stage });
    }
    for (const [direction, count] of Object.entries(transitionCounts)) {
      recordRawCounter('csa.lifecycle.transitions', count, { direction });
    }

    const res = await generate(lifecycles, health, takenAt);
    recordRawCounter('csa.lifecycle_snapshot.generated', res.inserted);
    if (res.skipped > 0) recordRawCounter('csa.lifecycle_snapshot.duplicates', res.skipped);
    recordRawHistogram('csa.lifecycle_snapshot.duration_ms', Date.now() - started);

    return { ok: true, total: res.total, inserted: res.inserted, skipped: res.skipped, takenAt, stageDistribution, transitionCounts };
  } catch {
    recordRawCounter('csa.lifecycle_snapshot.failures', 1);
    recordRawHistogram('csa.lifecycle_snapshot.duration_ms', Date.now() - started);
    return { ok: false, total: 0, inserted: 0, skipped: 0, takenAt, stageDistribution: {}, transitionCounts: {} };
  }
}
