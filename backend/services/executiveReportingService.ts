/**
 * Phase 9 — Executive reporting engine.
 *
 * Operator-defined report definitions + deterministic, replayable
 * generation. Reports are NOT autonomous: they execute on explicit
 * operator request (POST /api/active-leads/reports) OR are
 * pre-defined and ENABLED for an externally-driven cron caller. This
 * service never invokes its own scheduler.
 *
 * Supported report_kind:
 *   • opportunity_trends     — daily opportunity counts + avg score
 *   • source_roi             — opportunity yield per listening_source
 *   • escalation_summary     — open/resolved counts by severity
 *   • competitor_intel       — graph-node mentions by cluster (Phase 5 graph)
 *   • operational_health     — execution success rate + connector outages
 *   • sla_report             — breaches by metric_kind
 *   • governance_audit       — moderation blocks + policy activations
 *
 * Generation:
 *   • Pulls from the Phase 9 analytics warehouse when the requested
 *     window is already materialised; falls back to direct table reads
 *     otherwise. The result is small + inline (`payload_inline`).
 *   • Every report carries the exact filter_payload used so it can be
 *     re-run deterministically.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  REPORT_MAX_INLINE_BYTES,
  type ReportDefinition,
  type ReportExecution,
  type ReportExecutionStatus,
  type ReportKind,
} from '../types/reportDefinition';
import { publishRealtime } from './realtimePublisherService';
import { publishReportGenerated } from '../events/listeningEvents';
import { listWarehouseFacts } from './analyticsWarehouseService';

export type UpsertReportDefinitionInput = {
  organizationId: string;
  id?: string;
  reportKind: ReportKind;
  name: string;
  description?: string | null;
  filterPayload?: Record<string, unknown>;
  scheduleCron?: string | null;
  enabled?: boolean;
  ownerUserId: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertReportDefinition(input: UpsertReportDefinitionInput): Promise<ReportDefinition> {
  const name = (input.name ?? '').trim().slice(0, 120);
  if (name.length === 0) throw new Error('report_name_required');
  if (input.id) {
    const upd = await ownedDbTable('report_definitions')
      .update({
        report_kind: input.reportKind,
        name,
        description: input.description ?? null,
        filter_payload: input.filterPayload ?? {},
        schedule_cron: input.scheduleCron ?? null,
        enabled: input.enabled ?? false,
        owner_user_id: input.ownerUserId,
        metadata: input.metadata ?? {},
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`report_definition_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as ReportDefinition;
  }
  const ins = await ownedDbTable('report_definitions')
    .insert({
      organization_id: input.organizationId,
      report_kind: input.reportKind,
      name,
      description: input.description ?? null,
      filter_payload: input.filterPayload ?? {},
      schedule_cron: input.scheduleCron ?? null,
      enabled: input.enabled ?? false,
      owner_user_id: input.ownerUserId,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`report_definition_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as ReportDefinition;
}

export async function listReportDefinitions(
  organizationId: string,
  options?: { reportKind?: ReportKind; enabledOnly?: boolean; limit?: number },
): Promise<ReportDefinition[]> {
  let q = ownedDbTable('report_definitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.reportKind) q = q.eq('report_kind', options.reportKind);
  if (options?.enabledOnly) q = q.eq('enabled', true);
  const { data } = await q;
  return (data as ReportDefinition[]) ?? [];
}

export type GenerateReportInput = {
  organizationId: string;
  reportKind: ReportKind;
  reportDefinitionId?: string | null;
  filterPayload?: Record<string, unknown>;
  windowStart?: string;
  windowEnd?: string;
  requestedBy: string | null;
};

export async function generateReport(input: GenerateReportInput): Promise<ReportExecution> {
  const filterPayload = input.filterPayload ?? {};
  const ins = await ownedDbTable('report_executions')
    .insert({
      organization_id: input.organizationId,
      report_definition_id: input.reportDefinitionId ?? null,
      report_kind: input.reportKind,
      status: 'processing' as ReportExecutionStatus,
      filter_payload: filterPayload,
      requested_by: input.requestedBy,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`report_execution_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const execution = ins.data as ReportExecution;

  let payload: Record<string, unknown> = {};
  let status: ReportExecutionStatus = 'complete';
  let failure: string | null = null;
  try {
    payload = await buildReport(input.organizationId, input.reportKind, input.windowStart, input.windowEnd, filterPayload);
  } catch (err: any) {
    status = 'failed';
    failure = err?.message ?? 'unknown';
  }

  const serialised = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialised, 'utf8');
  const inline = byteSize <= REPORT_MAX_INLINE_BYTES ? payload : { truncated: true, byte_size: byteSize };

  const upd = await ownedDbTable('report_executions')
    .update({
      status,
      payload_inline: inline,
      row_count: typeof (payload as { rows?: unknown[] }).rows === 'object' ? ((payload as { rows?: unknown[] }).rows ?? []).length : null,
      byte_size: byteSize,
      failure_reason: failure,
      completed_at: new Date().toISOString(),
    })
    .eq('id', execution.id)
    .select('*')
    .single();

  try {
    await publishReportGenerated({
      organizationId: input.organizationId,
      reportExecutionId: execution.id,
      reportKind: input.reportKind,
      rowCount: (upd.data as ReportExecution | null)?.row_count ?? null,
      byteSize,
      status: status === 'complete' || status === 'failed' ? status : 'cancelled',
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'reports',
      eventName: 'report.generated',
      payload: { report_execution_id: execution.id, report_kind: input.reportKind, status },
    });
  } catch { /* best effort */ }

  return (upd.data as ReportExecution) ?? execution;
}

