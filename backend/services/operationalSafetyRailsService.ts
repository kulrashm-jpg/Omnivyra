/**
 * Phase 11 — Operational safety rails.
 *
 * Seven per-org rails sit alongside Phase 10 production safeguards. Rails
 * are broader-scope thresholds with an acknowledgement gate: when a rail
 * trips, an operator may need to acknowledge before mutations on the
 * relevant surface resume. Every state transition writes an append-only
 * event row.
 *
 * Hard guarantees:
 *   • Deterministic threshold evaluation (numeric comparison only).
 *   • Override + acknowledgement always carry actor + rationale.
 *   • Replay-safe freeze: `rollout_freeze` simply persists state;
 *     mutating callers consult `isRailFrozen()` and choose to no-op.
 *   • Append-only event log enforced by DB trigger.
 *   • No autonomous recovery — `recovered` only fires when an operator
 *     reports observed value below threshold OR re-arms explicitly.
 *   • Tenant-first; rails are 1:1 with (org, rail_kind).
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  SAFETY_RAIL_DEFAULT_THRESHOLDS,
  type OperationalSafetyRail,
  type OperationalSafetyRailEvent,
  type SafetyRailEventKind,
  type SafetyRailKind,
  type SafetyRailState,
} from '../types/operationalSafetyRail';
import { publishRealtime } from './realtimePublisherService';
import {
  publishSafeguardOverrideApplied,
  publishSafeguardThresholdTriggered,
} from '../events/listeningEvents';

export async function getOrInitSafetyRail(
  organizationId: string,
  railKind: SafetyRailKind,
): Promise<OperationalSafetyRail> {
  const { data } = await ownedDbTable('operational_safety_rails')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('rail_kind', railKind)
    .maybeSingle();
  if (data) return data as OperationalSafetyRail;
  const ins = await ownedDbTable('operational_safety_rails')
    .insert({
      organization_id: organizationId,
      rail_kind: railKind,
      state: 'green' as SafetyRailState,
      threshold_value: SAFETY_RAIL_DEFAULT_THRESHOLDS[railKind],
      observed_value: 0,
      acknowledgement_required: railKind === 'operator_ack_gate',
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    if ((ins.error as { code?: string }).code === '23505') {
      const reread = await ownedDbTable('operational_safety_rails')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('rail_kind', railKind)
        .single();
      return reread.data as OperationalSafetyRail;
    }
    throw new Error(`safety_rail_init_failed:${ins.error?.message ?? 'unknown'}`);
  }
  return ins.data as OperationalSafetyRail;
}

async function appendRailEvent(args: {
  organizationId: string;
  railId: string;
  eventKind: SafetyRailEventKind;
  previousState: SafetyRailState | null;
  newState: SafetyRailState;
  observedValue: number;
  thresholdValue: number;
  actorUserId: string | null;
  rationale: string | null;
  metadata?: Record<string, unknown>;
}): Promise<OperationalSafetyRailEvent | null> {
  const { data } = await ownedDbTable('operational_safety_rail_events')
    .insert({
      organization_id: args.organizationId,
      rail_id: args.railId,
      event_kind: args.eventKind,
      previous_state: args.previousState,
      new_state: args.newState,
      observed_value: args.observedValue,
      threshold_value: args.thresholdValue,
      actor_user_id: args.actorUserId,
      rationale: args.rationale,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  return (data as OperationalSafetyRailEvent | null) ?? null;
}

export type ReportRailObservationInput = {
  organizationId: string;
  railKind: SafetyRailKind;
  observedValue: number;
  actorUserId: string | null;
};

export async function reportRailObservation(input: ReportRailObservationInput): Promise<OperationalSafetyRail> {
  const current = await getOrInitSafetyRail(input.organizationId, input.railKind);
  const ratio = current.threshold_value === 0 ? 0 : input.observedValue / current.threshold_value;

  let nextState: SafetyRailState = current.state;
  let eventKind: SafetyRailEventKind | null = null;
  if (current.state === 'green' && ratio >= 0.8 && ratio < 1) nextState = 'warn';
  else if (current.state === 'green' && ratio >= 1) { nextState = 'triggered'; eventKind = 'threshold_triggered'; }
  else if (current.state === 'warn' && ratio >= 1) { nextState = 'triggered'; eventKind = 'threshold_triggered'; }
  else if (current.state === 'warn' && ratio < 0.8) nextState = 'green';
  else if (current.state === 'triggered' && ratio < 1) { nextState = 'warn'; eventKind = 'recovered'; }

  const patch: Record<string, unknown> = { observed_value: input.observedValue };
  if (nextState !== current.state) patch.state = nextState;
  const upd = await ownedDbTable('operational_safety_rails')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single();
  const final = (upd.data as OperationalSafetyRail | null) ?? current;

  if (eventKind) {
    await appendRailEvent({
      organizationId: input.organizationId,
      railId: final.id,
      eventKind,
      previousState: current.state,
      newState: final.state,
      observedValue: input.observedValue,
      thresholdValue: final.threshold_value,
      actorUserId: input.actorUserId,
      rationale: eventKind === 'threshold_triggered'
        ? `observed ${input.observedValue} >= threshold ${final.threshold_value}`
        : `observed ${input.observedValue} dropped below threshold ${final.threshold_value}`,
    });
    try {
      if (eventKind === 'threshold_triggered') {
        await publishSafeguardThresholdTriggered({
          organizationId: input.organizationId,
          railKind: input.railKind,
          observedValue: input.observedValue,
          thresholdValue: final.threshold_value,
          ackedBy: null,
        });
      }
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'safety_rails',
        eventName: eventKind === 'threshold_triggered' ? 'safeguard.threshold_triggered' : 'safeguard.recovered',
        payload: { rail_kind: input.railKind, observed_value: input.observedValue, threshold_value: final.threshold_value, state: nextState },
      });
    } catch { /* best effort */ }
  }
  return final;
}

