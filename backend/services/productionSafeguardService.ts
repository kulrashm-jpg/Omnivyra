/**
 * Phase 10 — Production runtime safeguards.
 *
 * Six per-org safeguards: execution_circuit_breaker, connector_degradation,
 * queue_congestion, semantic_overload, replay_overload, operational_freeze.
 *
 * Each safeguard has a deterministic threshold and tracks an observed
 * value reported by operators (or by Phase 9 observability calls). State
 * transitions:
 *
 *   armed       — normal
 *   tripped     — observed_value >= threshold; the runtime layer should
 *                 respect this by refusing new mutations on the relevant
 *                 surface (caller-enforced; this service does NOT block
 *                 calls itself).
 *   recovering  — observed_value has dropped below threshold but the
 *                 operator has not yet re-armed.
 *   overridden  — operator explicitly overrode the trip.
 *   disabled    — safeguard turned off (operator override; metadata).
 *
 * Every state change writes an append-only trigger row.
 *
 * Hard guarantees:
 *   • Deterministic thresholds — integer/decimal comparison only.
 *   • No autonomous system-wide shutdown — `tripped` is advisory; callers
 *     check via `isSafeguardTripped()` and choose how to respond.
 *   • Operator override is explicit + audited.
 *   • Replay-safe freeze: `operational_freeze` simply persists the state;
 *     replay paths consult it on resume.
 *   • Tenant-first reads; safeguard rows are 1:1 with (org, kind).
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  SAFEGUARD_DEFAULT_THRESHOLDS,
  type ProductionSafeguardState,
  type ProductionSafeguardTrigger,
  type SafeguardKind,
  type SafeguardState,
  type SafeguardTriggerKind,
} from '../types/productionSafeguard';
import { publishRealtime } from './realtimePublisherService';
import { publishSafeguardRecovered, publishSafeguardTriggered } from '../events/listeningEvents';

export async function getOrInitSafeguard(
  organizationId: string,
  safeguardKind: SafeguardKind,
): Promise<ProductionSafeguardState> {
  const { data } = await ownedDbTable('production_safeguard_states')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('safeguard_kind', safeguardKind)
    .maybeSingle();
  if (data) return data as ProductionSafeguardState;
  const ins = await ownedDbTable('production_safeguard_states')
    .insert({
      organization_id: organizationId,
      safeguard_kind: safeguardKind,
      state: 'armed' as SafeguardState,
      threshold_value: SAFEGUARD_DEFAULT_THRESHOLDS[safeguardKind],
      observed_value: 0,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    if ((ins.error as { code?: string }).code === '23505') {
      const reread = await ownedDbTable('production_safeguard_states')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('safeguard_kind', safeguardKind)
        .single();
      return reread.data as ProductionSafeguardState;
    }
    throw new Error(`safeguard_init_failed:${ins.error?.message ?? 'unknown'}`);
  }
  return ins.data as ProductionSafeguardState;
}

async function appendTrigger(args: {
  organizationId: string;
  safeguardStateId: string;
  triggerKind: SafeguardTriggerKind;
  observedValue: number;
  thresholdValue: number;
  actedBy: string | null;
  rationale: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ProductionSafeguardTrigger | null> {
  const { data } = await ownedDbTable('production_safeguard_triggers')
    .insert({
      organization_id: args.organizationId,
      safeguard_state_id: args.safeguardStateId,
      trigger_kind: args.triggerKind,
      observed_value: args.observedValue,
      threshold_value: args.thresholdValue,
      acted_by: args.actedBy,
      rationale: args.rationale,
      metadata: args.metadata ?? {},
    })
    .select('*')
    .single();
  return (data as ProductionSafeguardTrigger | null) ?? null;
}

export type ReportObservationInput = {
  organizationId: string;
  safeguardKind: SafeguardKind;
  observedValue: number;
  actedBy: string | null;
};

/**
 * Report an observation for a safeguard. Trips the safeguard if observed
 * value >= threshold and currently `armed`. Auto-flips to `recovering`
 * when value drops back below threshold and currently `tripped`. Does
 * NOT auto-re-arm — operator must call `reArmSafeguard()`.
 */
