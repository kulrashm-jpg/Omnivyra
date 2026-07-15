/**
 * W0-7 — Performance baseline collection framework (Gate A).
 *
 * Captures point-in-time snapshots of the HARDEN-001 registry (API / DB / AI
 * / queue / worker / external / cache / system / client-vitals series),
 * persists them to Redis (30-day TTL, gzip over the F-05 compression helper),
 * and supports listing + regression comparison between any two captures.
 *
 * MEASUREMENT ONLY — nothing here changes application behavior. Persistence
 * is Redis (no schema change; schema-governed tables can supersede later).
 * Capture sources:
 *   - on demand via POST /api/super-admin/observability-baseline,
 *   - optionally periodic on the long-lived worker via
 *     startBaselineCaptureLoop() (env OBSERVABILITY_BASELINE_CAPTURE_MS,
 *     DEFAULT OFF — no behavior change until an operator opts in).
 *
 * Caveat (same as every registry reader): series are per-process. The worker
 * process holds queue/system/scheduler series; serverless instances hold API
 * series for the traffic they served. Baselines record their origin process.
 */
import { registry, type Labels } from './registry';
import { compressIfLarge, decompressIfNeeded } from '../../lib/platform/cacheCore';

export const BASELINE_KEY_PREFIX = 'omnivyra:observability:baseline';
const BASELINE_TTL_SECONDS = 30 * 24 * 3600;

