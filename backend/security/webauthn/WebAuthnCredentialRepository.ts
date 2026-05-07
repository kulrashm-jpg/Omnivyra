/**
 * Persistence for `webauthn_credentials`.
 *
 * Service contracts:
 *   - listForUser: enumerate active (non-revoked) credentials.
 *   - findByCredentialId: lookup by base64url credential id (for verify).
 *   - insertCredential: create a new credential after a successful registration.
 *   - bumpCounter: atomic monotonic counter update on verify.
 *   - touchLastUsed: update last_used_at on a successful authentication.
 *   - revoke: soft-delete a credential.
 *
 * The repository ONLY persists; verification logic lives in the WebAuthn
 * services. The `counter` column is the WebAuthn-spec replay counter; it
 * MUST monotonically increase. The repo enforces this with a guard query.
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';
import type { StoredWebAuthnCredential } from './webauthnTypes';

interface CredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string | Uint8Array;     // bytea — Supabase JS returns base64 hex string by default
  counter: number | string;            // bigint may serialize as string
  transports: string[] | null;
  attestation_format: string | null;
  authenticator_aaguid: string | null;
  device_type: string | null;
  is_backed_up: boolean;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

function decodeBytea(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  // Supabase returns bytea as `\\x<hex>` by default. Decode either form.
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
    }
    // Fallback: treat as base64.
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  return new Uint8Array();
}

function rowToStored(row: CredentialRow): StoredWebAuthnCredential {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: decodeBytea(row.public_key),
    counter: typeof row.counter === 'string' ? BigInt(row.counter) : row.counter,
    transports: row.transports,
    attestationFormat: row.attestation_format,
    authenticatorAaguid: row.authenticator_aaguid,
    deviceType: row.device_type,
    isBackedUp: !!row.is_backed_up,
    label: row.label,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revocationReason: row.revocation_reason,
  };
}

export async function listForUser(userId: string): Promise<ReadonlyArray<StoredWebAuthnCredential>> {
  const { data } = await db
    .from('webauthn_credentials')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => rowToStored(r as CredentialRow));
}

export async function findByCredentialId(
  credentialId: string,
): Promise<StoredWebAuthnCredential | null> {
  const { data } = await db
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', credentialId)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as CredentialRow);
}

export async function findById(id: string): Promise<StoredWebAuthnCredential | null> {
  const { data } = await db
    .from('webauthn_credentials')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as CredentialRow);
}

export interface InsertCredentialInput {
  userId: string;
  credentialId: string;             // base64url
  publicKey: Uint8Array;
  counter: number | bigint;
  transports: ReadonlyArray<string> | null;
  attestationFormat: string | null;
  authenticatorAaguid: string | null;
  deviceType: string | null;
  isBackedUp: boolean;
  label?: string | null;
}

export async function insertCredential(
  input: InsertCredentialInput,
): Promise<StoredWebAuthnCredential> {
  // Encode publicKey for bytea: hex literal `\\x...`
  const hex = Buffer.from(input.publicKey).toString('hex');
  const { data, error } = await db
    .from('webauthn_credentials')
    .insert({
      user_id:              input.userId,
      credential_id:        input.credentialId,
      public_key:           `\\x${hex}`,
      counter:              typeof input.counter === 'bigint' ? input.counter.toString() : input.counter,
      transports:           input.transports,
      attestation_format:   input.attestationFormat,
      authenticator_aaguid: input.authenticatorAaguid,
      device_type:          input.deviceType,
      is_backed_up:         input.isBackedUp,
      label:                input.label ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    logger.error('webauthn_credential_insert_failed', {
      userId: input.userId,
      credentialId: input.credentialId,
      message: error?.message,
    });
    throw new Error(`webauthn_credential_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return rowToStored(data as CredentialRow);
}

/**
 * Monotonic counter bump. Updates only when the new counter is strictly
 * greater than the stored value. Returns the updated row, or null if the
 * counter would not advance (which a caller MUST treat as a replay).
 */
export async function bumpCounter(
  credentialId: string,
  newCounter: number | bigint,
): Promise<StoredWebAuthnCredential | null> {
  const candidate = typeof newCounter === 'bigint' ? newCounter.toString() : String(newCounter);
  const { data } = await db
    .from('webauthn_credentials')
    .update({ counter: candidate, last_used_at: new Date().toISOString() })
    .eq('credential_id', credentialId)
    .lt('counter', candidate)
    .select('*')
    .maybeSingle();
  if (!data) return null;
  return rowToStored(data as CredentialRow);
}

/**
 * Touch last_used_at without changing the counter. Used when the
 * authenticator reports counter=0 (some platforms always report 0 for
 * passkeys); we still record use but skip the monotonic check.
 */
export async function touchLastUsed(credentialId: string): Promise<void> {
  await db
    .from('webauthn_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('credential_id', credentialId);
}

export async function revokeCredential(
  credentialDbId: string,
  userId: string,
  reason: string,
): Promise<boolean> {
  const { data } = await db
    .from('webauthn_credentials')
    .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('id', credentialDbId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  return !!data && data.length > 0;
}
