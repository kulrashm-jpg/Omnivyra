/**
 * Phase 9 — Analytics warehouse materializations.
 *
 * Deterministic, explicit roll-ups over canonical Phase 0-8 tables into
 * `analytics_warehouse_facts`. Every materialization is operator-driven
 * (no autonomous cron); the window is bounded and the dimensions are
 * fixed per fact_kind. Idempotent — re-running the same window upserts
 * the same row (UNIQUE on organization_id, fact_kind, bucket_start,
 * dimensions).
 *
 * Supported fact kinds:
 *   • opportunity_daily      — opportunity_feed_items grouped by day
 *   • source_roi_daily       — opportunity volume per listening_source / day
 *   • escalation_daily       — escalations created per day
 *   • execution_daily        — listening_executions per day
 *   • moderation_daily       — moderation_audit_log blocks per day
 *   • cost_daily             — cost_governance_events per day, by category
 *   • sla_daily              — sla_breach_events per day, by metric_kind
 *
 * Hard guarantees:
 *   • No autonomous schedule. Materialization runs only on explicit
 *     operator request via /analytics-warehouse.
 *   • Tenant-first reads. CASCADE delete via FK.
 *   • Counts only — no PII; no embedding cost; no LLM round-trip.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  WAREHOUSE_DEFAULT_LOOKBACK_DAYS,
  WAREHOUSE_MAX_WINDOW_DAYS,
  type AnalyticsMaterialization,
  type AnalyticsWarehouseFact,
  type MaterializationStatus,
  type WarehouseFactKind,
} from '../types/analyticsWarehouse';
import { publishRealtime } from './realtimePublisherService';
import { publishAnalyticsMaterialized } from '../events/listeningEvents';

function startOfDayIso(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x.toISOString();
}

function endOfDayIso(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return x.toISOString();
}

function clampWindow(windowStart: string | undefined, windowEnd: string | undefined): { start: string; end: string } {
  const end = windowEnd ? new Date(windowEnd) : new Date();
  const start = windowStart ? new Date(windowStart) : new Date(end.getTime() - WAREHOUSE_DEFAULT_LOOKBACK_DAYS * 86400_000);
  const maxStart = new Date(end.getTime() - WAREHOUSE_MAX_WINDOW_DAYS * 86400_000);
  const clamped = start < maxStart ? maxStart : start;
  return { start: clamped.toISOString(), end: end.toISOString() };
}

export type MaterializeInput = {
  organizationId: string;
  factKind: WarehouseFactKind;
  windowStart?: string;
  windowEnd?: string;
  initiatedBy: string | null;
};

export type MaterializeResult = {
  materialization: AnalyticsMaterialization;
  facts: AnalyticsWarehouseFact[];
};

export async function materializeFact(input: MaterializeInput): Promise<MaterializeResult> {
  const { start, end } = clampWindow(input.windowStart, input.windowEnd);

  const matIns = await ownedDbTable('analytics_materializations')
    .insert({
      organization_id: input.organizationId,
      fact_kind: input.factKind,
      window_start: start,
      window_end: end,
      status: 'complete' as MaterializationStatus,
      initiated_by: input.initiatedBy,
      rows_written: 0,
    })
    .select('*')
    .single();
  const materialization = matIns.data as AnalyticsMaterialization;
  if (matIns.error || !materialization) throw new Error(`materialization_insert_failed:${matIns.error?.message ?? 'unknown'}`);

  let facts: AnalyticsWarehouseFact[] = [];
  let status: MaterializationStatus = 'complete';
  let detail: string | null = null;
  try {
    switch (input.factKind) {
      case 'opportunity_daily':
        facts = await materializeOpportunityDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'source_roi_daily':
        facts = await materializeSourceRoiDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'escalation_daily':
        facts = await materializeEscalationDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'execution_daily':
        facts = await materializeExecutionDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'moderation_daily':
        facts = await materializeModerationDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'cost_daily':
        facts = await materializeCostDaily(input.organizationId, start, end, materialization.id);
        break;
      case 'sla_daily':
        facts = await materializeSlaDaily(input.organizationId, start, end, materialization.id);
        break;
    }
  } catch (err: any) {
    status = 'failed';
    detail = err?.message ?? 'unknown';
  }

  const updated = await ownedDbTable('analytics_materializations')
    .update({ status, detail, rows_written: facts.length })
    .eq('id', materialization.id)
    .select('*')
    .single();

  try {
    await publishAnalyticsMaterialized({
      organizationId: input.organizationId,
      factKind: input.factKind,
      windowStart: start,
      windowEnd: end,
      rowsWritten: facts.length,
      status,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'analytics_warehouse',
      eventName: 'analytics.materialized',
      payload: { fact_kind: input.factKind, rows_written: facts.length, status },
    });
  } catch { /* best effort */ }

  return { materialization: (updated.data as AnalyticsMaterialization) ?? materialization, facts };
}