export interface BaselineHistogram {
  series: string;
  name: string;
  labels?: Labels;
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface BaselineSnapshot {
  v: 1;
  key: string;
  label: string;
  capturedAt: string;
  process: { kind: string; pid: number; uptimeSec: number };
  meta: { series: number; droppedSeries: number; registryStartedAt: number };
  counters: Array<{ series: string; value: number }>;
  gauges: Array<{ series: string; value: number }>;
  histograms: BaselineHistogram[];
}

/** Build a snapshot from the live registry (pure read; no I/O). */
export function buildBaselineSnapshot(label = 'manual'): BaselineSnapshot {
  const capturedAt = new Date().toISOString();
  const key = `${BASELINE_KEY_PREFIX}:${capturedAt.replace(/[:.]/g, '-')}`;
  return {
    v: 1,
    key,
    label,
    capturedAt,
    process: {
      kind: process.env.RAILWAY_ENVIRONMENT_NAME ? 'worker' : process.env.VERCEL ? 'serverless' : 'local',
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
    },
    meta: { ...registry.meta(), registryStartedAt: registry.meta().startedAt },
    counters: registry.counterEntries().map((c) => ({ series: c.series, value: c.value })),
    gauges: registry.gaugeEntries().map((g) => ({ series: g.series, value: g.value })),
    histograms: registry.histogramEntries().map((h) => ({
      series: h.series, name: h.name, labels: h.labels,
      count: h.count, avg: Math.round(h.avg * 100) / 100,
      p50: h.p50, p95: h.p95, p99: h.p99, max: h.max,
    })),
  };
}

async function redis() {
  const { getStandaloneRedis } = await import('../../lib/redis/canonicalClient');
  return getStandaloneRedis('health');
}

/** Capture + persist. Returns the stored snapshot key. Fail-safe on Redis loss. */
export async function captureBaseline(label = 'manual'): Promise<{ key: string; persisted: boolean; snapshot: BaselineSnapshot }> {
  const snapshot = buildBaselineSnapshot(label);
  try {
    const client = await redis();
    const body = await compressIfLarge(JSON.stringify(snapshot));
    await client.set(snapshot.key, body, 'EX', BASELINE_TTL_SECONDS);
    return { key: snapshot.key, persisted: true, snapshot };
  } catch {
    return { key: snapshot.key, persisted: false, snapshot };
  }
}

export async function listBaselines(): Promise<Array<{ key: string; capturedAt: string; label: string; process: string }>> {
  try {
    const client = await redis();
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', `${BASELINE_KEY_PREFIX}:*`, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    const out: Array<{ key: string; capturedAt: string; label: string; process: string }> = [];
    for (const key of keys.sort()) {
      const snap = await getBaseline(key);
      if (snap) out.push({ key, capturedAt: snap.capturedAt, label: snap.label, process: snap.process.kind });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getBaseline(key: string): Promise<BaselineSnapshot | null> {
  try {
    const client = await redis();
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(await decompressIfNeeded(raw)) as BaselineSnapshot;
  } catch {
    return null;
  }
}

// ── Regression comparison (pure — unit-testable) ─────────────────────────────

export interface SeriesDelta {
  series: string;
  metric: 'p50' | 'p95' | 'p99';
  before: number;
  after: number;
  deltaPct: number;
}

export interface BaselineComparison {
  before: { key: string; capturedAt: string };
  after: { key: string; capturedAt: string };
  /** deltaPct >= threshold — latency got worse. */
  regressed: SeriesDelta[];
  /** deltaPct <= -threshold — latency improved. */
  improved: SeriesDelta[];
  addedSeries: string[];
  removedSeries: string[];
  thresholdPct: number;
}

/**
 * Compare two snapshots' histogram series. Only series present in BOTH with
 * a minimum sample count are judged (cold series produce noise, not signal).
 */
export function compareBaselines(
  before: BaselineSnapshot,
  after: BaselineSnapshot,
  opts: { thresholdPct?: number; minCount?: number } = {},
): BaselineComparison {
  const thresholdPct = opts.thresholdPct ?? 10;
  const minCount = opts.minCount ?? 20;
  const beforeBy = new Map(before.histograms.map((h) => [h.series, h]));
  const afterBy = new Map(after.histograms.map((h) => [h.series, h]));

  const regressed: SeriesDelta[] = [];
  const improved: SeriesDelta[] = [];

  for (const [series, b] of beforeBy) {
    const a = afterBy.get(series);
    if (!a || b.count < minCount || a.count < minCount) continue;
    for (const metric of ['p50', 'p95', 'p99'] as const) {
      const bv = b[metric];
      const av = a[metric];
      if (!Number.isFinite(bv) || bv <= 0 || !Number.isFinite(av)) continue;
      const deltaPct = Math.round(((av - bv) / bv) * 1000) / 10;
      if (deltaPct >= thresholdPct) regressed.push({ series, metric, before: bv, after: av, deltaPct });
      else if (deltaPct <= -thresholdPct) improved.push({ series, metric, before: bv, after: av, deltaPct });
    }
  }
  regressed.sort((x, y) => y.deltaPct - x.deltaPct);
  improved.sort((x, y) => x.deltaPct - y.deltaPct);

  return {
    before: { key: before.key, capturedAt: before.capturedAt },
    after: { key: after.key, capturedAt: after.capturedAt },
    regressed,
    improved,
    addedSeries: [...afterBy.keys()].filter((s) => !beforeBy.has(s)).slice(0, 100),
    removedSeries: [...beforeBy.keys()].filter((s) => !afterBy.has(s)).slice(0, 100),
    thresholdPct,
  };
}

// ── Optional periodic capture (worker; DEFAULT OFF) ──────────────────────────

/**
 * Start periodic capture when OBSERVABILITY_BASELINE_CAPTURE_MS >= 60000.
 * Unref'd + fail-safe; returns a stop function. No-op (and returns a no-op
 * stopper) when the env is unset — zero default behavior change.
 */
export function startBaselineCaptureLoop(): () => void {
  const ms = Number(process.env.OBSERVABILITY_BASELINE_CAPTURE_MS);
  if (!Number.isFinite(ms) || ms < 60_000) return () => {};
  const timer = setInterval(() => {
    void captureBaseline('periodic').catch(() => {});
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  console.info('[baseline] periodic capture enabled', { intervalMs: ms });
  return () => clearInterval(timer);
}
