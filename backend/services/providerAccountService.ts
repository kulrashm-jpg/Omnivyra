import { ownedDbTable } from '../db/writeOwner';
/**
 * Provider Account Service
 *
 * Phase 1: Multi-account structure for external API providers.
 *
 * getActiveAccountForApi()   — fetch highest-priority active account for an API
 * resolveAccountCredentials() — extract usable credential fields from an account
 *
 * Credential shape stored in api_provider_accounts.credentials_encrypted — a JSON envelope
 * whose SECRET-BEARING fields are individually encrypted with `encryptCredential`
 * (AES-256-GCM). Non-secret fields (an env-var NAME) stay readable by design.
 *
 *   { "api_key_env_name": "YOUTUBE_API_KEY" }        ← a NAME, not a secret
 *   { "api_key_value": "<iv:tag:ciphertext>" }        ← ENCRYPTED admin-entered secret
 *   { "oauth_client_id_ref": "<iv:tag:ciphertext>",
 *     "oauth_client_secret_ref": "<iv:tag:ciphertext>" }
 *
 * REMEDIATION HISTORY: `api_key_value` was previously written and read as PLAINTEXT, in a
 * column named `credentials_encrypted`, while the OAuth fields beside it were encrypted.
 * It is now encrypted on write and decrypted only in `resolveAccountCredentials`, at the
 * moment a provider needs it. Legacy plaintext rows still resolve (so nothing breaks) but
 * are flagged via `legacy_plaintext_key` so they can be reported and re-entered.
 */