async function upsertFact(args: {
  organizationId: string;
  factKind: WarehouseFactKind;
  bucketStart: string;
  bucketEnd: string;
  dimensions: Record<string, string | number | null>;
  measures: Record<string, number>;
  materializationId: string;
}): Promise<AnalyticsWarehouseFact | null> {
  const existing = await ownedDbTable('analytics_warehouse_facts')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('fact_kind', args.factKind)
    .eq('bucket_start', args.bucketStart)
    .contains('dimensions', args.dimensions)
    .maybeSingle();
  if (existing.data) {
    const upd = await ownedDbTable('analytics_warehouse_facts')
      .update({ measures: args.measures, materialization_id: args.materializationId, bucket_end: args.bucketEnd })
      .eq('id', (existing.data as { id: string }).id)
      .select('*')
      .single();
    return (upd.data as AnalyticsWarehouseFact) ?? null;
  }
  const ins = await ownedDbTable('analytics_warehouse_facts')
    .insert({
      organization_id: args.organizationId,
      fact_kind: args.factKind,
      bucket_start: args.bucketStart,
      bucket_end: args.bucketEnd,
      dimensions: args.dimensions,
      measures: args.measures,
      materialization_id: args.materializationId,
    })
    .select('*')
    .single();
  if (ins.error && (ins.error as { code?: string }).code === '23505') {
    const reread = await ownedDbTable('analytics_warehouse_facts')
      .select('*')
      .eq('organization_id', args.organizationId)
      .eq('fact_kind', args.factKind)
      .eq('bucket_start', args.bucketStart)
      .contains('dimensions', args.dimensions)
      .single();
    return (reread.data as AnalyticsWarehouseFact) ?? null;
  }
  return (ins.data as AnalyticsWarehouseFact) ?? null;
}

function bucketize<T>(rows: T[], dateField: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const v = row[dateField] as unknown as string | null;
    if (!v) continue;
    const day = startOfDayIso(new Date(v));
    const bucket = map.get(day) ?? [];
    bucket.push(row);
    map.set(day, bucket);
  }
  return map;
}

// --- per-fact materializers -------------------------------------------------

