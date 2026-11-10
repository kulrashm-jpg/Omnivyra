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
 *   - Legacy plaintext rows are INVALIDATED at rest by migration
 *     20261231000010_rpa_legacy_session_invalidation: storage_state is
 *     replaced by the marker
 *       { format: 'omnivyra.rpa_session.invalidated', reason: 'legacy_plaintext', invalidated_at }
 *     A marker row is "re-login required" everywhere (worker, callback,
 *     platform health). A new login (saveRpaSession upsert) replaces it.
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
/** storage_state of a legacy plaintext row after the at-rest invalidation. */
export const RPA_SESSION_INVALIDATED_FORMAT = 'omnivyra.rpa_session.invalidated';

/** Why a stored session cannot be used; the organization must log in again. */
export type RpaSessionReauthReason =
  | 'expired'
  | 'invalidated'
  | 'legacy_plaintext'
  | 'undecryptable'
  | 'binding_mismatch';

export type RpaSessionRowStatus =
  | { status: 'connected' }
  | { status: 'reauth_required'; reason: RpaSessionReauthReason };

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

/** The marker written over a legacy plaintext row (no cookie material). */
export function isInvalidatedSessionMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).format === RPA_SESSION_INVALIDATED_FORMAT;
}

/**
 * Structural classification only (no decryption): why a non-envelope value is
 * unusable. Never inspects or returns any field other than `format`.
 */
export function structuralReauthReason(value: unknown): RpaSessionReauthReason | null {
  if (isEncryptedSessionEnvelope(value)) return null;
  return isInvalidatedSessionMarker(value) ? 'invalidated' : 'legacy_plaintext';
}

/** Directory of the legacy plaintext copies this module used to write. */
export function legacyRpaSessionDir(): string {
  return process.env.RPA_SESSION_DIR || path.join(process.cwd(), 'tmp', 'rpa-sessions');
}

/** Legacy location of the plaintext copies this module used to write. */
function legacySessionPath(organizationId: string, platform: string): string {
  const dir = legacyRpaSessionDir();
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

type OpenResult =
  | { ok: true; state: PlaywrightStorageState }
  | { ok: false; reason: RpaSessionReauthReason };

/**
 * Decrypt + binding check. Never logs; the caller decides what (non-secret)
 * reason to report. The decrypted state is returned only on success.
 */
function openRpaSessionDetailed(
  envelope: unknown,
  organizationId: string,
  platform: string,
): OpenResult {
  const structural = structuralReauthReason(envelope);
  if (structural) return { ok: false, reason: structural };
  let parsed: { organization_id?: unknown; platform?: unknown; state?: unknown };
  try {
    parsed = JSON.parse(decryptCredential((envelope as SessionEnvelope).ciphertext));
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }
  if (parsed?.organization_id !== organizationId || parsed?.platform !== platform.toLowerCase()) {
    return { ok: false, reason: 'binding_mismatch' };
  }
  const state = parsed.state as PlaywrightStorageState | null | undefined;
  if (!state || typeof state !== 'object') return { ok: false, reason: 'undecryptable' };
  return { ok: true, state };
}

const REFUSAL_CODE: Record<RpaSessionReauthReason, string> = {
  expired: 'RPA_SESSION_EXPIRED',
  invalidated: 'RPA_SESSION_INVALIDATED_REFUSED',
  legacy_plaintext: 'RPA_SESSION_PLAINTEXT_REFUSED',
  undecryptable: 'RPA_SESSION_DECRYPT_FAILED',
  binding_mismatch: 'RPA_SESSION_BINDING_MISMATCH',
};

export function openRpaSession(
  envelope: unknown,
  organizationId: string,
  platform: string,
): PlaywrightStorageState | null {
  const r = openRpaSessionDetailed(envelope, organizationId, platform);
  if (r.ok === false) {
    // Only identifiers and a fixed code are logged — never the stored value.
    console.warn(`[rpaSessionStore] ${REFUSAL_CODE[r.reason]}: re-authentication required`, { organizationId, platform });
    return null;
  }
  return r.state;
}

/**
 * Is this stored row a usable session for (organizationId, platform)?
 * `connected` only for an unexpired, valid encrypted envelope that decrypts
 * with the current key AND is bound to this organization + platform (the same
 * test the worker applies before launching a browser). Everything else is
 * `reauth_required` with a non-secret reason. Never logs; the decrypted state
 * is discarded before returning.
 *
 * Only `format`, `alg` and `ciphertext` of storage_state are consulted, so a
 * caller may pass a projection holding just those three fields.
 */
export function checkRpaSessionRow(
  row: { storage_state?: unknown; expires_at?: string | null },
  organizationId: string,
  platform: string,
  nowMs: number = Date.now(),
): RpaSessionRowStatus {
  const structural = structuralReauthReason(row.storage_state);
  if (structural) return { status: 'reauth_required', reason: structural };
  if (row.expires_at) {
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isFinite(exp) || exp < nowMs) return { status: 'reauth_required', reason: 'expired' };
  }
  const r = openRpaSessionDetailed(row.storage_state, organizationId, platform);
  if (r.ok === false) return { status: 'reauth_required', reason: r.reason };
  return { status: 'connected' };
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
      // Saving verifies nothing: only a real verifier may stamp this.
      last_verified_at: metadata?.last_verified_at ?? null,
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
