/**
 * TotpVerificationService — verify a TOTP token against the user's
 * activated factor.
 *
 * Used by:
 *   - Step-up `factor: 'totp'` flow (Wave 2B-B)
 *   - Future feature gates that need fresh TOTP (Wave 2C+)
 *
 * Replay safety (M3, 2026-11-13 - no longer accepted as a risk):
 *   - otplib's `window: 1` permits ±1 step for clock drift and does not track used tokens itself. Each successful
 *     verification now CONSUMES its time step atomically in totp_factors.last_used_step (consumeTotpStep): the same
 *     code, or any code from a step at or before the last used one, is refused as TOKEN_REPLAYED - including two
 *     concurrent submissions of one code (exactly one wins the conditional UPDATE). If the consumption cannot be
 *     recorded the verification is refused (VERIFICATION_UNAVAILABLE), never accepted unrecorded.
 *   - Inactive (verified_at NULL) factors cannot authenticate.
 *   - Revoked factors cannot authenticate.
 */

import { authenticator } from 'otplib';

import { logSecurityEvent } from '../audit/SecurityAuditService';
import { findActiveForUser, consumeTotpStep } from './TotpFactorRepository';
import { readVaultSecret } from './VaultSecretClient';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../MfaAttemptLimiter';
import type { TotpVerifyResult } from './totpTypes';

export interface VerifyTotpInput {
  userId: string;
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function verifyTotp(input: VerifyTotpInput): Promise<TotpVerifyResult> {
  // Per-user + per-IP brute-force gate. Runs BEFORE we do any work so a
  // locked-out user/IP costs nothing — and so the existence of an active
  // factor is not leaked through timing differences when locked.
  const gate = mfaCheck({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
  if (!gate.allowed) {
    await audit(input, 'RATE_LIMITED', null);
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  const factor = await findActiveForUser(input.userId);
  if (!factor) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'NO_ACTIVE_FACTOR', null);
    return { ok: false, reason: 'NO_ACTIVE_FACTOR' };
  }
  if (factor.revokedAt) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'FACTOR_REVOKED', factor.id);
    return { ok: false, reason: 'FACTOR_REVOKED' };
  }
  if (!factor.verifiedAt) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'FACTOR_NOT_VERIFIED', factor.id);
    return { ok: false, reason: 'FACTOR_NOT_VERIFIED' };
  }

  const secret = await readVaultSecret(factor.vaultSecretId);
  if (!secret) {
    await audit(input, 'SECRET_UNAVAILABLE', factor.id);
    return { ok: false, reason: 'SECRET_UNAVAILABLE' };
  }

  const trimmed = input.token.trim();
  // M3: which time step did the code match (otplib checkDelta: -1 / 0 / +1 within window, null = invalid)?
  const step = matchedTotpStep(trimmed, secret);
  if (step === null) {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'INVALID_TOKEN', factor.id);
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  // M3: ONE-TIME USE - atomically consume the step; a step at or before the last used one is a replay.
  const consumed = await consumeTotpStep(factor.id, step);
  if (consumed === 'unavailable') {
    await audit(input, 'VERIFICATION_UNAVAILABLE', factor.id);
    return { ok: false, reason: 'VERIFICATION_UNAVAILABLE' };
  }
  if (consumed === 'replayed') {
    mfaRecordFailure({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'TOKEN_REPLAYED', factor.id);
    return { ok: false, reason: 'TOKEN_REPLAYED' };
  }

  // Reset the rate-limit buckets on success so legitimate users don't
  // accumulate failure counts from earlier mistypes.
  mfaReset({ factor: 'totp', userId: input.userId, ip: input.ip ?? null });

  const verifiedAt = new Date(); // last_used_at was stamped by consumeTotpStep
  return { ok: true, factorId: factor.id, verifiedAt };
}

/** The absolute TOTP time step the token matched (now-step + otplib's delta), or null when it matches none. */
export function matchedTotpStep(token: string, secret: string, nowMs: number = Date.now()): number | null {
  // ONE clock reading (05): otplib's delta and our base step must come from the SAME instant, or a read pair that
  // straddles a step boundary would record a step one too high and pre-consume the user's next legitimate code.
  const at = authenticator.clone({ epoch: nowMs });
  const delta = at.checkDelta(token, secret);
  if (delta === null || delta === undefined) return null;
  const period = Number(at.allOptions().step) || 30;
  return Math.floor(nowMs / 1000 / period) + delta;
}

async function audit(
  input: VerifyTotpInput,
  reason: string,
  factorId: string | null,
): Promise<void> {
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'totp_verification_failed',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: factorId,
    reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
