/**
 * Lightweight in-process anomaly detector.
 *
 * Counts security events in a 1-minute rolling window and emits a structured
 * WARN log when a threshold is crossed. Intentionally minimal — no Redis
 * dependency, no external calls. Runs per-process; in a multi-instance
 * deployment each instance alerts independently, which is acceptable since
 * alerts are additive (more signal, not false negatives).
 */

interface Bucket {
  count:       number;
  windowStart: number;
  alerted:     boolean;  // suppress duplicate alerts within the same window
}

const counters = new Map<string, Bucket>();
const WINDOW_MS = 60_000; // 1 minute rolling window

/** Events and the per-minute count that triggers an alert. */
const THRESHOLDS: Record<string, number> = {
  ghost_session_detected:   5,
  account_deleted_response: 10,
  rate_limit_triggered:     20,
  domain_validation_failed: 5,
  unauthorized_access:      3,
};

/**
 * Record a security event. If the count for this event exceeds its threshold
 * within the current 1-minute window, emits a single structured WARN log.
 */
export function recordAnomalyEvent(event: string): void {
  const now = Date.now();
  let bucket = counters.get(event);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now, alerted: false };
    counters.set(event, bucket);
  }

  bucket.count++;

  const threshold = THRESHOLDS[event];
  if (threshold && bucket.count >= threshold && !bucket.alerted) {
    bucket.alerted = true;
    console.warn(JSON.stringify({
      level:    'WARN',
      event:    'anomaly_detected',
      anomaly:  event,
      count:    bucket.count,
      windowMs: WINDOW_MS,
      ts:       new Date().toISOString(),
    }));
  }
}
