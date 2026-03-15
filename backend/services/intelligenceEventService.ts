/**
 * Intelligence Event Service
 * Emits events to intelligence_events for timeline visualization.
 * Event types: trend_detected, insight_generated, opportunity_detected, campaign_launched, engagement_spike
 * Uses event_hash for idempotency: sha256(JSON.stringify(canonical_payload))
 * Canonical payload: { company_id, event_type, normalized_event_data } with volatile fields stripped.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

const VOLATILE_KEYS = new Set([
  'timestamp',
  'generated_at',
  'created_at',
  'report_id',
  'id',
  'uuid',
  'run_id',
  'execution_id',
  'request_id',
  'trace_id',
  'job_id',
  'session_id',
]);

function normalizeEventData(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(normalizeEventData);
  }
  const input = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const sortedKeys = Object.keys(input).sort();
  for (const k of sortedKeys) {
    if (VOLATILE_KEYS.has(k.toLowerCase())) continue;
    const v = input[k];
    if (v === undefined) continue;
    out[k] = normalizeEventData(v);
  }
  return out;
}

function stableStringify(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

function computeEventHash(
  company_id: string,
  event_type: string,
  event_data: Record<string, unknown>
): string {
  const normalized = normalizeEventData(event_data) as Record<string, unknown>;
  const canonicalPayload = {
    company_id,
    event_type,
    normalized_event_data: normalized,
  };
  const payloadStr = stableStringify(canonicalPayload);
  return createHash('sha256').update(payloadStr, 'utf8').digest('hex');
}

export type IntelligenceEventType =
  | 'trend_detected'
  | 'insight_generated'
  | 'opportunity_detected'
  | 'campaign_launched'
  | 'engagement_spike';

/**
 * Insert an intelligence event into intelligence_events.
 */
export async function emitIntelligenceEvent(
  company_id: string,
  event_type: IntelligenceEventType | string,
  event_data: Record<string, unknown> = {}
): Promise<EmitResult> {
  const companyId = String(company_id ?? '').trim();
  const eventType = String(event_type ?? '').trim();

  if (!companyId || !eventType) {
    return null;
  }

  const dataObj = event_data && typeof event_data === 'object' ? event_data : {};
  const eventHash = computeEventHash(companyId, eventType, dataObj);

  const { data, error } = await supabase
    .from('intelligence_events')
    .insert({
      company_id: companyId,
      event_type: eventType,
      event_data: dataObj,
      event_hash: eventHash,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { duplicate: true };
    }
    console.warn('[intelligenceEventService] insert failed:', error.message);
    return null;
  }

  return data ? { id: data.id } : null;
}

export type EmitResult = { id: string } | { duplicate: true } | null;
