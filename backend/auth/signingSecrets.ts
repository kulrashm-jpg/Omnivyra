/**
 * SEC91-B1 — server-only HMAC signing-secret resolution.
 *
 * Several self-contained token formats (extension session tokens + the per-session
 * request-signing secret derived from them, extension claim codes, RPA auth-bootstrap
 * tokens, invitation tokens) are HMAC-signed with a secret read from the environment.
 * Their resolvers used to end in fallbacks that are NOT secrets:
 *
 *   - the browser-public Supabase anon key (shipped in every page bundle), and
 *   - hard-coded literals committed to this repository,
 *
 * plus the Supabase service-role key (an API credential, not a signing key). Whenever the
 * dedicated secret and AUTH_SECRET were both unset, anyone who had read the source or
 * the page bundle could mint valid tokens.
 *
 * The rule now: a signing secret is resolved ONLY from the variables the caller names
 * (its dedicated variable, then AUTH_SECRET). If none is set, resolution FAILS CLOSED —
 * issuing throws `SigningSecretUnavailableError`, and verifiers treat that as "invalid".
 *
 * Compatibility: production resolves the same variable it resolved before (the dedicated
 * variable when set, else AUTH_SECRET), and the value is used verbatim, so every token
 * already issued keeps verifying. Only the unsafe tail of the chain was removed.
 *
 * Never log or return the resolved value; error messages name variables, never values.
 */

export class SigningSecretUnavailableError extends Error {
  readonly code = 'SIGNING_SECRET_UNAVAILABLE';
  readonly purpose: string;

  constructor(purpose: string, envNames: readonly string[]) {
    super(
      `SIGNING_SECRET_UNAVAILABLE: no server-only signing secret is configured for ${purpose}` +
        ` (set ${envNames.join(' or ')})`,
    );
    this.name = 'SigningSecretUnavailableError';
    this.purpose = purpose;
  }
}

export function isSigningSecretUnavailable(err: unknown): err is SigningSecretUnavailableError {
  return (
    err instanceof SigningSecretUnavailableError ||
    (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'SIGNING_SECRET_UNAVAILABLE')
  );
}

/**
 * Return the first configured secret among `envNames` (in order), or throw.
 *
 * A variable that is unset, empty or whitespace-only does not count. The value is returned
 * verbatim unless `trim` is set (callers that historically trimmed keep trimming, so the
 * derived HMAC key — and every token already issued with it — is unchanged).
 */
export function resolveSigningSecret(
  purpose: string,
  envNames: readonly string[],
  options: { trim?: boolean } = {},
): string {
  for (const name of envNames) {
    const raw = process.env[name];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    return options.trim ? raw.trim() : raw;
  }
  throw new SigningSecretUnavailableError(purpose, envNames);
}
