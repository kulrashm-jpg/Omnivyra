/**
 * Phase 9 — Intelligence incident management.
 *
 * Incidents track operational/analytical failures across the platform:
 * execution failures, semantic indexing failures, replay failures,
 * projection drift, moderation outages, cost/SLA breaches, connector
 * outages, governance violations.
 *
 * Every mutation appends an entry to `incident_timeline_entries`. The
 * timeline is append-only at the DB level (PL/pgSQL trigger blocks
 * UPDATE/DELETE) so the audit story remains intact.
 *
 * Hard guarantees:
 *   • No autonomous incident creation in this service — callers must
 *     supply `created_by` (or null for system-emitted). Phase 9 wires
 *     system-emitted incidents from execution / replay / semantic /
 *     governance failure points; they all carry an explicit category.
 *   • Status / severity / owner / link mutations always append a
 *     timeline entry.
 *   • Linked escalation + linked replay set once (UPDATE allowed); the
 *     full history lives on the timeline.
 *   • Tenant-first reads; FK CASCADE on org delete.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentTimelineEntry,
  type IncidentTimelineKind,
  type IntelligenceIncident,
} from '../types/intelligenceIncident';
import { publishRealtime } from './realtimePublisherService';
import { publishIncidentCreated, publishIncidentUpdated } from '../events/listeningEvents';

async function appendTimeline(args: {
  organizationId: string;
  incidentId: string;
  entryKind: IncidentTimelineKind;
  body?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<IncidentTimelineEntry | null> {
  const { data } = await ownedDbTable('incident_timeline_entries')
    .insert({
      organization_id: args.organizationId,
      incident_id: args.incidentId,
      entry_kind: args.entryKind,
      body: args.body ?? null,
      actor_user_id: args.actorUserId ?? null,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  return (data as IncidentTimelineEntry | null) ?? null;
}

export type CreateIncidentInput = {
  organizationId: string;
  title: string;
  description?: string | null;
  severity?: IncidentSeverity;
  category: IncidentCategory;
  ownerUserId?: string | null;
  linkedEscalationId?: string | null;
  linkedReplayId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy: string | null;
};

export async function createIncident(input: CreateIncidentInput): Promise<IntelligenceIncident> {
  const title = (input.title ?? '').trim().slice(0, 200);
  if (title.length === 0) throw new Error('incident_title_required');
  const ins = await ownedDbTable('intelligence_incidents')
    .insert({
      organization_id: input.organizationId,
      title,
      description: input.description ?? null,
      severity: input.severity ?? 'sev3',
      status: 'open' as IncidentStatus,
      category: input.category,
      owner_user_id: input.ownerUserId ?? null,
      linked_escalation_id: input.linkedEscalationId ?? null,
      linked_replay_id: input.linkedReplayId ?? null,
      metadata: input.metadata ?? {},
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`incident_insert_failed:${ins.error?.message ?? 'unknown'}`);
  const incident = ins.data as IntelligenceIncident;

  await appendTimeline({
    organizationId: input.organizationId,
    incidentId: incident.id,
    entryKind: 'created',
    body: input.description ?? title,
    actorUserId: input.createdBy,
    metadata: { severity: incident.severity, category: incident.category },
  });

  try {
    await publishIncidentCreated({
      organizationId: input.organizationId,
      incidentId: incident.id,
      severity: incident.severity,
      category: incident.category,
      createdBy: input.createdBy,
    });
    void publishRealtime({
      organizationId: input.organizationId,
      topic: 'incidents',
      eventName: 'incident.created',
      payload: { incident_id: incident.id, severity: incident.severity, category: incident.category },
    });
  } catch { /* best effort */ }

  return incident;
}

export type UpdateIncidentInput = {
  organizationId: string;
  incidentId: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  ownerUserId?: string | null;
  linkedEscalationId?: string | null;
  linkedReplayId?: string | null;
  note?: string | null;
  actorUserId: string | null;
};

