/**
 * Canonical Telemetry — Dispatcher (the single write path)
 * -------------------------------------------------------
 * The ONLY way business-action sites record telemetry. No feature module writes
 * to the store directly. Given a canonical event type + context, it resolves
 * category/entity from the registry, computes a deterministic dedup key (one
 * business action can never emit duplicates), and appends via the store.
 *
 * SAFE BY CONSTRUCTION: never throws. If telemetry is unavailable (table not
 * provisioned) the emit is a silent no-op. Records BUSINESS actions only.
 */

import { TELEMETRY_EVENTS, isTelemetryEventType } from '../../../lib/telemetry/telemetryRegistry';
import type { TelemetryEventType, TelemetryEventRecord } from '../../../lib/telemetry/telemetryTypes';
import { insertTelemetryEvent, type RecordResult } from './telemetryStore';

export interface DispatchTelemetryInput {
  type: TelemetryEventType;
  organizationId: string;
  actorId?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Business-action time; defaults to now. */
  occurredAt?: string;
  /**
   * Explicit idempotency key. When omitted, derived from (type + entityId); if
   * there is no entityId, the event is non-deduplicated (dedup_key null).
   */
  dedupKey?: string | null;
}

function resolveDedupKey(input: DispatchTelemetryInput): string | null {
  if (input.dedupKey !== undefined) return input.dedupKey;
  if (input.entityId) return `${input.type}:${input.entityId}`;
  return null;
}

/** Dispatch a canonical telemetry event. Returns the store result; never rejects. */
export async function dispatchTelemetry(input: DispatchTelemetryInput): Promise<RecordResult> {
  try {
    if (!input.organizationId || !isTelemetryEventType(input.type)) {
      return { recorded: false, reason: 'error' };
    }
    const def = TELEMETRY_EVENTS[input.type];
    const record: TelemetryEventRecord = {
      event_type: input.type,
      category: def.category,
      entity_type: def.entity,
      entity_id: input.entityId ?? null,
      actor_id: input.actorId ?? null,
      organization_id: input.organizationId,
      metadata: input.metadata ?? {},
      dedup_key: resolveDedupKey(input),
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    };
    return await insertTelemetryEvent(record);
  } catch {
    return { recorded: false, reason: 'error' };
  }
}

/**
 * Fire-and-forget helper for instrumentation inside business-action handlers.
 * Swallows everything so it can be dropped in after a successful DB write.
 */
export function trackEvent(input: DispatchTelemetryInput): void {
  void dispatchTelemetry(input).catch(() => undefined);
}
