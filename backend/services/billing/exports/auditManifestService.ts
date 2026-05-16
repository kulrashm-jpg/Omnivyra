/**
 * Audit Manifest Service — Phase 3 C
 *
 * Wraps every billing export with an immutable manifest. The manifest
 * records WHAT was exported, BY WHOM, the row count, and a SHA-256
 * checksum of the serialized body — so finance can later verify the
 * export's content was not tampered with.
 *
 * The manifest table is immutable at update/delete (trigger from
 * 20260665 migration).
 */

import { createHash, randomUUID } from 'crypto';
import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export type ExportType =
  | 'ledger'
  | 'company_usage'
  | 'admin_adjustments'
  | 'reservation_lifecycle'
  | 'billing_anomalies'
  | 'approval_chain';

export type ExportFormat = 'csv' | 'json' | 'ndjson';

export interface ManifestInput {
  exportType:      ExportType;
  organizationId?: string;
  requestedBy:     string;
  periodStart?:    string;
  periodEnd?:      string;
  filters?:        Record<string, unknown>;
  body:            string;            // serialized payload
  rowCount:        number;
  format:          ExportFormat;
  retentionDays?:  number;            // default 365
  metadata?:       Record<string, unknown>;
}

export interface ManifestResult {
  manifestId:    string;
  contentSha256: string;
  byteSize:      number;
  rowCount:      number;
  exportType:    ExportType;
  recordedAt:    string;
}

export async function recordExportManifest(input: ManifestInput): Promise<ManifestResult> {
  const bodyBuffer = Buffer.from(input.body, 'utf8');
  const contentSha256 = createHash('sha256').update(bodyBuffer).digest('hex');
  const byteSize = bodyBuffer.byteLength;
  const retentionDays = input.retentionDays ?? 365;

  const manifestId = randomUUID();
  const recordedAt = new Date().toISOString();
  const retentionUntil = new Date(Date.now() + retentionDays * 86400_000).toISOString();

  const { error } = await supabase
    .from('billing_export_manifests')
    .insert({
      id:               manifestId,
      export_type:      input.exportType,
      organization_id:  input.organizationId ?? null,
      requested_by:     input.requestedBy,
      requested_at:     recordedAt,
      period_start:     input.periodStart ?? null,
      period_end:       input.periodEnd ?? null,
      filters:          input.filters ?? {},
      row_count:        input.rowCount,
      content_sha256:   contentSha256,
      byte_size:        byteSize,
      format:           input.format,
      retention_until:  retentionUntil,
      metadata:         input.metadata ?? {},
    });

  if (error) {
    logger.error('export_manifest_insert_failed', {
      exportType: input.exportType, message: error.message,
    });
    throw new Error(`Failed to record export manifest: ${error.message}`);
  }

  return {
    manifestId,
    contentSha256,
    byteSize,
    rowCount: input.rowCount,
    exportType: input.exportType,
    recordedAt,
  };
}

/**
 * Verify a previously-recorded export by re-hashing the supplied body and
 * comparing against the stored manifest. Returns the verification result;
 * caller decides whether to treat a mismatch as a tampering signal.
 */
export async function verifyExportContent(manifestId: string, body: string): Promise<{
  ok:      boolean;
  reason?: string;
  manifest?: {
    contentSha256: string;
    rowCount:      number;
    recordedAt:    string;
    exportType:    string;
  };
}> {
  const { data, error } = await supabase
    .from('billing_export_manifests')
    .select('content_sha256, row_count, requested_at, export_type, byte_size')
    .eq('id', manifestId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: 'MANIFEST_NOT_FOUND' };
  }
  const stored = data as { content_sha256: string; row_count: number; requested_at: string; export_type: string; byte_size: number };
  const actualSha = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
  if (actualSha !== stored.content_sha256) {
    return {
      ok: false,
      reason: 'CHECKSUM_MISMATCH',
      manifest: {
        contentSha256: stored.content_sha256,
        rowCount:      stored.row_count,
        recordedAt:    stored.requested_at,
        exportType:    stored.export_type,
      },
    };
  }
  return {
    ok: true,
    manifest: {
      contentSha256: stored.content_sha256,
      rowCount:      stored.row_count,
      recordedAt:    stored.requested_at,
      exportType:    stored.export_type,
    },
  };
}

export async function listManifests(opts: {
  organizationId?: string;
  exportType?:     ExportType;
  limit?:          number;
}): Promise<Array<{
  id: string;
  exportType: string;
  organizationId: string | null;
  requestedBy: string;
  requestedAt: string;
  rowCount: number;
  contentSha256: string;
  format: string;
}>> {
  let q = supabase
    .from('billing_export_manifests')
    .select('id, export_type, organization_id, requested_by, requested_at, row_count, content_sha256, format')
    .order('requested_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
  if (opts.exportType)     q = q.eq('export_type', opts.exportType);
  const { data } = await q;
  return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    id:             String(r.id),
    exportType:     String(r.export_type),
    organizationId: r.organization_id ? String(r.organization_id) : null,
    requestedBy:    String(r.requested_by),
    requestedAt:    String(r.requested_at),
    rowCount:       Number(r.row_count ?? 0),
    contentSha256:  String(r.content_sha256),
    format:         String(r.format),
  }));
}
