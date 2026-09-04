/**
 * Credential remediation — inspection and migration.
 *
 * Two operations, both SHAPE-ONLY in what they report:
 *
 *   --inspect   read-only. Reports how many rows hold plaintext / ciphertext / env refs,
 *               and how many `external_api_sources.api_key_env_name` values fail env-var-name
 *               validation. Prints NO credential value, ever.
 *   --migrate   encrypts plaintext `api_key_value` in place using the existing
 *               `encryptCredential`, and clears secrets out of `api_key_env_name`.
 *
 * SAFETY PROPERTIES
 *  • No credential value is ever printed, logged or written to a file.
 *  • Migration is idempotent — an already-encrypted value is skipped, never double-encrypted.
 *  • Migration is reversible in the sense that no credential is DESTROYED: a secret found in
 *    `api_key_env_name` is moved to the account's encrypted envelope where one exists, and
 *    otherwise the row is FLAGGED for secure re-entry rather than silently cleared.
 *  • `--migrate` refuses to run without `--confirm`, so a stray invocation cannot mutate.
 *
 * Run:  npx tsx scripts/credential-remediation.ts --inspect
 *       npx tsx scripts/credential-remediation.ts --migrate --confirm
 */
import { createClient } from '@supabase/supabase-js';
import { encryptCredential } from '../backend/auth/credentialEncryption';
import {
  classifyStoredKey,
  isEnvVarName,
  isEncryptedCredential,
} from '../backend/security/credentialSafety';

type Mode = 'inspect' | 'migrate';

