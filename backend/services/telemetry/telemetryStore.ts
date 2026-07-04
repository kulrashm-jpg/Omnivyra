/**
 * Canonical Telemetry — Append-Only Event Store
 * ---------------------------------------------
 * The ONE canonical event model. INSERT-only: an append-only ledger of business
 * actions. Never overwritten, never mutated, no derived scores stored — raw
 * events only. Aggregation is computed on read.
 *
 * FAIL-SOFT: if `telemetry_events` is not yet provisioned (migration not
 * applied), reads return [] and writes no-op — instrumentation never affects
 * existing behavior until the table is activated.
 *
 * Idempotency: a business action supplies a deterministic `dedup_key`; a unique
 * index on (organization_id, event_type, dedup_key) makes re-emits a no-op
 * (insert … on conflict do nothing).
 */

import { supabase } from '../../db/supabaseClient';
import type { TelemetryEventRecord, TelemetryEventType } from '../../../lib/telemetry/telemetryTypes';

export const TELEMETRY_EVENTS_TABLE = 'telemetry_events' as const;

const isMissingTable = (err: { code?: string; message?: string } | null): boolean =>
  err?.code === '42P01' || Boolean(err?.message && /relation .* does not exist/i.test(err.message));

export interface RecordResult {
  recorded: boolean;
  reason?: 'table_missing' | 'error';
}

/** Append one event. Insert-only, on-conflict-do-nothing dedup. Never throws. */
export async function insertTelemetryEvent(record: TelemetryEventRecord): Promise<RecordResult> {
  try {
    const { error } = await supabase
      .from(TELEMETRY_EVENTS_TABLE)
      .upsert(record, { onConflict: 'organization_id,event_type,dedup_key', ignoreDuplicates: true });
    if (error) {
      if (isMissingTable(error)) return { recorded: false, reason: 'table_missing' };
      return { recorded: false, reason: 'error' };
    }
    return { recorded: true };
  } catch {
    return { recorded: false, reason: 'error' };
  }
}

export interface QueryTelemetryInput {
  organizationId: string;
  types?: TelemetryEventType[];
  /** ISO lower bound on occurred_at (inclusive). null = lifetime. */
  since?: string | null;
  limit?: number;
}

/**
 * Read events for aggregation. Fail-soft: returns [] on missing table / error.
 * Ordered by occurred_at ascending for deterministic cadence bucketing.
 */
export async function queryTelemetryEvents(input: QueryTelemetryInput): Promise<TelemetryEventRecord[]> {
  try {
    let q = supabase
      .from(TELEMETRY_EVENTS_TABLE)
      .select('event_type, category, entity_type, entity_id, actor_id, organization_id, metadata, dedup_key, occurred_at')
      .eq('organization_id', input.organizationId)
      .order('occurred_at', { ascending: true })
      .limit(input.limit ?? 5000);
    if (input.types && input.types.length > 0) q = q.in('event_type', input.types);
    if (input.since) q = q.gte('occurred_at', input.since);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as TelemetryEventRecord[];
  } catch {
    return [];
  }
}
