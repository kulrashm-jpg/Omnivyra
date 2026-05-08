import { ownedDbTable } from '../../db/writeOwner';
/**
 * Persistence for `trusted_devices`.
 *
 * Service contracts:
 *   - findActiveByFingerprint: lookup by (user_id, fingerprint) where
 *                              non-revoked + non-expired.
 *   - listForUser:             enumerate active rows.
 *   - insertTrustedDevice:     create a new row with TTL.
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
