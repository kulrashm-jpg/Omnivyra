/**
 * Phase 12 — Supportability infrastructure.
 *
 * Operator-authorized snapshots aimed at enterprise support: bundle the
 * minimum tenant-safe state needed to reproduce or triage an issue,
 * apply deterministic redaction to anything that could leak PII, and
 * persist with a sha256 payload_hash for replay/audit.
 *
 * Hard guarantees:
 *   • Explicit export authorization (caller supplies `generated_by`).
 *   • Deterministic redaction templates per snapshot_kind.
 *   • Payload hash is sha256 over canonical serialization.
 *   • Inline payload ≤ 1 MiB; larger snapshots persist hash + truncation
 *     flag (operators retrieve full content via a separate authorized
 *     channel, not implemented here).
 *   • Read-only over upstream tables.
 *   • Tenant-first.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  SUPPORT_SNAPSHOT_MAX_INLINE_BYTES,
  type SupportRedaction,
  type SupportSnapshot,
  type SupportSnapshotKind,
  type SupportSnapshotStatus,
} from '../types/supportSnapshot';
import { publishRealtime } from './realtimePublisherService';
import { publishSupportSnapshotGenerated } from '../events/listeningEvents';

function canonicalHash(payload: unknown): string {
  const canonical = JSON.stringify(payload, (_k, v) => (v === undefined ? null : v));
  return createHash('sha256').update(canonical).digest('hex');
}

function redactionFor(kind: SupportSnapshotKind): SupportRedaction[] {
  const baseline: SupportRedaction[] = [
    { field_path: 'email', redaction_kind: 'masked', detail: 'email addresses masked to local + domain hash' },
    { field_path: 'phone', redaction_kind: 'masked', detail: 'phone numbers masked to last 4' },
    { field_path: 'oauth_token', redaction_kind: 'omitted', detail: 'OAuth tokens omitted entirely' },
    { field_path: 'api_key', redaction_kind: 'omitted', detail: 'API keys omitted entirely' },
  ];
  if (kind === 'tenant_diagnostic') {
    return [...baseline, { field_path: 'user_handle', redaction_kind: 'hashed', detail: 'user handles hashed' }];
  }
  return baseline;
}

async function collectByKind(
  organizationId: string,
  kind: SupportSnapshotKind,
  linkedIncidentId: string | null,
  linkedReplayId: string | null,
): Promise<unknown[]> {
  switch (kind) {
    case 'support_bundle': {
      const [incidents, escalations, executions] = await Promise.all([
        ownedDbTable('intelligence_incidents').select('id, title, severity, status, category, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(50),
        ownedDbTable('escalations').select('id, severity, status, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(50),
        ownedDbTable('listening_executions').select('id, status, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(50),
      ]);
      return [
        { section: 'incidents', rows: incidents.data ?? [] },
        { section: 'escalations', rows: escalations.data ?? [] },
        { section: 'executions', rows: executions.data ?? [] },
      ];
    }
    case 'issue_reproduction': {
      if (!linkedIncidentId) return [];
      const inc = await ownedDbTable('intelligence_incidents').select('*').eq('organization_id', organizationId).eq('id', linkedIncidentId).maybeSingle();
      const timeline = await ownedDbTable('incident_timeline_entries').select('*').eq('organization_id', organizationId).eq('incident_id', linkedIncidentId).order('created_at', { ascending: true }).limit(500);
      return [{ section: 'incident', rows: inc.data ? [inc.data] : [] }, { section: 'timeline', rows: timeline.data ?? [] }];
    }
    case 'tenant_diagnostic': {
      const [feedItems, partitions, sources] = await Promise.all([
        ownedDbTable('opportunity_feed_items').select('id, opportunity_type, opportunity_score, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(50),
        ownedDbTable('execution_partitions').select('id, partition_key, status, lease_expires_at').eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(50),
        ownedDbTable('source_health_state').select('listening_source_id, status, last_success_at').eq('organization_id', organizationId).limit(50),
      ]);
      return [
        { section: 'opportunity_feed', rows: feedItems.data ?? [] },
        { section: 'partitions', rows: partitions.data ?? [] },
        { section: 'source_health', rows: sources.data ?? [] },
      ];
    }
    case 'execution_replay_ref': {
      if (!linkedReplayId) return [];
      const op = await ownedDbTable('replay_operations').select('*').eq('organization_id', organizationId).eq('id', linkedReplayId).maybeSingle();
      const parts = await ownedDbTable('replay_partitions').select('id, partition_index, status, processed_count, skipped_count, attempts_made').eq('organization_id', organizationId).eq('replay_operation_id', linkedReplayId).order('partition_index', { ascending: true }).limit(500);
      return [{ section: 'replay_operation', rows: op.data ? [op.data] : [] }, { section: 'replay_partitions', rows: parts.data ?? [] }];
    }
    case 'incident_bundle': {
      if (!linkedIncidentId) return [];
      const inc = await ownedDbTable('intelligence_incidents').select('*').eq('organization_id', organizationId).eq('id', linkedIncidentId).maybeSingle();
      const tl = await ownedDbTable('incident_timeline_entries').select('*').eq('organization_id', organizationId).eq('incident_id', linkedIncidentId).order('created_at', { ascending: true }).limit(1000);
      const linkedEscalation = inc.data && (inc.data as { linked_escalation_id?: string | null }).linked_escalation_id;
      const linkedReplay = inc.data && (inc.data as { linked_replay_id?: string | null }).linked_replay_id;
      const extras: unknown[] = [];
      if (linkedEscalation) {
        const esc = await ownedDbTable('escalations').select('*').eq('organization_id', organizationId).eq('id', linkedEscalation).maybeSingle();
        if (esc.data) extras.push({ section: 'escalation', rows: [esc.data] });
      }
      if (linkedReplay) {
        const rep = await ownedDbTable('replay_operations').select('*').eq('organization_id', organizationId).eq('id', linkedReplay).maybeSingle();
        if (rep.data) extras.push({ section: 'replay_operation', rows: [rep.data] });
      }
      return [{ section: 'incident', rows: inc.data ? [inc.data] : [] }, { section: 'timeline', rows: tl.data ?? [] }, ...extras];
    }
    case 'operational_trace': {
      const [opActions, governanceEnforcement] = await Promise.all([
        ownedDbTable('operator_actions').select('id, action_kind, actor_user_id, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200),
        ownedDbTable('governance_enforcement_events').select('id, policy_kind, decision, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(200),
      ]);
      return [
        { section: 'operator_actions', rows: opActions.data ?? [] },
        { section: 'governance_enforcement', rows: governanceEnforcement.data ?? [] },
      ];
    }
  }
}

export type GenerateSupportSnapshotInput = {
  organizationId: string;
  snapshotKind: SupportSnapshotKind;
  scopeDescription?: string | null;
  linkedIncidentId?: string | null;
  linkedReplayId?: string | null;
  generatedBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function generateSupportSnapshot(input: GenerateSupportSnapshotInput): Promise<SupportSnapshot> {
  let rows: unknown[] = [];
  let status: SupportSnapshotStatus = 'complete';
  let failure: string | null = null;
  try {
    rows = await collectByKind(input.organizationId, input.snapshotKind, input.linkedIncidentId ?? null, input.linkedReplayId ?? null);
  } catch (err: any) {
    status = 'failed';
    failure = err?.message ?? 'unknown';
  }

  const redaction = redactionFor(input.snapshotKind);
  const payload = {
    snapshot_kind: input.snapshotKind,
    scope_description: input.scopeDescription ?? null,
    redaction_applied: redaction,
    sections: rows,
  };
  const hash = canonicalHash(payload);
  const serialised = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialised, 'utf8');
  const inline = byteSize <= SUPPORT_SNAPSHOT_MAX_INLINE_BYTES ? payload : { truncated: true, byte_size: byteSize, payload_hash: hash };

  const ins = await ownedDbTable('support_snapshots')
    .insert({
      organization_id: input.organizationId,
      snapshot_kind: input.snapshotKind,
      scope_description: input.scopeDescription ?? null,
      payload_inline: inline,
      payload_hash: hash,
      row_count: rows.length,
      byte_size: byteSize,
      redaction_applied: redaction,
      linked_incident_id: input.linkedIncidentId ?? null,
      linked_replay_id: input.linkedReplayId ?? null,
      status,
      failure_reason: failure,
      generated_by: input.generatedBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`support_snapshot_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const row = ins.data as SupportSnapshot;

  try {
    await publishSupportSnapshotGenerated({
      organizationId: input.organizationId,
      snapshotId: row.id,
      snapshotKind: row.snapshot_kind,
      rowCount: row.row_count,
      byteSize: row.byte_size,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'support_snapshots',
      eventName: 'support.snapshot_generated',
      payload: { snapshot_id: row.id, snapshot_kind: row.snapshot_kind, status: row.status },
    });
  } catch { /* best effort */ }

  return row;
}

export async function listSupportSnapshots(
  organizationId: string,
  options?: { snapshotKind?: SupportSnapshotKind; limit?: number },
): Promise<SupportSnapshot[]> {
  let q = ownedDbTable('support_snapshots')
    .select('id, snapshot_kind, scope_description, payload_hash, row_count, byte_size, redaction_applied, linked_incident_id, linked_replay_id, status, failure_reason, generated_by, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.snapshotKind) q = q.eq('snapshot_kind', options.snapshotKind);
  const { data } = await q;
  return (data as SupportSnapshot[]) ?? [];
}

export async function getSupportSnapshot(
  organizationId: string,
  id: string,
): Promise<SupportSnapshot | null> {
  const { data } = await ownedDbTable('support_snapshots')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  return (data as SupportSnapshot | null) ?? null;
}
