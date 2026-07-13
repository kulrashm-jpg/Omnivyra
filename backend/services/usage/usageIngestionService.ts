/**
 * usageIngestionService.ts — the ONE canonical usage ingestion authority
 * (CSA-001 §2). Every customer product-usage event is written HERE and nowhere
 * else. It normalizes/validates against the canonical model, de-duplicates
 * (§6), persists to the time-series sink (§3), and emits observability (§7).
 *
 * Trust boundary: the caller supplies the authenticated companyId + userId. The
 * client-supplied companyId is NEVER trusted — it is overwritten with the
 * authenticated tenant, so an event can only ever be attributed to the caller's
 * own company (privacy/tenant safety, §5).
 *
 * Fail-safe: ingestion NEVER throws to its caller. On any error (including the
 * table not existing pre-migration) it returns an `ok:false` summary and emits
 * a failure metric, so producers/endpoints never break.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import {
  normalizeUsageEvent,
  type UsageEvent,
  type NormalizedUsageEvent,
} from '../../../lib/usage/usageEvent';

export interface IngestContext {
  /** Authenticated tenant — overrides any client-supplied companyId. */
  companyId: string;
  /** Authenticated actor — used when an event omits userId. */
  userId?: string | null;
  now?: string;
  supabase?: SupabaseClient;
}

export interface IngestResult {
  ok: boolean;
  received: number;
  persisted: number;
  /** Rejected duplicates (in-batch + already-stored). */
  duplicates: number;
  /** Rejected invalid events (bad type / missing company). */
  rejected: number;
  reasons: Record<string, number>;
}

const TABLE = 'customer_usage_events';

function toRow(e: NormalizedUsageEvent) {
  return {
    company_id: e.companyId,
    user_id: e.userId,
    event_type: e.eventType,
    feature: e.feature,
    capability: e.capability,
    event_id: e.eventId,
    occurred_at: e.occurredAt,
    metadata: e.metadata,
    event_day: e.occurredAt.slice(0, 10), // UTC day from ISO timestamp
  };
}

/**
 * Ingest a batch of usage events idempotently. Returns a deterministic summary;
 * never throws. Emits: usage.events.received / .persisted / .duplicates /
 * .rejected and usage.ingest.duration_ms / usage.ingest.failures.
 */
export async function ingestUsageEvents(
  rawEvents: UsageEvent[],
  ctx: IngestContext,
): Promise<IngestResult> {
  const started = Date.now();
  const now = ctx.now ?? new Date().toISOString();
  const received = Array.isArray(rawEvents) ? rawEvents.length : 0;
  const reasons: Record<string, number> = {};
  const result: IngestResult = { ok: false, received, persisted: 0, duplicates: 0, rejected: 0, reasons };

  recordRawCounter('usage.events.received', received);
  if (received === 0) {
    result.ok = true;
    recordRawHistogram('usage.ingest.duration_ms', Date.now() - started);
    return result;
  }

  // Normalize + validate. Force the authenticated tenant/actor (never trust the
  // client's companyId; default userId to the authenticated actor).
  const normalized: NormalizedUsageEvent[] = [];
  for (const raw of rawEvents) {
    const res = normalizeUsageEvent(
      { ...raw, companyId: ctx.companyId, userId: raw.userId ?? ctx.userId ?? null },
      now,
    );
    if (!res.ok || !res.event) {
      result.rejected++;
      reasons[res.reason ?? 'invalid'] = (reasons[res.reason ?? 'invalid'] ?? 0) + 1;
      continue;
    }
    normalized.push(res.event);
  }

  // In-batch dedup by (companyId, eventId) — the same anchor the DB enforces.
  const seen = new Set<string>();
  const unique: NormalizedUsageEvent[] = [];
  for (const e of normalized) {
    const key = `${e.companyId}|${e.eventId}`;
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);
    unique.push(e);
  }

  if (result.rejected > 0) recordRawCounter('usage.events.rejected', result.rejected);

  if (unique.length === 0) {
    result.ok = true;
    if (result.duplicates > 0) recordRawCounter('usage.events.duplicates', result.duplicates);
    recordRawHistogram('usage.ingest.duration_ms', Date.now() - started);
    return result;
  }

  try {
    const supabase = ctx.supabase ?? (await import('../../db/supabaseClient')).supabase;
    // ON CONFLICT (company_id, event_id) DO NOTHING → only new rows return.
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(unique.map(toRow), { onConflict: 'company_id,event_id', ignoreDuplicates: true })
      .select('event_id');

    if (error) {
      recordRawCounter('usage.ingest.failures', 1);
      recordRawHistogram('usage.ingest.duration_ms', Date.now() - started);
      reasons['write_failed'] = (reasons['write_failed'] ?? 0) + unique.length;
      return result; // ok:false
    }

    const persisted = Array.isArray(data) ? data.length : 0;
    result.persisted = persisted;
    // Anything unique-in-batch that wasn't inserted was an already-stored dup.
    result.duplicates += unique.length - persisted;
    result.ok = true;

    recordRawCounter('usage.events.persisted', persisted);
    if (result.duplicates > 0) recordRawCounter('usage.events.duplicates', result.duplicates);
    recordRawHistogram('usage.ingest.duration_ms', Date.now() - started);
    return result;
  } catch {
    recordRawCounter('usage.ingest.failures', 1);
    recordRawHistogram('usage.ingest.duration_ms', Date.now() - started);
    reasons['exception'] = (reasons['exception'] ?? 0) + unique.length;
    return result; // ok:false, never throws
  }
}

/**
 * Convenience single-event emitter for backend producers (fire-and-forget
 * friendly). Reuses the same authority — no second write path.
 */
export async function recordUsageEvent(event: UsageEvent, ctx: IngestContext): Promise<IngestResult> {
  return ingestUsageEvents([event], ctx);
}