export async function reportSafeguardObservation(
  input: ReportObservationInput,
): Promise<ProductionSafeguardState> {
  const current = await getOrInitSafeguard(input.organizationId, input.safeguardKind);
  const overThreshold = input.observedValue >= current.threshold_value;

  let nextState: SafeguardState = current.state;
  let triggerKind: SafeguardTriggerKind | null = null;
  const patch: Record<string, unknown> = { observed_value: input.observedValue };

  if (current.state === 'armed' && overThreshold) {
    nextState = 'tripped';
    patch.state = 'tripped';
    patch.triggered_at = new Date().toISOString();
    patch.recovered_at = null;
    triggerKind = 'tripped';
  } else if (current.state === 'tripped' && !overThreshold) {
    nextState = 'recovering';
    patch.state = 'recovering';
    patch.recovered_at = new Date().toISOString();
    triggerKind = 'recovered';
  }

  const upd = await ownedDbTable('production_safeguard_states')
    .update(patch)
    .eq('id', current.id)
    .select('*')
    .single();
  const final = (upd.data as ProductionSafeguardState | null) ?? current;

  if (triggerKind) {
    await appendTrigger({
      organizationId: input.organizationId,
      safeguardStateId: final.id,
      triggerKind,
      observedValue: input.observedValue,
      thresholdValue: final.threshold_value,
      actedBy: input.actedBy,
      rationale: triggerKind === 'tripped'
        ? `observed ${input.observedValue} >= threshold ${final.threshold_value}`
        : `observed ${input.observedValue} dropped below threshold ${final.threshold_value}`,
    });
    try {
      if (triggerKind === 'tripped') {
        await publishSafeguardTriggered({
          organizationId: input.organizationId,
          safeguardKind: input.safeguardKind,
          observedValue: input.observedValue,
          thresholdValue: final.threshold_value,
          actedBy: input.actedBy,
        });
      } else {
        await publishSafeguardRecovered({
          organizationId: input.organizationId,
          safeguardKind: input.safeguardKind,
          actedBy: input.actedBy,
        });
      }
      void publishRealtime({
        organizationId: input.organizationId,
        topic: 'production_safeguards',
        eventName: `safeguard.${triggerKind === 'tripped' ? 'triggered' : 'recovered'}`,
        payload: { safeguard_kind: input.safeguardKind, observed_value: input.observedValue, threshold_value: final.threshold_value, state: nextState },
      });
    } catch { /* best effort */ }
  }

  return final;
}

export async function overrideSafeguard(args: {
  organizationId: string;
  safeguardKind: SafeguardKind;
  actorUserId: string | null;
  rationale: string;
}): Promise<ProductionSafeguardState> {
  const current = await getOrInitSafeguard(args.organizationId, args.safeguardKind);
  const upd = await ownedDbTable('production_safeguard_states')
    .update({
      state: 'overridden' as SafeguardState,
      last_override_by: args.actorUserId,
      last_override_at: new Date().toISOString(),
      rationale: args.rationale,
    })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendTrigger({
    organizationId: args.organizationId,
    safeguardStateId: current.id,
    triggerKind: 'overridden',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actedBy: args.actorUserId,
    rationale: args.rationale,
  });
  return (upd.data as ProductionSafeguardState | null) ?? current;
}

export async function reArmSafeguard(args: {
  organizationId: string;
  safeguardKind: SafeguardKind;
  actorUserId: string | null;
}): Promise<ProductionSafeguardState> {
  const current = await getOrInitSafeguard(args.organizationId, args.safeguardKind);
  const upd = await ownedDbTable('production_safeguard_states')
    .update({
      state: 'armed' as SafeguardState,
      triggered_at: null,
      recovered_at: null,
      rationale: null,
    })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendTrigger({
    organizationId: args.organizationId,
    safeguardStateId: current.id,
    triggerKind: 're_armed',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actedBy: args.actorUserId,
    rationale: 'operator re-armed safeguard',
  });
  return (upd.data as ProductionSafeguardState | null) ?? current;
}

export async function setSafeguardThreshold(args: {
  organizationId: string;
  safeguardKind: SafeguardKind;
  newThreshold: number;
  actorUserId: string | null;
}): Promise<ProductionSafeguardState> {
  const current = await getOrInitSafeguard(args.organizationId, args.safeguardKind);
  const upd = await ownedDbTable('production_safeguard_states')
    .update({ threshold_value: args.newThreshold, last_override_by: args.actorUserId, last_override_at: new Date().toISOString() })
    .eq('id', current.id)
    .select('*')
    .single();
  return (upd.data as ProductionSafeguardState | null) ?? current;
}

export async function disableSafeguard(args: {
  organizationId: string;
  safeguardKind: SafeguardKind;
  actorUserId: string | null;
  rationale: string;
}): Promise<ProductionSafeguardState> {
  const current = await getOrInitSafeguard(args.organizationId, args.safeguardKind);
  const upd = await ownedDbTable('production_safeguard_states')
    .update({
      state: 'disabled' as SafeguardState,
      rationale: args.rationale,
      last_override_by: args.actorUserId,
      last_override_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .select('*')
    .single();
  await appendTrigger({
    organizationId: args.organizationId,
    safeguardStateId: current.id,
    triggerKind: 'disabled',
    observedValue: current.observed_value,
    thresholdValue: current.threshold_value,
    actedBy: args.actorUserId,
    rationale: args.rationale,
  });
  return (upd.data as ProductionSafeguardState | null) ?? current;
}

export async function isSafeguardTripped(
  organizationId: string,
  safeguardKind: SafeguardKind,
): Promise<boolean> {
  const current = await getOrInitSafeguard(organizationId, safeguardKind);
  return current.state === 'tripped';
}

export async function listSafeguardStates(organizationId: string): Promise<ProductionSafeguardState[]> {
  const { data } = await ownedDbTable('production_safeguard_states')
    .select('*')
    .eq('organization_id', organizationId)
    .order('safeguard_kind', { ascending: true });
  return (data as ProductionSafeguardState[]) ?? [];
}

export async function listSafeguardTriggers(
  organizationId: string,
  options?: { safeguardStateId?: string; limit?: number },
): Promise<ProductionSafeguardTrigger[]> {
  let q = ownedDbTable('production_safeguard_triggers')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.safeguardStateId) q = q.eq('safeguard_state_id', options.safeguardStateId);
  const { data } = await q;
  return (data as ProductionSafeguardTrigger[]) ?? [];
}