import { supabase } from '../db/supabaseClient';
import { decryptCredential, encryptCredential } from '../auth/credentialEncryption';
// Remediation: one shared definition of secret / env-var-name / ciphertext shapes.
import { classifyStoredKey, isEncryptedCredential } from '../security/credentialSafety';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ProviderAccount = {
  id: string;
  api_source_id: string;
  account_name: string;
  credentials_encrypted: string;  // JSON string (see header)
  rate_limit_per_min: number | null;
  rate_limit_per_day: number | null;
  current_usage_min: number;
  current_usage_day: number;
  last_reset_at: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Resolved, ready-to-use credential fields extracted from a ProviderAccount.
 * Mirrors the fields that buildExternalApiRequest() already understands.
 */
export type ResolvedAccountCredentials = {
  /** Source of resolution — for observability */
  source: 'account' | 'fallback';
  accountId: string | null;
  api_key_env_name: string | null;
  /** Literal API key value (resolved from env var, or decrypted from the stored credential). */
  api_key_value: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  /**
   * True when the stored key was LEGACY PLAINTEXT rather than ciphertext. A boolean only —
   * it never carries any part of the value. Lets the migration and health surfaces report
   * remaining plaintext without reading it.
   */
  legacy_plaintext_key?: boolean;
};

// ── Centralized resolution ────────────────────────────────────────────────────

/**
 * Phase 1 single-account resolution — kept for non-loop callers (test endpoints, etc.).
 * Production execution paths MUST use resolveAllAccountsForRequest() instead.
 */
export async function resolveAccountForRequest(apiSourceId: string): Promise<{
  accountId: string | null;
  credentials: ResolvedAccountCredentials | null;
  rateLimitPerMin: number | null;
}> {
  const account = await getActiveAccountForApi(apiSourceId);
  if (!account) {
    return { accountId: null, credentials: null, rateLimitPerMin: null };
  }
  return {
    accountId: account.id,
    credentials: resolveAccountCredentials(account),
    rateLimitPerMin: account.rate_limit_per_min ?? null,
  };
}

/**
 * Phase 2: Returns ALL active accounts for a provider, ordered by priority ASC.
 * The execution loop iterates this list and switches accounts on rate-limit / failure.
 * Returns empty array when no accounts exist → caller falls back to source-level credentials.
 */
export async function resolveAllAccountsForRequest(
  apiSourceId: string,
): Promise<ProviderAccount[]> {
  return getAllActiveAccountsForApi(apiSourceId);
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

/**
 * Return ALL active accounts for a given api_source_id, sorted by priority ASC.
 * Returns empty array if the table doesn't exist yet or no accounts are found.
 */
export async function getAllActiveAccountsForApi(
  apiSourceId: string,
): Promise<ProviderAccount[]> {
  try {
    const { data, error } = await ownedDbTable('api_provider_accounts')
      .select('*')
      .eq('api_source_id', apiSourceId)
      .eq('is_active', true)
      .order('priority', { ascending: true });

    if (error) {
      const msg = (error as { message?: string })?.message?.toLowerCase() ?? '';
      const isSchemaError =
        (msg.includes('relation') && msg.includes('does not exist')) ||
        msg.includes('could not find the table');
      if (isSchemaError && !(globalThis as any).__provider_accounts_schema_hint_shown) {
        (globalThis as any).__provider_accounts_schema_hint_shown = true;
        console.warn(
          'api_provider_accounts table not found. Run 20260509_api_provider_accounts.sql migration. Account resolution will fall back to source-level credentials.'
        );
      }
      return [];
    }

    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Return the highest-priority active account for a given api_source_id.
 * Returns null if the table doesn't exist yet or no accounts are found.
 * Used by Phase 1 single-account resolution and SuperAdmin tooling.
 */
export async function getActiveAccountForApi(
  apiSourceId: string,
): Promise<ProviderAccount | null> {
  try {
    const { data, error } = await ownedDbTable('api_provider_accounts')
      .select('*')
      .eq('api_source_id', apiSourceId)
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      const msg = (error as { message?: string })?.message?.toLowerCase() ?? '';
      const isSchemaError =
        msg.includes('relation') && msg.includes('does not exist') ||
        msg.includes('could not find the table');
      if (isSchemaError && !(globalThis as any).__provider_accounts_schema_hint_shown) {
        (globalThis as any).__provider_accounts_schema_hint_shown = true;
        console.warn(
          'api_provider_accounts table not found. Run 20260509_api_provider_accounts.sql migration. Account resolution will fall back to source-level credentials.'
        );
      }
      return null;
    }

    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * List all accounts for a provider (SuperAdmin use).
 */
export async function listAccountsForApi(
  apiSourceId: string,
): Promise<ProviderAccount[]> {
  const { data, error } = await ownedDbTable('api_provider_accounts')
    .select('*')
    .eq('api_source_id', apiSourceId)
    .order('priority', { ascending: true });

  if (error) {
    console.warn('listAccountsForApi failed', { apiSourceId, message: error.message });
    return [];
  }
  return data ?? [];
}

// ── Credential resolution ──────────────────────────────────────────────────────

/**
 * Parse stored credentials JSON and resolve to usable fields.
 * Never throws — returns nulls on any parse/decrypt error.
 */
export function resolveAccountCredentials(account: ProviderAccount): ResolvedAccountCredentials {
  const base: ResolvedAccountCredentials = {
    source: 'account',
    accountId: account.id,
    api_key_env_name: null,
    api_key_value: null,
    oauth_client_id: null,
    oauth_client_secret: null,
  };

  let creds: Record<string, unknown> = {};
  try {
    const raw = account.credentials_encrypted?.trim();
    if (raw && raw !== '{}' && raw !== '') {
      creds = JSON.parse(raw);
    }
  } catch {
    console.warn('providerAccountService: failed to parse credentials_encrypted', {
      accountId: account.id,
    });
    return base;
  }

  // api_key_env_name path
  if (typeof creds.api_key_env_name === 'string' && creds.api_key_env_name.trim()) {
    base.api_key_env_name = creds.api_key_env_name.trim();
    const val = process.env[base.api_key_env_name];
    if (val) base.api_key_value = val;
  }

  // Literal key value path (admin-entered raw key).
  //
  // REMEDIATION: this value is now ENCRYPTED at rest (`encryptCredential`), matching the
  // OAuth fields beside it. It was previously written and read as plaintext, in a column
  // named `credentials_encrypted`. Decryption happens HERE and only here — at the moment a
  // provider actually needs the credential — and the plaintext is never persisted back,
  // returned in an API response, or logged.
  //
  // Legacy plaintext is still accepted so a pre-migration row keeps working, but it is
  // flagged so the migration and the health surface can report it. Silently accepting it
  // forever is how the original defect persisted.
  if (typeof creds.api_key_value === 'string' && creds.api_key_value.trim()) {
    const stored = creds.api_key_value.trim();
    if (isEncryptedCredential(stored)) {
      try {
        base.api_key_value = decryptCredential(stored);
      } catch {
        // Never log the ciphertext or any fragment of it.
        console.warn('providerAccountService: failed to decrypt api_key_value', {
          accountId: account.id,
        });
      }
    } else {
      base.api_key_value = stored;
      base.legacy_plaintext_key = true;
    }
  }

  // OAuth refs — reuse existing encrypted blobs from external_api_sources
  if (
    typeof creds.oauth_client_id_ref === 'string' &&
    creds.oauth_client_id_ref.trim()
  ) {
    try {
      base.oauth_client_id = decryptCredential(creds.oauth_client_id_ref as string);
    } catch {
      console.warn('providerAccountService: failed to decrypt oauth_client_id_ref', {
        accountId: account.id,
      });
    }
  }

  if (
    typeof creds.oauth_client_secret_ref === 'string' &&
    creds.oauth_client_secret_ref.trim()
  ) {
    try {
      base.oauth_client_secret = decryptCredential(creds.oauth_client_secret_ref as string);
    } catch {
      console.warn('providerAccountService: failed to decrypt oauth_client_secret_ref', {
        accountId: account.id,
      });
    }
  }

  // Direct (already-decrypted) OAuth stored by SuperAdmin
  if (typeof creds.oauth_client_id === 'string' && creds.oauth_client_id.trim()) {
    base.oauth_client_id = creds.oauth_client_id.trim();
  }
  if (typeof creds.oauth_client_secret === 'string' && creds.oauth_client_secret.trim()) {
    base.oauth_client_secret = creds.oauth_client_secret.trim();
  }

  return base;
}

// ── CRUD (SuperAdmin only — enforcement in the API layer) ─────────────────────

export async function createProviderAccount(input: {
  api_source_id: string;
  account_name: string;
  credentials_encrypted: string;
  rate_limit_per_min?: number | null;
  rate_limit_per_day?: number | null;
  priority?: number;
}): Promise<ProviderAccount> {
  const { data, error } = await ownedDbTable('api_provider_accounts')
    .insert({
      api_source_id:        input.api_source_id,
      account_name:         input.account_name,
      credentials_encrypted: input.credentials_encrypted,
      rate_limit_per_min:   input.rate_limit_per_min ?? null,
      rate_limit_per_day:   input.rate_limit_per_day ?? null,
      priority:             input.priority ?? 1,
      is_active:            true,
    })
    .select()
    .single();

  if (error) throw new Error(`createProviderAccount: ${error.message}`);
  return data as ProviderAccount;
}

export async function updateProviderAccount(
  id: string,
  patch: Partial<Pick<
    ProviderAccount,
    'account_name' | 'credentials_encrypted' | 'rate_limit_per_min' | 'rate_limit_per_day' | 'priority' | 'is_active'
  >>
): Promise<ProviderAccount> {
  const { data, error } = await ownedDbTable('api_provider_accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`updateProviderAccount: ${error.message}`);
  return data as ProviderAccount;
}

/** Soft delete — sets is_active=false */
export async function deactivateProviderAccount(id: string): Promise<void> {
  const { error } = await ownedDbTable('api_provider_accounts')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`deactivateProviderAccount: ${error.message}`);
}

// ── Credential envelope (write path) ──────────────────────────────────────────

/**
 * Build the stored credential envelope from admin-supplied fields, MERGING onto whatever is
 * already stored.
 *
 * Two defects are fixed here, and both are fixed once rather than per-endpoint:
 *
 *  1. ENCRYPTION — `api_key_value` is encrypted with the same `encryptCredential` used for
 *     the OAuth fields. Previously it was written verbatim into a column named
 *     `credentials_encrypted`.
 *  2. MERGE — the PUT path previously did `credentials_encrypted = JSON.stringify(new)`,
 *     replacing the whole envelope. Editing an account and submitting only
 *     `api_key_env_name` silently destroyed the stored secret. Only fields the caller
 *     actually supplied are changed now; everything else is carried forward.
 *
 * Never logs, returns or echoes a secret. Throws only on encryption failure, so a caller can
 * fail closed rather than storing plaintext.
 */
export function buildCredentialEnvelope(params: {
  /** The account's existing `credentials_encrypted` JSON string, or null when creating. */
  existing?: string | null;
  /** Admin-supplied fields. Absent keys are left untouched; empty strings are ignored. */
  supplied: Record<string, unknown>;
}): string {
  const next: Record<string, string> = {};

  // Start from what is already stored so an unrelated edit cannot drop a credential.
  if (params.existing) {
    try {
      const parsed = JSON.parse(params.existing) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim()) next[key] = value;
      }
    } catch {
      // An unparseable envelope is treated as empty rather than propagated.
    }
  }

  const supplied = params.supplied ?? {};
  const provided = (key: string): string | null => {
    const value = supplied[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  // Env-var NAME — not a secret, stored readable. Validated by the API layer.
  const envName = provided('api_key_env_name');
  if (envName) next.api_key_env_name = envName;

  // Secret — encrypted. Already-encrypted input is passed through unchanged so a
  // round-trip cannot double-encrypt.
  const keyValue = provided('api_key_value');
  if (keyValue) {
    next.api_key_value = isEncryptedCredential(keyValue) ? keyValue : encryptCredential(keyValue);
  }

  // OAuth — unchanged behaviour, preserved exactly.
  const clientId = provided('oauth_client_id');
  const clientIdRef = provided('oauth_client_id_ref');
  if (clientIdRef) next.oauth_client_id_ref = clientIdRef;
  else if (clientId) next.oauth_client_id_ref = encryptCredential(clientId);

  const clientSecret = provided('oauth_client_secret');
  const clientSecretRef = provided('oauth_client_secret_ref');
  if (clientSecretRef) next.oauth_client_secret_ref = clientSecretRef;
  else if (clientSecret) next.oauth_client_secret_ref = encryptCredential(clientSecret);

  return JSON.stringify(next);
}

/**
 * Shape-only description of what an account stores — for migration and health reporting.
 * Returns booleans and states, never a credential value.
 */
export function describeAccountCredentialState(account: Pick<ProviderAccount, 'id' | 'credentials_encrypted'>): {
  accountId: string;
  keyState: ReturnType<typeof classifyStoredKey>;
  hasEnvRef: boolean;
  hasOauthRef: boolean;
} {
  let creds: Record<string, unknown> = {};
  try {
    const raw = account.credentials_encrypted?.trim();
    if (raw && raw !== '{}') creds = JSON.parse(raw);
  } catch { /* treated as empty */ }
  return {
    accountId: account.id,
    keyState: classifyStoredKey(creds.api_key_value),
    hasEnvRef: typeof creds.api_key_env_name === 'string' && Boolean(creds.api_key_env_name.trim()),
    hasOauthRef: typeof creds.oauth_client_secret_ref === 'string' || typeof creds.oauth_client_id_ref === 'string',
  };
}
