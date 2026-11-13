/**
 * Operational alerts to the platform owner (e1 2026-11-13; owner ruling, binding points from 05 / e9).
 *
 * The signup rate limiter depends on Redis/Upstash. When it is unreachable or over quota, /api/auth/signup and
 * /api/onboarding/revalidate-signup FAIL CLOSED (503 + Retry-After + no-store; their limit configs pin
 * onRedisFailure:'closed' - login and every other limit keep their own degraded mode). The owner is emailed:
 *
 *   - DIRECTLY through the transactional mailer (supabase.functions.invoke('send-transactional-email')) - NOT an
 *     email_jobs enqueue, so the "Redis is down" alert never waits on a queue / cron that may itself need Redis;
 *     with a hard SEND_TIMEOUT_MS, and fire-and-forget at the call site (the 503 never waits for it).
 *   - DEDUPED CROSS-INSTANCE WITHOUT REDIS: a marker row in public.ops_alert_markers keyed (alert_kind, 30-minute
 *     bucket) - the outage has no id, so a time bucket is the honest key. First insert wins (PK); 23505 = already
 *     sent this window. Plus a HARD CAP of MAX_ALERTS_PER_HOUR per kind, so a flapping Redis cannot mail-bomb the
 *     mailbox. If the marker table itself cannot be reached, an in-process marker limits it to one per instance per
 *     window (fail toward fewer emails, never zero).
 *   - Counter on every occurrence (auth.signup.limiter_unavailable); the email carries only the time and reason -
 *     never user data.
 * Recipient: env OPS_ALERT_EMAIL (one named config value), default kuldeep@omnivyra.com.
 */
import { supabase } from '../db/supabaseClient';
import { sendOpsAlert } from './emailService';
import { incrementAuthMetric } from './authMetrics';
import { logger } from './logger';

export const OPS_ALERT_DEFAULT_RECIPIENT = 'kuldeep@omnivyra.com';
export const SIGNUP_LIMITER_ALERT_KIND = 'signup_limiter_unavailable';
/** One alert per this window (cross-instance). */
export const SIGNUP_LIMITER_ALERT_WINDOW_MS = 30 * 60 * 1000;
/** Hard cap per kind per rolling hour (cross-instance). */
export const MAX_ALERTS_PER_HOUR = 2;
export const SEND_TIMEOUT_MS = 5000;

/**
 * The ONE user-facing response for "signup temporarily unavailable" (shown to prospects during a limiter outage).
 * Owner-visible copy - change it here only.
 */
export const SIGNUP_BUSY_MESSAGE = 'Our servers are busy right now - please try again in a few minutes.';
export const SIGNUP_BUSY_BODY = { error: SIGNUP_BUSY_MESSAGE, code: 'SIGNUP_TEMPORARILY_UNAVAILABLE' } as const;
export const SIGNUP_BUSY_RETRY_AFTER_SECS = 120;

/** Write the fail-closed 503 (Retry-After + no-store so no cache keeps refusing after recovery). */
export function sendSignupBusy(res: { setHeader: (k: string, v: string) => unknown; status: (c: number) => { json: (b: unknown) => unknown } }): void {
  res.setHeader('Retry-After', String(SIGNUP_BUSY_RETRY_AFTER_SECS));
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json(SIGNUP_BUSY_BODY);
}

export function opsAlertRecipient(): string {
  const configured = String(process.env.OPS_ALERT_EMAIL ?? '').trim();
  return configured || OPS_ALERT_DEFAULT_RECIPIENT;
}

let localFallbackBucket: string | null = null;
/** Test seam only. */
export function __resetOpsAlertStateForTest(): void {
  localFallbackBucket = null;
}

