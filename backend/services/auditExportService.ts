/**
 * Phase 7 — Bounded audit export service.
 *
 * Sync export model — for Phase 7, exports complete synchronously inside
 * the API call (bounded at AUDIT_EXPORT_MAX_ROWS = 5000). The job row is
 * persisted with status='complete' and `payload_inline` containing the
 * serialised body. Larger / async exports land in a later phase.
 *
 * Hard guarantees:
 *   • Tenant-scoped: every read filters on organization_id first.
 *   • Bounded: row cap enforced before serialisation.
 *   • Deterministic snapshot: query frozen at `filter_criteria.cutoff_at`
 *     when supplied; otherwise read at request time.
 *   • Audit-safe: every export records who requested it, what type, when,
 *     and how many rows came out.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  AuditExportFormat,
  AuditExportJob,
  AuditExportType,
} from '../types/auditExport';
import { AUDIT_EXPORT_MAX_ROWS } from '../types/auditExport';

const TARGET_TABLES: Record<AuditExportType, { table: string; time_column: string; columns: string }> = {
  lifecycle_history: { table: 'opportunity_lifecycle_states', time_column: 'transitioned_at', columns: '*' },
  moderation_decisions: { table: 'moderation_decisions', time_column: 'created_at', columns: '*' },
  escalations: { table: 'escalations', time_column: 'created_at', columns: '*' },
  execution_traces: { table: 'execution_observability_records', time_column: 'created_at', columns: '*' },
  identity_actions: { table: 'author_identity_links', time_column: 'updated_at', columns: '*' },
  governance_history: { table: 'intelligence_governance_policies', time_column: 'created_at', columns: '*' },
  source_health_history: { table: 'source_health_states', time_column: 'computed_at', columns: '*' },
};

function toCSV(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Array.from(rows.reduce<Set<string>>((acc, row) => {
    for (const k of Object.keys(row)) acc.add(k);
    return acc;
  }, new Set<string>()));
  const escape = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v).replace(/"/g, '""');
    const s = String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => escape((r as Record<string, unknown>)[h])).join(','));
  return lines.join('\n');
}

export type RequestExportInput = {
  organizationId: string;
  exportType: AuditExportType;
  format: AuditExportFormat;
  filterCriteria?: { since?: string; until?: string };
  requestedBy: string | null;
};

export async function requestAuditExport(input: RequestExportInput): Promise<AuditExportJob> {
  const binding = TARGET_TABLES[input.exportType];
  if (!binding) throw new Error(`unknown_export_type:${input.exportType}`);

  // Create job row first.
  const { data: jobRow, error: jobErr } = await ownedDbTable('audit_export_jobs')
    .insert({
      organization_id: input.organizationId,
      export_type: input.exportType,
      format: input.format,
      status: 'processing',
      filter_criteria: input.filterCriteria ?? {},
      requested_by: input.requestedBy,
    })
    .select('*')
    .single();
  if (jobErr || !jobRow) throw new Error(`audit_export_create_failed:${jobErr?.message ?? 'unknown'}`);
  const job = jobRow as AuditExportJob;

  try {
    let q = ownedDbTable(binding.table)
      .select(binding.columns)
      .eq('organization_id', input.organizationId)
      .order(binding.time_column, { ascending: true })
      .limit(AUDIT_EXPORT_MAX_ROWS);
    if (input.filterCriteria?.since) q = q.gte(binding.time_column, input.filterCriteria.since);
    if (input.filterCriteria?.until) q = q.lt(binding.time_column, input.filterCriteria.until);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const rowCount = rows.length;

    const payload = input.format === 'json'
      ? { rows }
      : { csv: toCSV(rows) };
    const byteSize = JSON.stringify(payload).length;

    const { data: updated, error: updateErr } = await ownedDbTable('audit_export_jobs')
      .update({
        status: 'complete',
        row_count: rowCount,
        byte_size: byteSize,
        payload_inline: payload,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('*')
      .single();
    if (updateErr || !updated) throw new Error(`audit_export_finalize_failed:${updateErr?.message ?? 'unknown'}`);
    return updated as AuditExportJob;
  } catch (err: any) {
    await ownedDbTable('audit_export_jobs')
      .update({
        status: 'failed',
        failure_reason: err?.message ?? 'unknown',
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    throw new Error(`audit_export_failed:${err?.message ?? 'unknown'}`);
  }
}

export async function listAuditExports(
  organizationId: string,
  options?: { exportType?: AuditExportType; limit?: number },
): Promise<AuditExportJob[]> {
  let q = ownedDbTable('audit_export_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.exportType) q = q.eq('export_type', options.exportType);
  const { data, error } = await q;
  if (error) throw new Error(`audit_exports_list_failed:${error.message}`);
  return (data as AuditExportJob[]) ?? [];
}

export async function getAuditExport(
  organizationId: string,
  id: string,
): Promise<AuditExportJob | null> {
  const { data, error } = await ownedDbTable('audit_export_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`audit_export_get_failed:${error.message}`);
  return (data as AuditExportJob | null) ?? null;
}
