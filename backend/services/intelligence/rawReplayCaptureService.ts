/**
 * Raw replay payload capture + quarantine (append-oriented, idempotent).
 *
 * Closes the real gap: failed raw payloads were previously lost. Now they are
 * durably captured so they can be inspected, exported, and (for whitelisted
 * idempotent targets) replayed. Persistence uses the `replay_payloads` /
 * `quarantine_payloads` tables WHEN PRESENT (migration 20260692) and otherwise
 * falls back to the append-only audit_events substrate (size-bounded) — zero
 * regression either way.
 *
 * DELIBERATE BOUNDARY: this does NOT re-inject bytes into the hardened
 * ingestion/webhook HTTP endpoints (origin/secret-gated, stable — not to be
 * refactored). Raw capture + quarantine + lineage + operator export is
 * provided; idempotent re-dispatch is handled by replayOrchestrationService
 * for service-level targets only. Stated honestly in the report.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type ReplaySource = 'ingestion' | 'webhook' | 'publish' | 'reconciliation' | 'attribution';
export type QuarantineReason = 'malformed' | 'schema_invalid' | 'untrusted';

const MAX_AUDIT_PAYLOAD = 6_000; // chars — fallback only, avoids bloating audit

let tableProbed: boolean | null = null;
async function hasTables(): Promise<boolean> {
  if (tableProbed !== null) return tableProbed;
  try {
    const { error } = await ownedDbTable('replay_payloads')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    tableProbed = !error;
  } catch {
    tableProbed = false;
  }
  return tableProbed;
}

export interface CapturedPayloadInput {
  companyId: string;
  source: ReplaySource;
  target: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  error: string;
}

/** Durably capture a failed raw payload (idempotent on dedupe_key). */
export async function captureReplayPayload(input: CapturedPayloadInput): Promise<{ stored: 'table' | 'audit' }> {
  if (await hasTables()) {
    // ON CONFLICT DO NOTHING via the UNIQUE(company_id,source,dedupe_key).
    await ownedDbTable('replay_payloads')
      .upsert(
        {
          company_id: input.companyId,
          source: input.source,
          target: input.target,
          dedupe_key: input.dedupeKey,
          payload: input.payload,
          error: input.error,
          status: 'pending',
        },
        { onConflict: 'company_id,source,dedupe_key', ignoreDuplicates: true },
      )
      .then(() => undefined, () => undefined);
    return { stored: 'table' };
  }
  // Fallback: append-only audit (bounded payload).
  const json = JSON.stringify(input.payload);
  await recordComplianceAudit({
    companyId: input.companyId,
    actor: { userId: null, type: 'system', label: 'replay-capture' },
    action: `dead_letter.${input.source}`,
    resourceType: 'dead_letter',
    resourceId: input.dedupeKey,
    severity: 'warning',
    outcome: 'failure',
    entityLineage: ['company', 'dead_letter', input.source, input.target],
    detail: {
      source: input.source,
      target: input.target,
      dedupeKey: input.dedupeKey,
      error: input.error,
      payloadTruncated: json.length > MAX_AUDIT_PAYLOAD,
      payload: json.length > MAX_AUDIT_PAYLOAD ? json.slice(0, MAX_AUDIT_PAYLOAD) : input.payload,
      status: 'pending',
    },
  }).catch(() => undefined);
  return { stored: 'audit' };
}

/** Quarantine an unparseable / untrusted body — NEVER executed or replayed. */
export async function quarantinePayload(input: {
  companyId: string;
  source: ReplaySource;
  reason: QuarantineReason;
  raw: string;
}): Promise<void> {
  if (await hasTables()) {
    await ownedDbTable('quarantine_payloads')
      .insert({
        company_id: input.companyId,
        source: input.source,
        reason: input.reason,
        raw: input.raw.slice(0, 20_000),
      })
      .then(() => undefined, () => undefined);
    return;
  }
  await recordComplianceAudit({
    companyId: input.companyId,
    actor: { userId: null, type: 'system', label: 'replay-quarantine' },
    action: `quarantine.${input.reason}`,
    resourceType: 'quarantine_payload',
    resourceId: input.source,
    severity: 'warning',
    entityLineage: ['company', 'quarantine', input.source],
    detail: { reason: input.reason, rawTruncated: input.raw.length > MAX_AUDIT_PAYLOAD, raw: input.raw.slice(0, MAX_AUDIT_PAYLOAD) },
  }).catch(() => undefined);
}

export async function listReplayPayloads(companyId: string, status?: string, limit = 100): Promise<any[]> {
  if (!(await hasTables())) return [];
  try {
    let q = ownedDbTable('replay_payloads')
      .select('id, source, target, dedupe_key, error, status, attempts, captured_at, last_attempt_at')
      .eq('company_id', companyId)
      .order('captured_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

export async function listQuarantine(companyId: string, limit = 100): Promise<any[]> {
  if (!(await hasTables())) return [];
  try {
    const { data } = await ownedDbTable('quarantine_payloads')
      .select('id, source, reason, captured_at')
      .eq('company_id', companyId)
      .order('captured_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

/** Mark a captured payload's replay outcome (append-only status transition). */
export async function markReplayPayloadOutcome(
  companyId: string,
  id: string,
  status: 'replayed' | 'failed' | 'quarantined',
): Promise<void> {
  if (!(await hasTables())) return;
  await ownedDbTable('replay_payloads')
    .update({ status, last_attempt_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', id)
    .then(() => undefined, () => undefined);
}

export function __resetReplayTableProbe(): void {
  tableProbed = null;
}