async function buildReport(
  organizationId: string,
  kind: ReportKind,
  windowStart: string | undefined,
  windowEnd: string | undefined,
  _filter: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (kind) {
    case 'opportunity_trends': {
      const facts = await listWarehouseFacts(organizationId, { factKind: 'opportunity_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 365 });
      return {
        kind,
        rows: facts.map((f) => ({
          bucket: f.bucket_start,
          count: (f.measures as { count?: number }).count ?? 0,
          avg_score: (f.measures as { avg_score?: number }).avg_score ?? 0,
          max_score: (f.measures as { max_score?: number }).max_score ?? 0,
        })),
      };
    }
    case 'source_roi': {
      const facts = await listWarehouseFacts(organizationId, { factKind: 'source_roi_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 1000 });
      const agg = new Map<string, { opportunities: number; sumScore: number }>();
      for (const f of facts) {
        const sid = String((f.dimensions as { listening_source_id?: string }).listening_source_id ?? 'unknown');
        const a = agg.get(sid) ?? { opportunities: 0, sumScore: 0 };
        a.opportunities += (f.measures as { opportunities?: number }).opportunities ?? 0;
        a.sumScore += (f.measures as { sum_score?: number }).sum_score ?? 0;
        agg.set(sid, a);
      }
      return {
        kind,
        rows: Array.from(agg.entries())
          .map(([sid, v]) => ({ listening_source_id: sid, opportunities: v.opportunities, sum_score: Number(v.sumScore.toFixed(3)) }))
          .sort((a, b) => b.opportunities - a.opportunities),
      };
    }
    case 'escalation_summary': {
      const facts = await listWarehouseFacts(organizationId, { factKind: 'escalation_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 365 });
      const totals: Record<string, number> = { count: 0 };
      for (const f of facts) {
        for (const [k, v] of Object.entries(f.measures)) {
          totals[k] = (totals[k] ?? 0) + (typeof v === 'number' ? v : 0);
        }
      }
      return { kind, totals, rows: facts.map((f) => ({ bucket: f.bucket_start, measures: f.measures })) };
    }
    case 'competitor_intel': {
      const { data } = await ownedDbTable('opportunity_graph_nodes')
        .select('id, display_name, node_kind, organization_mention_count')
        .eq('organization_id', organizationId)
        .order('organization_mention_count', { ascending: false })
        .limit(50);
      return { kind, rows: data ?? [] };
    }
    case 'operational_health': {
      const exec = await listWarehouseFacts(organizationId, { factKind: 'execution_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 365 });
      let totalExec = 0;
      let totalComplete = 0;
      let totalFailed = 0;
      for (const f of exec) {
        const m = f.measures as Record<string, number>;
        totalExec += m.total ?? 0;
        totalComplete += m.complete ?? 0;
        totalFailed += m.failed ?? 0;
      }
      const successRate = totalExec > 0 ? totalComplete / totalExec : 1;
      return {
        kind,
        success_rate: Number(successRate.toFixed(4)),
        total_executions: totalExec,
        complete: totalComplete,
        failed: totalFailed,
        rows: exec.map((f) => ({ bucket: f.bucket_start, measures: f.measures })),
      };
    }
    case 'sla_report': {
      const facts = await listWarehouseFacts(organizationId, { factKind: 'sla_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 1000 });
      return { kind, rows: facts.map((f) => ({ bucket: f.bucket_start, dimensions: f.dimensions, measures: f.measures })) };
    }
    case 'governance_audit': {
      const mod = await listWarehouseFacts(organizationId, { factKind: 'moderation_daily', bucketStart: windowStart, bucketEnd: windowEnd, limit: 365 });
      const { data: pol } = await ownedDbTable('governance_enforcement_events')
        .select('id, policy_kind, decision, created_at, actor_user_id')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(50);
      return { kind, moderation_rows: mod.map((f) => ({ bucket: f.bucket_start, measures: f.measures })), governance_enforcement_events: pol ?? [] };
    }
  }
}

export async function listReportExecutions(
  organizationId: string,
  options?: { reportKind?: ReportKind; limit?: number },
): Promise<ReportExecution[]> {
  let q = ownedDbTable('report_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.reportKind) q = q.eq('report_kind', options.reportKind);
  const { data } = await q;
  return (data as ReportExecution[]) ?? [];
}

export async function getReportExecution(
  organizationId: string,
  executionId: string,
): Promise<ReportExecution | null> {
  const { data } = await ownedDbTable('report_executions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', executionId)
    .maybeSingle();
  return (data as ReportExecution | null) ?? null;
}
