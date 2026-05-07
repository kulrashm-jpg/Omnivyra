/**
 * VaultSecretClient — narrow wrapper over Supabase Vault.
 *
 * Strategy:
 *   - Primary: Supabase Vault via the security_create_secret /
 *     security_get_secret / security_delete_secret RPCs (defined in
 *     supabase/migrations/20260507_security_vault_rpcs.sql).
 *   - Fallback: NOT IMPLEMENTED in Wave 2B-B. The architecture remains
 *     KMS/Vault-ready: replacing this file with an envelope-encryption
 *     implementation requires no caller changes.
 *
 * Rules enforced here:
 *   - Names MUST be prefixed `security:` (the RPC enforces this, the
 *     client mirrors the rule for fail-fast).
 *   - Secrets are never logged, never returned to anything other than
 *     the caller that owns the factor.
 *   - Decrypt errors return null; callers must treat a missing secret
 *     as "credential unusable" (e.g. revoked / vault outage).
 */

import { supabase as db } from '../../db/supabaseClient';
import { logger } from '../../services/logger';

const SECURITY_NAME_PREFIX = 'security:';

export class VaultSecretError extends Error {
  constructor(message: string, public readonly code: 'CREATE_FAILED' | 'READ_FAILED' | 'DELETE_FAILED' | 'INVALID_NAME') {
    super(message);
    this.name = 'VaultSecretError';
  }
}

export interface CreateVaultSecretInput {
  /** Plaintext secret. Never logged. */
  plaintext: string;
  /** Stable name. MUST start with "security:" (e.g., "security:totp:user:<uuid>"). */
  name: string;
  /** Free-text description. Avoid PII. */
  description?: string;
}

export async function createVaultSecret(input: CreateVaultSecretInput): Promise<string> {
  if (!input.name.startsWith(SECURITY_NAME_PREFIX)) {
    throw new VaultSecretError(
      `Vault secret name must start with "${SECURITY_NAME_PREFIX}"`,
      'INVALID_NAME',
    );
  }

  const { data, error } = await db.rpc('security_create_secret', {
    p_secret:      input.plaintext,
    p_name:        input.name,
    p_description: input.description ?? null,
  });

  if (error || typeof data !== 'string') {
    logger.error('vault_create_secret_failed', { name: input.name, message: error?.message });
    throw new VaultSecretError(
      `vault.create_secret failed: ${error?.message ?? 'no id returned'}`,
      'CREATE_FAILED',
    );
  }

  return data as string;
}

/**
 * Read a vault secret by id. Returns null if not present (deleted /
 * never existed). Decryption errors are mapped to null + warning log.
 */
export async function readVaultSecret(id: string): Promise<string | null> {
  const { data, error } = await db.rpc('security_get_secret', { p_id: id });

  if (error) {
    logger.warn('vault_get_secret_failed', { id, message: error.message });
    return null;
  }

  if (data === null || data === undefined) return null;

  if (typeof data !== 'string') {
    logger.warn('vault_get_secret_unexpected_shape', { id, type: typeof data });
    return null;
  }

  return data;
}

/**
 * Delete a vault secret by id. Idempotent.
 */
export async function deleteVaultSecret(id: string): Promise<void> {
  const { error } = await db.rpc('security_delete_secret', { p_id: id });
  if (error) {
    logger.warn('vault_delete_secret_failed', { id, message: error.message });
    // Not fatal; the consumer can still revoke the factor row. Caller
    // logic should treat a leaked-but-unreferenced secret as orphan
    // garbage to be cleaned up later.
  }
}
