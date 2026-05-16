/**
 * Creator Upload Abuse Guard Service
 *
 * Enterprise security layer for the creator upload endpoints:
 *
 *   - sliding-window rate limiting (per-user + per-company)
 *   - byte-volume throttling
 *   - MIME-spoof attempt tracking + escalation
 *   - oversized-upload anomaly detection
 *   - signed-upload session verification
 *
 * Backed by `creator_upload_rate_state` for distributed counters.
 * Failures (DB unreachable) FAIL OPEN — security is best-effort, not a
 * hard gate; legitimate users must not be blocked by infra outages.
 *
 * Returns structured decisions the upload handlers can branch on:
 *   - { allowed: true }
 *   - { allowed: false, reason: 'rate_limited', retry_after_seconds }
 *   - { allowed: false, reason: 'abuse_detected', kind: ... }
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { emitCreatorEvent, CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { recordAuditEntry } from './creatorAuditTrailService';

const BUCKET_SECONDS = 60; // 1-minute buckets
const WINDOW_BUCKETS = 10; // 10-minute window

// Defaults — overridable via env for ops tuning.
const DEFAULTS = {
  USER_ATTEMPTS_PER_WINDOW: 30,
  COMPANY_ATTEMPTS_PER_WINDOW: 200,
  USER_BYTES_PER_WINDOW: 5 * 1024 * 1024 * 1024,  // 5 GB
  COMPANY_BYTES_PER_WINDOW: 50 * 1024 * 1024 * 1024, // 50 GB
  USER_SPOOF_THRESHOLD: 3,    // 3 spoof attempts in window → flag
  USER_FAILURE_RATIO: 0.85,   // 85%+ failure rate (min 10 attempts) → flag
  OVERSIZED_BYTES: 2 * 1024 * 1024 * 1024, // 2 GB
};

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const LIMITS = {
  userAttempts: envInt('CREATOR_UPLOAD_USER_ATTEMPTS', DEFAULTS.USER_ATTEMPTS_PER_WINDOW),
  companyAttempts: envInt('CREATOR_UPLOAD_COMPANY_ATTEMPTS', DEFAULTS.COMPANY_ATTEMPTS_PER_WINDOW),
  userBytes: envInt('CREATOR_UPLOAD_USER_BYTES', DEFAULTS.USER_BYTES_PER_WINDOW),
  companyBytes: envInt('CREATOR_UPLOAD_COMPANY_BYTES', DEFAULTS.COMPANY_BYTES_PER_WINDOW),
  userSpoofThreshold: envInt('CREATOR_UPLOAD_USER_SPOOF_THRESHOLD', DEFAULTS.USER_SPOOF_THRESHOLD),
  oversizedBytes: envInt('CREATOR_UPLOAD_OVERSIZED_BYTES', DEFAULTS.OVERSIZED_BYTES),
};

export type UploadDecision =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited' | 'rate_limited_bytes' | 'oversized' | 'abuse_spoof' | 'abuse_failure_storm'; kind?: string; retry_after_seconds?: number; details?: Record<string, unknown> };

function currentBucketStart(): string {
  const now = Date.now();
  const aligned = now - (now % (BUCKET_SECONDS * 1000));
  return new Date(aligned).toISOString();
}

async function readRecentBuckets(scope: 'user' | 'company' | 'plan', scopeId: string) {
  const sinceMs = Date.now() - WINDOW_BUCKETS * BUCKET_SECONDS * 1000;
  const { data } = await supabase
    .from('creator_upload_rate_state')
    .select('attempt_count, byte_total, spoof_count, failure_count, bucket_start')
    .eq('scope', scope)
    .eq('scope_id', scopeId)
    .gte('bucket_start', new Date(sinceMs).toISOString())
    .order('bucket_start', { ascending: false });
  return Array.isArray(data) ? (data as Array<{ attempt_count: number; byte_total: number; spoof_count: number; failure_count: number; bucket_start: string }>) : [];
}

/**
 * Check whether an upload attempt should proceed. Records attempt
 * counters AS A SIDE EFFECT (this is intentional — every check is one
 * attempt; we want the counter advanced even if the decision is allow).
 *
 * Pass `sizeBytes` when known (multipart) for byte-volume throttling.
 */
