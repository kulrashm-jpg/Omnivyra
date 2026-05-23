// Shadow Telemetry Persistence
//
// Append-only, immutable, advisory-only persistence for worker shadow soak
// telemetry. Persists runtime telemetry, metrics snapshots, and risk / drift /
// compatibility / ownership summaries. No worker mutation, no execution.
//
// The `content_publish_snapshots`-style discipline applies: there is NO update
// API — rows are append-only (also enforced by the database trigger).

import { ownedDbTable } from '../db/writeOwner';
import { publishSha256, stablePublishStringify } from '../../lib/publishing/universalPublishSnapshot';
import type { WorkerSnapshotRuntimeTelemetry } from '../../lib/publishing/workerSnapshotRuntimeTelemetry';

const TABLE = 'worker_snapshot_shadow_telemetry';

export type ShadowTelemetryRecordKind =
  | 'runtime_telemetry'
  | 'metrics_snapshot'
  | 'risk_summary'
  | 'drift_summary'
  | 'compatibility_summary'
  | 'ownership_summary';

export interface WorkerSnapshotShadowTelemetryRow {
  soak_cycle_id: string;
  record_kind: ShadowTelemetryRecordKind;
  company_id: string | null;
  blog_id: string | null;
  job_id: string | null;
  runtime_status: string | null;
  shadow_soak_status: string | null;
  payload: unknown;
  telemetry_fingerprint: string;
}

export interface BuildShadowTelemetryRowInput {
  soakCycleId: string;
  recordKind: ShadowTelemetryRecordKind;
  payload: unknown;
  companyId?: string | null;
  blogId?: string | null;
  jobId?: string | null;
  runtimeStatus?: string | null;
  shadowSoakStatus?: string | null;
}

// Pure, deterministic row codec — identical input yields an identical row,
// including a content-addressed append-only fingerprint.
export function buildShadowTelemetryRow(
  input: BuildShadowTelemetryRowInput,
): WorkerSnapshotShadowTelemetryRow {
  return {
    soak_cycle_id: input.soakCycleId,
    record_kind: input.recordKind,
    company_id: input.companyId ?? null,
    blog_id: input.blogId ?? null,
    job_id: input.jobId ?? null,
    runtime_status: input.runtimeStatus ?? null,
    shadow_soak_status: input.shadowSoakStatus ?? null,
    payload: input.payload,
    telemetry_fingerprint: publishSha256(stablePublishStringify(input.payload)),
  };
}

// Convenience: build an append-only runtime-telemetry row.
export function buildRuntimeTelemetryRow(
  soakCycleId: string,
  telemetry: WorkerSnapshotRuntimeTelemetry,
): WorkerSnapshotShadowTelemetryRow {
  return buildShadowTelemetryRow({
    soakCycleId,
    recordKind: 'runtime_telemetry',
    payload: telemetry,
    companyId: telemetry.companyId || null,
    blogId: telemetry.blogId || null,
    jobId: telemetry.jobId || null,
    runtimeStatus: telemetry.runtimeStatus,
  });
}

// Append-only persistence. Never updates or deletes existing rows.
export async function persistShadowTelemetryRecords(
  rows: readonly WorkerSnapshotShadowTelemetryRow[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  const { error } = await ownedDbTable(TABLE).insert(rows as WorkerSnapshotShadowTelemetryRow[]);
  if (error) throw new Error(error.message);
  return { inserted: rows.length };
}

export interface LoadShadowTelemetryFilter {
  soakCycleId?: string;
  recordKind?: ShadowTelemetryRecordKind;
  limit?: number;
}

export async function loadShadowTelemetryRecords(
  filter: LoadShadowTelemetryFilter = {},
): Promise<WorkerSnapshotShadowTelemetryRow[]> {
  let query = ownedDbTable(TABLE)
    .select('*')
    .order('created_at', { ascending: true })
    .limit(filter.limit ?? 1000);
  if (filter.soakCycleId) query = query.eq('soak_cycle_id', filter.soakCycleId);
  if (filter.recordKind) query = query.eq('record_kind', filter.recordKind);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkerSnapshotShadowTelemetryRow[];
}
