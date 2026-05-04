/**
 * Weekly Pricing Analysis Job
 *
 * Rolls up the trailing ISO-week (Monday 00:00 UTC → Monday 00:00 UTC) of
 * usage_events + credit_usage_log per active org, writes one
 * org_weekly_metrics row per (org, week), and emits cost_anomalies for:
 *   - negative margin (credits paid < API cost we incurred)
 *   - cost spike (≥ 2× previous week's api_cost)
 *   - weekly over-limit (env WEEKLY_ORG_COST_LIMIT_USD)
 *
 * Idempotent via org_weekly_metrics.UNIQUE(organization_id, week_start) —
 * a second run overwrites via upsert with fresh computed values.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getOrgCostSummary, listActiveOrgsInWindow } from '../services/orgCostSummaryService';
import { recordCostAnomaly, getActionPricing } from '../services/pricingService';
import {
  computeMarginPercent,
  computeMultiplierRecommendation,
} from '../services/pricingIntelligenceService';
import { logger } from '../services/logger';

const COST_SPIKE_MULTIPLIER = 2.0;
const WEEKLY_ORG_COST_LIMIT_USD = Number(process.env.WEEKLY_ORG_COST_LIMIT_USD ?? '500');

export interface WeeklyPricingAnalysisResult {
  week_start:        string;
  orgs_processed:    number;
  rows_written:      number;
  negative_margin:   number;
  cost_spikes:       number;
  over_limit:        number;
  // ── Phase 6 additions ───────────────────────────────────────────────────
  intelligence_rows:   number;  // pricing_intelligence rows written
  deviations_detected: number;  // rows with deviation_flag=true
  adjustments_queued:  number;  // pricing_adjustment_queue inserts
  leaks_detected:      number;  // structural_leak anomalies emitted
  errors:            string[];
}

/** Monday-of-this-week at 00:00 UTC, as a Date. */
function currentWeekStartUtc(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, …
  const offsetToMonday = (day + 6) % 7; // Mon→0, Tue→1, … Sun→6
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetToMonday));
  return monday;
}

function weekStartIso(monday: Date): string {
  return monday.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function runWeeklyPricingAnalysis(): Promise<WeeklyPricingAnalysisResult> {
  const thisMonday = currentWeekStartUtc();
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400 * 1000);

  // Analyse the COMPLETED week [lastMonday, thisMonday).
  const windowStart = lastMonday.toISOString();
  const windowEnd   = thisMonday.toISOString();

  // Previous completed week [prevPrevMonday, lastMonday) — used for spike detection.
  const prevPrevMonday = new Date(lastMonday.getTime() - 7 * 86400 * 1000);
  const prevWindowStart = prevPrevMonday.toISOString();
  const prevWindowEnd   = windowStart;

  const result: WeeklyPricingAnalysisResult = {
    week_start:          weekStartIso(lastMonday),
    orgs_processed:      0,
    rows_written:        0,
    negative_margin:     0,
    cost_spikes:         0,
    over_limit:          0,
    intelligence_rows:   0,
    deviations_detected: 0,
    adjustments_queued:  0,
    leaks_detected:      0,
    errors:              [],
  };

  const orgs = await listActiveOrgsInWindow(windowStart, windowEnd);
  result.orgs_processed = orgs.length;

  for (const orgId of orgs) {
    try {
      const [summary, prevSummary] = await Promise.all([
        getOrgCostSummary(orgId, windowStart, windowEnd),
        getOrgCostSummary(orgId, prevWindowStart, prevWindowEnd),
      ]);

      const isSpike =
        prevSummary.total_api_cost_usd > 0 &&
        summary.total_api_cost_usd >= COST_SPIKE_MULTIPLIER * prevSummary.total_api_cost_usd;

      const overLimit = summary.total_api_cost_usd > WEEKLY_ORG_COST_LIMIT_USD;

      const topAction = summary.breakdown.by_action[0];

      const { error: upsertErr } = await supabase
        .from('org_weekly_metrics')
        .upsert({
          organization_id:     orgId,
          week_start:          result.week_start,
          total_api_cost_usd:  summary.total_api_cost_usd,
          total_credits_used:  summary.total_credits_used,
          credits_value_usd:   summary.credits_value_usd,
          margin_usd:          summary.margin_usd,
          is_negative_margin:  summary.is_negative_margin,
          is_cost_spike:       isSpike,
          top_action_key:      topAction?.action_key ?? null,
          top_action_cost_usd: topAction?.api_cost_usd ?? null,
          breakdown:           summary.breakdown,
          computed_at:         new Date().toISOString(),
        }, { onConflict: 'organization_id,week_start' });

      if (upsertErr) {
        result.errors.push(`${orgId}: upsert failed — ${upsertErr.message}`);
        continue;
      }

      result.rows_written += 1;
      if (summary.is_negative_margin) result.negative_margin += 1;
      if (isSpike)                     result.cost_spikes     += 1;
      if (overLimit)                   result.over_limit      += 1;

      if (overLimit) {
        void recordCostAnomaly({
          organizationId:  orgId,
          type:            'cost_exceeds_weekly_limit',
          severity:        'critical',
          apiCostUsd:      summary.total_api_cost_usd,
          creditsValueUsd: summary.credits_value_usd,
          metadata: {
            week_start:    result.week_start,
            limit_usd:     WEEKLY_ORG_COST_LIMIT_USD,
            spike:         isSpike,
            top_action:    topAction?.action_key,
          },
        });
      } else if (summary.is_negative_margin) {
        void recordCostAnomaly({
          organizationId:  orgId,
          type:            'cost_credit_mismatch',
          // Severity critical when the loss is material (> $10 in a week)
          severity:        summary.total_api_cost_usd - summary.credits_value_usd > 10 ? 'critical' : 'warn',
          apiCostUsd:      summary.total_api_cost_usd,
          creditsValueUsd: summary.credits_value_usd,
          metadata: {
            week_start: result.week_start,
            margin_usd: summary.margin_usd,
            top_action: topAction?.action_key,
          },
        });
      }
    } catch (err: any) {
      result.errors.push(`${orgId}: ${err?.message ?? 'unknown'}`);
      logger.error('weekly_pricing_analysis_org_failed', { orgId, message: err?.message });
    }
  }

  // ── Phase 6: per (action_key, model_name) pricing intelligence ──────────
  try {
    const intel = await computePricingIntelligence(windowStart, windowEnd, result.week_start);
    result.intelligence_rows   = intel.rows_written;
    result.deviations_detected = intel.deviations_detected;
    result.adjustments_queued  = intel.adjustments_queued;
  } catch (err: any) {
    result.errors.push(`pricing_intelligence: ${err?.message ?? 'unknown'}`);
    logger.error('weekly_pricing_intelligence_failed', { message: err?.message });
  }

  // ── Phase 6: structural leak scan ───────────────────────────────────────
  try {
    const leaks = await scanStructuralLeaks(windowStart, windowEnd);
    result.leaks_detected = leaks;
  } catch (err: any) {
    result.errors.push(`leak_scan: ${err?.message ?? 'unknown'}`);
    logger.error('weekly_leak_scan_failed', { message: err?.message });
  }

  return result;
}

