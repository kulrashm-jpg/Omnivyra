import { encryptCredential, decryptCredential } from '../auth/credentialEncryption';
import { ownedDbTable } from '../db/writeOwner';

export type CredentialMap = Record<string, string>;

export const SECRET_CONFIG_KEYS = new Set([
  'secret',
  'api_key',
  'app_password',
  'password',
  'access_token',
  'refresh_token',
  'client_secret',
  'webhook_secret',
  // Multi-provider CMS auth secrets (Ghost / Drupal / Joomla / Shopify).
  'admin_api_key',
  'api_token',
  'bearer_token',
  'shopify_access_token',
  // HubSpot / Wix.
  'wix_api_key',
]);

export function splitSecretConfig(config: Record<string, unknown> | null | undefined): {
  nonSecretConfig: Record<string, string>;
  credentials: CredentialMap;
} {
  const nonSecretConfig: Record<string, string> = {};
  const credentials: CredentialMap = {};

  for (const [key, rawValue] of Object.entries(config ?? {})) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue);
    if (SECRET_CONFIG_KEYS.has(key)) {
      if (value.trim()) credentials[key] = value;
    } else {
      nonSecretConfig[key] = value;
    }
  }

  return { nonSecretConfig, credentials };
}

export function maskCredentials(config: Record<string, string>): Record<string, string> {
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (SECRET_CONFIG_KEYS.has(key)) masked[key] = '********';
  }
  return masked;
}

/**
 * Raised when a caller asks for a credential belonging to another tenant.
 *
 * A distinct type, not a generic Error: a cross-tenant credential request is a
 * security event and must be distinguishable from "the connection is missing"
 * or "the database is unavailable" by anything that logs or alerts on it.
 */
export class CrossTenantCredentialError extends Error {
  constructor(readonly companyId: string, readonly connectionId: string) {
    super('connection does not belong to this company');
    this.name = 'CrossTenantCredentialError';
  }
}

/**
 * PHASE-1A / T-1 — the tenant gate every credential operation passes through.
 *
 * `integration_credentials` is keyed only by `connection_id`, so the tenant is
 * three hops away: credential → website_connection → website → company. Before
 * this existed, every function here took a bare `connectionId` and trusted the
 * caller to have checked ownership. That made tenant isolation a CONVENTION —
 * correct in all current callers, but one forgetful call site away from
 * decrypting another tenant's secret, and nothing in the type system would have
 * objected.
 *
 * Resolving ownership here rather than at the caller means the guarantee holds
 * for call sites that do not exist yet, which is the point: later phases will
 * add data-source and outreach providers to this same store.
 *
 * A missing connection is NOT a cross-tenant error — it is simply absent, and
 * callers already treat "no credentials" as a normal outcome.
 */
async function assertConnectionBelongsToCompany(
  companyId: string,
  connectionId: string,
): Promise<'ok' | 'missing'> {
  if (!companyId?.trim()) {
    throw new Error('companyId is required — credential access is never tenant-less');
  }
  if (!connectionId?.trim()) return 'missing';

  const { data, error } = await ownedDbTable('website_connections')
    .select('id, websites!inner(company_id)')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return 'missing';

  const owner = (data as { websites?: { company_id?: string } | Array<{ company_id?: string }> }).websites;
  const ownerCompanyId = Array.isArray(owner) ? owner[0]?.company_id : owner?.company_id;

  // An unresolvable owner is refused rather than allowed. A connection whose
  // website or company cannot be read is not proof of entitlement.
  if (!ownerCompanyId || ownerCompanyId !== companyId) {
    throw new CrossTenantCredentialError(companyId, connectionId);
  }
  return 'ok';
}

export async function upsertConnectionCredentials(
  companyId: string,
  connectionId: string,
  credentials: CredentialMap,
): Promise<void> {
  const entries = Object.entries(credentials).filter(([, value]) => value?.trim());
  if (entries.length === 0) return;

  // Ownership is proven BEFORE anything is written, so a cross-tenant write
  // cannot leave a partially-stored secret behind.
  if ((await assertConnectionBelongsToCompany(companyId, connectionId)) === 'missing') {
    throw new Error(`connection ${connectionId} not found`);
  }

  const rows = entries.map(([credential_key, value]) => ({
    connection_id: connectionId,
    credential_key,
    encrypted_value: encryptCredential(value),
    rotated_at: new Date().toISOString(),
  }));

  const { error } = await ownedDbTable('integration_credentials')
    .upsert(rows, { onConflict: 'connection_id,credential_key' });
  if (error) throw new Error(error.message);
}

