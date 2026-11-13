import { ownedDbTable } from '../../db/writeOwner';
/**
 * Persistence for `totp_factors`.
 *
 * Service contracts:
 *   - findActiveForUser:      single non-revoked row per user (DB enforces
 *                             via partial unique index `idx_totp_factors_user_active`).
 *   - findByIdForUser:        ownership-checked lookup.
 *   - insertPending:          row with verified_at NULL — caller must verify
 *                             a token before activating.
 *   - markVerified:           set verified_at on first successful verify.
 *   - touchLastUsed:          stamp last_used_at on every successful verify.
 *   - revokeFactor:           soft-delete; preserves history.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import type {
  StoredTotpFactor,
  TotpAlgorithm,
  TotpDigits,
} from './totpTypes';

interface FactorRow {
  id: string;
  user_id: string;
  vault_secret_id: string;
  label: string | null;
  algorithm: string;
  digits: number;
  period_seconds: number;
  created_at: string;
  verified_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

function rowToStored(row: FactorRow): StoredTotpFactor {
  return {
    id:               row.id,
    userId:           row.user_id,
    vaultSecretId:    row.vault_secret_id,
    label:            row.label,
    algorithm:        row.algorithm as TotpAlgorithm,
    digits:           row.digits as TotpDigits,
    periodSeconds:    row.period_seconds,
    createdAt:        new Date(row.created_at),
    verifiedAt:       row.verified_at ? new Date(row.verified_at) : null,
    lastUsedAt:       row.last_used_at ? new Date(row.last_used_at) : null,
    revokedAt:        row.revoked_at  ? new Date(row.revoked_at)  : null,
    revocationReason: row.revocation_reason,
  };
}

export async function findActiveForUser(userId: string): Promise<StoredTotpFactor | null> {
  const { data } = await ownedDbTable('totp_factors')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as FactorRow);
}

export async function findByIdForUser(
  factorId: string,
  userId: string,
): Promise<StoredTotpFactor | null> {
  const { data } = await ownedDbTable('totp_factors')
    .select('*')
    .eq('id', factorId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as FactorRow);
}

export interface InsertPendingFactorInput {
  userId: string;
  vaultSecretId: string;
  label?: string | null;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  periodSeconds: number;
}

export async function insertPending(input: InsertPendingFactorInput): Promise<StoredTotpFactor> {
  const { data, error } = await ownedDbTable('totp_factors')
    .insert({
      user_id:         input.userId,
      vault_secret_id: input.vaultSecretId,
      label:           input.label ?? null,
      algorithm:       input.algorithm,
      digits:          input.digits,
      period_seconds:  input.periodSeconds,
    })
    .select('*')
    .single();
  if (error || !data) {
    logger.error('totp_factor_insert_failed', { userId: input.userId, message: error?.message });
    throw new Error(`totp_factor_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return rowToStored(data as FactorRow);
}

export async function markVerified(factorId: string, usedStep?: number): Promise<StoredTotpFactor | null> {
  const now = new Date().toISOString();
  // M3: the enrollment code's step is recorded as USED, so the same code cannot be replayed into a step-up / MFA
  // verification within its window right after enrollment.
  const { data } = await ownedDbTable('totp_factors')
    .update({ verified_at: now, last_used_at: now, ...(Number.isSafeInteger(usedStep) ? { last_used_step: usedStep } : {}) })
    .eq('id', factorId)
    .is('verified_at', null)
    .select('*')
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as FactorRow);
}

/**
 * M3 (TOTP replay protection; owner-assigned to e1, spec 05): CONSUME a time step atomically. One conditional UPDATE -
 * it succeeds only when the factor has no recorded step or a strictly OLDER one - so the same code (same step), or a
 * code from an earlier step after a later one succeeded, can never verify twice; two concurrent submissions of one code
 * race on the same row and exactly one UPDATE matches. Persisted in the database (survives restarts), never in memory.
 * `step` is an integer computed by our own code (never request text), so it is safe in the filter.
 */
export async function consumeTotpStep(
  factorId: string,
  step: number,
): Promise<'consumed' | 'replayed' | 'unavailable'> {
  if (!Number.isSafeInteger(step) || step < 0) return 'unavailable';
  const { data, error } = await ownedDbTable('totp_factors')
    .update({ last_used_step: step, last_used_at: new Date().toISOString() })
    .eq('id', factorId)
    .or(`last_used_step.is.null,last_used_step.lt.${step}`)
    .select('id');
  if (error) return 'unavailable';
  return Array.isArray(data) && data.length === 1 ? 'consumed' : 'replayed';
}

export async function touchLastUsed(factorId: string): Promise<void> {
  await ownedDbTable('totp_factors')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', factorId);
}

export async function revokeFactor(
  factorId: string,
  userId: string,
  reason: string,
): Promise<boolean> {
  const { data } = await ownedDbTable('totp_factors')
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq('id', factorId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  return !!data && data.length > 0;
}