/** Claim the right to send for this bucket. 'claimed' | 'already' | 'capped' | 'db_unavailable'. */
async function claimBucket(kind: string, bucket: string, nowMs: number): Promise<'claimed' | 'already' | 'capped' | 'db_unavailable'> {
  const since = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const recent = await supabase.from('ops_alert_markers').select('bucket').eq('alert_kind', kind).gt('sent_at', since);
  if (recent.error) return 'db_unavailable';
  if ((recent.data ?? []).length >= MAX_ALERTS_PER_HOUR) return 'capped';
  const ins = await supabase.from('ops_alert_markers').insert({ alert_kind: kind, bucket, sent_at: new Date(nowMs).toISOString() });
  if (!ins.error) return 'claimed';
  return (ins.error as { code?: string }).code === '23505' ? 'already' : 'db_unavailable';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ops_alert_send_timeout_${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Count (always) and notify the owner (at most once per window, cross-instance) that the signup rate limiter is
 * unavailable. Never throws. `endpoint` / `reason` are operator strings - never pass user data.
 */
type NotifyDeps = { now?: () => number; send?: typeof sendOpsAlert };
type NotifyResult = 'sent' | 'suppressed' | 'failed';

function recordOccurrence(endpoint: string, reason: string): void {
  incrementAuthMetric('auth.signup.limiter_unavailable', { endpoint });
  logger.error('auth.signup_limiter_unavailable', { endpoint, reason });
}

/** Send the alert email (time + reason only), with the hard timeout. Never throws. Performs NO database write. */
async function deliverSignupLimiterAlert(endpoint: string, reason: string, nowMs: number, bucket: string, deps: NotifyDeps): Promise<NotifyResult> {
  const at = new Date(nowMs).toISOString();
  try {
    await withTimeout((deps.send ?? sendOpsAlert)(
      opsAlertRecipient(),
      'Signup paused: rate limiter unavailable',
      `At ${at} the signup rate limiter (Redis/Upstash) was unavailable or over quota, so new signups are being refused ` +
      `with a retryable "servers are busy" message until it recovers.\n\nEndpoint: ${endpoint}\nReason: ${reason}\n\n` +
      `Login and existing users are unaffected. You get at most one of these per ${SIGNUP_LIMITER_ALERT_WINDOW_MS / 60000} ` +
      `minutes and at most ${MAX_ALERTS_PER_HOUR} per hour.`,
      `ops-alert:${SIGNUP_LIMITER_ALERT_KIND}:${bucket}`,
    ), SEND_TIMEOUT_MS);
    return 'sent';
  } catch (err) {
    logger.warn('ops_alert_send_failed', { kind: SIGNUP_LIMITER_ALERT_KIND, message: err instanceof Error ? err.message : String(err) });
    return 'failed';
  }
}

/** In-process window: one email per instance per bucket. Used when the DB marker is unreachable or not allowed. */
function claimLocalWindow(bucket: string): boolean {
  if (localFallbackBucket === bucket) return false;
  localFallbackBucket = bucket;
  return true;
}

/**
 * Count (always) and notify the owner (at most once per window CROSS-INSTANCE via the DB marker; hourly cap) that the
 * signup rate limiter is unavailable. Never throws. `endpoint` / `reason` are operator strings - never user data.
 * For AUTHENTICATED or public-signup call sites; pre-authentication callers use notifySignupLimiterUnavailablePreAuth.
 */
export async function notifySignupLimiterUnavailable(endpoint: string, reason: string, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const nowMs = (deps.now ?? Date.now)();
  recordOccurrence(endpoint, reason);
  const bucket = String(Math.floor(nowMs / SIGNUP_LIMITER_ALERT_WINDOW_MS));
  let claim: Awaited<ReturnType<typeof claimBucket>>;
  try {
    claim = await claimBucket(SIGNUP_LIMITER_ALERT_KIND, bucket, nowMs);
  } catch {
    claim = 'db_unavailable';
  }
  if (claim === 'already' || claim === 'capped') return 'suppressed';
  if (claim === 'db_unavailable' && !claimLocalWindow(bucket)) return 'suppressed';
  return deliverSignupLimiterAlert(endpoint, reason, nowMs, bucket, deps);
}

/**
 * PRE-AUTHENTICATION variant (05 review): route-auth forbids any write before authentication, so this path NEVER
 * touches the DB marker - it uses the in-process window (one email per instance per window) instead of going silent.
 * The log line + counter always fire, so the event is reconstructable even when the email is suppressed.
 */
export async function notifySignupLimiterUnavailablePreAuth(endpoint: string, reason: string, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const nowMs = (deps.now ?? Date.now)();
  recordOccurrence(endpoint, reason);
  const bucket = String(Math.floor(nowMs / SIGNUP_LIMITER_ALERT_WINDOW_MS));
  if (!claimLocalWindow(bucket)) return 'suppressed';
  return deliverSignupLimiterAlert(endpoint, reason, nowMs, bucket, deps);
}
