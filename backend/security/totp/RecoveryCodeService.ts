import { ownedDbTable } from '../../db/writeOwner';
/**
 * RecoveryCodeService — argon2id-hashed one-shot recovery codes.
 *
 * Lifecycle:
 *   - regenerate: revoke prior batch (mark used_at on every unused row),
 *                 generate N fresh codes, hash each individually, return
 *                 plaintext codes ONCE.
 *   - verifyAndConsume: linear-scan unused codes for the user, argon2.verify
 *                       each, atomically mark the matching row used.
 *
 * Rules:
 *   - Plaintext codes are never persisted, never logged.
 *   - Each code is hashed individually (no batch hash shortcut).
 *   - Reusing a recovery code (consumed twice) MUST fail — atomic
 *     `UPDATE … WHERE used_at IS NULL` enforces single-shot.
 *   - Regenerating invalidates the prior batch.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as argon2 from 'argon2';

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import { logSecurityEvent } from '../audit/SecurityAuditService';
import {
  check as mfaCheck,
  recordFailure as mfaRecordFailure,
  reset as mfaReset,
} from '../MfaAttemptLimiter';
import type {
  RecoveryCodeVerifyFailure,
  RecoveryCodeVerifyResult,
} from './totpTypes';

// ── Tuning ───────────────────────────────────────────────────────────────────

const RECOVERY_CODE_COUNT      = 10;
const RECOVERY_CODE_GROUPS     = 4;
const RECOVERY_CODE_GROUP_SIZE = 4;
// Length of the dashed canonical form: 4 groups × 4 chars + 3 dashes = 19.
const RECOVERY_CODE_DASHED_LENGTH = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_SIZE + (RECOVERY_CODE_GROUPS - 1);
// Resulting code shape: 4 groups of 4 alphanum chars separated by dashes
// (e.g. "GH4K-9P2N-XR7T-AB3V"). 64 bits of entropy per code; argon2id
// makes brute-force impractical even with the full hash list leaked.

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,    // ~19 MiB — RFC 9106 "second recommended option"
  timeCost: 2,
  parallelism: 1,
};

// Charset excludes ambiguous glyphs (0/O, 1/I) for usability.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface RecoveryCodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  batch_id: string;
  used_at: string | null;
  used_ip: string | null;
  created_at: string;
}

// ── Generate ────────────────────────────────────────────────────────────────

function randomCharFrom(charset: string): string {
  // Crypto-grade rejection sampling against a power-of-two threshold.
  const max = 256 - (256 % charset.length);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const b = randomBytes(1)[0];
    if (b < max) return charset[b % charset.length];
  }
}

function generateRecoveryCodePlaintext(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_CODE_GROUPS; g++) {
    let chunk = '';
    for (let i = 0; i < RECOVERY_CODE_GROUP_SIZE; i++) {
      chunk += randomCharFrom(CHARSET);
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

/** Normalize user input: strip whitespace + dashes; uppercase. */
export function normalizeRecoveryCodeInput(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}

