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

/** Test seam only. */
export function __resetOpsAlertStateForTest(): void {
  localFallbackBuckets.clear();
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

type NotifyDeps = { now?: () => number; send?: typeof sendOpsAlert };
type NotifyResult = 'sent' | 'suppressed' | 'failed';

/**
 * A generic operational alert (reusable by any track - e.g. 55's 'billing_invalid_event_stamp'). All operator-facing
 * strings; NEVER user data. Dedupe is per (alertKind, 30-minute bucket) cross-instance via ops_alert_markers (PK is
 * already (alert_kind, bucket) - a new kind needs no schema change), hard cap MAX_ALERTS_PER_HOUR per kind.
 */
export type OpsAlert = {
  alertKind: string;     // stable machine id, e.g. 'signup_limiter_unavailable'
  subject: string;       // short; prefixed "[Omnivyra ops]" by the template
  detail: string;        // body text - time is prepended automatically
  metric: string;        // counter name bumped on EVERY occurrence
  logEvent: string;      // structured log event name, emitted on EVERY occurrence
  logContext?: Record<string, string | number | boolean | null>;
};

function recordOccurrence(alert: OpsAlert): void {
  incrementAuthMetric(alert.metric, (alert.logContext ?? {}) as Record<string, string>);
  logger.error(alert.logEvent, { alertKind: alert.alertKind, ...(alert.logContext ?? {}) });
}

const localFallbackBuckets = new Map<string, string>();
/** In-process window: one email per instance per (kind, bucket). Used when the DB marker is unreachable / not allowed. */
function claimLocalWindow(kind: string, bucket: string): boolean {
  if (localFallbackBuckets.get(kind) === bucket) return false;
  localFallbackBuckets.set(kind, bucket);
  return true;
}

/** Send the alert email with the hard timeout. Never throws. Performs NO database write. */
async function deliver(alert: OpsAlert, nowMs: number, bucket: string, deps: NotifyDeps): Promise<NotifyResult> {
  try {
    await withTimeout((deps.send ?? sendOpsAlert)(
      opsAlertRecipient(),
      alert.subject,
      `At ${new Date(nowMs).toISOString()}: ${alert.detail}\n\nYou get at most one of these per ${SIGNUP_LIMITER_ALERT_WINDOW_MS / 60000} ` +
      `minutes and at most ${MAX_ALERTS_PER_HOUR} per hour for this alert.`,
      `ops-alert:${alert.alertKind}:${bucket}`,
    ), SEND_TIMEOUT_MS);
    return 'sent';
  } catch (err) {
    logger.warn('ops_alert_send_failed', { kind: alert.alertKind, message: err instanceof Error ? err.message : String(err) });
    return 'failed';
  }
}

/** Count + log (always) and email the owner at most once per window CROSS-INSTANCE (DB marker; hourly cap). */
export async function notifyOpsAlert(alert: OpsAlert, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const nowMs = (deps.now ?? Date.now)();
  recordOccurrence(alert);
  const bucket = String(Math.floor(nowMs / SIGNUP_LIMITER_ALERT_WINDOW_MS));
  let claim: Awaited<ReturnType<typeof claimBucket>>;
  try {
    claim = await claimBucket(alert.alertKind, bucket, nowMs);
  } catch {
    claim = 'db_unavailable';
  }
  if (claim === 'already' || claim === 'capped') return 'suppressed';
  if (claim === 'db_unavailable' && !claimLocalWindow(alert.alertKind, bucket)) return 'suppressed';
  return deliver(alert, nowMs, bucket, deps);
}

/**
 * PRE-AUTHENTICATION variant (05 review): route-auth forbids any write before authentication, so this NEVER touches
 * the DB marker - in-process window (one email per instance per window) instead of silence; log + counter always.
 */
export async function notifyOpsAlertPreAuth(alert: OpsAlert, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const nowMs = (deps.now ?? Date.now)();
  recordOccurrence(alert);
  const bucket = String(Math.floor(nowMs / SIGNUP_LIMITER_ALERT_WINDOW_MS));
  if (!claimLocalWindow(alert.alertKind, bucket)) return 'suppressed';
  return deliver(alert, nowMs, bucket, deps);
}

function signupLimiterAlert(endpoint: string, reason: string): OpsAlert {
  return {
    alertKind: SIGNUP_LIMITER_ALERT_KIND,
    subject: 'Signup paused: rate limiter unavailable',
    detail:
      `the signup rate limiter (Redis/Upstash) was unavailable or over quota, so new signups are being refused with a ` +
      `retryable "servers are busy" message until it recovers.\n\nEndpoint: ${endpoint}\nReason: ${reason}\n\n` +
      `Login and existing users are unaffected.`,
    metric: 'auth.signup.limiter_unavailable',
    logEvent: 'auth.signup_limiter_unavailable',
    logContext: { endpoint, reason },
  };
}

/** Signup limiter outage (authenticated / public-signup call sites). */
export function notifySignupLimiterUnavailable(endpoint: string, reason: string, deps: NotifyDeps = {}): Promise<NotifyResult> {
  return notifyOpsAlert(signupLimiterAlert(endpoint, reason), deps);
}

/** Signup limiter outage, PRE-AUTHENTICATION call sites (no DB write). */
export function notifySignupLimiterUnavailablePreAuth(endpoint: string, reason: string, deps: NotifyDeps = {}): Promise<NotifyResult> {
  return notifyOpsAlertPreAuth(signupLimiterAlert(endpoint, reason), deps);
}