export async function updateIncident(input: UpdateIncidentInput): Promise<IntelligenceIncident> {
  const { data: row } = await ownedDbTable('intelligence_incidents')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('id', input.incidentId)
    .maybeSingle();
  const current = row as IntelligenceIncident | null;
  if (!current) throw new Error(`incident_not_found:${input.incidentId}`);

  const patch: Record<string, unknown> = {};
  const timelineEntries: Array<Omit<Parameters<typeof appendTimeline>[0], 'organizationId' | 'incidentId'>> = [];

  if (input.status && input.status !== current.status) {
    patch.status = input.status;
    if (input.status === 'resolved' && !current.resolved_at) {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = input.actorUserId;
    }
    timelineEntries.push({
      entryKind: input.status === 'resolved' ? 'resolved' : 'status_changed',
      body: input.note ?? `Status: ${current.status} -> ${input.status}`,
      actorUserId: input.actorUserId,
      metadata: { previous: current.status, next: input.status },
    });
  }
  if (input.severity && input.severity !== current.severity) {
    patch.severity = input.severity;
    timelineEntries.push({
      entryKind: 'severity_changed',
      body: `Severity: ${current.severity} -> ${input.severity}`,
      actorUserId: input.actorUserId,
      metadata: { previous: current.severity, next: input.severity },
    });
  }
  if (typeof input.ownerUserId !== 'undefined' && input.ownerUserId !== current.owner_user_id) {
    patch.owner_user_id = input.ownerUserId;
    timelineEntries.push({
      entryKind: 'owner_changed',
      body: input.ownerUserId ? `Assigned to ${input.ownerUserId}` : 'Unassigned',
      actorUserId: input.actorUserId,
      metadata: { previous: current.owner_user_id, next: input.ownerUserId },
    });
  }
  if (typeof input.linkedEscalationId !== 'undefined' && input.linkedEscalationId !== current.linked_escalation_id) {
    patch.linked_escalation_id = input.linkedEscalationId;
    timelineEntries.push({
      entryKind: 'escalation_linked',
      body: input.linkedEscalationId ? `Linked escalation ${input.linkedEscalationId}` : 'Unlinked escalation',
      actorUserId: input.actorUserId,
      metadata: { escalation_id: input.linkedEscalationId },
    });
  }
  if (typeof input.linkedReplayId !== 'undefined' && input.linkedReplayId !== current.linked_replay_id) {
    patch.linked_replay_id = input.linkedReplayId;
    timelineEntries.push({
      entryKind: 'replay_linked',
      body: input.linkedReplayId ? `Linked replay ${input.linkedReplayId}` : 'Unlinked replay',
      actorUserId: input.actorUserId,
      metadata: { replay_id: input.linkedReplayId },
    });
  }
  if (input.note) {
    timelineEntries.push({
      entryKind: 'note',
      body: input.note,
      actorUserId: input.actorUserId,
    });
  }

  let final: IntelligenceIncident = current;
  if (Object.keys(patch).length > 0) {
    const upd = await ownedDbTable('intelligence_incidents')
      .update(patch)
      .eq('id', current.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`incident_update_failed:${upd.error?.message ?? 'unknown'}`);
    final = upd.data as IntelligenceIncident;
  }

  for (const e of timelineEntries) {
    await appendTimeline({ organizationId: input.organizationId, incidentId: current.id, ...e });
  }

  try {
    if (timelineEntries.length > 0) {
      await publishIncidentUpdated({
        organizationId: input.organizationId,
        incidentId: final.id,
        status: final.status,
        severity: final.severity,
        actorUserId: input.actorUserId,
      });
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'incidents',
        eventName: 'incident.updated',
        payload: { incident_id: final.id, status: final.status, severity: final.severity },
      });
    }
  } catch { /* best effort */ }

  return final;
}

export async function addIncidentNote(args: {
  organizationId: string;
  incidentId: string;
  body: string;
  actorUserId: string | null;
}): Promise<IncidentTimelineEntry | null> {
  return appendTimeline({
    organizationId: args.organizationId,
    incidentId: args.incidentId,
    entryKind: 'note',
    body: args.body,
    actorUserId: args.actorUserId,
  });
}

export async function getIncident(
  organizationId: string,
  incidentId: string,
): Promise<{ incident: IntelligenceIncident | null; timeline: IncidentTimelineEntry[] }> {
  const inc = await ownedDbTable('intelligence_incidents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', incidentId)
    .maybeSingle();
  const tl = await ownedDbTable('incident_timeline_entries')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true });
  return {
    incident: (inc.data as IntelligenceIncident | null) ?? null,
    timeline: (tl.data as IncidentTimelineEntry[]) ?? [],
  };
}

export async function listIncidents(
  organizationId: string,
  options?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    category?: IncidentCategory;
    limit?: number;
  },
): Promise<IntelligenceIncident[]> {
  let q = ownedDbTable('intelligence_incidents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.status) q = q.eq('status', options.status);
  if (options?.severity) q = q.eq('severity', options.severity);
  if (options?.category) q = q.eq('category', options.category);
  const { data } = await q;
  return (data as IntelligenceIncident[]) ?? [];
}
