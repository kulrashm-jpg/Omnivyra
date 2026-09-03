/**
 * Credential-management remediation — security regression suite.
 *
 * Every credential in this file is a PLACEHOLDER. No real secret appears here, and the
 * assertions are written so that a real one could not be introduced without failing review.
 *
 * The invariants under test are the ones whose absence caused the incident: a name field that
 * accepted secrets, a column named `credentials_encrypted` that held plaintext, a PUT that
 * destroyed credentials, and a read path that served everything.
 */
import {
  ENV_VAR_NAME_PATTERN,
  REDACTED_ENV_VAR_NAME,
  classifyStoredKey,
  describeRejectedEnvVarName,
  isEncryptedCredential,
  isEnvVarName,
  redactApiSourceRow,
  redactEnvVarName,
} from '../../security/credentialSafety';
import {
  buildCredentialEnvelope,
  describeAccountCredentialState,
  resolveAccountCredentials,
  type ProviderAccount,
} from '../../services/providerAccountService';
import { decryptCredential, encryptCredential } from '../../auth/credentialEncryption';

// ── Placeholders ONLY. Shaped like real secrets so the shape-detectors are exercised. ──
const PLACEHOLDER_KEY = 'placeholder-secret-value-not-real-0000';
const PLACEHOLDER_OPENAI_SHAPE = 'sk-placeholderNotARealKey000000000000';
const PLACEHOLDER_GOOGLE_SHAPE = 'AIzaPlaceholderNotARealKey0000000000';
const PLACEHOLDER_HEX_SHAPE = 'a'.repeat(32);

/** A 32-byte key so encrypt/decrypt work in-test without touching production config. */
const TEST_ENCRYPTION_KEY = 'f'.repeat(64);

beforeAll(() => { process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY; });

const account = (credentials: Record<string, string>): ProviderAccount => ({
  id: 'acct-1', api_source_id: 'src-1', account_name: 'default',
  credentials_encrypted: JSON.stringify(credentials),
  rate_limit_per_min: null, rate_limit_per_day: null,
  current_usage_min: 0, current_usage_day: 0, last_reset_at: '', priority: 1,
  is_active: true, created_at: '', updated_at: '',
});

// ── Secret-shaped input rejection ─────────────────────────────────────────────

describe('remediation — env-var-name validation', () => {
  it('accepts legitimate environment-variable names', () => {
    for (const name of ['SERP_API_KEY', 'OPENAI_API_KEY', 'PAGESPEED_API_KEY', 'GITHUB_TOKEN', 'A']) {
      expect(isEnvVarName(name)).toBe(true);
      expect(ENV_VAR_NAME_PATTERN.test(name)).toBe(true);
    }
  });

  it('REJECTS secret-shaped input — the exact defect that caused the incident', () => {
    for (const secret of [PLACEHOLDER_OPENAI_SHAPE, PLACEHOLDER_GOOGLE_SHAPE, PLACEHOLDER_HEX_SHAPE, PLACEHOLDER_KEY]) {
      expect(isEnvVarName(secret)).toBe(false);
    }
  });

  it('rejects lowercase, hyphens, spaces and over-long values', () => {
    for (const bad of ['serp_api_key', 'SERP-API-KEY', 'SERP KEY', '1KEY', 'K'.repeat(200)]) {
      expect(isEnvVarName(bad)).toBe(false);
    }
  });

  it('rejection messages describe the shape and NEVER echo the value', () => {
    for (const secret of [PLACEHOLDER_OPENAI_SHAPE, PLACEHOLDER_GOOGLE_SHAPE, PLACEHOLDER_KEY]) {
      const message = describeRejectedEnvVarName(secret);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(secret);
      // Not even a fragment.
      expect(message).not.toContain(secret.slice(0, 12));
    }
  });

  it('names the likely secret type to help the operator', () => {
    expect(describeRejectedEnvVarName(PLACEHOLDER_OPENAI_SHAPE)).toContain('OpenAI');
    expect(describeRejectedEnvVarName(PLACEHOLDER_GOOGLE_SHAPE)).toContain('Google');
  });
});

// ── Read-path redaction ───────────────────────────────────────────────────────