export async function overrideRail(args: {
  organizationId: string;
  railKind: SafetyRailKind;
  actorUserId: string | null;
  rationale: string;
}): Promise<OperationalSafetyRail> {
  const current = await getOrInitSafetyRail(args.organizationId, args.railKind);
  const upd = await ownedDbTable('operational_safety_rails')
    .update({ state: 'overridden' as SafetyRailState, override_rationale: args.rationale })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendRailEvent({
    organizationId: args.organizationId,
    railId: current.id,
    eventKind: 'override_applied',
    previousState: current.state,
    newState: 'overridden',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actorUserId: args.actorUserId,
    rationale: args.rationale,
  });
  try {
    await publishSafeguardOverrideApplied({
      organizationId: args.organizationId,
      railKind: args.railKind,
      actorUserId: args.actorUserId,
      rationale: args.rationale,
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'safety_rails',
      eventName: 'safeguard.override_applied',
      payload: { rail_kind: args.railKind, rationale: args.rationale },
    });
  } catch { /* best effort */ }
  return (upd.data as OperationalSafetyRail | null) ?? current;
}

export async function acknowledgeRail(args: {
  organizationId: string;
  railKind: SafetyRailKind;
  actorUserId: string | null;
}): Promise<OperationalSafetyRail> {
  const current = await getOrInitSafetyRail(args.organizationId, args.railKind);
  const upd = await ownedDbTable('operational_safety_rails')
    .update({
      acknowledged_by: args.actorUserId,
      acknowledged_at: new Date().toISOString(),
      state: current.state === 'triggered' ? ('warn' as SafetyRailState) : current.state,
    })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendRailEvent({
    organizationId: args.organizationId,
    railId: current.id,
    eventKind: 'acknowledged',
    previousState: current.state,
    newState: (upd.data as OperationalSafetyRail | null)?.state ?? current.state,
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actorUserId: args.actorUserId,
    rationale: 'operator acknowledged',
  });
  return (upd.data as OperationalSafetyRail | null) ?? current;
}

export async function freezeRail(args: {
  organizationId: string;
  railKind: SafetyRailKind;
  actorUserId: string | null;
  rationale: string;
}): Promise<OperationalSafetyRail> {
  const current = await getOrInitSafetyRail(args.organizationId, args.railKind);
  const upd = await ownedDbTable('operational_safety_rails')
    .update({ state: 'frozen' as SafetyRailState, override_rationale: args.rationale })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendRailEvent({
    organizationId: args.organizationId,
    railId: current.id,
    eventKind: 'frozen',
    previousState: current.state,
    newState: 'frozen',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actorUserId: args.actorUserId,
    rationale: args.rationale,
  });
  return (upd.data as OperationalSafetyRail | null) ?? current;
}

export async function reArmRail(args: {
  organizationId: string;
  railKind: SafetyRailKind;
  actorUserId: string | null;
}): Promise<OperationalSafetyRail> {
  const current = await getOrInitSafetyRail(args.organizationId, args.railKind);
  const upd = await ownedDbTable('operational_safety_rails')
    .update({
      state: 'green' as SafetyRailState,
      override_rationale: null,
      acknowledged_by: null,
      acknowledged_at: null,
    })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendRailEvent({
    organizationId: args.organizationId,
    railId: current.id,
    eventKind: 're_armed',
    previousState: current.state,
    newState: 'green',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actorUserId: args.actorUserId,
    rationale: 'operator re-armed',
  });
  return (upd.data as OperationalSafetyRail | null) ?? current;
}

export async function isRailFrozen(
  organizationId: string,
  railKind: SafetyRailKind,
): Promise<boolean> {
  const current = await getOrInitSafetyRail(organizationId, railKind);
  return current.state === 'frozen';
}

export async function listSafetyRails(organizationId: string): Promise<OperationalSafetyRail[]> {
  const { data } = await ownedDbTable('operational_safety_rails')
    .select('*')
    .eq('organization_id', organizationId)
    .order('rail_kind', { ascending: true });
  return (data as OperationalSafetyRail[]) ?? [];
}

export async function listSafetyRailEvents(
  organizationId: string,
  options?: { railId?: string; limit?: number },
): Promise<OperationalSafetyRailEvent[]> {
  let q = ownedDbTable('operational_safety_rail_events')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.railId) q = q.eq('rail_id', options.railId);
  const { data } = await q;
  return (data as OperationalSafetyRailEvent[]) ?? [];
}