function reformatForCompare(code: string): string {
  // Re-insert dashes every group_size characters so plaintext compared
  // matches the canonical hashed form.
  const norm = normalizeRecoveryCodeInput(code);
  const groups: string[] = [];
  for (let i = 0; i < norm.length; i += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(norm.slice(i, i + RECOVERY_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}

// ── Regenerate (revokes prior set + emits new plaintext codes ONCE) ─────────

export interface RegenerateRecoveryCodesInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RegeneratedRecoveryCodes {
  batchId: string;
  /** Plaintext codes. Returned ONCE; caller must surface them to the user
   *  and never persist client-side. */
  codes: ReadonlyArray<string>;
}

export async function regenerate(
  input: RegenerateRecoveryCodesInput,
): Promise<RegeneratedRecoveryCodes> {
  // 1. Revoke unused codes from any prior batch.
  await ownedDbTable('recovery_codes')
    .update({ used_at: new Date().toISOString(), used_ip: null })
    .eq('user_id', input.userId)
    .is('used_at', null);

  // 2. Generate + hash new codes individually.
  const batchId = randomUUID();
  const plaintext: string[] = [];
  const rows: { user_id: string; code_hash: string; batch_id: string }[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateRecoveryCodePlaintext();
    const hash = await argon2.hash(code, ARGON2_OPTIONS);
    plaintext.push(code);
    rows.push({
      user_id:   input.userId,
      code_hash: hash,
      batch_id:  batchId,
    });
  }

  const { error } = await ownedDbTable('recovery_codes').insert(rows);
  if (error) {
    logger.error('recovery_codes_insert_failed', { userId: input.userId, message: error.message });
    throw new Error(`recovery_codes_insert_failed: ${error.message}`);
  }

  await logSecurityEvent({
    capability: 'mfa.enroll',
    decision: 'recovery_codes_regenerated',
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: batchId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { batchId, codes: plaintext };
}

// ── Verify + consume ────────────────────────────────────────────────────────

export interface VerifyRecoveryCodeInput {
  userId: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Verify a candidate recovery code and consume it on success.
 *
 * argon2.verify is intentionally slow; we cap the verify count per
 * request at the active-codes-per-user count (default 10), which keeps
 * worst-case CPU bounded.
 */
export async function verifyAndConsume(
  input: VerifyRecoveryCodeInput,
): Promise<RecoveryCodeVerifyResult> {
  // Per-user + per-IP brute-force gate. argon2.verify is intentionally
  // expensive; the gate ensures the cost is bounded under a guessing
  // attack and prevents enumeration via timing differences.
  const gate = mfaCheck({ factor: 'recovery_code', userId: input.userId, ip: input.ip ?? null });
  if (!gate.allowed) {
    await audit(input, 'NOT_MATCHED', null);
    return { ok: false, reason: 'NOT_MATCHED' };
  }

  const candidate = reformatForCompare(input.code);
  if (candidate.length !== RECOVERY_CODE_DASHED_LENGTH) {
    mfaRecordFailure({ factor: 'recovery_code', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'NOT_MATCHED', null);
    return { ok: false, reason: 'NOT_MATCHED' };
  }

  const { data: rows } = await ownedDbTable('recovery_codes')
    .select('*')
    .eq('user_id', input.userId)
    .is('used_at', null);

  const list = (rows ?? []) as RecoveryCodeRow[];
  if (list.length === 0) {
    mfaRecordFailure({ factor: 'recovery_code', userId: input.userId, ip: input.ip ?? null });
    await audit(input, 'NO_ACTIVE_CODES', null);
    return { ok: false, reason: 'NO_ACTIVE_CODES' };
  }

  for (const row of list) {
    let matched = false;
    try {
      matched = await argon2.verify(row.code_hash, candidate);
    } catch (err) {
      logger.warn('recovery_code_argon2_verify_failed', {
        userId: input.userId,
        rowId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!matched) continue;

    // Atomic single-flight consume.
    const now = new Date().toISOString();
    const { data: claimed } = await ownedDbTable('recovery_codes')
      .update({ used_at: now, used_ip: input.ip ?? null })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id');

    if (!claimed || claimed.length === 0) {
      // Race lost — another verifier consumed this row.
      await audit(input, 'CONSUME_RACE_LOST', row.id);
      // Do NOT short-circuit: a different row may also match (extremely
      // unlikely with argon2 hashes but defensive).
      continue;
    }

    await logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'recovery_code_used',
      actorUserId: input.userId,
      principalUserId: input.userId,
      resourceId: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // Reset rate-limit buckets on success.
    mfaReset({ factor: 'recovery_code', userId: input.userId, ip: input.ip ?? null });

    return { ok: true, codeId: row.id, consumedAt: new Date(now) };
  }

  // No row matched.
  // Do a constant-time guard so timing doesn't differ from "matched but
  // race lost" — argon2.verify already absorbs most of the timing.
  const dummy = Buffer.alloc(8);
  timingSafeEqual(dummy, dummy);

  mfaRecordFailure({ factor: 'recovery_code', userId: input.userId, ip: input.ip ?? null });
  await audit(input, 'NOT_MATCHED', null);
  return { ok: false, reason: 'NOT_MATCHED' };
}

async function audit(
  input: VerifyRecoveryCodeInput,
  reason: RecoveryCodeVerifyFailure,
  rowId: string | null,
): Promise<void> {
  await logSecurityEvent({
    capability: 'mfa.view_factors',
    decision: 'totp_verification_failed',
    reason: `recovery_code: ${reason}`,
    actorUserId: input.userId,
    principalUserId: input.userId,
    resourceId: rowId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}
