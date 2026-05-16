/**
 * Phase 6 — Escalation pipeline.
 *
 * User-triggered escalations. Five types, four severities, four statuses.
 * SLA windows are deterministic per type and supplied at creation time
 * unless the caller provides an explicit override.
 *
 * Strict guarantees:
 *   • No autonomous escalation creator exists in the codebase.
 *   • No external notification (email/SMS/Slack/WhatsApp) is emitted.
 *     History entries are recorded internally only.
 *   • Status transitions are explicit and append-only against the
 *     `history` JSONB column.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  Escalation,
  EscalationHistoryEntry,
  EscalationSeverity,
  EscalationStatus,
  EscalationType,
} from '../types/escalation';
import { ESCALATION_SLA_HOURS } from '../types/escalation';

function appendHistory(existing: EscalationHistoryEntry[], entry: EscalationHistoryEntry): EscalationHistoryEntry[] {
  const next = Array.isArray(existing) ? [...existing] : [];
  next.push(entry);
  // Bounded — keep last 200 entries to avoid unbounded JSONB growth.
  return next.slice(-200);
}

export type CreateEscalationInput = {
  organizationId: string;
  opportunityFeedItemId: string | null;
  escalationType: EscalationType;
  severity: EscalationSeverity;
  requestedBy: string | null;
  assignedToUserId?: string | null;
  title: string;
  body?: string | null;
  slaDueAt?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createEscalation(input: CreateEscalationInput): Promise<Escalation> {
  const slaHours = ESCALATION_SLA_HOURS[input.escalationType];
  const due = input.slaDueAt ?? new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();
  const history: EscalationHistoryEntry[] = [
    {
      at: new Date().toISOString(),
      by: input.requestedBy,
      action: 'created',
      detail: `severity=${input.severity}`,
    },
  ];
  if (input.assignedToUserId) {
    history.push({
      at: new Date().toISOString(),
      by: input.requestedBy,
      action: 'assigned',
      detail: input.assignedToUserId,
    });
  }
  const { data, error } = await ownedDbTable('escalations')
    .insert({
      organization_id: input.organizationId,
      opportunity_feed_item_id: input.opportunityFeedItemId,
      escalation_type: input.escalationType,
      status: 'open' as EscalationStatus,
      severity: input.severity,
      requested_by: input.requestedBy,
      assigned_to_user_id: input.assignedToUserId ?? null,
      title: input.title.slice(0, 200),
      body: input.body ?? null,
      sla_due_at: due,
      history,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`escalation_insert_failed:${error?.message ?? 'unknown'}`);
  return data as Escalation;
}

export async function assignEscalation(args: {
  organizationId: string;
  escalationId: string;
  assignedToUserId: string;
  actorUserId: string | null;
}): Promise<Escalation | null> {
  const { data: existing } = await ownedDbTable('escalations')
    .select('history')
    .eq('organization_id', args.organizationId)
    .eq('id', args.escalationId)
    .maybeSingle();
  const history = appendHistory((existing as { history?: EscalationHistoryEntry[] } | null)?.history ?? [], {
    at: new Date().toISOString(),
    by: args.actorUserId,
    action: 'assigned',
    detail: args.assignedToUserId,
  });
  const { data, error } = await ownedDbTable('escalations')
    .update({
      assigned_to_user_id: args.assignedToUserId,
      history,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.escalationId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`escalation_assign_failed:${error.message}`);
  return (data as Escalation | null) ?? null;
}

export async function updateEscalationStatus(args: {
  organizationId: string;
  escalationId: string;
  status: EscalationStatus;
  actorUserId: string | null;
  reason?: string | null;
}): Promise<Escalation | null> {
  const { data: existing } = await ownedDbTable('escalations')
    .select('history')
    .eq('organization_id', args.organizationId)
    .eq('id', args.escalationId)
    .maybeSingle();
  const history = appendHistory((existing as { history?: EscalationHistoryEntry[] } | null)?.history ?? [], {
    at: new Date().toISOString(),
    by: args.actorUserId,
    action: 'status_changed',
    detail: `${args.status}${args.reason ? ` :: ${args.reason}` : ''}`,
  });
  const patch: Record<string, unknown> = { status: args.status, history };
  if (args.status === 'resolved') {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = args.actorUserId;
  } else if (args.status === 'dismissed') {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = args.actorUserId;
  }
  const { data, error } = await ownedDbTable('escalations')
    .update(patch)
    .eq('organization_id', args.organizationId)
    .eq('id', args.escalationId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`escalation_update_failed:${error.message}`);
  return (data as Escalation | null) ?? null;
}

export async function listEscalations(
  organizationId: string,
  options?: { status?: EscalationStatus; assignedToUserId?: string; limit?: number },
): Promise<Escalation[]> {
  let q = ownedDbTable('escalations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.status) q = q.eq('status', options.status);
  if (options?.assignedToUserId) q = q.eq('assigned_to_user_id', options.assignedToUserId);
  const { data, error } = await q;
  if (error) throw new Error(`escalation_list_failed:${error.message}`);
  return (data as Escalation[]) ?? [];
}

export async function getEscalation(
  organizationId: string,
  id: string,
): Promise<Escalation | null> {
  const { data, error } = await ownedDbTable('escalations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`escalation_get_failed:${error.message}`);
  return (data as Escalation | null) ?? null;
}
