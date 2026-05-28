/**
 * qualityBenchmarkSuite.ts
 *
 * Phase 5.7 — Comparative quality benchmarking across engines + over time.
 *
 * Captures one `LongFormQualityBenchmark` per generation run and keeps a
 * rolling ring buffer of the last N runs per content_type + engine. From
 * that we expose:
 *
 *   - `recordBenchmark(...)`   — capture a benchmark from an orchestrator result
 *   - `compareEngineBenchmarks(...)` — planned vs compatibility-core side-by-side
 *   - `getQualityTrend(...)`   — moving averages over the ring buffer
 *
 * No external dependencies. The ring buffer is in-process and resets on
 * process restart; durable storage is out of scope for this phase.
 */

export type BenchmarkEngine = 'planned-sectionwise-v1' | 'compatibility-core' | 'previous-stable';

export interface LongFormQualityBenchmark {
  benchmarkId: string;
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  /** Metrics — 0..100 where higher is better. */
  metrics: {
    alignment: number;
    grounding: number;
    repetition: number;          // INVERSE: 100 - repetition_score
    continuity: number;
    strategic_density: number;
    narrative_flow: number;
    timeout_frequency: number;   // INVERSE: 100 - timeout-share
    retry_efficiency: number;    // INVERSE: 100 - avg_retries_per_section * 20
  };
  /** Aggregate quality score (weighted mean of metrics). */
  qualityScore: number;
  duration_ms: number;
  sectionCount: number;
  retriesUsed: number;
  fallbackTriggered: boolean;
  recordedAt: string;
}

export interface BenchmarkInputFromOrchestrator {
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  duration_ms: number;
  sectionCount: number;
  sectionsPassed: number;
  retriesUsed: number;
  fallbackTriggered: boolean;
  /** 0..100 — overall company-alignment average across sections. */
  alignmentAverage: number;
  /** 0..100 — overall semantic-grounding coverage. */
  groundingCoverage: number;
  /** 0..100, HIGHER = MORE REPETITION (we invert internally). */
  repetitionScoreRaw: number;
  /** 0..100 — narrative continuity. */
  continuity: number;
  /** 0..100 — strategic-presence average. */
  strategicDensity: number;
  /** 0..100 — narrative flow heuristic. */
  narrativeFlow: number;
  /** count — sections that timed out at least once. */
  timeoutSectionCount: number;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function timeoutFrequencyMetric(timeoutSectionCount: number, sectionCount: number): number {
  if (sectionCount <= 0) return 100;
  const share = Math.min(1, timeoutSectionCount / sectionCount);
  return clampPct(100 - share * 100);
}

function retryEfficiencyMetric(retriesUsed: number, sectionCount: number): number {
  if (sectionCount <= 0) return 100;
  // 0 retries/section = 100; 0.5 retries/section = 90; 1.0 = 80; 2.0 = 60; 3.0 = 40.
  const avg = retriesUsed / sectionCount;
  return clampPct(100 - avg * 20);
}

function aggregateQualityScore(metrics: LongFormQualityBenchmark['metrics']): number {
  // Weighted blend:
  //   alignment 18%, grounding 18%, repetition 12%, continuity 12%,
  //   strategic_density 12%, narrative_flow 10%, timeout 9%, retry 9%
  return Math.round(
    0.18 * metrics.alignment +
    0.18 * metrics.grounding +
    0.12 * metrics.repetition +
    0.12 * metrics.continuity +
    0.12 * metrics.strategic_density +
    0.10 * metrics.narrative_flow +
    0.09 * metrics.timeout_frequency +
    0.09 * metrics.retry_efficiency,
  );
}

function stableBenchmarkId(input: BenchmarkInputFromOrchestrator): string {
  const basis = `${input.engine}|${input.content_type}|${input.topic}|${Date.now()}`;
  let h = 5381;
  for (let i = 0; i < basis.length; i += 1) h = ((h << 5) + h) ^ basis.charCodeAt(i);
  return `bench_${(h >>> 0).toString(36)}`;
}

export function buildBenchmark(input: BenchmarkInputFromOrchestrator): LongFormQualityBenchmark {
  const metrics: LongFormQualityBenchmark['metrics'] = {
    alignment: clampPct(input.alignmentAverage),
    grounding: clampPct(input.groundingCoverage),
    repetition: clampPct(100 - input.repetitionScoreRaw),
    continuity: clampPct(input.continuity),
    strategic_density: clampPct(input.strategicDensity),
    narrative_flow: clampPct(input.narrativeFlow),
    timeout_frequency: timeoutFrequencyMetric(input.timeoutSectionCount, input.sectionCount),
    retry_efficiency: retryEfficiencyMetric(input.retriesUsed, input.sectionCount),
  };
  return {
    benchmarkId: stableBenchmarkId(input),
    engine: input.engine,
    content_type: input.content_type,
    topic: input.topic,
    metrics,
    qualityScore: aggregateQualityScore(metrics),
    duration_ms: input.duration_ms,
    sectionCount: input.sectionCount,
    retriesUsed: input.retriesUsed,
    fallbackTriggered: input.fallbackTriggered,
    recordedAt: new Date().toISOString(),
  };
}

// ── Ring buffer ─────────────────────────────────────────────────────────────

const RING_CAPACITY_PER_KEY = 50;
const ringBuffer = new Map<string, LongFormQualityBenchmark[]>();

function bufferKey(engine: BenchmarkEngine, contentType: string): string {
  return `${engine}::${contentType}`;
}

export function recordBenchmark(benchmark: LongFormQualityBenchmark): void {
  const key = bufferKey(benchmark.engine, benchmark.content_type);
  const list = ringBuffer.get(key) ?? [];
  list.push(benchmark);
  while (list.length > RING_CAPACITY_PER_KEY) list.shift();
  ringBuffer.set(key, list);
}

export interface EngineBenchmarkComparison {
  content_type: string;
  planned: AverageBenchmarkSnapshot | null;
  compatibility: AverageBenchmarkSnapshot | null;
  delta: {
    qualityScore: number | null;
    alignment: number | null;
    grounding: number | null;
    repetition: number | null;
    continuity: number | null;
    strategic_density: number | null;
    narrative_flow: number | null;
    timeout_frequency: number | null;
    retry_efficiency: number | null;
    duration_ms: number | null;
  };
}

export interface AverageBenchmarkSnapshot {
  engine: BenchmarkEngine;
  samples: number;
  metrics: LongFormQualityBenchmark['metrics'];
  qualityScore: number;
  averageDurationMs: number;
}

function averageOver(buffer: LongFormQualityBenchmark[]): AverageBenchmarkSnapshot | null {
  if (buffer.length === 0) return null;
  const keys: Array<keyof LongFormQualityBenchmark['metrics']> = [
    'alignment','grounding','repetition','continuity','strategic_density','narrative_flow','timeout_frequency','retry_efficiency',
  ];
  const sumMetrics: Record<string, number> = {};
  for (const k of keys) sumMetrics[k] = 0;
  let sumQuality = 0;
  let sumDuration = 0;
  for (const b of buffer) {
    for (const k of keys) sumMetrics[k] += b.metrics[k];
    sumQuality += b.qualityScore;
    sumDuration += b.duration_ms;
  }
  const metrics = {} as LongFormQualityBenchmark['metrics'];
  for (const k of keys) (metrics as any)[k] = Math.round(sumMetrics[k] / buffer.length);
  return {
    engine: buffer[0].engine,
    samples: buffer.length,
    metrics,
    qualityScore: Math.round(sumQuality / buffer.length),
    averageDurationMs: Math.round(sumDuration / buffer.length),
  };
}

function diffOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return a - b;
}

