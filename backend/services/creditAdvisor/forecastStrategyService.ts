/**
 * Credit Advisor — Recency-aware forecasting (Phases 3/4/6).
 *
 * Computes 3d / 7d / 30d burn + a weighted blend, then exposes three runway
 * models (conservative / balanced / aggressive) with plain-language explanations.
 * Does NOT replace the existing 30-day forecast — it adds context. Deterministic,
 * READ-ONLY. Weights are configurable via env (CREDIT_FORECAST_W3/W7/W30).
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import { runwayDays } from './creditForecastService';
import type {
  BurnWindows,
  ForecastExplanation,
  ForecastStrategy,
  MultiRunway,
} from './creditAdvisorTypes';

const DAY_MS = 86_400_000;

function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Default weights: recent usage dominates. Overridable via env. */
export function resolveWeights(): { d3: number; d7: number; d30: number } {
  let d3 = envNum('CREDIT_FORECAST_W3', 0.5);
  let d7 = envNum('CREDIT_FORECAST_W7', 0.3);
  let d30 = envNum('CREDIT_FORECAST_W30', 0.2);
  const sum = d3 + d7 + d30;
  if (sum <= 0) return { d3: 0.5, d7: 0.3, d30: 0.2 };
  return { d3: d3 / sum, d7: d7 / sum, d30: d30 / sum }; // normalize to 1
}

function sumSince(rows: ConsumptionRow[], sinceMs: number): number {
  let t = 0;
  for (const r of rows) if (new Date(r.created_at).getTime() >= sinceMs) t += r.credits;
  return t;
}

export function computeForecastStrategy(
  rows: ConsumptionRow[],
  remaining: number,
  now = new Date(),
): ForecastStrategy {
  const t = now.getTime();
  const weights = resolveWeights();

  const burn_3d = sumSince(rows, t - 3 * DAY_MS) / 3;
  const burn_7d = sumSince(rows, t - 7 * DAY_MS) / 7;
  const burn_30d = sumSince(rows, t - 30 * DAY_MS) / 30;
  const weighted = burn_3d * weights.d3 + burn_7d * weights.d7 + burn_30d * weights.d30;

  const windows: BurnWindows = {
    burn_3d: Math.round(burn_3d * 100) / 100,
    burn_7d: Math.round(burn_7d * 100) / 100,
    burn_30d: Math.round(burn_30d * 100) / 100,
    weighted: Math.round(weighted * 100) / 100,
    weights,
  };

  const highest = Math.max(burn_3d, burn_7d, burn_30d);
  const highestLabel =
    highest === burn_3d ? '3-day' : highest === burn_7d ? '7-day' : '30-day';

  const runways: MultiRunway = {
    conservative: {
      days: runwayDays(remaining, highest),
      daily_burn: Math.round(highest * 100) / 100,
      basis: `highest recent burn (${highestLabel} = ${Math.round(highest)}/day)`,
    },
    balanced: {
      days: runwayDays(remaining, weighted),
      daily_burn: windows.weighted,
      basis: `weighted burn (3d×${weights.d3.toFixed(2)} + 7d×${weights.d7.toFixed(2)} + 30d×${weights.d30.toFixed(2)} = ${Math.round(weighted)}/day)`,
    },
    aggressive: {
      days: runwayDays(remaining, burn_30d),
      daily_burn: windows.burn_30d,
      basis: `30-day average (${Math.round(burn_30d)}/day)`,
    },
  };

  const explanation: ForecastExplanation = {
    headline_days: runways.aggressive.days,
    headline_basis: `30-day burn = ${Math.round(burn_30d)}/day`,
    recent_days: runways.conservative.days,
    recent_basis: `${highestLabel} burn = ${Math.round(highest)}/day`,
    note:
      runways.conservative.days !== null &&
      runways.aggressive.days !== null &&
      runways.aggressive.days > runways.conservative.days * 1.3
        ? 'Recent usage is materially higher than the 30-day average — treat the conservative runway as the real risk.'
        : 'Recent usage is in line with the 30-day average.',
  };

  return { windows, runways, explanation };
}
