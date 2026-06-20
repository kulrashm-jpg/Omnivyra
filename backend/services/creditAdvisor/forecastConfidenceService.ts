/**
 * Credit Advisor — Phase 7/8: Forecast Confidence + sparse-data handling.
 *
 * Scores how trustworthy the forecast is from four factors: usage history span,
 * attribution coverage, data volume, and recent volatility. Flags limited data
 * and caps the level to avoid false precision. Deterministic, READ-ONLY.
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import type {
  ConfidenceLevel,
  ForecastConfidence,
} from './creditAdvisorTypes';

const DAY_MS = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function volumeFactor(events: number): number {
  if (events >= 200) return 100;
  if (events >= 100) return 85;
  if (events >= 50) return 70;
  if (events >= 20) return 50;
  if (events >= 5) return 30;
  return 10;
}

function levelFor(score: number): ConfidenceLevel {
  if (score >= 85) return 'Very High';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Medium';
  if (score >= 30) return 'Low';
  return 'Very Low';
}

function capLevel(level: ConfidenceLevel): ConfidenceLevel {
  // Limited data must never read as High/Very High.
  if (level === 'Very High' || level === 'High') return 'Low';
  return level;
}

export function computeConfidence(
  rows: ConsumptionRow[],
  coveragePct: number,
  spikeMagnitude: number,
  now = new Date(),
): ForecastConfidence {
  const events = rows.length;

  // History span (days between earliest and latest event).
  let spanDays = 0;
  if (events > 0) {
    const times = rows.map((r) => new Date(r.created_at).getTime());
    spanDays = (Math.max(...times) - Math.min(...times)) / DAY_MS;
  }

  const usage_history = clamp((spanDays / 21) * 100);
  const data_volume = volumeFactor(events);
  const attribution_coverage = clamp(coveragePct);
  const volatility = Number.isFinite(spikeMagnitude) ? spikeMagnitude : 5;
  const recent_volatility = clamp(100 - Math.max(0, volatility - 1) * 40);

  const score = Math.round(
    usage_history * 0.25 +
      data_volume * 0.3 +
      attribution_coverage * 0.25 +
      recent_volatility * 0.2,
  );

  const limited_data = events < 20 || spanDays < 7;
  let level = levelFor(score);
  if (limited_data) level = capLevel(level);

  const message = limited_data
    ? `Limited usage history (${events} events over ${Math.round(spanDays)}d) — forecasts are directional, not precise.`
    : level === 'Very Low' || level === 'Low'
      ? 'Volatile or thin data — runway is uncertain; prefer the conservative figure.'
      : 'Sufficient history and coverage — forecasts are reliable.';

  return {
    level,
    score: clamp(score),
    factors: {
      usage_history: Math.round(usage_history),
      attribution_coverage: Math.round(attribution_coverage),
      data_volume,
      recent_volatility: Math.round(recent_volatility),
    },
    limited_data,
    message,
  };
}
