import fs from 'fs/promises';
import path from 'path';
import { ownedDbTable } from '../../db/writeOwner';
import { encryptCredential, decryptCredential } from '../../auth/credentialEncryption';

/**
 * RPA session storage. Playwright's `storageState` is a JSON blob holding
 * cookies + localStorage for a domain — live platform session credentials. We
 * persist one blob per (organization_id, platform).
 *
 * At rest the blob is ENCRYPTED with the repository's existing AES-256-GCM
 * helper (backend/auth/credentialEncryption: same algorithm, same strict-hex
 * ENCRYPTION_KEY as backend/auth/tokenStore). The rpa_sessions.storage_state
 * jsonb column holds only an envelope:
 *
 *   { format: 'omnivyra.rpa_session.v1', alg: 'aes-256-gcm',
 *     ciphertext: '<iv>:<tag>:<data>', account_tier_verified: false }
 *
 * The plaintext inside the ciphertext is { organization_id, platform, state },
 * and is checked on load, so a ciphertext copied onto another tenant's row
 * (or another platform) is refused.
 *
 * Fail-closed rules:
 *   - No filesystem copy is written and none is read. Legacy plaintext files
 *     under $RPA_SESSION_DIR || tmp/rpa-sessions are deleted (best effort) on
 *     save and on delete, never used.
 *   - A row that is not the encrypted envelope (legacy plaintext) is refused:
 *     the organization must re-authenticate. It is never silently migrated.
 *   - Expired row, wrong/missing key, tampered ciphertext, or tenant/platform
 *     mismatch → no session (the worker refuses with RPA_NO_SESSION).
 *   - A missing ENCRYPTION_KEY makes save THROW: nothing is stored in clear.
 */

export type PlaywrightStorageState = {
  cookies?: Array<Record<string, unknown>>;
  origins?: Array<Record<string, unknown>>;
};

export type RpaSessionMetadata = {
  account_tier?: string | null;
  last_login_at?: string | null;
  expires_at?: string | null;
  last_verified_at?: string | null;
};

export const RPA_SESSION_ENVELOPE_FORMAT = 'omnivyra.rpa_session.v1';

type SessionEnvelope = {
  format: typeof RPA_SESSION_ENVELOPE_FORMAT;
  alg: 'aes-256-gcm';
  ciphertext: string;
  /** Set only by a server-side verifier; a client-declared tier never sets it. */
  account_tier_verified: boolean;
};

const CIPHERTEXT_SHAPE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;

export function isEncryptedSessionEnvelope(value: unknown): value is SessionEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.format === RPA_SESSION_ENVELOPE_FORMAT
    && v.alg === 'aes-256-gcm'
    && typeof v.ciphertext === 'string'
    && CIPHERTEXT_SHAPE.test(v.ciphertext);
}

/** Legacy location of the plaintext copies this module used to write. */
function legacySessionPath(organizationId: string, platform: string): string {
  const dir = process.env.RPA_SESSION_DIR || path.join(process.cwd(), 'tmp', 'rpa-sessions');
  const safeOrg = organizationId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safePlatform = platform.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(dir, `${safeOrg}__${safePlatform}.json`);
}

async function removeLegacyPlaintextCopy(organizationId: string, platformLc: string): Promise<void> {
  try {
    await fs.unlink(legacySessionPath(organizationId, platformLc));
  } catch { /* missing file is the expected case */ }
}

export function sealRpaSession(
  organizationId: string,
  platform: string,
  state: PlaywrightStorageState,
): SessionEnvelope {
  const plaintext = JSON.stringify({
    organization_id: organizationId,
    platform: platform.toLowerCase(),
    state,
  });
  const ciphertext = encryptCredential(plaintext);
  if (!ciphertext || !CIPHERTEXT_SHAPE.test(ciphertext)) {
    throw new Error('RPA_SESSION_ENCRYPTION_FAILED');
  }
  return {
    format: RPA_SESSION_ENVELOPE_FORMAT,
    alg: 'aes-256-gcm',
    ciphertext,
    account_tier_verified: false,
  };
}