export async function getConnectionCredentials(
  companyId: string,
  connectionId: string,
): Promise<CredentialMap> {
  // Decryption happens only after ownership is proven. A connection that does
  // not exist yields no credentials, exactly as before.
  if ((await assertConnectionBelongsToCompany(companyId, connectionId)) === 'missing') return {};

  const { data, error } = await ownedDbTable('integration_credentials')
    .select('credential_key, encrypted_value')
    .eq('connection_id', connectionId);
  if (error) throw new Error(error.message);

  const credentials: CredentialMap = {};
  for (const row of (data || []) as Array<{ credential_key: string; encrypted_value: string }>) {
    try {
      credentials[row.credential_key] = decryptCredential(row.encrypted_value);
    } catch {
      credentials[row.credential_key] = '';
    }
  }
  return credentials;
}

/* ───────────────────────────────────────────────────────────────────────────
 * A3M — the TENANT-OWNED PROVIDER branch.
 *
 * The functions above own a credential through a website connection, three
 * hops from the tenant (credential → website_connection → website → company).
 * A Prospect Intelligence provider has no website, and inventing a synthetic
 * `website_connections` row to hang one off would make that ownership chain a
 * fiction — a credential store whose ownership proof is fiction cannot be
 * audited. So a provider credential is owned DIRECTLY by the company.
 *
 * ─── WHY THE TENANT IS THE PREDICATE, NOT A PRE-CHECK ─────────────────────
 * The connection path must LOOK UP the owner and compare it, because the
 * caller supplies a connection id. Here the caller supplies a company id and a
 * provider key, and both are part of the WHERE clause — so a row belonging to
 * another tenant is not refused after being found, it is never found. There is
 * no id a caller could supply that reaches across tenants, which is a stronger
 * guarantee than a check, because there is no check to forget.
 *
 * `CrossTenantCredentialError` therefore does not arise on this path. Absence
 * and non-entitlement are deliberately the same answer — an empty map — for
 * the same reason `resolveCredential` returns null rather than throwing: a
 * caller learning WHY it cannot have a secret learns something about another
 * tenant's configuration.
 * ────────────────────────────────────────────────────────────────────────── */

/** Both keys are required. A tenant-less or provider-less lookup is refused. */
function requireProviderScope(companyId: string, providerKey: string): void {
  if (!companyId?.trim()) {
    throw new Error('companyId is required — credential access is never tenant-less');
  }
  if (!providerKey?.trim()) {
    throw new Error('providerKey is required — a credential is never provider-less');
  }
}

/**
 * Store (or replace) a tenant's credentials for one provider.
 *
 * `rotated_at` moves on every write, so replacement and rotation are the same
 * operation and neither leaves the previous secret behind.
 *
 * ─── WHY THIS IS NOT `.upsert()` ──────────────────────────────────────────
 * It was, and it could never have worked. The provider index is PARTIAL:
 *
 *   CREATE UNIQUE INDEX integration_credentials_provider_unique
 *     ON integration_credentials (company_id, provider_key, credential_key)
 *     WHERE company_id IS NOT NULL;
 *
 * PostgreSQL only accepts a partial index as an ON CONFLICT arbiter when the
 * statement RESTATES the index predicate, and PostgREST's `on_conflict=` can
 * carry a column list and nothing else. Inference therefore failed at PLAN
 * time with `42P10` — "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification" — for every provider and every tenant, which is
 * why this table has never held a single provider-scoped row.
 *
 * `upsertConnectionCredentials` above keeps its `.upsert()` deliberately: its
 * arbiter, `integration_credentials_connection_key_unique`, is NOT partial, so
 * inference succeeds there. The two paths differ because the indexes differ.
 *
 * So this uses the repository's established shape instead — INSERT, catch
 * `23505`, UPDATE — the same one `upsertSourceRecord`, `resolveOrCreateAccount`
 * and `persistClaims` use, and for the same reason: idempotency belongs to a
 * database constraint, never to a SELECT-then-INSERT that a concurrent writer
 * can slip between. Two racing rotations therefore yield one row, not two.
 *
 * ROTATION IS THE POINT, so the conflict branch must UPDATE. An insert-only
 * "skip if present" would accept a rotated key, report success, and leave the
 * revoked secret in place — the failure mode this comment exists to prevent.
 */
