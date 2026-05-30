/**
 * BOLT row-failure dashboard reads.
 *
 * Companion to boltRowFailureDiagnostics.ts (writer) and
 * boltFailureDashboard.ts (run-level reads). Provides:
 *
 *   - listRowFailuresForFailure(failureId, filters)
 *     → paginated, filterable rows linked to the parent failure
 *       summary row's run_id
 *   - getRowFailureSummary(failureId)
 *     → aggregations: rows failed, codes, platforms, content types,
 *       weeks
 *   - checkRowDiagnosticsTableExists()
 *     → migration-readiness probe. Returns `{ exists, error_message }`
 *       so the API can return a graceful "migration required" response
 *       instead of a 500.
 *
 * All reads scope to the parent failure's `run_id` so dashboard
 * surfaces stay within the per-run audit trail. The failure id is
 * the user-facing handle the operator clicks from the failure list.
 *
 * No write paths. No mutation. Read-only.
 */

import { supabase } from '../db/supabaseClient';

export interface RowFailureListItem {
  id: string;
  run_id: string;
  campaign_id: string | null;
  company_id: string | null;
  daily_plan_id: string | null;
  week_number: number | null;
  activity_id: string | null;
  platform: string | null;
  content_type: string | null;
  failure_code: string;
  failure_category: string | null;
  failure_message: string;
  failure_field: string | null;
  failure_details: Record<string, unknown> | null;
  stage: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RowFailureFilters {
  /** Filter by stable BOLT error code. */
  failureCode?: string;
  /** Filter by platform key (linkedin / x / instagram / …). */
  platform?: string;
  /** Filter by canonical content type. */
  contentType?: string;
  /** Free-text search applied to failure_message via ilike. */
  search?: string;
  /** Page size — capped at 200. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Sort column. Restricted to a small allow-list. */
  sort?: 'occurred_at' | 'failure_code' | 'platform' | 'content_type' | 'week_number';
  /** Sort direction. */
  order?: 'asc' | 'desc';
}

export interface RowFailureListResponse {
  items: RowFailureListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface RowFailureSummary {
  rows_failed: number;
  by_code: Array<{ key: string; count: number }>;
  by_platform: Array<{ key: string; count: number }>;
  by_content_type: Array<{ key: string; count: number }>;
  by_week: Array<{ key: number; count: number }>;
  by_stage: Array<{ key: string; count: number }>;
}

export interface MigrationReadinessResult {
  exists: boolean;
  error_message?: string;
}

/**
 * Probe the table existence by attempting a 1-row HEAD select.
 * Supabase returns a structured PG error (42P01 — undefined_table)
 * when the migration hasn't been applied; we surface that to the
 * caller so the API can render a "migration required" notice rather
 * than a generic 500.
 */
export async function checkRowDiagnosticsTableExists(): Promise<MigrationReadinessResult> {
  try {
    const { error } = await supabase
      .from('bolt_row_failure_diagnostics')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (error) {
      // PG undefined_table → migration not applied yet. Anything else
      // is a different operational problem; surface verbatim so the
      // operator can act on it.
      const msg = String(error.message ?? '');
      const isMissing = msg.includes('does not exist')
        || msg.includes('bolt_row_failure_diagnostics')
        || (error as { code?: string }).code === '42P01';
      return { exists: !isMissing, error_message: msg };
    }
    return { exists: true };
  } catch (err) {
    return {
      exists: false,
      error_message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolveRunIdForFailure(failureId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('bolt_failure_summary')
    .select('run_id')
    .eq('id', failureId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { run_id: string }).run_id ?? null;
}

const ALLOWED_SORTS: Record<NonNullable<RowFailureFilters['sort']>, true> = {
  occurred_at: true,
  failure_code: true,
  platform: true,
  content_type: true,
  week_number: true,
};

export async function listRowFailuresForFailure(
  failureId: string,
  filters: RowFailureFilters = {}
): Promise<RowFailureListResponse | { migration_required: true }> {
  const probe = await checkRowDiagnosticsTableExists();
  if (!probe.exists) return { migration_required: true };

  const runId = await resolveRunIdForFailure(failureId);
  if (!runId) {
    return { items: [], total: 0, limit: 0, offset: 0, has_more: false };
  }

  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);
  const sort = filters.sort && ALLOWED_SORTS[filters.sort] ? filters.sort : 'occurred_at';
  const order: 'asc' | 'desc' = filters.order === 'asc' ? 'asc' : 'desc';

  let q = supabase
    .from('bolt_row_failure_diagnostics')
    .select(
      'id, run_id, campaign_id, company_id, daily_plan_id, week_number, activity_id, platform, content_type, failure_code, failure_category, failure_message, failure_field, failure_details, stage, occurred_at, created_at',
      { count: 'exact' }
    )
    .eq('run_id', runId);

  if (filters.failureCode) q = q.eq('failure_code', filters.failureCode);
  if (filters.platform) q = q.eq('platform', filters.platform);
  if (filters.contentType) q = q.eq('content_type', filters.contentType);
  if (filters.search) {
    // PostgREST ilike — escape % and _ in the user-supplied search.
    const escaped = filters.search.replace(/[%_]/g, '\\$&');
    q = q.ilike('failure_message', `%${escaped}%`);
  }

  q = q.order(sort, { ascending: order === 'asc' }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) {
    return { items: [], total: 0, limit, offset, has_more: false };
  }
  const items = (data ?? []) as RowFailureListItem[];
  const total = typeof count === 'number' ? count : items.length;
  return {
    items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  };
}

function tally<K extends string | number>(rows: Array<{ key: K }>): Array<{ key: K; count: number }> {
  const counts = new Map<K, number>();
  for (const r of rows) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getRowFailureSummary(
  failureId: string
): Promise<RowFailureSummary | { migration_required: true }> {
  const probe = await checkRowDiagnosticsTableExists();
  if (!probe.exists) return { migration_required: true };

  const runId = await resolveRunIdForFailure(failureId);
  const empty: RowFailureSummary = {
    rows_failed: 0,
    by_code: [],
    by_platform: [],
    by_content_type: [],
    by_week: [],
    by_stage: [],
  };
  if (!runId) return empty;

  // Pull all rows for the run. Hard-capped at 5000 to match the
  // run-level dashboard's safety bound — bigger runs are extreme
  // outliers and dashboards display aggregates anyway.
  const { data, error } = await supabase
    .from('bolt_row_failure_diagnostics')
    .select('failure_code, platform, content_type, week_number, stage')
    .eq('run_id', runId)
    .limit(5_000);
  if (error || !data) return empty;

  const rows = data as Array<{
    failure_code: string;
    platform: string | null;
    content_type: string | null;
    week_number: number | null;
    stage: string | null;
  }>;

  return {
    rows_failed: rows.length,
    by_code: tally(rows.map((r) => ({ key: r.failure_code ?? 'unknown' }))),
    by_platform: tally(rows.filter((r) => r.platform).map((r) => ({ key: r.platform as string }))),
    by_content_type: tally(rows.filter((r) => r.content_type).map((r) => ({ key: r.content_type as string }))),
    by_week: tally(rows.filter((r) => typeof r.week_number === 'number').map((r) => ({ key: r.week_number as number }))),
    by_stage: tally(rows.filter((r) => r.stage).map((r) => ({ key: r.stage as string }))),
  };
}
