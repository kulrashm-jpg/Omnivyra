/**
 * convergenceTelemetry.ts
 *
 * Phase 9.3 — Aggregate convergence telemetry across articles.
 *
 * Phase 5.5 produced per-article `ArticleConvergenceResult` records.
 * Phase 9.3 aggregates them so the retirement governance snapshot can
 * report a real `convergenceRate` (instead of the placeholder 0 from
 * Phase 8.9).
 *
 * `recordConvergence()` is called from the orchestrator on every
 * article exit. `getConvergenceAggregateReport()` summarises across
 * the rolling buffer.
 */

import type { ArticleConvergenceResult, ShipRecommendation } from './articleConvergence';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ConvergenceAggregateReport {
  total_articles: number;
  convergenceRate: number;        // fraction with shipRecommendation === SHIP or SHIP_WITH_SOFTENING
  avgConvergenceScore: number;    // 0..100
  abortRate: number;
  partialShipRate: number;
  repairRequiredRate: number;
  shipWithSofteningRate: number;
  shipRate: number;
  per_content_type: Array<{
    content_type: string;
    samples: number;
    avg_convergence_score: number;
    convergence_rate: number;
    abort_rate: number;
    partial_ship_rate: number;
  }>;
  by_recommendation: Record<ShipRecommendation, number>;
  recent_samples: Array<{
    recorded_at: string;
    content_type: string;
    topic: string;
    convergenceScore: number;
    shipRecommendation: ShipRecommendation;
  }>;
}

interface ConvergenceSample {
  recorded_at: string;
  content_type: string;
  topic: string;
  company_id: string | null;
  convergenceScore: number;
  shipRecommendation: ShipRecommendation;
}

// ── Rolling buffer ──────────────────────────────────────────────────────────

const RING_CAPACITY = 500;
const samples: ConvergenceSample[] = [];

// ── Recording ───────────────────────────────────────────────────────────────

export function recordConvergence(input: {
  content_type: string;
  topic: string;
  company_id: string | null;
  result: ArticleConvergenceResult;
}): void {
  const sample: ConvergenceSample = {
    recorded_at: new Date().toISOString(),
    content_type: input.content_type,
    topic: input.topic,
    company_id: input.company_id,
    convergenceScore: input.result.convergenceScore,
    shipRecommendation: input.result.shipRecommendation,
  };
  samples.push(sample);
  while (samples.length > RING_CAPACITY) samples.shift();
  // Emit a structured event for log scrapers.
  console.log(`[longform-convergence] ${JSON.stringify({
    event: 'LONGFORM_CONVERGENCE_SAMPLE',
    ...sample,
    timestamp: sample.recorded_at,
  })}`);
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function shareOf(count: number, total: number): number {
  return total > 0 ? Number((count / total).toFixed(4)) : 0;
}

export function getConvergenceAggregateReport(): ConvergenceAggregateReport {
  const total = samples.length;
  const byRec: Record<ShipRecommendation, number> = {
    SHIP: 0,
    SHIP_WITH_SOFTENING: 0,
    PARTIAL_SHIP: 0,
    REPAIR_REQUIRED: 0,
    ABORT: 0,
  };
  let scoreSum = 0;
  const byCt = new Map<string, { samples: number; scoreSum: number; converged: number; aborted: number; partial: number }>();

  for (const s of samples) {
    byRec[s.shipRecommendation] = (byRec[s.shipRecommendation] ?? 0) + 1;
    scoreSum += s.convergenceScore;
    const bucket = byCt.get(s.content_type) ?? { samples: 0, scoreSum: 0, converged: 0, aborted: 0, partial: 0 };
    bucket.samples += 1;
    bucket.scoreSum += s.convergenceScore;
    if (s.shipRecommendation === 'SHIP' || s.shipRecommendation === 'SHIP_WITH_SOFTENING') bucket.converged += 1;
    if (s.shipRecommendation === 'ABORT') bucket.aborted += 1;
    if (s.shipRecommendation === 'PARTIAL_SHIP') bucket.partial += 1;
    byCt.set(s.content_type, bucket);
  }

  const ship = byRec.SHIP;
  const shipSoftening = byRec.SHIP_WITH_SOFTENING;
  const partial = byRec.PARTIAL_SHIP;
  const repair = byRec.REPAIR_REQUIRED;
  const abort = byRec.ABORT;
  const converged = ship + shipSoftening;

  return {
    total_articles: total,
    convergenceRate: shareOf(converged, total),
    avgConvergenceScore: total > 0 ? Math.round(scoreSum / total) : 0,
    abortRate: shareOf(abort, total),
    partialShipRate: shareOf(partial, total),
    repairRequiredRate: shareOf(repair, total),
    shipWithSofteningRate: shareOf(shipSoftening, total),
    shipRate: shareOf(ship, total),
    per_content_type: Array.from(byCt.entries()).map(([content_type, b]) => ({
      content_type,
      samples: b.samples,
      avg_convergence_score: b.samples > 0 ? Math.round(b.scoreSum / b.samples) : 0,
      convergence_rate: shareOf(b.converged, b.samples),
      abort_rate: shareOf(b.aborted, b.samples),
      partial_ship_rate: shareOf(b.partial, b.samples),
    })),
    by_recommendation: byRec,
    recent_samples: samples.slice(-20).map((s) => ({
      recorded_at: s.recorded_at,
      content_type: s.content_type,
      topic: s.topic,
      convergenceScore: s.convergenceScore,
      shipRecommendation: s.shipRecommendation,
    })),
  };
}

/** Convenience: just the rate for callers that don't need the full report. */
export function getConvergenceRate(): number {
  const total = samples.length;
  if (total === 0) return 0;
  const converged = samples.filter(
    (s) => s.shipRecommendation === 'SHIP' || s.shipRecommendation === 'SHIP_WITH_SOFTENING',
  ).length;
  return Number((converged / total).toFixed(4));
}

// Seed from durable persistence on boot — fed by operationalStatePersistence.
export function seedConvergenceSamples(historicalSamples: ConvergenceSample[]): void {
  for (const s of historicalSamples) {
    samples.push(s);
    if (samples.length > RING_CAPACITY) samples.shift();
  }
}

export function __resetConvergenceTelemetryForTests(): void {
  samples.length = 0;
}
