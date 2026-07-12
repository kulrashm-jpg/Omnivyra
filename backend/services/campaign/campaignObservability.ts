/**
 * CAMPAIGN-OPS-001 — campaign-intelligence observability (measurement only).
 *
 * Instruments the pipeline stages that did not yet emit metrics — campaign run
 * duration/outcome, Quality Engine, and Optimization Engine — through the SAME
 * HARDEN-001 registry every other stage uses. Additive + fail-safe: it changes
 * NO campaign behavior, tunes NO thresholds, and adds NO features. High-cardinality
 * identifiers (campaign_id, company_id) are intentionally NOT metric labels (they
 * would exhaust the bounded series budget) — they stay in the structured logs; only
 * low-cardinality dimensions (mode, campaign_type, grade, dimension, pass) are
 * labels.
 *
 * The `build*` functions are pure (return the metric samples) so emission is
 * testable; `emitMetrics` performs the fail-safe registry writes.
 */
import { recordRawCounter, recordRawHistogram } from '../../observability';
import type { CampaignQualityAssessment } from '../../../lib/shared/campaign/campaignQuality';
import type { OptimizationResult } from '../../../lib/shared/campaign/campaignOptimizer';

export interface MetricSample {
  kind: 'counter' | 'histogram';
  name: string;
  value: number;
  labels?: Record<string, string | number>;
}

export interface CampaignMetricContext {
  mode?: string;          // weekly | writer | creator | mix | ai_decide | …
  campaign_type?: string; // text | creator | combined | unknown
}

const base = (ctx: CampaignMetricContext = {}): Record<string, string> => ({
  mode: String(ctx.mode ?? 'weekly'),
  campaign_type: String(ctx.campaign_type ?? 'unknown'),
});

/** Quality Engine → score (histogram), grade (counter), per-dimension (histogram). */
export function buildQualityMetrics(a: CampaignQualityAssessment, ctx: CampaignMetricContext = {}): MetricSample[] {
  const b = base(ctx);
  const out: MetricSample[] = [
    { kind: 'histogram', name: 'campaign.quality.score', value: a.overall, labels: b },
    { kind: 'counter', name: 'campaign.quality.grade', value: 1, labels: { ...b, grade: a.grade } },
  ];
  for (const d of a.dimensions) {
    out.push({ kind: 'histogram', name: 'campaign.quality.dimension', value: d.score, labels: { ...b, dimension: d.key } });
  }
  return out;
}

/** Optimization Engine → before/after/delta scores, passes, and applied-change counts. */
export function buildOptimizationMetrics(r: OptimizationResult, ctx: CampaignMetricContext = {}): MetricSample[] {
  const b = base(ctx);
  const out: MetricSample[] = [
    { kind: 'histogram', name: 'campaign.optimization.before_score', value: r.before.overall, labels: b },
    { kind: 'histogram', name: 'campaign.optimization.after_score', value: r.after.overall, labels: b },
    { kind: 'histogram', name: 'campaign.optimization.delta', value: r.delta, labels: b },
    { kind: 'histogram', name: 'campaign.optimization.passes', value: r.passes_run, labels: b },
    { kind: 'counter', name: 'campaign.optimization.changes', value: r.changes.length, labels: b },
  ];
  const byPass = new Map<string, number>();
  for (const c of r.changes) byPass.set(c.pass, (byPass.get(c.pass) ?? 0) + 1);
  for (const [pass, n] of byPass) out.push({ kind: 'counter', name: 'campaign.optimization.change', value: n, labels: { ...b, pass } });
  return out;
}

/** Campaign run → execution duration + success/failure outcome. */
export function buildCampaignRunMetrics(o: { durationMs: number; success: boolean }, ctx: CampaignMetricContext = {}): MetricSample[] {
  const b = base(ctx);
  return [
    { kind: 'histogram', name: 'campaign.run.duration_ms', value: Math.max(0, Math.round(o.durationMs)), labels: b },
    { kind: 'counter', name: o.success ? 'campaign.run.success' : 'campaign.run.failure', value: 1, labels: b },
  ];
}

/** Text generation duration for one asset, labelled by content type + platform. */
export function buildGenerationDurationMetric(durationMs: number, labels: { content_type?: string; platform?: string } = {}): MetricSample {
  return {
    kind: 'histogram',
    name: 'campaign.generation.duration_ms',
    value: Math.max(0, Math.round(durationMs)),
    labels: { content_type: String(labels.content_type ?? 'unknown'), platform: String(labels.platform ?? 'unknown') },
  };
}

/** Fail-safe emission of built samples into the registry. Never throws. */
export function emitMetrics(samples: MetricSample[]): void {
  for (const s of samples) {
    try {
      if (s.kind === 'counter') recordRawCounter(s.name, s.value, s.labels);
      else recordRawHistogram(s.name, s.value, s.labels);
    } catch { /* fail-safe — observability must never break generation */ }
  }
}

export function emitQualityMetrics(a: CampaignQualityAssessment, ctx?: CampaignMetricContext): void {
  emitMetrics(buildQualityMetrics(a, ctx));
}
export function emitOptimizationMetrics(r: OptimizationResult, ctx?: CampaignMetricContext): void {
  emitMetrics(buildOptimizationMetrics(r, ctx));
}
export function emitCampaignRunMetrics(o: { durationMs: number; success: boolean }, ctx?: CampaignMetricContext): void {
  emitMetrics(buildCampaignRunMetrics(o, ctx));
}
