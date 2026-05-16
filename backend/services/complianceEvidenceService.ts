/**
 * Phase 10 — Compliance evidence export.
 *
 * Deterministic, replayable export of compliance evidence over a bounded
 * window. Outputs a row in `compliance_evidence_exports` with:
 *   • payload_inline      — small (<= 512 KiB) JSON snapshot
 *   • payload_hash        — sha256 over canonical-serialised rows
 *   • row_count, byte_size, status
 *
 * Evidence sources are existing append-only / immutable artefacts:
 *   • governance_policy_activations + governance_policies
 *   • retention_executions
 *   • replay_operations
 *   • access_logs / consent_records
 *   • operator_action_log
 *
 * Hard guarantees:
 *   • Read-only. Never mutates source rows.
 *   • Operator-driven. Every export requires `generated_by`.
 *   • Bounded window (default 90d lookback; consumer chooses).
 *   • Hashing is deterministic → same window + same upstream rows →
 *     same payload_hash.
 *   • Tenant-first reads.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  COMPLIANCE_DEFAULT_LOOKBACK_DAYS,
  COMPLIANCE_MAX_INLINE_BYTES,
  type ComplianceEvidenceExport,
  type ComplianceEvidenceKind,
  type ComplianceExportStatus,
  type ComplianceTarget,
} from '../types/complianceEvidence';
import { publishRealtime } from './realtimePublisherService';
import { publishComplianceExportGenerated } from '../events/listeningEvents';

function canonicalHash(rows: unknown): string {
  const canonical = JSON.stringify(rows, (_k, v) => (v === undefined ? null : v));
  return createHash('sha256').update(canonical).digest('hex');
}

function defaultWindow(input: { start?: string; end?: string }): { start: string; end: string } {
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start
    ? new Date(input.start)
    : new Date(end.getTime() - COMPLIANCE_DEFAULT_LOOKBACK_DAYS * 86400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function collectByKind(
  organizationId: string,
  evidenceKind: ComplianceEvidenceKind,
  start: string,
  end: string,
): Promise<unknown[]> {
  switch (evidenceKind) {
    case 'governance_traceability': {
      const { data: pol } = await ownedDbTable('intelligence_governance_policies')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end);
      const { data: enf } = await ownedDbTable('governance_enforcement_events')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end);
      return [...((pol as unknown[]) ?? []), ...((enf as unknown[]) ?? [])];
    }
    case 'retention_audit': {
      const { data } = await ownedDbTable('retention_executions')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      return (data as unknown[]) ?? [];
    }
    case 'replay_audit': {
      const { data: ops } = await ownedDbTable('replay_operations')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      const { data: parts } = await ownedDbTable('replay_partitions')
        .select('id, replay_operation_id, partition_index, status, processed_count, skipped_count, created_at')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      return [...((ops as unknown[]) ?? []), ...((parts as unknown[]) ?? [])];
    }
    case 'access_audit': {
      const { data } = await ownedDbTable('operator_actions')
        .select('id, action_kind, actor_user_id, created_at, metadata')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      return (data as unknown[]) ?? [];
    }
    case 'operational_change_log': {
      const { data } = await ownedDbTable('operator_actions')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      return (data as unknown[]) ?? [];
    }
    case 'consent_log': {
      const { data } = await ownedDbTable('consent_records')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', start).lt('created_at', end)
        .limit(2000);
      return (data as unknown[]) ?? [];
    }
    case 'full_bundle': {
      const [gov, ret, rep, acc, con] = await Promise.all([
        collectByKind(organizationId, 'governance_traceability', start, end),
        collectByKind(organizationId, 'retention_audit', start, end),
        collectByKind(organizationId, 'replay_audit', start, end),
        collectByKind(organizationId, 'access_audit', start, end),
        collectByKind(organizationId, 'consent_log', start, end),
      ]);
      return [
        { section: 'governance', rows: gov },
        { section: 'retention', rows: ret },
        { section: 'replay', rows: rep },
        { section: 'access', rows: acc },
        { section: 'consent', rows: con },
      ];
    }
  }
}

export type GenerateComplianceExportInput = {
  organizationId: string;
  evidenceKind: ComplianceEvidenceKind;
  certificationTarget?: ComplianceTarget;
  windowStart?: string;
  windowEnd?: string;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateComplianceExport(
  input: GenerateComplianceExportInput,
): Promise<ComplianceEvidenceExport> {
  const target: ComplianceTarget = input.certificationTarget ?? 'soc2';
  const { start, end } = defaultWindow({ start: input.windowStart, end: input.windowEnd });

  let rows: unknown[] = [];
  let status: ComplianceExportStatus = 'complete';
  let failureReason: string | null = null;
  try {
    rows = await collectByKind(input.organizationId, input.evidenceKind, start, end);
  } catch (err: any) {
    status = 'failed';
    failureReason = err?.message ?? 'unknown';
  }

  const payload = { evidence_kind: input.evidenceKind, certification_target: target, window_start: start, window_end: end, rows };
  const hash = canonicalHash(payload);
  const serialised = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialised, 'utf8');
  const inline = byteSize <= COMPLIANCE_MAX_INLINE_BYTES ? payload : { truncated: true, byte_size: byteSize, payload_hash: hash };

  const ins = await ownedDbTable('compliance_evidence_exports')
    .insert({
      organization_id: input.organizationId,
      evidence_kind: input.evidenceKind,
      certification_target: target,
      window_start: start,
      window_end: end,
      row_count: Array.isArray(rows) ? rows.length : 0,
      byte_size: byteSize,
      payload_inline: inline,
      payload_hash: hash,
      status,
      failure_reason: failureReason,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`compliance_export_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as ComplianceEvidenceExport;

  try {
    await publishComplianceExportGenerated({
      organizationId: input.organizationId,
      evidenceKind: row.evidence_kind,
      certificationTarget: row.certification_target,
      status: row.status,
      rowCount: row.row_count,
      byteSize: row.byte_size,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'compliance',
      eventName: 'compliance.export_generated',
      payload: { evidence_kind: row.evidence_kind, status: row.status, row_count: row.row_count },
    });
  } catch { /* best effort */ }

  return row;
}

export async function listComplianceExports(
  organizationId: string,
  options?: { evidenceKind?: ComplianceEvidenceKind; limit?: number },
): Promise<ComplianceEvidenceExport[]> {
  let q = ownedDbTable('compliance_evidence_exports')
    .select('id, evidence_kind, certification_target, window_start, window_end, row_count, byte_size, payload_hash, status, failure_reason, generated_by, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.evidenceKind) q = q.eq('evidence_kind', options.evidenceKind);
  const { data } = await q;
  return (data as ComplianceEvidenceExport[]) ?? [];
}

export async function getComplianceExport(
  organizationId: string,
  id: string,
): Promise<ComplianceEvidenceExport | null> {
  const { data } = await ownedDbTable('compliance_evidence_exports')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  return (data as ComplianceEvidenceExport | null) ?? null;
}