export async function upsertProviderCredentials(
  companyId: string,
  providerKey: string,
  credentials: CredentialMap,
): Promise<void> {
  requireProviderScope(companyId, providerKey);

  const entries = Object.entries(credentials).filter(([, value]) => value?.trim());
  if (entries.length === 0) return;

  for (const [credentialKey, value] of entries) {
    // Encrypted before it is ever handed to the driver, exactly as before. The
    // plaintext never reaches a row object, a log line or an error message.
    const encrypted = encryptCredential(value);
    const rotatedAt = new Date().toISOString();

    const insert = await ownedDbTable('integration_credentials').insert({
      company_id: companyId,
      provider_key: providerKey,
      // Provider credentials are tenant-scoped, never connection-scoped. NULL
      // here is what keeps them outside the website-path unique index.
      connection_id: null,
      credential_key: credentialKey,
      encrypted_value: encrypted,
      rotated_at: rotatedAt,
    });

    if (!insert.error) continue;

    const code = (insert.error as { code?: string }).code;
    if (code !== '23505') throw new Error(insert.error.message);

    // The row already exists — this write is a rotation, or another worker won
    // the race. Either way the tenant's intent is "this must be the credential
    // now", so the stored value is replaced rather than left alone.
    const update = await ownedDbTable('integration_credentials')
      .update({ encrypted_value: encrypted, rotated_at: rotatedAt })
      .eq('company_id', companyId)        // TENANT — never optional
      .eq('provider_key', providerKey)
      .eq('credential_key', credentialKey)
      .select('id');

    if (update.error) throw new Error(update.error.message);

    // A conflict that no row satisfies means the 23505 came from a constraint
    // this function does not own. Reporting success there would tell a tenant
    // their key was rotated when it was not, so it is raised instead.
    if (!((update.data as unknown[] | null)?.length)) {
      throw new Error(
        'integration_credentials: provider credential conflicted but no matching row could be updated',
      );
    }
  }
}

/**
 * Read a tenant's credentials for one provider. Absent ⇒ `{}`, never a throw.
 *
 * A value that fails to decrypt yields '' exactly as the connection path does:
 * a corrupt secret is an absent secret, and callers already treat an empty
 * credential as "not configured".
 */
export async function getProviderCredentials(
  companyId: string,
  providerKey: string,
): Promise<CredentialMap> {
  requireProviderScope(companyId, providerKey);

  const { data, error } = await ownedDbTable('integration_credentials')
    .select('credential_key, encrypted_value')
    .eq('company_id', companyId)
    .eq('provider_key', providerKey);
  if (error) throw new Error(error.message);

  const credentials: CredentialMap = {};
  for (const row of (data || []) as Array<{ credential_key: string; encrypted_value: string }>) {
    try {
      credentials[row.credential_key] = decryptCredential(row.encrypted_value);
    } catch {
      credentials[row.credential_key] = '';
    }
  }
  return credentials;
}

/**
 * Revoke a tenant's credentials for one provider.
 *
 * Deletes rather than blanking: an encrypted value nobody can reach is still a
 * secret at rest, and revocation should leave nothing to reach.
 */
export async function deleteProviderCredentials(
  companyId: string,
  providerKey: string,
): Promise<void> {
  requireProviderScope(companyId, providerKey);

  const { error } = await ownedDbTable('integration_credentials')
    .delete()
    .eq('company_id', companyId)
    .eq('provider_key', providerKey);
  if (error) throw new Error(error.message);
}

export async function mergeConnectionConfig(
  companyId: string,
  connectionId: string | null | undefined,
  nonSecretConfig: Record<string, string> | null | undefined,
  legacyConfig?: Record<string, string> | null,
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {
    ...(legacyConfig ?? {}),
    ...(nonSecretConfig ?? {}),
  };

  if (!connectionId) return merged;

  let credentials: CredentialMap;
  try {
    credentials = await getConnectionCredentials(companyId, connectionId);
  } catch (err) {
    // A cross-tenant request is RE-THROWN, never swallowed. This function is
    // deliberately forgiving about transient read failures — hydrating an
    // integration must not fail because the credential store blinked — but
    // "you asked for another tenant's secret" is not a transient failure and
    // must not be silently degraded into an empty config.
    if (err instanceof CrossTenantCredentialError) throw err;
    credentials = {};
  }

  return {
    ...merged,
    ...credentials,
  };
}
