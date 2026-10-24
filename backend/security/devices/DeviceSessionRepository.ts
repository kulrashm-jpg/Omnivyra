import { ownedDbTable } from '../../db/writeOwner';
/**
 * Persistence for `trusted_devices`.
 *
 * Service contracts:
 *   - findActiveByFingerprint: lookup by (user_id, fingerprint) where
 *                              non-revoked + non-expired.
 *   - listForUser:             enumerate active rows.
 *   - insertTrustedDevice:     create a new row with TTL.
 *   - reviveDormantTrustedDevice: re-trust the EXPIRED or REVOKED row for the
 *                              same (user_id, fingerprint) (Closure-011).
 *   - touchLastSeen:           bump last_seen_at.
 *   - revokeDevice:            soft-delete with reason.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import type { StoredTrustedDevice } from './trustedDeviceTypes';

interface DeviceRow {
  id: string;
  user_id: string;
  fingerprint: string;
  label: string | null;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

function rowToStored(row: DeviceRow): StoredTrustedDevice {
  return {
    id:               row.id,
    userId:           row.user_id,
    fingerprint:      row.fingerprint,
    label:            row.label,
    firstSeenAt:      new Date(row.first_seen_at),
    lastSeenAt:       new Date(row.last_seen_at),
    expiresAt:        new Date(row.expires_at),
    revokedAt:        row.revoked_at ? new Date(row.revoked_at) : null,
    revocationReason: row.revocation_reason,
  };
}

function isLive(row: StoredTrustedDevice): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function findActiveByFingerprint(
  userId: string,
  fingerprint: string,
): Promise<StoredTrustedDevice | null> {
  const { data } = await ownedDbTable('trusted_devices')
    .select('*')
    .eq('user_id', userId)
    .eq('fingerprint', fingerprint)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const stored = rowToStored(data as DeviceRow);
  return isLive(stored) ? stored : null;
}

export async function listForUser(userId: string): Promise<ReadonlyArray<StoredTrustedDevice>> {
  const { data } = await ownedDbTable('trusted_devices')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false });
  return (data ?? [])
    .map((r) => rowToStored(r as DeviceRow))
    .filter((r) => r.expiresAt.getTime() > Date.now());
}

export async function findByIdForUser(
  id: string,
  userId: string,
): Promise<StoredTrustedDevice | null> {
  const { data } = await ownedDbTable('trusted_devices')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as DeviceRow);
}

export interface InsertTrustedDeviceInput {
  userId: string;
  fingerprint: string;
  label?: string | null;
  ttlSeconds: number;
}

export async function insertTrustedDevice(
  input: InsertTrustedDeviceInput,
): Promise<StoredTrustedDevice> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
  const { data, error } = await ownedDbTable('trusted_devices')
    .insert({
      user_id:       input.userId,
      fingerprint:   input.fingerprint,
      label:         input.label ?? null,
      first_seen_at: now.toISOString(),
      last_seen_at:  now.toISOString(),
      expires_at:    expiresAt.toISOString(),
    })
    .select('*')
    .single();
  if (error || !data) {
    logger.error('trusted_device_insert_failed', { userId: input.userId, message: error?.message });
    throw new Error(`trusted_device_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return rowToStored(data as DeviceRow);
}

/**
 * Closure-011 — `trusted_devices` carries UNIQUE (user_id, fingerprint) with no
 * partial predicate (migration 20260507; the same in the baseline schema), so
 * once a device's trust EXPIRES (30 days by default) or is REVOKED, a fresh
 * INSERT for that browser violates the constraint and trusting it again fails
 * for ever — every step-up write that needs a trusted device becomes
 * unreachable from that browser. The one row per (user, fingerprint) is
 * therefore revived instead: compare-and-set on the dormant state that was
 * read (its revoked_at and expires_at), so a concurrent re-trust or revoke is
 * never overwritten. Returns null when there is no dormant row to revive, or
 * when the row changed since it was read.
 */
export async function reviveDormantTrustedDevice(input: InsertTrustedDeviceInput): Promise<StoredTrustedDevice | null> {
  const { data: found } = await ownedDbTable('trusted_devices')
    .select('*')
    .eq('user_id', input.userId)
    .eq('fingerprint', input.fingerprint)
    .maybeSingle();
  if (!found) return null;
  const row = found as DeviceRow;
  if (isLive(rowToStored(row))) return null; // live: not dormant (the caller reports ALREADY_TRUSTED)
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
  let revive = ownedDbTable('trusted_devices')
    .update({
      label:             input.label ?? null,
      last_seen_at:      now.toISOString(),
      expires_at:        expiresAt.toISOString(),
      revoked_at:        null,
      revocation_reason: null,
    })
    .eq('id', row.id)
    .eq('user_id', input.userId)
    .eq('expires_at', row.expires_at);
  revive = row.revoked_at == null ? revive.is('revoked_at', null) : revive.eq('revoked_at', row.revoked_at);
  const { data, error } = await revive.select('*');
  if (error) {
    logger.error('trusted_device_revive_failed', { userId: input.userId, message: error.message });
    throw new Error(`trusted_device_revive_failed: ${error.message}`);
  }
  const updated = Array.isArray(data) && data.length > 0 ? (data[0] as DeviceRow) : null;
  return updated ? rowToStored(updated) : null;
}

export async function touchLastSeen(id: string): Promise<void> {
  await ownedDbTable('trusted_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', id);
}

export async function revokeDevice(
  id: string,
  userId: string,
  reason: string,
): Promise<boolean> {
  const { data } = await ownedDbTable('trusted_devices')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('id', id)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  return !!data && data.length > 0;
}