describe('remediation — response redaction', () => {
  it('passes through a valid env-var name unchanged', () => {
    expect(redactEnvVarName('SERP_API_KEY')).toBe('SERP_API_KEY');
  });

  it('REDACTS any value that is not a valid env-var name', () => {
    for (const secret of [PLACEHOLDER_OPENAI_SHAPE, PLACEHOLDER_GOOGLE_SHAPE, PLACEHOLDER_HEX_SHAPE]) {
      expect(redactEnvVarName(secret)).toBe(REDACTED_ENV_VAR_NAME);
    }
  });

  it('redacts across a row set — a poisoned row cannot be served', () => {
    const rows = [
      { id: '1', name: 'Good', api_key_env_name: 'SERP_API_KEY' },
      { id: '2', name: 'Poisoned', api_key_env_name: PLACEHOLDER_OPENAI_SHAPE },
    ];
    const redacted = redactApiSourceRow(rows);
    expect(redacted[0].api_key_env_name).toBe('SERP_API_KEY');
    expect(redacted[1].api_key_env_name).toBe(REDACTED_ENV_VAR_NAME);
    // The serialized response must not contain the secret anywhere.
    expect(JSON.stringify(redacted)).not.toContain(PLACEHOLDER_OPENAI_SHAPE);
    // And the input must not be mutated.
    expect(rows[1].api_key_env_name).toBe(PLACEHOLDER_OPENAI_SHAPE);
  });

  it('leaves null and rows without the field alone', () => {
    expect(redactEnvVarName(null)).toBeNull();
    expect(redactApiSourceRow({ id: '1' } as Record<string, unknown>)).toEqual({ id: '1' });
  });
});

// ── Encryption at rest ────────────────────────────────────────────────────────

describe('remediation — api_key_value encrypted at rest', () => {
  it('encrypts a supplied key — the stored blob is not the plaintext', () => {
    const envelope = buildCredentialEnvelope({ existing: null, supplied: { api_key_value: PLACEHOLDER_KEY } });
    expect(envelope).not.toContain(PLACEHOLDER_KEY);
    const parsed = JSON.parse(envelope);
    expect(isEncryptedCredential(parsed.api_key_value)).toBe(true);
    expect(classifyStoredKey(parsed.api_key_value)).toBe('encrypted');
  });

  it('round-trips: what is decrypted at runtime equals what was entered', () => {
    const envelope = buildCredentialEnvelope({ existing: null, supplied: { api_key_value: PLACEHOLDER_KEY } });
    const resolved = resolveAccountCredentials(account(JSON.parse(envelope)));
    expect(resolved.api_key_value).toBe(PLACEHOLDER_KEY);
    expect(resolved.legacy_plaintext_key).toBeUndefined();
  });

  it('does NOT double-encrypt an already-encrypted value', () => {
    const once = JSON.parse(buildCredentialEnvelope({ existing: null, supplied: { api_key_value: PLACEHOLDER_KEY } }));
    const twice = JSON.parse(buildCredentialEnvelope({ existing: null, supplied: { api_key_value: once.api_key_value } }));
    expect(twice.api_key_value).toBe(once.api_key_value);
    expect(decryptCredential(twice.api_key_value)).toBe(PLACEHOLDER_KEY);
  });

  it('stores an env-var NAME readable — it is not a secret', () => {
    const envelope = JSON.parse(buildCredentialEnvelope({ existing: null, supplied: { api_key_env_name: 'SERP_API_KEY' } }));
    expect(envelope.api_key_env_name).toBe('SERP_API_KEY');
  });

  it('encrypts OAuth fields exactly as before — no regression', () => {
    const envelope = JSON.parse(buildCredentialEnvelope({
      existing: null,
      supplied: { oauth_client_id: 'placeholder-client-id', oauth_client_secret: 'placeholder-client-secret' },
    }));
    expect(isEncryptedCredential(envelope.oauth_client_id_ref)).toBe(true);
    expect(isEncryptedCredential(envelope.oauth_client_secret_ref)).toBe(true);
    const resolved = resolveAccountCredentials(account(envelope));
    expect(resolved.oauth_client_id).toBe('placeholder-client-id');
    expect(resolved.oauth_client_secret).toBe('placeholder-client-secret');
  });

  it('legacy plaintext still resolves but is FLAGGED, not silently accepted', () => {
    const resolved = resolveAccountCredentials(account({ api_key_value: PLACEHOLDER_KEY }));
    expect(resolved.api_key_value).toBe(PLACEHOLDER_KEY);
    expect(resolved.legacy_plaintext_key).toBe(true);
  });
});

// ── Partial update must preserve credentials ──────────────────────────────────