export function compareEngineBenchmarks(contentType: string): EngineBenchmarkComparison {
  const planned = averageOver(ringBuffer.get(bufferKey('planned-sectionwise-v1', contentType)) ?? []);
  const compatibility = averageOver(ringBuffer.get(bufferKey('compatibility-core', contentType)) ?? []);
  return {
    content_type: contentType,
    planned,
    compatibility,
    delta: {
      qualityScore: diffOrNull(planned?.qualityScore, compatibility?.qualityScore),
      alignment: diffOrNull(planned?.metrics.alignment, compatibility?.metrics.alignment),
      grounding: diffOrNull(planned?.metrics.grounding, compatibility?.metrics.grounding),
      repetition: diffOrNull(planned?.metrics.repetition, compatibility?.metrics.repetition),
      continuity: diffOrNull(planned?.metrics.continuity, compatibility?.metrics.continuity),
      strategic_density: diffOrNull(planned?.metrics.strategic_density, compatibility?.metrics.strategic_density),
      narrative_flow: diffOrNull(planned?.metrics.narrative_flow, compatibility?.metrics.narrative_flow),
      timeout_frequency: diffOrNull(planned?.metrics.timeout_frequency, compatibility?.metrics.timeout_frequency),
      retry_efficiency: diffOrNull(planned?.metrics.retry_efficiency, compatibility?.metrics.retry_efficiency),
      duration_ms: diffOrNull(planned?.averageDurationMs, compatibility?.averageDurationMs),
    },
  };
}

// ── Trend ──────────────────────────────────────────────────────────────────

export interface QualityTrendPoint {
  bucket: string; // recordedAt truncated to hour
  qualityScore: number;
  samples: number;
}

export function getQualityTrend(
  engine: BenchmarkEngine,
  contentType: string,
  bucketSize: 'hour' | 'day' = 'hour',
): QualityTrendPoint[] {
  const buf = ringBuffer.get(bufferKey(engine, contentType)) ?? [];
  if (buf.length === 0) return [];
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const b of buf) {
    const key = bucketSize === 'hour'
      ? b.recordedAt.slice(0, 13) + ':00'
      : b.recordedAt.slice(0, 10);
    const cur = buckets.get(key) ?? { sum: 0, count: 0 };
    cur.sum += b.qualityScore;
    cur.count += 1;
    buckets.set(key, cur);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, v]) => ({
      bucket,
      qualityScore: Math.round(v.sum / v.count),
      samples: v.count,
    }));
}

export function __resetBenchmarkBufferForTests(): void {
  ringBuffer.clear();
}