async function materializeOpportunityDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('opportunity_feed_items')
    .select('id, created_at, opportunity_score')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; opportunity_score: number | null }>) ?? [];
  const byDay = bucketize(rows, 'created_at');
  const out: AnalyticsWarehouseFact[] = [];
  for (const [day, items] of byDay.entries()) {
    const scores = items.map((r) => r.opportunity_score ?? 0);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'opportunity_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: {},
      measures: { count: items.length, avg_score: Number(avg.toFixed(3)), max_score: Number(max.toFixed(3)) },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeSourceRoiDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('opportunity_feed_items')
    .select('id, created_at, listening_source_id, opportunity_score')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; listening_source_id: string | null; opportunity_score: number | null }>) ?? [];
  const buckets = new Map<string, { count: number; sumScore: number }>();
  for (const r of rows) {
    if (!r.listening_source_id) continue;
    const day = startOfDayIso(new Date(r.created_at));
    const key = `${day}|${r.listening_source_id}`;
    const b = buckets.get(key) ?? { count: 0, sumScore: 0 };
    b.count += 1;
    b.sumScore += r.opportunity_score ?? 0;
    buckets.set(key, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [key, b] of buckets.entries()) {
    const [day, sourceId] = key.split('|');
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'source_roi_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: { listening_source_id: sourceId },
      measures: { opportunities: b.count, sum_score: Number(b.sumScore.toFixed(3)) },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeEscalationDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('escalations')
    .select('id, created_at, severity, status')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; severity: string | null; status: string | null }>) ?? [];
  const buckets = new Map<string, { count: number; bySev: Record<string, number> }>();
  for (const r of rows) {
    const day = startOfDayIso(new Date(r.created_at));
    const b = buckets.get(day) ?? { count: 0, bySev: {} };
    b.count += 1;
    const sev = r.severity ?? 'unknown';
    b.bySev[sev] = (b.bySev[sev] ?? 0) + 1;
    buckets.set(day, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [day, b] of buckets.entries()) {
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'escalation_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: {},
      measures: { count: b.count, ...Object.fromEntries(Object.entries(b.bySev).map(([k, v]) => [`sev_${k}`, v])) },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeExecutionDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('listening_executions')
    .select('id, created_at, status')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; status: string }>) ?? [];
  const buckets = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const day = startOfDayIso(new Date(r.created_at));
    const b = buckets.get(day) ?? { total: 0 };
    b.total = (b.total ?? 0) + 1;
    b[r.status] = (b[r.status] ?? 0) + 1;
    buckets.set(day, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [day, b] of buckets.entries()) {
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'execution_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: {},
      measures: b,
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeModerationDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('moderation_audit_log')
    .select('id, created_at, decision')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; decision: string }>) ?? [];
  const buckets = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const day = startOfDayIso(new Date(r.created_at));
    const b = buckets.get(day) ?? {};
    b[r.decision ?? 'unknown'] = (b[r.decision ?? 'unknown'] ?? 0) + 1;
    buckets.set(day, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [day, b] of buckets.entries()) {
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'moderation_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: {},
      measures: { ...b, total: Object.values(b).reduce((a, c) => a + c, 0) },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeCostDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('cost_governance_events')
    .select('id, created_at, category, cost_units')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; category: string; cost_units: number | null }>) ?? [];
  const buckets = new Map<string, { units: number; events: number }>();
  for (const r of rows) {
    const day = startOfDayIso(new Date(r.created_at));
    const key = `${day}|${r.category ?? 'unknown'}`;
    const b = buckets.get(key) ?? { units: 0, events: 0 };
    b.units += r.cost_units ?? 0;
    b.events += 1;
    buckets.set(key, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [key, b] of buckets.entries()) {
    const [day, category] = key.split('|');
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'cost_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: { category },
      measures: { cost_units: b.units, events: b.events },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

async function materializeSlaDaily(orgId: string, start: string, end: string, matId: string) {
  const { data } = await ownedDbTable('sla_breach_events')
    .select('id, created_at, metric_kind, severity')
    .eq('organization_id', orgId)
    .gte('created_at', start)
    .lt('created_at', end);
  const rows = (data as Array<{ id: string; created_at: string; metric_kind: string; severity: string | null }>) ?? [];
  const buckets = new Map<string, { count: number; bySev: Record<string, number> }>();
  for (const r of rows) {
    const day = startOfDayIso(new Date(r.created_at));
    const key = `${day}|${r.metric_kind ?? 'unknown'}`;
    const b = buckets.get(key) ?? { count: 0, bySev: {} };
    b.count += 1;
    const sev = r.severity ?? 'unknown';
    b.bySev[sev] = (b.bySev[sev] ?? 0) + 1;
    buckets.set(key, b);
  }
  const out: AnalyticsWarehouseFact[] = [];
  for (const [key, b] of buckets.entries()) {
    const [day, metric] = key.split('|');
    const f = await upsertFact({
      organizationId: orgId,
      factKind: 'sla_daily',
      bucketStart: day,
      bucketEnd: endOfDayIso(new Date(day)),
      dimensions: { metric_kind: metric },
      measures: { breaches: b.count, ...Object.fromEntries(Object.entries(b.bySev).map(([k, v]) => [`sev_${k}`, v])) },
      materializationId: matId,
    });
    if (f) out.push(f);
  }
  return out;
}

// --- queries ---------------------------------------------------------------

export async function listWarehouseFacts(
  organizationId: string,
  options: { factKind?: WarehouseFactKind; bucketStart?: string; bucketEnd?: string; limit?: number },
): Promise<AnalyticsWarehouseFact[]> {
  let q = ownedDbTable('analytics_warehouse_facts')
    .select('*')
    .eq('organization_id', organizationId)
    .order('bucket_start', { ascending: false })
    .limit(Math.min(1000, Math.max(1, options.limit ?? 200)));
  if (options.factKind) q = q.eq('fact_kind', options.factKind);
  if (options.bucketStart) q = q.gte('bucket_start', options.bucketStart);
  if (options.bucketEnd) q = q.lt('bucket_start', options.bucketEnd);
  const { data } = await q;
  return (data as AnalyticsWarehouseFact[]) ?? [];
}

export async function listMaterializations(
  organizationId: string,
  options?: { factKind?: WarehouseFactKind; limit?: number },
): Promise<AnalyticsMaterialization[]> {
  let q = ownedDbTable('analytics_materializations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.factKind) q = q.eq('fact_kind', options.factKind);
  const { data } = await q;
  return (data as AnalyticsMaterialization[]) ?? [];
}