// =============================================================================
// Phase 6 — internal helpers
// =============================================================================

interface IntelGroupRow {
  action_key:              string;
  model_name:              string | null;
  total_api_cost_usd:      number;
  total_credits_value_usd: number;
  event_count:             number;
}

/**
 * Read unified_transactions for the window and aggregate per (action, model)
 * across ALL orgs. Multipliers are global, so pricing decisions are global.
 */
async function fetchIntelGroups(windowStart: string, windowEnd: string): Promise<IntelGroupRow[]> {
  const PAGE = 1000;
  const byKey = new Map<string, IntelGroupRow>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('unified_transactions')
      .select('action_key, model_name, api_cost_usd, credits_value_usd')
      .not('action_key', 'is', null)
      .eq('final_attempt', true)
      .gte('created_at', windowStart)
      .lt('created_at', windowEnd)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ action_key: string; model_name: string | null; api_cost_usd: number | null; credits_value_usd: number | null }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = `${row.action_key}|${row.model_name ?? '__null__'}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          action_key:              row.action_key,
          model_name:              row.model_name,
          total_api_cost_usd:      0,
          total_credits_value_usd: 0,
          event_count:             0,
        };
        byKey.set(key, agg);
      }
      agg.total_api_cost_usd      += Number(row.api_cost_usd       ?? 0);
      agg.total_credits_value_usd += Number(row.credits_value_usd ?? 0);
      agg.event_count             += 1;
    }
    if (rows.length < PAGE) break;
  }

  return Array.from(byKey.values());
}

async function computePricingIntelligence(
  windowStart: string,
  windowEnd:   string,
  weekStart:   string,
): Promise<{ rows_written: number; deviations_detected: number; adjustments_queued: number }> {
  const groups = await fetchIntelGroups(windowStart, windowEnd);
  let rowsWritten       = 0;
  let deviationsCount   = 0;
  let adjustmentsQueued = 0;

  for (const g of groups) {
    const marginUsd     = g.total_credits_value_usd - g.total_api_cost_usd;
    const marginPercent = computeMarginPercent(g.total_api_cost_usd, g.total_credits_value_usd);
    const currentMultiplier = (await getActionPricing(g.action_key)).cost_multiplier;
    const rec = computeMultiplierRecommendation(currentMultiplier, marginPercent);

    const { error: upsertErr } = await supabase
      .from('pricing_intelligence')
      .upsert({
        action_key:              g.action_key,
        model_name:              g.model_name,
        week_start:              weekStart,
        total_api_cost_usd:      g.total_api_cost_usd,
        total_credits_value_usd: g.total_credits_value_usd,
        margin_usd:              marginUsd,
        margin_percent:          marginPercent,
        current_multiplier:      currentMultiplier,
        recommended_multiplier:  rec.recommended_multiplier,
        deviation_flag:          rec.deviation_flag,
        event_count:             g.event_count,
      }, { onConflict: 'action_key,model_name,week_start' });

    if (upsertErr) {
      logger.warn('pricing_intel_upsert_failed', {
        action: g.action_key,
        model:  g.model_name,
        message: upsertErr.message,
      });
      continue;
    }
    rowsWritten += 1;
    if (rec.deviation_flag) deviationsCount += 1;

    // Queue a SAFE-MODE adjustment proposal when the recommendation warrants
    // a real change. Supersede any older pending proposal for the same
    // (action, model) so the queue never shows stale suggestions.
    if (rec.proposed_multiplier != null && rec.deviation_flag) {
      await supabase
        .from('pricing_adjustment_queue')
        .update({ status: 'superseded' })
        .eq('action_key', g.action_key)
        .is('model_name', g.model_name)   // null-safe match
        .eq('status', 'pending');

      const { error: queueErr } = await supabase.from('pricing_adjustment_queue').insert({
        action_key:          g.action_key,
        model_name:          g.model_name,
        current_multiplier:  currentMultiplier,
        proposed_multiplier: rec.proposed_multiplier,
        margin_percent:      marginPercent,
        reason:              rec.reason,
        status:              'pending',
        source_week:         weekStart,
      });
      if (queueErr) {
        // Unique-violation on (action_key, model_name, 'pending') means a
        // concurrent run beat us; treat as non-error.
        if ((queueErr as any).code !== '23505') {
          logger.warn('pricing_queue_insert_failed', {
            action: g.action_key,
            model:  g.model_name,
            message: queueErr.message,
          });
        }
      } else {
        adjustmentsQueued += 1;
      }
    }
  }

  return { rows_written: rowsWritten, deviations_detected: deviationsCount, adjustments_queued: adjustmentsQueued };
}

/**
 * Structural leak = a billable LLM/embedding/external_api call that recorded
 * api_cost but charged zero credits. Excludes system/internal/cache where
 * zero-credit is expected. Emits one critical cost_anomalies row per
 * (action, model) with the leak count + total unrecovered $ in metadata.
 */
async function scanStructuralLeaks(windowStart: string, windowEnd: string): Promise<number> {
  type LeakRow = {
    organization_id: string;
    action_key:      string | null;
    model_name:      string | null;
    api_cost_usd:    number | null;
  };

  const PAGE = 1000;
  type Agg = { count: number; total_cost: number; sample_orgs: Set<string> };
  const groups = new Map<string, { action_key: string; model_name: string | null; agg: Agg }>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('unified_transactions')
      .select('organization_id, action_key, model_name, api_cost_usd')
      .in('source_type', ['llm', 'embedding', 'external_api'])
      .eq('final_attempt', true)
      .eq('error_flag', false)
      .gt('api_cost_usd', 0)
      .or('credits_charged.is.null,credits_charged.eq.0')
      .gte('created_at', windowStart)
      .lt('created_at', windowEnd)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as LeakRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = `${row.action_key ?? '__null__'}|${row.model_name ?? '__null__'}`;
      let entry = groups.get(key);
      if (!entry) {
        entry = {
          action_key: row.action_key ?? 'unknown',
          model_name: row.model_name,
          agg: { count: 0, total_cost: 0, sample_orgs: new Set() },
        };
        groups.set(key, entry);
      }
      entry.agg.count      += 1;
      entry.agg.total_cost += Number(row.api_cost_usd ?? 0);
      if (entry.agg.sample_orgs.size < 5) entry.agg.sample_orgs.add(row.organization_id);
    }
    if (rows.length < PAGE) break;
  }

  for (const { action_key, model_name, agg } of groups.values()) {
    await recordCostAnomaly({
      type:       'structural_leak',
      severity:   'critical',
      actionKey:  action_key,
      modelName:  model_name,
      apiCostUsd: agg.total_cost,
      metadata: {
        leak_count:       agg.count,
        leak_total_usd:   agg.total_cost,
        window_start:     windowStart,
        window_end:       windowEnd,
        sample_org_ids:   Array.from(agg.sample_orgs),
      },
    });
  }

  return groups.size;
}
