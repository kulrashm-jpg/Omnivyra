/**
 * BOLT failure dashboard service.
 *
 * Reads from bolt_failure_summary (additive table populated by
 * persistPipelineFailure) and computes the rollups the super-admin
 * failure view renders:
 *
 *   - by_stage           — terminal failures grouped by failed_stage
 *   - by_provider        — terminal failures grouped by provider
 *   - by_campaign_type   — terminal failures grouped by campaign_type
 *   - by_normalized_type — terminal failures grouped by normalized_error_type
 *   - top_raw_messages   — most common raw_error_message values
 *   - unknown_count      — number of failures classified as UNKNOWN/OTHER
 *
 * All counts are filtered to is_terminal=true so a single run that
 * fired both a per-stage and an outer catch counts once.
 *
 * This is operator-facing only. The planner never reads from this
 * service. All queries are time-bounded to keep responses bounded.
 */

import { supabase } from '../db/supabaseClient';

export interface FailureDashboardFilters {
  /** Inclusive window start, ISO string. Defaults to NOW() - 7 days. */
  since?: string;
  /** Inclusive window end, ISO string. Defaults to NOW(). */
  until?: string;
  /** Optional company filter — when set, only rolls up this tenant's failures. */
  companyId?: string;
  /** Optional pipeline-mode filter (week_plan / daily_plan / schedule / …). */
  pipelineMode?: string;
  /** Hard cap on top-N rollups. Defaults to 10. */
  topN?: number;
}

export interface BucketCount {
  key: string;
  count: number;
}

export interface FailureDashboardSnapshot {
  window: { since: string; until: string };
  total_terminal_failures: number;
  by_stage: BucketCount[];
  by_provider: BucketCount[];
  by_campaign_type: BucketCount[];
  by_normalized_type: BucketCount[];
  top_raw_messages: BucketCount[];
  unknown_count: number;
}

interface SummaryRow {
  failed_stage: string | null;
  provider: string | null;
  campaign_type: string | null;
  normalized_error_type: string | null;
  raw_error_message: string | null;
}

function bucket(rows: SummaryRow[], key: keyof SummaryRow, topN: number): BucketCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    const label = v == null || v === '' ? 'unknown' : String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function bucketTruncated(rows: SummaryRow[], topN: number, truncateAt: number): BucketCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = r.raw_error_message ?? '';
    if (!raw) continue;
    const key = raw.length > truncateAt ? `${raw.slice(0, truncateAt)}…` : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export async function getFailureDashboardSnapshot(
  filters: FailureDashboardFilters = {}
): Promise<FailureDashboardSnapshot> {
  const until = filters.until ?? new Date().toISOString();
  const since = filters.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const topN = Math.max(1, Math.min(50, filters.topN ?? 10));

  let q = supabase
    .from('bolt_failure_summary')
    .select('failed_stage, provider, campaign_type, normalized_error_type, raw_error_message, pipeline_mode, company_id, occurred_at')
    .eq('is_terminal', true)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .order('occurred_at', { ascending: false })
    // Hard cap so a runaway query against an unindexed window can't
    // pull a million rows into the API process. Dashboards display
    // aggregated counts so an upper bound is fine.
    .limit(5_000);

  if (filters.companyId) q = q.eq('company_id', filters.companyId);
  if (filters.pipelineMode) q = q.eq('pipeline_mode', filters.pipelineMode);

  const { data, error } = await q;
  if (error) {
    return {
      window: { since, until },
      total_terminal_failures: 0,
      by_stage: [],
      by_provider: [],
      by_campaign_type: [],
      by_normalized_type: [],
      top_raw_messages: [],
      unknown_count: 0,
    };
  }

  const rows = (data ?? []) as SummaryRow[];
  return {
    window: { since, until },
    total_terminal_failures: rows.length,
    by_stage: bucket(rows, 'failed_stage', topN),
    by_provider: bucket(rows, 'provider', topN),
    by_campaign_type: bucket(rows, 'campaign_type', topN),
    by_normalized_type: bucket(rows, 'normalized_error_type', topN),
    top_raw_messages: bucketTruncated(rows, topN, 160),
    unknown_count: rows.filter((r) => r.normalized_error_type === 'UNKNOWN' || r.normalized_error_type === 'OTHER').length,
  };
}

export interface FailureListItem {
  id: string;
  run_id: string;
  campaign_id: string | null;
  company_id: string | null;
  failed_stage: string;
  current_stage: string | null;
  pipeline_mode: string | null;
  campaign_type: string | null;
  raw_error_message: string | null;
  provider: string | null;
  normalized_error_type: string | null;
  retriable: boolean | null;
  occurred_at: string;
}

export interface ListFailuresFilters extends FailureDashboardFilters {
  /** Restrict to a specific normalized category. */
  normalizedType?: string;
  /** Restrict to a specific provider. */
  provider?: string;
  /** Restrict to a specific failed_stage. */
  stage?: string;
  /** Pagination — number of rows to return. Capped at 200. */
  limit?: number;
}

export async function listTerminalFailures(filters: ListFailuresFilters = {}): Promise<FailureListItem[]> {
  const until = filters.until ?? new Date().toISOString();
  const since = filters.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));

  let q = supabase
    .from('bolt_failure_summary')
    .select('id, run_id, campaign_id, company_id, failed_stage, current_stage, pipeline_mode, campaign_type, raw_error_message, provider, normalized_error_type, retriable, occurred_at')
    .eq('is_terminal', true)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (filters.companyId) q = q.eq('company_id', filters.companyId);
  if (filters.pipelineMode) q = q.eq('pipeline_mode', filters.pipelineMode);
  if (filters.normalizedType) q = q.eq('normalized_error_type', filters.normalizedType);
  if (filters.provider) q = q.eq('provider', filters.provider);
  if (filters.stage) q = q.eq('failed_stage', filters.stage);

  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as FailureListItem[];
}

export interface FailureDetail extends FailureListItem {
  strategy_id: string | null;
  stack_excerpt: string | null;
  strategy_snapshot: Record<string, unknown> | null;
  /** Sibling rows for the same run (every catch site, including non-terminal). */
  run_history: Array<{
    id: string;
    failed_stage: string;
    normalized_error_type: string | null;
    provider: string | null;
    raw_error_message: string | null;
    occurred_at: string;
    is_terminal: boolean;
  }>;
}

export async function getFailureDetail(failureId: string): Promise<FailureDetail | null> {
  const { data: row, error } = await supabase
    .from('bolt_failure_summary')
    .select('id, run_id, campaign_id, company_id, strategy_id, failed_stage, current_stage, pipeline_mode, campaign_type, raw_error_message, stack_excerpt, provider, normalized_error_type, retriable, strategy_snapshot, occurred_at')
    .eq('id', failureId)
    .maybeSingle();
  if (error || !row) return null;

  const detail = row as FailureDetail;

  // Pull the full run timeline so operators can see every catch
  // that fired for this run, terminal or not.
  const { data: siblings } = await supabase
    .from('bolt_failure_summary')
    .select('id, failed_stage, normalized_error_type, provider, raw_error_message, occurred_at, is_terminal')
    .eq('run_id', detail.run_id)
    .order('occurred_at', { ascending: true });

  detail.run_history = (siblings ?? []) as FailureDetail['run_history'];
  return detail;
}