export async function checkUploadAttemptAllowed(input: {
  userId: string;
  companyId: string;
  sizeBytes?: number | null;
  dailyPlanId?: string | null;
}): Promise<UploadDecision> {
  try {
    // Oversized — instant deny, before rate counter increments.
    if (input.sizeBytes != null && Number.isFinite(input.sizeBytes) && input.sizeBytes > LIMITS.oversizedBytes) {
      emitCreatorEvent({
        event: CREATOR_EVENTS.ABUSE_DETECTED,
        severity: 'warning',
        actorUserId: input.userId,
        companyId: input.companyId,
        dailyPlanId: input.dailyPlanId ?? null,
        metadata: { kind: 'oversized', size_bytes: input.sizeBytes, max: LIMITS.oversizedBytes },
      });
      return { allowed: false, reason: 'oversized', details: { size_bytes: input.sizeBytes, max: LIMITS.oversizedBytes } };
    }

    // Sliding-window sums.
    const [userBuckets, companyBuckets] = await Promise.all([
      readRecentBuckets('user', input.userId),
      readRecentBuckets('company', input.companyId),
    ]);
    const userAttempts = userBuckets.reduce((s, b) => s + (b.attempt_count ?? 0), 0);
    const userBytes = userBuckets.reduce((s, b) => s + Number(b.byte_total ?? 0), 0);
    const userSpoofs = userBuckets.reduce((s, b) => s + (b.spoof_count ?? 0), 0);
    const userFailures = userBuckets.reduce((s, b) => s + (b.failure_count ?? 0), 0);
    const companyAttempts = companyBuckets.reduce((s, b) => s + (b.attempt_count ?? 0), 0);
    const companyBytes = companyBuckets.reduce((s, b) => s + Number(b.byte_total ?? 0), 0);

    // Abuse: spoof escalation.
    if (userSpoofs >= LIMITS.userSpoofThreshold) {
      emitCreatorEvent({
        event: CREATOR_EVENTS.ABUSE_DETECTED,
        severity: 'critical',
        actorUserId: input.userId,
        companyId: input.companyId,
        metadata: { kind: 'mime_spoof_repeat', spoof_count: userSpoofs },
      });
      return { allowed: false, reason: 'abuse_spoof', kind: 'mime_spoof_repeat', details: { spoof_count: userSpoofs } };
    }

    // Abuse: high failure ratio.
    if (userAttempts >= 10 && userFailures / userAttempts >= DEFAULTS.USER_FAILURE_RATIO) {
      emitCreatorEvent({
        event: CREATOR_EVENTS.ABUSE_DETECTED,
        severity: 'warning',
        actorUserId: input.userId,
        companyId: input.companyId,
        metadata: { kind: 'failure_storm', attempts: userAttempts, failures: userFailures },
      });
      return { allowed: false, reason: 'abuse_failure_storm', kind: 'failure_storm', details: { attempts: userAttempts, failures: userFailures } };
    }

    // Rate: attempt counts.
    if (userAttempts >= LIMITS.userAttempts || companyAttempts >= LIMITS.companyAttempts) {
      const scope = userAttempts >= LIMITS.userAttempts ? 'user' : 'company';
      emitCreatorEvent({
        event: CREATOR_EVENTS.RATE_LIMIT_BLOCKED,
        severity: 'info',
        actorUserId: input.userId,
        companyId: input.companyId,
        metadata: { kind: 'attempts', scope, user_attempts: userAttempts, company_attempts: companyAttempts },
      });
      return { allowed: false, reason: 'rate_limited', retry_after_seconds: BUCKET_SECONDS, details: { scope, user_attempts: userAttempts, company_attempts: companyAttempts } };
    }

    // Rate: bytes.
    const additionalBytes = input.sizeBytes ?? 0;
    if (userBytes + additionalBytes >= LIMITS.userBytes || companyBytes + additionalBytes >= LIMITS.companyBytes) {
      const scope = userBytes + additionalBytes >= LIMITS.userBytes ? 'user' : 'company';
      emitCreatorEvent({
        event: CREATOR_EVENTS.RATE_LIMIT_BLOCKED,
        severity: 'info',
        actorUserId: input.userId,
        companyId: input.companyId,
        metadata: { kind: 'bytes', scope, user_bytes: userBytes, company_bytes: companyBytes, attempting_bytes: additionalBytes },
      });
      return { allowed: false, reason: 'rate_limited_bytes', retry_after_seconds: BUCKET_SECONDS, details: { scope, user_bytes: userBytes, company_bytes: companyBytes } };
    }

    // Record attempt counter (allowed).
    await incrementBucket('user', input.userId, { attempts: 1, bytes: input.sizeBytes ?? 0 });
    await incrementBucket('company', input.companyId, { attempts: 1, bytes: input.sizeBytes ?? 0 });
    if (input.dailyPlanId) {
      await incrementBucket('plan', input.dailyPlanId, { attempts: 1, bytes: input.sizeBytes ?? 0 });
    }
    return { allowed: true };
  } catch (err) {
    // FAIL OPEN — security is best-effort.
    logger.warn('creatorAbuseGuard.check_failed', {
      surface: 'creatorAbuseGuard',
      error: (err as Error)?.message ?? String(err),
    });
    return { allowed: true };
  }
}

