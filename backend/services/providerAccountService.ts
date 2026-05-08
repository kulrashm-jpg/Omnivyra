import { ownedDbTable } from '../db/writeOwner';
/**
 * Provider Account Service
 *
 * Phase 1: Multi-account structure for external API providers.
 *
 * getActiveAccountForApi()   — fetch highest-priority active account for an API
 * resolveAccountCredentials() — extract usable credential fields from an account
 *
 * Credential shape stored in api_provider_accounts.credentials_encrypted (plain JSON,
 * not individually encrypted — the JSON value itself may contain references to
 * already-encrypted blobs that were originally in external_api_sources):
 *
 *   { "api_key_env_name": "YOUTUBE_API_KEY" }
 *   { "api_key_value": "<raw key>" }               ← SuperAdmin-entered literal
 *   { "oauth_client_id_ref": "<enc>",
 *     "oauth_client_secret_ref": "<enc>" }          ← reuse existing encrypted blobs
 *
 * The field `credentials_encrypted` is named for future encryption of the
 * whole JSON blob.  In Phase 1 it stores plain JSON to avoid a re-encryption
 * migration on existing OAuth blobs.
 */

import { supabase } from '../db/supabaseClient';
import { decryptCredential } from '../auth/credentialEncryption';

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
  /** Literal API key value (resolved from env var or entered directly) */
  api_key_value: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
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

  // Literal key value path (admin-entered raw key)
  if (typeof creds.api_key_value === 'string' && creds.api_key_value.trim()) {
    base.api_key_value = creds.api_key_value.trim();
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