describe('remediation — PUT merge preserves credentials', () => {
  const existing = buildCredentialEnvelope({
    existing: null,
    supplied: {
      api_key_env_name: 'SERP_API_KEY',
      api_key_value: PLACEHOLDER_KEY,
      oauth_client_secret: 'placeholder-client-secret',
    },
  });

  it('editing ONLY the env-var name preserves the stored secret', () => {
    // This is the exact scenario that previously destroyed the credential.
    const merged = buildCredentialEnvelope({ existing, supplied: { api_key_env_name: 'SERPAPI_API_KEY' } });
    const parsed = JSON.parse(merged);
    expect(parsed.api_key_env_name).toBe('SERPAPI_API_KEY');
    expect(parsed.api_key_value).toBe(JSON.parse(existing).api_key_value);
    expect(resolveAccountCredentials(account(parsed)).api_key_value).toBe(PLACEHOLDER_KEY);
  });

  it('supplying NO credential fields preserves everything', () => {
    // Editing priority / quota / active / name sends no credential fields at all.
    const merged = JSON.parse(buildCredentialEnvelope({ existing, supplied: {} }));
    expect(merged).toEqual(JSON.parse(existing));
  });

  it('empty strings are ignored, not treated as a deletion', () => {
    const merged = JSON.parse(buildCredentialEnvelope({ existing, supplied: { api_key_value: '   ' } }));
    expect(merged.api_key_value).toBe(JSON.parse(existing).api_key_value);
  });

  it('rotating the secret replaces only the secret', () => {
    const rotated = JSON.parse(buildCredentialEnvelope({ existing, supplied: { api_key_value: 'placeholder-rotated-value' } }));
    expect(rotated.api_key_env_name).toBe('SERP_API_KEY');
    expect(rotated.oauth_client_secret_ref).toBe(JSON.parse(existing).oauth_client_secret_ref);
    expect(resolveAccountCredentials(account(rotated)).api_key_value).toBe('placeholder-rotated-value');
  });

  it('an unparseable existing envelope does not lose the new credential', () => {
    const merged = JSON.parse(buildCredentialEnvelope({ existing: 'not json', supplied: { api_key_value: PLACEHOLDER_KEY } }));
    expect(isEncryptedCredential(merged.api_key_value)).toBe(true);
  });
});

// ── Credential resolution + precedence ────────────────────────────────────────

describe('remediation — credential resolution precedence', () => {
  const ENV_NAME = 'TEST_REMEDIATION_KEY_NAME';
  afterEach(() => { delete process.env[ENV_NAME]; });

  it('resolves from the environment when only an env-var name is stored', () => {
    process.env[ENV_NAME] = 'placeholder-env-value';
    const resolved = resolveAccountCredentials(account({ api_key_env_name: ENV_NAME }));
    expect(resolved.api_key_value).toBe('placeholder-env-value');
  });

  it('a stored encrypted secret OVERRIDES the environment variable', () => {
    process.env[ENV_NAME] = 'placeholder-env-value';
    const envelope = JSON.parse(buildCredentialEnvelope({
      existing: null,
      supplied: { api_key_env_name: ENV_NAME, api_key_value: PLACEHOLDER_KEY },
    }));
    const resolved = resolveAccountCredentials(account(envelope));
    expect(resolved.api_key_value).toBe(PLACEHOLDER_KEY);
  });

  it('yields null when neither source supplies a value', () => {
    const resolved = resolveAccountCredentials(account({ api_key_env_name: ENV_NAME }));
    expect(resolved.api_key_value).toBeNull();
  });

  it('never throws on malformed stored credentials', () => {
    for (const raw of ['', '{}', 'not json', '{"api_key_value":123}']) {
      const acct = { ...account({}), credentials_encrypted: raw };
      expect(() => resolveAccountCredentials(acct)).not.toThrow();
    }
  });

  it('a corrupt ciphertext yields null rather than leaking or crashing', () => {
    const resolved = resolveAccountCredentials(account({
      api_key_value: 'aaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccc',
    }));
    expect(resolved.api_key_value).toBeNull();
  });
});

// ── Shape-only reporting ──────────────────────────────────────────────────────

describe('remediation — state reporting never exposes values', () => {
  it('describes credential state without returning any credential', () => {
    const envelope = buildCredentialEnvelope({
      existing: null,
      supplied: { api_key_env_name: 'SERP_API_KEY', api_key_value: PLACEHOLDER_KEY },
    });
    const state = describeAccountCredentialState({ id: 'acct-1', credentials_encrypted: envelope });
    expect(state).toEqual({ accountId: 'acct-1', keyState: 'encrypted', hasEnvRef: true, hasOauthRef: false });
    expect(JSON.stringify(state)).not.toContain(PLACEHOLDER_KEY);
  });

  it('classifies plaintext vs encrypted vs absent', () => {
    expect(classifyStoredKey(undefined)).toBe('absent');
    expect(classifyStoredKey('')).toBe('absent');
    expect(classifyStoredKey(PLACEHOLDER_KEY)).toBe('plaintext');
    expect(classifyStoredKey(encryptCredential(PLACEHOLDER_KEY))).toBe('encrypted');
  });
});