async function incrementBucket(
  scope: 'user' | 'company' | 'plan',
  scopeId: string,
  delta: { attempts?: number; bytes?: number; spoofs?: number; failures?: number },
): Promise<void> {
  const bucketStart = currentBucketStart();
  try {
    const { data: existing } = await supabase
      .from('creator_upload_rate_state')
      .select('id, attempt_count, byte_total, spoof_count, failure_count')
      .eq('scope', scope)
      .eq('scope_id', scopeId)
      .eq('bucket_start', bucketStart)
      .maybeSingle();

    if (existing) {
      await ownedDbTable('creator_upload_rate_state')
        .update({
          attempt_count: ((existing as any).attempt_count ?? 0) + (delta.attempts ?? 0),
          byte_total: Number((existing as any).byte_total ?? 0) + (delta.bytes ?? 0),
          spoof_count: ((existing as any).spoof_count ?? 0) + (delta.spoofs ?? 0),
          failure_count: ((existing as any).failure_count ?? 0) + (delta.failures ?? 0),
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', (existing as any).id);
    } else {
      await ownedDbTable('creator_upload_rate_state').insert({
        scope,
        scope_id: scopeId,
        bucket_start: bucketStart,
        bucket_size_seconds: BUCKET_SECONDS,
        attempt_count: delta.attempts ?? 0,
        byte_total: delta.bytes ?? 0,
        spoof_count: delta.spoofs ?? 0,
        failure_count: delta.failures ?? 0,
      });
    }
  } catch (err) {
    logger.warn('creatorAbuseGuard.increment_failed', {
      surface: 'creatorAbuseGuard',
      scope,
      scope_id: scopeId,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

/** Record a MIME-spoof attempt — call from upload handlers when spoof detected. */
export async function recordUploadSpoofAttempt(input: { userId: string; companyId: string; dailyPlanId?: string | null }): Promise<void> {
  await incrementBucket('user', input.userId, { spoofs: 1, failures: 1 });
  await incrementBucket('company', input.companyId, { spoofs: 1, failures: 1 });
  recordAuditEntry({
    action: 'upload_validation_rejected',
    actorUserId: input.userId,
    actorKind: 'user',
    companyId: input.companyId,
    dailyPlanId: input.dailyPlanId ?? null,
    metadata: { kind: 'mime_spoof' },
  });
}

/** Record a validation failure — non-spoof. */
export async function recordUploadFailure(input: { userId: string; companyId: string }): Promise<void> {
  await incrementBucket('user', input.userId, { failures: 1 });
  await incrementBucket('company', input.companyId, { failures: 1 });
}

/** Signed-upload session verification — checks that the `upload_session_id` on the row
 *  matches a token derived from `dailyPlanId + companyId + a secret`. */
export function verifyUploadSession(input: { sessionId: string; dailyPlanId: string; companyId: string }): boolean {
  // Deterministic HMAC-style fingerprint without bringing in crypto deps —
  // suitable for opportunistic verification, not as the only auth gate.
  const secret = process.env.CREATOR_UPLOAD_SESSION_SECRET ?? 'creator-upload-secret';
  const expected = simpleFingerprint(`${input.dailyPlanId}:${input.companyId}:${secret}`);
  return input.sessionId.length >= 16 && (input.sessionId.startsWith(expected.slice(0, 8)) || input.sessionId.includes(expected.slice(0, 12)));
}

function simpleFingerprint(s: string): string {
  // FNV-1a 32-bit hash — non-cryptographic, used only for tampering hints.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
