/**
 * Ledger Export Service — Phase 3 C
 *
 * Produces immutable exports of credit_transactions + related financial
 * tables, suitable for finance archival, customer disputes, or quarterly
 * audit. Every export is wrapped in an audit manifest (auditManifestService)
 * with SHA-256 checksum.
 *
 * Output formats: csv | json | ndjson. CSV escaping is RFC 4180 compliant.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { recordExportManifest, type ExportFormat, type ManifestResult, type ExportType } from './auditManifestService';

export interface LedgerExportFilters {
  organizationId?: string;
  periodStart?:    string;
  periodEnd?:      string;
  executionPhase?: 'hold' | 'confirm' | 'release' | 'grant' | 'expire' | 'expire_incentive';
  referenceType?:  string;
}

export interface LedgerExportArgs {
  format:      ExportFormat;
  requestedBy: string;
  filters:     LedgerExportFilters;
  pageSize?:   number;
}

export interface LedgerExportResult {
  body:     string;
  rowCount: number;
  manifest: ManifestResult;
}

export async function exportLedger(args: LedgerExportArgs): Promise<LedgerExportResult> {
  const rows = await fetchLedgerRows(args.filters, args.pageSize ?? 5000);
  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'ledger',
    organizationId: args.filters.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.filters.periodStart,
    periodEnd:      args.filters.periodEnd,
    filters:        { ...args.filters } as Record<string, unknown>,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

export async function exportAdminAdjustments(args: {
  format:      ExportFormat;
  requestedBy: string;
  organizationId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<LedgerExportResult> {
  let q = supabase
    .from('admin_financial_audit_events')
    .select('id, actor_user_id, action_type, organization_id, amount_credits, usd_equivalent, currency, reason_type, reason, approval_id, ledger_idempotency_key, correlation_id, created_at')
    .order('created_at', { ascending: false });
  if (args.organizationId) q = q.eq('organization_id', args.organizationId);
  if (args.periodStart)   q = q.gte('created_at', args.periodStart);
  if (args.periodEnd)     q = q.lte('created_at', args.periodEnd);
  const { data, error } = await q.limit(5000);
  if (error) {
    logger.error('admin_adjustments_export_failed', { message: error.message });
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'admin_adjustments',
    organizationId: args.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

export async function exportCompanyUsage(args: {
  format:      ExportFormat;
  requestedBy: string;
  organizationId: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<LedgerExportResult> {
  let q = supabase
    .from('credit_transactions')
    .select('id, organization_id, execution_phase, credits_delta, balance_after, usd_equivalent, reference_type, reference_id, note, performed_by, idempotency_key, parent_transaction_id, category, created_at')
    .eq('organization_id', args.organizationId)
    .eq('execution_phase', 'confirm')
    .order('created_at', { ascending: false });
  if (args.periodStart) q = q.gte('created_at', args.periodStart);
  if (args.periodEnd)   q = q.lte('created_at', args.periodEnd);
  const { data, error } = await q.limit(10000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'company_usage',
    organizationId: args.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

export async function exportReservationLifecycle(args: {
  format:      ExportFormat;
  requestedBy: string;
  organizationId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<LedgerExportResult> {
  let q = supabase
    .from('credit_transactions')
    .select('id, organization_id, execution_phase, credits_delta, parent_transaction_id, idempotency_key, reference_type, reference_id, created_at, expires_at')
    .in('execution_phase', ['hold', 'confirm', 'release'])
    .order('created_at', { ascending: false });
  if (args.organizationId) q = q.eq('organization_id', args.organizationId);
  if (args.periodStart)   q = q.gte('created_at', args.periodStart);
  if (args.periodEnd)     q = q.lte('created_at', args.periodEnd);
  const { data, error } = await q.limit(10000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'reservation_lifecycle',
    organizationId: args.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

export async function exportApprovalChain(args: {
  format:      ExportFormat;
  requestedBy: string;
  organizationId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<LedgerExportResult> {
  let q = supabase
    .from('credit_action_approvals')
    .select('id, action_type, organization_id, proposed_by, status, required_approvals, approvals_received, executed_at, proposed_at, payload, rejected_at, rejected_by, rejection_reason')
    .order('proposed_at', { ascending: false });
  if (args.organizationId) q = q.eq('organization_id', args.organizationId);
  if (args.periodStart)   q = q.gte('proposed_at', args.periodStart);
  if (args.periodEnd)     q = q.lte('proposed_at', args.periodEnd);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);

  // Join in signatures for each approval (one batch query for the listed ids)
  const approvalIds = (data ?? []).map((r: Record<string, unknown>) => String(r.id));
  let signaturesById: Record<string, Array<Record<string, unknown>>> = {};
  if (approvalIds.length > 0) {
    const { data: sigs } = await supabase
      .from('credit_action_approval_signatures')
      .select('approval_id, approver_id, decision, comment, signed_at')
      .in('approval_id', approvalIds);
    for (const s of (sigs ?? []) as Array<Record<string, unknown>>) {
      const id = String(s.approval_id);
      (signaturesById[id] ??= []).push(s);
    }
  }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    ...r,
    signatures: signaturesById[String(r.id)] ?? [],
  }));

  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'approval_chain',
    organizationId: args.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

export async function exportBillingAnomalies(args: {
  format:      ExportFormat;
  requestedBy: string;
  organizationId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<LedgerExportResult> {
  let q = supabase
    .from('cost_anomalies')
    .select('id, organization_id, anomaly_type, severity, api_cost_usd, credits_value_usd, action_key, model_name, detected_at, metadata')
    .order('detected_at', { ascending: false });
  if (args.organizationId) q = q.eq('organization_id', args.organizationId);
  if (args.periodStart)   q = q.gte('detected_at', args.periodStart);
  if (args.periodEnd)     q = q.lte('detected_at', args.periodEnd);
  const { data, error } = await q.limit(10000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const body = serialize(rows, args.format);
  const manifest = await recordExportManifest({
    exportType:     'billing_anomalies',
    organizationId: args.organizationId,
    requestedBy:    args.requestedBy,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
    body,
    rowCount:       rows.length,
    format:         args.format,
  });
  return { body, rowCount: rows.length, manifest };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchLedgerRows(filters: LedgerExportFilters, pageSize: number): Promise<Array<Record<string, unknown>>> {
  let q = supabase
    .from('credit_transactions')
    .select('*')
    .order('created_at', { ascending: false });
  if (filters.organizationId) q = q.eq('organization_id', filters.organizationId);
  if (filters.executionPhase) q = q.eq('execution_phase', filters.executionPhase);
  if (filters.referenceType)  q = q.eq('reference_type', filters.referenceType);
  if (filters.periodStart)    q = q.gte('created_at', filters.periodStart);
  if (filters.periodEnd)      q = q.lte('created_at', filters.periodEnd);
  const { data, error } = await q.limit(pageSize);
  if (error) {
    logger.error('ledger_export_failed', { message: error.message });
    throw new Error(error.message);
  }
  return (data ?? []) as Array<Record<string, unknown>>;
}

function serialize(rows: Array<Record<string, unknown>>, format: ExportFormat): string {
  switch (format) {
    case 'json':   return JSON.stringify(rows, null, 0);
    case 'ndjson': return rows.map(r => JSON.stringify(r)).join('\n');
    case 'csv':    return toCsv(rows);
  }
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

export type { ExportFormat, ExportType } from './auditManifestService';
