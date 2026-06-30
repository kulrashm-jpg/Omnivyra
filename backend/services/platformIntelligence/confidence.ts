/**
 * Platform Confidence Engine (Phase 21B, Phase G).
 * One confidence/coverage model for every intelligence domain: confidence = evaluable
 * checks / total checks (evidence coverage), with deterministic score aggregation. Pure.
 * Website Intelligence's engineCommon re-exports this (Consumer #1).
 */
export type IntelHealth = 'healthy' | 'warning' | 'critical' | 'unavailable';
export type Readiness = 'ready' | 'partial' | 'not_ready';

export interface Provenance {
  sources: string[];
  checksEvaluated: number;
  checksTotal: number;
  deterministic: true;
}

/** A single deterministic check result. status 'not_evaluable' = no stored data (honest gap). */
export interface CheckResult {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'not_evaluable';
  score: number | null;
  detail?: string;
}

export const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, Math.round(n)));

export const healthFromScore = (s: number | null): IntelHealth =>
  s == null ? 'unavailable' : s >= 80 ? 'healthy' : s >= 55 ? 'warning' : 'critical';

export const readinessFromScore = (s: number | null, conf: number): Readiness =>
  s == null ? 'not_ready' : s >= 75 && conf >= 0.5 ? 'ready' : s >= 50 ? 'partial' : 'not_ready';

/**
 * Aggregate evaluable checks into a 0..100 score + confidence (= evaluable / total).
 * Returns score=null when nothing was evaluable (honest "unavailable", never fabricated).
 */
export function aggregate(checks: CheckResult[]): { score: number | null; confidence: number; evaluated: number; total: number } {
  const total = checks.length;
  const evaluable = checks.filter((c) => c.status !== 'not_evaluable' && typeof c.score === 'number');
  if (evaluable.length === 0) return { score: null, confidence: 0, evaluated: 0, total };
  const score = clamp(evaluable.reduce((a, c) => a + (c.score as number), 0) / evaluable.length);
  return { score, confidence: Math.round((evaluable.length / total) * 100) / 100, evaluated: evaluable.length, total };
}