const argv = process.argv.slice(2);
const mode: Mode = argv.includes('--migrate') ? 'migrate' : 'inspect';
const confirmed = argv.includes('--confirm');

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function run(): Promise<void> {
  if (mode === 'migrate' && !confirmed) {
    console.error('Refusing to migrate without --confirm.');
    process.exit(1);
  }
  const db = client();

  // ── 1. external_api_sources.api_key_env_name ───────────────────────────────
  const { data: sources, error: sourcesError } = await db
    .from('external_api_sources')
    .select('id, name, api_key_env_name');
  if (sourcesError) throw new Error(`read external_api_sources: ${sourcesError.message}`);

  const poisoned = (sources ?? []).filter(
    (row) => row.api_key_env_name && !isEnvVarName(row.api_key_env_name),
  );

  console.log('=== external_api_sources.api_key_env_name ===');
  console.log(`  rows total                 : ${sources?.length ?? 0}`);
  console.log(`  valid env-var names        : ${(sources ?? []).filter((r) => isEnvVarName(r.api_key_env_name)).length}`);
  console.log(`  null / empty               : ${(sources ?? []).filter((r) => !r.api_key_env_name).length}`);
  console.log(`  CONTAINS SECRET-SHAPED DATA: ${poisoned.length}`);
  for (const row of poisoned) {
    // Provider name and length only — never the value, never a prefix.
    console.log(`    - provider="${row.name}" id=${row.id} length=${String(row.api_key_env_name).length}`);
  }

  // ── 2. api_provider_accounts.credentials_encrypted ─────────────────────────
  const { data: accounts, error: accountsError } = await db
    .from('api_provider_accounts')
    .select('id, account_name, api_source_id, credentials_encrypted');
  if (accountsError) throw new Error(`read api_provider_accounts: ${accountsError.message}`);

  let plaintextKeys = 0;
  let encryptedKeys = 0;
  let envRefs = 0;
  let oauthRefs = 0;
  const toEncrypt: Array<{ id: string; envelope: Record<string, string> }> = [];

  for (const account of accounts ?? []) {
    let creds: Record<string, unknown> = {};
    try {
      const raw = (account.credentials_encrypted ?? '').trim();
      if (raw && raw !== '{}') creds = JSON.parse(raw);
    } catch { /* unparseable → treated as empty */ }

    const state = classifyStoredKey(creds.api_key_value);
    if (state === 'plaintext') {
      plaintextKeys += 1;
      const envelope: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) if (typeof v === 'string' && v.trim()) envelope[k] = v;
      toEncrypt.push({ id: account.id, envelope });
    }
    if (state === 'encrypted') encryptedKeys += 1;
    if (typeof creds.api_key_env_name === 'string' && creds.api_key_env_name.trim()) envRefs += 1;
    if (typeof creds.oauth_client_secret_ref === 'string' || typeof creds.oauth_client_id_ref === 'string') oauthRefs += 1;
  }

  console.log('\n=== api_provider_accounts.credentials_encrypted ===');
  console.log(`  accounts total        : ${accounts?.length ?? 0}`);
  console.log(`  api_key_value ENCRYPTED: ${encryptedKeys}`);
  console.log(`  api_key_value PLAINTEXT: ${plaintextKeys}`);
  console.log(`  env-var references     : ${envRefs}`);
  console.log(`  OAuth refs (encrypted) : ${oauthRefs}`);

  if (mode === 'inspect') {
    console.log('\n(inspect only — nothing was modified)');
    return;
  }

  // ── 3. MIGRATE ─────────────────────────────────────────────────────────────
  console.log('\n=== MIGRATING ===');

  let encryptedCount = 0;
  for (const item of toEncrypt) {
    const value = item.envelope.api_key_value;
    if (!value || isEncryptedCredential(value)) continue; // idempotent
    const next = { ...item.envelope, api_key_value: encryptCredential(value) };
    const { error } = await db
      .from('api_provider_accounts')
      .update({ credentials_encrypted: JSON.stringify(next) })
      .eq('id', item.id);
    if (error) {
      console.error(`  FAILED account ${item.id}: ${error.message}`);
      continue;
    }
    encryptedCount += 1;
    console.log(`  encrypted api_key_value for account ${item.id}`);
  }
  console.log(`  accounts encrypted: ${encryptedCount}/${toEncrypt.length}`);

  // ── Secrets sitting in the NAME field — MOVE, then clear ───────────────────
  //
  // These are functionally LIVE, not dead data. `externalApi/internalHelpers.resolveEnvValue`
  // has a literal-key fallback: when the stored value does not look like an env-var name it
  // is returned AS the API key. That fallback is why pasting a secret here "worked", and why
  // the misuse went unnoticed. It also means clearing the field outright would BREAK these
  // integrations.
  //
  // So the migration relocates the secret into the owning account's ENCRYPTED envelope
  // first — where `resolveAccountCredentials` will find it via `acct.api_key_value`, which
  // already takes precedence over the source field — and only then clears the name field.
  // Where no account exists to receive it, nothing is cleared: the value is left in place
  // (the read-path redaction already prevents it being served) and reported for secure
  // re-entry. "No credential silently lost" outranks "field cleared".
  let relocated = 0;
  let cleared = 0;
  let needsManualReentry = 0;

  for (const row of poisoned) {
    const secret = String(row.api_key_env_name);

    const { data: accountRows } = await db
      .from('api_provider_accounts')
      .select('id, credentials_encrypted, is_active, priority')
      .eq('api_source_id', row.id)
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(1);
    const target = (accountRows ?? [])[0] as { id: string; credentials_encrypted: string } | undefined;

    if (!target) {
      needsManualReentry += 1;
      console.log(`  provider "${row.name}": NO active account to receive the credential — left in place, redacted on read. REQUIRES manual secure re-entry after rotation.`);
      continue;
    }

    let envelope: Record<string, string> = {};
    try {
      const raw = (target.credentials_encrypted ?? '').trim();
      if (raw && raw !== '{}') envelope = JSON.parse(raw);
    } catch { /* treated as empty */ }

    // Never overwrite an existing stored credential.
    if (envelope.api_key_value) {
      console.log(`  provider "${row.name}": account already holds a credential — source field cleared without relocation.`);
    } else {
      envelope.api_key_value = encryptCredential(secret);
      const { error: moveError } = await db
        .from('api_provider_accounts')
        .update({ credentials_encrypted: JSON.stringify(envelope) })
        .eq('id', target.id);
      if (moveError) {
        console.error(`  provider "${row.name}": FAILED to relocate credential (${moveError.message}) — source field NOT cleared.`);
        continue;
      }
      relocated += 1;
      console.log(`  provider "${row.name}": credential relocated to account ${target.id} (encrypted).`);
    }

    const { error: clearError } = await db
      .from('external_api_sources')
      .update({ api_key_env_name: null })
      .eq('id', row.id);
    if (clearError) {
      console.error(`  provider "${row.name}": FAILED to clear name field (${clearError.message}).`);
      continue;
    }
    cleared += 1;
  }

  console.log(`\n  relocated to encrypted storage : ${relocated}`);
  console.log(`  source name-fields cleared     : ${cleared}/${poisoned.length}`);
  console.log(`  requiring manual re-entry      : ${needsManualReentry}`);
  console.log('\nDone. Every affected credential was EXPOSED and must still be rotated externally,');
  console.log('then re-entered through the Credentials form. Relocation preserves service continuity only.');
}

run().catch((error) => {
  // Error messages from this script must never contain credential material.
  console.error('credential-remediation failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
