/**
 * Credential safety primitives (credential-management remediation).
 *
 * ONE module defining what a legitimate environment-variable NAME looks like, what a secret
 * looks like, and what an encrypted blob looks like — so every write path validates the same
 * way and every read path redacts the same way. Duplicating these rules per endpoint is how
 * the original defect survived: the field named `api_key_env_name` accepted anything, and
 * four live provider secrets were pasted into it and then served back by `select('*')`.
 *
 * This module handles secret SHAPES only. It never logs, returns or reproduces a secret
 * value, and callers must not either.
 */

/**
 * A legitimate environment-variable name. Deliberately strict: uppercase start, then
 * uppercase alphanumerics and underscores. Every real env var the platform references
 * (`SERP_API_KEY`, `OPENAI_API_KEY`, `PAGESPEED_API_KEY`, `GITHUB_TOKEN`, …) matches; no
 * API key the providers issue does, because real keys carry lowercase, hyphens or a
 * `sk-`/`AIza` style prefix.
 */
export const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Encrypted-credential shape produced by `encryptCredential`: ivHex(24):tagHex(32):cipherHex. */
export const ENCRYPTED_CREDENTIAL_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

/** Longest plausible env-var name. Anything longer is a secret, not a name. */
const MAX_ENV_VAR_NAME_LENGTH = 128;

export function isEnvVarName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ENV_VAR_NAME_LENGTH) return false;
  return ENV_VAR_NAME_PATTERN.test(trimmed);
}

export function isEncryptedCredential(value: unknown): boolean {
  return typeof value === 'string' && ENCRYPTED_CREDENTIAL_PATTERN.test(value.trim());
}

/**
 * Known secret prefixes/shapes, used ONLY to produce a more specific rejection message.
 * Rejection itself is driven by `isEnvVarName` failing — an allowlist, not a denylist — so
 * an unrecognised secret format is still rejected.
 */
const SECRET_SHAPE_HINTS: Array<{ test: RegExp; hint: string }> = [
  { test: /^sk-/i, hint: 'an OpenAI-style secret key' },
  { test: /^AIza/, hint: 'a Google API key' },
  { test: /^ghp_|^github_pat_/i, hint: 'a GitHub token' },
  { test: /^xox[baprs]-/i, hint: 'a Slack token' },
  { test: /^Bearer\s/i, hint: 'a bearer token' },
  { test: /^[0-9a-f]{32,}$/i, hint: 'a hexadecimal API key' },
  { test: /^[A-Za-z0-9_-]{20,}$/, hint: 'an API key' },
];

/** A short, non-reproducing description of why a value was rejected. NEVER echoes the value. */
export function describeRejectedEnvVarName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'A value is required.';
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_ENV_VAR_NAME_LENGTH) {
    return `This looks like a secret, not an environment-variable name (${trimmed.length} characters). Store the secret on the account's Credentials form instead.`;
  }
  for (const { test, hint } of SECRET_SHAPE_HINTS) {
    if (test.test(trimmed)) {
      return `This looks like ${hint}, not an environment-variable name. Environment-variable names must match ${ENV_VAR_NAME_PATTERN.source} (for example SERP_API_KEY). Store the secret itself on the account's Credentials form, where it is encrypted at rest.`;
    }
  }
  return `Environment-variable names must match ${ENV_VAR_NAME_PATTERN.source} (for example SERP_API_KEY). If you meant to store a secret value, use the account's Credentials form, where it is encrypted at rest.`;
}

/** Marker returned in place of a value that failed validation. Never the original. */
export const REDACTED_ENV_VAR_NAME = '__REDACTED_INVALID_ENV_VAR_NAME__';

/**
 * Read-path guard. Returns the value only when it is a legitimate env-var name; otherwise a
 * redaction marker.
 *
 * This is defence in depth for rows written before validation existed: even after migration,
 * a value that fails validation can never be served. Applied at the API boundary rather than
 * in the UI, because the UI is not the security boundary.
 */
export function redactEnvVarName(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isEnvVarName(value)) return String(value).trim();
  return REDACTED_ENV_VAR_NAME;
}

/**
 * Apply `redactEnvVarName` across one row or an array of rows, in place of a manual
 * `.map()` at every call site. Returns new objects; never mutates the input.
 */
export function redactApiSourceRow<T extends Record<string, unknown>>(row: T): T;
export function redactApiSourceRow<T extends Record<string, unknown>>(rows: T[]): T[];
export function redactApiSourceRow<T extends Record<string, unknown>>(input: T | T[]): T | T[] {
  if (Array.isArray(input)) return input.map((row) => redactApiSourceRow(row));
  if (!input || typeof input !== 'object') return input;
  if (!('api_key_env_name' in input)) return input;
  return { ...input, api_key_env_name: redactEnvVarName(input.api_key_env_name) } as T;
}

/**
 * Classify what a stored `credentials_encrypted.api_key_value` currently holds, for migration
 * decisions. Shape-only; the value is never returned.
 */
export type StoredKeyState = 'absent' | 'encrypted' | 'plaintext';

export function classifyStoredKey(value: unknown): StoredKeyState {
  if (typeof value !== 'string' || !value.trim()) return 'absent';
  return isEncryptedCredential(value) ? 'encrypted' : 'plaintext';
}
