/**
 * Org Cost Summary Service
 *
 * Aggregates unified_transactions into per-org cost/credit/margin views.
 * Post-Phase-5: reads ONLY from unified_transactions (the reconciled ledger).
 * The older paths (usage_events + credit_usage_log) are no longer joined
 * here — the unified table already reconciles them at write time.
 *
 * Filters on final_attempt=true so intermediate retries don't double-count.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from './logger';
import { assertAnalyticsUsesUnified } from './unifiedLedgerGuard';

export interface OrgCostSummary {
  organization_id:    string;
  window_start:       string;
  window_end:         string;
  total_api_cost_usd: number;
  total_credits_used: number;
  credits_value_usd:  number;
  margin_usd:         number;
  is_negative_margin: boolean;
  breakdown: {
    by_action: Array<{ action_key: string | null; api_cost_usd: number; credits_used: number; event_count: number }>;
    by_model:  Array<{ model_name: string | null; api_cost_usd: number; event_count: number; total_tokens: number }>;
    by_source: Array<{ source_type: string; api_cost_usd: number; event_count: number }>;
  };
}

interface UnifiedRow {
  action_key:        string | null;
  model_name:        string | null;
  source_type:       string;
  api_cost_usd:      number | null;
  credits_charged:   number | null;
  credits_value_usd: number | null;
  margin_usd:        number | null;
  total_tokens:      number | null;
  input_tokens:      number | null;
  output_tokens:     number | null;
  error_flag:        boolean | null;
}

async function fetchAllUnifiedRows(orgId: string, start: string, end: string): Promise<UnifiedRow[]> {
  const PAGE = 1000;
  const out: UnifiedRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('unified_transactions')
      .select(
        'action_key, model_name, source_type, api_cost_usd, credits_charged, credits_value_usd, margin_usd, total_tokens, input_tokens, output_tokens, error_flag',
      )
      .eq('organization_id', orgId)
      .eq('final_attempt', true)
      .gte('created_at', start)
      .lt('created_at', end)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as UnifiedRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Build a cost summary for one org over [start, end). Both timestamps are ISO
 * strings. End is exclusive so callers can pass back-to-back windows without
 * double-counting. Reads from unified_transactions (final_attempt=true only).
 */
export async function getOrgCostSummary(
  orgId: string,
  start: string,
  end:   string,
): Promise<OrgCostSummary> {
  // Tripwire: asserts we're on the unified read path. Throws if any future
  // edit reintroduces a legacy-ledger read under USE_UNIFIED_LEDGER_ONLY.
  assertAnalyticsUsesUnified('orgCostSummaryService.getOrgCostSummary');

  const rows = await fetchAllUnifiedRows(orgId, start, end);

  const byAction = new Map<string, { api_cost_usd: number; credits_used: number; event_count: number }>();
  const byModel  = new Map<string, { api_cost_usd: number; event_count: number; total_tokens: number }>();
  const bySource = new Map<string, { api_cost_usd: number; event_count: number }>();

  let totalApiCost     = 0;
  let totalCreditsUsed = 0;
  let totalCreditsValueUsd = 0;

  for (const row of rows) {
    const cost    = Number(row.api_cost_usd ?? 0);
    const credits = Number(row.credits_charged ?? 0);
    const credUsd = Number(row.credits_value_usd ?? 0);

    if (Number.isFinite(cost))    totalApiCost         += cost;
    if (Number.isFinite(credits)) totalCreditsUsed     += credits;
    if (Number.isFinite(credUsd)) totalCreditsValueUsd += credUsd;

    const aKey = row.action_key ?? '__unknown__';
    const actionAgg = byAction.get(aKey) ?? { api_cost_usd: 0, credits_used: 0, event_count: 0 };
    actionAgg.api_cost_usd += cost;
    actionAgg.credits_used += credits;
    actionAgg.event_count  += 1;
    byAction.set(aKey, actionAgg);

    const mKey = row.model_name ?? '__unknown__';
    const modelAgg = byModel.get(mKey) ?? { api_cost_usd: 0, event_count: 0, total_tokens: 0 };
    modelAgg.api_cost_usd += cost;
    modelAgg.event_count  += 1;
    modelAgg.total_tokens += Number(row.total_tokens ?? 0);
    byModel.set(mKey, modelAgg);

    const sAgg = bySource.get(row.source_type) ?? { api_cost_usd: 0, event_count: 0 };
    sAgg.api_cost_usd += cost;
    sAgg.event_count  += 1;
    bySource.set(row.source_type, sAgg);
  }

  const marginUsd = totalCreditsValueUsd - totalApiCost;

  return {
    organization_id:    orgId,
    window_start:       start,
    window_end:         end,
    total_api_cost_usd: totalApiCost,
    total_credits_used: totalCreditsUsed,
    credits_value_usd:  totalCreditsValueUsd,
    margin_usd:         marginUsd,
    is_negative_margin: marginUsd < 0,
    breakdown: {
      by_action: Array.from(byAction.entries())
        .map(([action_key, v]) => ({ action_key: action_key === '__unknown__' ? null : action_key, ...v }))
        .sort((a, b) => b.api_cost_usd - a.api_cost_usd),
      by_model: Array.from(byModel.entries())
        .map(([model_name, v]) => ({ model_name: model_name === '__unknown__' ? null : model_name, ...v }))
        .sort((a, b) => b.api_cost_usd - a.api_cost_usd),
      by_source: Array.from(bySource.entries())
        .map(([source_type, v]) => ({ source_type, ...v }))
        .sort((a, b) => b.api_cost_usd - a.api_cost_usd),
    },
  };
}

/**
 * Convenience: return summaries for every org that had any usage_events
 * activity in the window. Used by the weekly rollup job.
 */
export async function listActiveOrgsInWindow(start: string, end: string): Promise<string[]> {
  assertAnalyticsUsesUnified('orgCostSummaryService.listActiveOrgsInWindow');
  try {
    const { data, error } = await supabase
      .from('unified_transactions')
      .select('organization_id')
      .gte('created_at', start)
      .lt('created_at', end);
    if (error) throw error;
    const seen = new Set<string>();
    for (const r of (data ?? []) as any[]) {
      if (r.organization_id) seen.add(String(r.organization_id));
    }
    return Array.from(seen);
  } catch (err: any) {
    logger.error('list_active_orgs_failed', { message: err?.message });
    return [];
  }
}
