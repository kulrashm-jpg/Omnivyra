/**
 * B7.8-C.5 — PLATFORM USAGE REPORTING (read-only).
 *
 * Makes tenant-less platform provider spend visible. This closes B7.8-B's
 * required change #2: without it, platform_usage_events accumulates real
 * provider cost that nobody can see, and invisible spend is a quieter failure
 * than wrong spend.
 *
 * ── READS ONE TABLE, NEVER MUTATES ─────────────────────────────────────────
 * platform_usage_events only. It never reads or writes usage_events,
 * unified_transactions, companies, user_company_roles, content or coverage
 * tables — so customer billing cannot be reached, and platform spend can never
 * be confused with customer spend.
 *
 * ── NO TENANT ATTRIBUTION ──────────────────────────────────────────────────
 * The table has no organization_id by design, so this module takes no company
 * parameter and performs no join. There is nothing tenant-scoped to filter by,
 * which is exactly the property that makes platform spend safe to aggregate.
 */

import { supabase } from '../../db/supabaseClient';

const TABLE = 'platform_usage_events';

/**
 * Explicit allow-list — never `select('*')`. A new column must be added here
 * deliberately before it can reach an operator's screen. `idempotency_key` is
 * excluded: it is an internal dedup token, not reporting data.
 */
const REPORT_COLUMNS =
  'id, provider_name, model_name, model_version, source_type, source_name, process_type, ' +
  'input_tokens, output_tokens, total_tokens, unit_cost, total_cost, pricing_snapshot, ' +
  'resource_type, resource_id, created_at';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PlatformUsageRow {
  id: string;
  providerName: string;
  modelName: string;
  modelVersion: string | null;
  sourceType: string;
  sourceName: string;
  processType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  unitCost: number | null;
  totalCost: number | null;
  pricingSnapshot: Record<string, unknown> | null;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export interface PlatformUsageSummary {
  totalCostUsd: number;
  eventCount: number;
  totalTokens: number;
  byProviderModel: Array<{ provider: string; model: string; eventCount: number; totalCostUsd: number; totalTokens: number }>;
  byResourceType: Array<{ resourceType: string; eventCount: number; totalCostUsd: number }>;
}

export interface PlatformUsageReport {
  items: PlatformUsageRow[];
  summary: PlatformUsageSummary;
  page: number;
  pageSize: number;
  hasMore: boolean;
  from: string | null;
  to: string | null;
}

export interface ReportFilter {
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const EMPTY_SUMMARY: PlatformUsageSummary = {
  totalCostUsd: 0, eventCount: 0, totalTokens: 0, byProviderModel: [], byResourceType: [],
};

export type ReportOutcome =
  | { ok: true; report: PlatformUsageReport }
  | { ok: false; reason: 'invalid_from' | 'invalid_to' | 'reversed_range' | 'query_failed' };

function mapRow(r: Record<string, unknown>): PlatformUsageRow {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    providerName: String(r.provider_name ?? ''),
    modelName: String(r.model_name ?? ''),
    modelVersion: r.model_version == null ? null : String(r.model_version),
    sourceType: String(r.source_type ?? ''),
    sourceName: String(r.source_name ?? ''),
    processType: String(r.process_type ?? ''),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    totalTokens: num(r.total_tokens),
    unitCost: num(r.unit_cost),
    totalCost: num(r.total_cost),
    pricingSnapshot: (r.pricing_snapshot as Record<string, unknown>) ?? null,
    resourceType: String(r.resource_type ?? ''),
    resourceId: String(r.resource_id ?? ''),
    createdAt: String(r.created_at ?? ''),
  };
}

/**
 * B7.8-C.9 — date-boundary parsing. STRICT ISO, always UTC.
 *
 * ── WHY NOT `new Date(v)` ──────────────────────────────────────────────────
 * The previous implementation accepted whatever `new Date()` could coerce, so
 * `from=5` silently became 2001-04-30 (parsed in the SERVER's local zone) and a
 * date-only `to=2026-08-31` became that day's MIDNIGHT, excluding the whole
 * requested day. Both under-report spend, and an under-count in a cost report
 * reads exactly like cheap infrastructure — the most expensive kind of wrong.
 *
 * ── THE REPOSITORY'S CONTRACT (adopted, not invented) ──────────────────────
 * Every date boundary in this repo is UTC and none uses locale parsing:
 *   · attributionReportingService.endOfDay(day) → `${day}T23:59:59.999Z`,
 *     applied with .lte() — the same closed-interval shape as this service.
 *   · analyticsWarehouseService.endOfDayIso  → Date.UTC(..., date + 1)
 *   · consumption/activity-breakdown.ts       → Date.UTC(year, month, 1)
 * So: a date-only `from` is that UTC day's first instant, a date-only `to` is
 * its last, and `from=2026-08-13&to=2026-08-13` covers the complete day.
 *
 * An EXPLICIT datetime is never reinterpreted — only a bare date gets a
 * boundary. A datetime with no offset is read as UTC rather than as server-local,
 * because a report must not change meaning with the host's timezone.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/;

type Boundary = 'start' | 'end';

function parseBoundary(
  v: string | undefined,
  kind: Boundary,
): { ok: true; value: string | null } | { ok: false } {
  if (v == null || String(v).trim() === '') return { ok: true, value: null };
  const raw = String(v).trim();

  if (ISO_DATE_RE.test(raw)) {
    // Reject impossible calendar dates the regex cannot catch (2026-02-30,
    // 2026-02-29 in a non-leap year). JS rolls these over instead of failing,
    // so the round-trip is the check.
    const probe = new Date(raw + 'T00:00:00.000Z');
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== raw) return { ok: false };
    return {
      ok: true,
      value: kind === 'start' ? raw + 'T00:00:00.000Z' : raw + 'T23:59:59.999Z',
    };
  }

  const m = ISO_DATETIME_RE.exec(raw);
  if (!m) return { ok: false };            // numeric-only, "5", "garbage", "08/13/2026"

  // No offset ⇒ UTC (never server-local).
  const normalized = m[6] ? raw : raw + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return { ok: false };
  // Same rollover guard: the date part must survive the round-trip.
  if (new Date(m[1] + 'T00:00:00.000Z').toISOString().slice(0, 10) !== m[1]) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

/**
 * Aggregate in application code over the returned page.
 *
 * IMPORTANT AND DELIBERATE: the summary describes THE RETURNED PAGE, not the
 * whole table. A true whole-table aggregate needs SQL GROUP BY, which through
 * this client would require an RPC — i.e. a migration this phase must not add.
 * Callers must not read `summary.totalCostUsd` as "all platform spend ever"
 * unless the range returned a single page (`hasMore === false`).
 */
function summarize(rows: PlatformUsageRow[]): PlatformUsageSummary {
  const pm = new Map<string, { provider: string; model: string; eventCount: number; totalCostUsd: number; totalTokens: number }>();
  const rt = new Map<string, { resourceType: string; eventCount: number; totalCostUsd: number }>();
  let totalCostUsd = 0;
  let totalTokens = 0;

  for (const r of rows) {
    const cost = Number(r.totalCost ?? 0);
    const tok = Number(r.totalTokens ?? 0);
    totalCostUsd += Number.isFinite(cost) ? cost : 0;
    totalTokens += Number.isFinite(tok) ? tok : 0;

    const pmKey = r.providerName + '|' + r.modelName;
    const pmEntry = pm.get(pmKey) ?? { provider: r.providerName, model: r.modelName, eventCount: 0, totalCostUsd: 0, totalTokens: 0 };
    pmEntry.eventCount += 1;
    pmEntry.totalCostUsd += Number.isFinite(cost) ? cost : 0;
    pmEntry.totalTokens += Number.isFinite(tok) ? tok : 0;
    pm.set(pmKey, pmEntry);

    const rtEntry = rt.get(r.resourceType) ?? { resourceType: r.resourceType, eventCount: 0, totalCostUsd: 0 };
    rtEntry.eventCount += 1;
    rtEntry.totalCostUsd += Number.isFinite(cost) ? cost : 0;
    rt.set(r.resourceType, rtEntry);
  }

  const round = (n: number) => Number(n.toFixed(10));
  return {
    totalCostUsd: round(totalCostUsd),
    eventCount: rows.length,
    totalTokens,
    // Deterministic ordering so two identical queries render identically.
    byProviderModel: [...pm.values()]
      .map((e) => ({ ...e, totalCostUsd: round(e.totalCostUsd) }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
    byResourceType: [...rt.values()]
      .map((e) => ({ ...e, totalCostUsd: round(e.totalCostUsd) }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.resourceType.localeCompare(b.resourceType)),
  };
}

/**
 * Read platform usage. READ-ONLY; never throws.
 *
 * Ordering is `created_at DESC, id DESC` — `created_at` alone is not unique, so
 * `id` is the stable tie-break that stops pagination skipping or repeating rows.
 */
export async function getPlatformUsageReport(filter: ReportFilter = {}): Promise<ReportOutcome> {
  const from = parseBoundary(filter.from, 'start');
  if (!from.ok) return { ok: false, reason: 'invalid_from' };
  const to = parseBoundary(filter.to, 'end');
  if (!to.ok) return { ok: false, reason: 'invalid_to' };
  if (from.value && to.value && from.value > to.value) return { ok: false, reason: 'reversed_range' };

  const page = Math.max(0, Math.floor(Number(filter.page ?? 0)) || 0);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(filter.pageSize ?? DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE));

  try {
    let q = supabase.from(TABLE).select(REPORT_COLUMNS);
    if (from.value) q = q.gte('created_at', from.value);
    if (to.value) q = q.lte('created_at', to.value);

    const start = page * pageSize;
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + pageSize);   // pageSize+1 to detect hasMore

    if (error || !Array.isArray(data)) return { ok: false, reason: 'query_failed' };

    // Double assertion via `unknown` — the repo-canonical form (see
    // scripts/verify-materialization.ts). supabase-js types a string-column
    // select as `Row[] | GenericStringError[]`, and GenericStringError has no
    // index signature, so a direct cast is rejected (TS2352). The runtime guard
    // above already proved `data` is an array and PostgREST reports column
    // errors through `error`, not through the rows.
    const raw = data as unknown as Record<string, unknown>[];
    const hasMore = raw.length > pageSize;
    const items = raw.slice(0, pageSize).map(mapRow);

    return {
      ok: true,
      report: {
        items,
        summary: items.length ? summarize(items) : EMPTY_SUMMARY,
        page, pageSize, hasMore,
        from: from.value, to: to.value,
      },
    };
  } catch {
    return { ok: false, reason: 'query_failed' };
  }
}
