/**
 * Safe structured observability — single emit point for pipeline events.
 *
 * Goals (Round-2 item 7):
 *  - searchable: every line is `[evt] {json}` with a stable `event` key
 *  - production-safe: no secrets, bounded payload
 *  - not noisy: per-(event+dedupeKey) throttle so a hot loop can't spam
 *
 * Intentionally tiny + dependency-free (console only). Does NOT replace
 * existing logging; it's an additive, consistent channel for the new
 * degraded / queue-health / publish-validation signals.
 */

type Level = 'info' | 'warn' | 'error';

export type PipelineEvent =
  | 'scheduling.degraded'
  | 'scheduling.zero_scheduled'
  | 'scheduling.queue_path'
  | 'queue.health'
  | 'queue.stale_sweep'
  | 'publish.validation'
  | 'publish.rejected'
  | 'publish.scheduled_validation'
  | 'lifecycle.canonical_resolved'
  | 'creator.routing_enforced'
  | 'media.refresh'
  | 'media.dead_link'
  | 'orphan.recovery'
  | 'reconciliation.summary'
  | 'migration.readiness'
  | 'publish.health'
  | 'ai_asset.created'
  | 'ai_asset.replaced'
  | 'ai_asset.removed'
  | 'ai_asset.restored'
  | 'ai_asset.override'
  | 'ai_asset.provenance'
  | 'creator.routing_deactivated'
  | 'creator.runtime_shadow'
  | 'writer.attachment_rejected'
  | 'writer.attachment_mode_coerced'
  | 'embedded_copy_ocr_relaxed'
  | 'embedded_copy_synthetic_reading_order'
  | 'schedule.char_limit_overflow'
  | 'reconciliation.success'
  | 'reconciliation.failure';

const _lastEmit = new Map<string, number>();
// Default 60s throttle window per (event|dedupeKey). Override per call.
const DEFAULT_THROTTLE_MS = 60_000;

function safeFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    // Drop obvious secret-ish keys defensively.
    if (/token|secret|password|authorization|api[_-]?key/i.test(k)) continue;
    if (v === undefined) continue;
    if (typeof v === 'string' && v.length > 500) { out[k] = v.slice(0, 500) + '…'; continue; }
    out[k] = v;
  }
  return out;
}

export function logPipelineEvent(
  event: PipelineEvent,
  level: Level,
  fields?: Record<string, unknown>,
  opts?: { dedupeKey?: string; throttleMs?: number },
): void {
  const dedupeKey = opts?.dedupeKey ?? '';
  const throttleMs = opts?.throttleMs ?? DEFAULT_THROTTLE_MS;
  if (throttleMs > 0) {
    const k = `${event}|${dedupeKey}`;
    const now = Date.now();
    const last = _lastEmit.get(k) ?? 0;
    if (now - last < throttleMs) return;
    _lastEmit.set(k, now);
    // bound the map
    if (_lastEmit.size > 500) {
      for (const key of Array.from(_lastEmit.keys())) {
        _lastEmit.delete(key);
        if (_lastEmit.size <= 400) break;
      }
    }
  }
  const line = JSON.stringify({
    evt: event,
    ts: new Date().toISOString(),
    ...safeFields(fields),
  });
  if (level === 'error') console.error(`[pipeline] ${line}`);
  else if (level === 'warn') console.warn(`[pipeline] ${line}`);
  else console.info(`[pipeline] ${line}`);
}
