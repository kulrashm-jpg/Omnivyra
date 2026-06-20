/**
 * Credit Advisor — Phase 4: Attribution Engine.
 *
 * Attributes consumption by MODULE / ACTIVITY / VARIANT / USER with
 * credits, percentage, and trend. Deterministic aggregation over the
 * already-loaded consumption rows. READ-ONLY.
 */

import type { ConsumptionRow } from './consumptionMetricsService';
import { moduleForActionKey, activityForActionKey } from './creditAdvisorTaxonomy';
import type {
  AttributionResult,
  AttributionRow,
  TrendDirection,
} from './creditAdvisorTypes';

const DAY_MS = 86_400_000;

interface Bucket {
  key: string;
  label: string;
  credits: number;
  recent: number;
  prior: number;
}

function trendOf(recent: number, prior: number): TrendDirection {
  if (prior <= 0) return recent > 0 ? 'up' : 'flat';
  const delta = (recent - prior) / prior;
  if (delta > 0.15) return 'up';
  if (delta < -0.15) return 'down';
  return 'flat';
}

function finalize(buckets: Map<string, Bucket>, total: number): AttributionRow[] {
  return Array.from(buckets.values())
    .map((b) => ({
      key: b.key,
      label: b.label,
      credits: Math.round(b.credits),
      percentage: total > 0 ? Math.round((b.credits / total) * 1000) / 10 : 0,
      trend: trendOf(b.recent, b.prior),
    }))
    .sort((a, b) => b.credits - a.credits);
}

/**
 * Build module / activity / variant / user attribution from consumption rows.
 *
 * @param rows  per-event rows from loadConsumptionRows()
 * @param days  the window length (for the recent/prior trend split midpoint)
 */
export function computeAttribution(rows: ConsumptionRow[], days: number): AttributionResult {
  const midpointMs = Date.now() - (days / 2) * DAY_MS;
  const total = rows.reduce((s, r) => s + r.credits, 0);

  const modules = new Map<string, Bucket>();
  const activities = new Map<string, Bucket>();
  const variants = new Map<string, Bucket>();
  const users = new Map<string, Bucket>();

  const bump = (map: Map<string, Bucket>, key: string, label: string, r: ConsumptionRow) => {
    let b = map.get(key);
    if (!b) {
      b = { key, label, credits: 0, recent: 0, prior: 0 };
      map.set(key, b);
    }
    b.credits += r.credits;
    if (new Date(r.created_at).getTime() >= midpointMs) b.recent += r.credits;
    else b.prior += r.credits;
  };

  for (const r of rows) {
    const moduleLabel = moduleForActionKey(r.action);
    const activityLabel = activityForActionKey(r.action);
    const userKey = r.user_id ?? 'system';
    const userLabel = r.user_id ? `User ${r.user_id.slice(0, 8)}` : 'System / automated';

    bump(modules, moduleLabel, moduleLabel, r);
    bump(activities, activityLabel, activityLabel, r);
    bump(variants, r.action, r.action, r);
    bump(users, userKey, userLabel, r);
  }

  return {
    total_credits: Math.round(total),
    by_module: finalize(modules, total),
    by_activity: finalize(activities, total),
    by_variant: finalize(variants, total),
    by_user: finalize(users, total),
    window_days: days,
  };
}