export function openRpaSession(
  envelope: unknown,
  organizationId: string,
  platform: string,
): PlaywrightStorageState | null {
  if (!isEncryptedSessionEnvelope(envelope)) {
    console.warn('[rpaSessionStore] RPA_SESSION_PLAINTEXT_REFUSED: re-authentication required', { organizationId, platform });
    return null;
  }
  let parsed: { organization_id?: unknown; platform?: unknown; state?: unknown };
  try {
    parsed = JSON.parse(decryptCredential(envelope.ciphertext));
  } catch {
    console.warn('[rpaSessionStore] RPA_SESSION_DECRYPT_FAILED', { organizationId, platform });
    return null;
  }
  if (parsed?.organization_id !== organizationId || parsed?.platform !== platform.toLowerCase()) {
    console.warn('[rpaSessionStore] RPA_SESSION_BINDING_MISMATCH', { organizationId, platform });
    return null;
  }
  const state = parsed.state as PlaywrightStorageState | null | undefined;
  if (!state || typeof state !== 'object') return null;
  return state;
}

export async function loadRpaSession(
  organizationId: string,
  platform: string,
): Promise<PlaywrightStorageState | null> {
  const platformLc = platform.toLowerCase();
  try {
    const { data, error } = await ownedDbTable('rpa_sessions')
      .select('storage_state, expires_at')
      .eq('organization_id', organizationId)
      .eq('platform', platformLc)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return null; // expired: no fallback of any kind
    }
    return openRpaSession(data.storage_state, organizationId, platformLc);
  } catch {
    return null;
  }
}

/**
 * Persist a storageState, encrypted, to rpa_sessions. Upserts on
 * (organization_id, platform). Throws when encryption or the write fails —
 * there is no plaintext fallback. A client-declared account tier is never
 * stored (`account_tier` is always written as null here).
 */
export async function saveRpaSession(
  organizationId: string,
  platform: string,
  state: PlaywrightStorageState,
  metadata?: RpaSessionMetadata,
): Promise<void> {
  const platformLc = platform.toLowerCase();
  const now = new Date().toISOString();
  const envelope = sealRpaSession(organizationId, platformLc, state);

  const { error } = await ownedDbTable('rpa_sessions').upsert(
    {
      organization_id: organizationId,
      platform: platformLc,
      storage_state: envelope,
      account_tier: null,
      last_login_at: metadata?.last_login_at ?? now,
      expires_at: metadata?.expires_at ?? null,
      last_verified_at: metadata?.last_verified_at ?? now,
      updated_at: now,
    },
    { onConflict: 'organization_id,platform' },
  );
  if (error) {
    throw new Error(`RPA_SESSION_PERSIST_FAILED:${(error as { message?: string }).message ?? 'unknown'}`);
  }

  await removeLegacyPlaintextCopy(organizationId, platformLc);
}

/**
 * Account-tier lookup used by the dispatch layer (Instagram business-only
 * check). Returns a tier ONLY when a server-side verifier marked it verified
 * (envelope.account_tier_verified === true). A self-declared tier — every
 * value written by the auth routes before this change — is ignored. Null
 * means "unknown"; the Instagram DM guard refuses unknown.
 */
export async function getRpaAccountTier(
  organizationId: string,
  platform: string,
): Promise<string | null> {
  try {
    const { data } = await ownedDbTable('rpa_sessions')
      .select('account_tier, storage_state')
      .eq('organization_id', organizationId)
      .eq('platform', platform.toLowerCase())
      .maybeSingle();
    if (!data) return null;
    const envelope = (data as { storage_state?: unknown }).storage_state;
    if (!isEncryptedSessionEnvelope(envelope) || envelope.account_tier_verified !== true) return null;
    return ((data as { account_tier?: string | null }).account_tier as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Purge a session (e.g. on revoke or on auth failure). Removes the DB row and
 * any legacy plaintext file.
 */
export async function deleteRpaSession(
  organizationId: string,
  platform: string,
): Promise<void> {
  const platformLc = platform.toLowerCase();
  try {
    await ownedDbTable('rpa_sessions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('platform', platformLc);
  } catch { /* swallow */ }
  await removeLegacyPlaintextCopy(organizationId, platformLc);
}
