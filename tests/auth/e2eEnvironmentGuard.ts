/**
 * Fail-closed environment guard for the Auth-Integrity E2E suite.
 *
 * The suite creates, confirms and DELETES real Supabase users via the admin API.
 * It must therefore only ever run against the dedicated, non-production E2E
 * project. Historically the harness loaded `.env.local`, which points at the
 * production project (see PHASE 146 audit) — this module makes that impossible.
 *
 * The guard is deliberately dependency-free and side-effect-free so it can be
 * unit-tested without any network access or E2E credentials.
 *
 * Secrets are never included in error messages. Project refs and hostnames are
 * public identifiers (they already appear in `.mcp.json`) and are safe to log.
 */

/** Supabase project refs that must NEVER be targeted by the E2E suite. */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ['klkiseupptzbecbxwrky'];

/** Hostnames that must NEVER be targeted by the E2E suite. */
export const PRODUCTION_HOSTNAMES: readonly string[] = [
  'klkiseupptzbecbxwrky.supabase.co',
  'klkiseupptzbecbxwrky.supabase.in',
];

/** The dedicated E2E project this suite is allowed to target. */
export const DEFAULT_EXPECTED_E2E_PROJECT_REF = 'lomndxmrpyudaegddpef';

/** Hosts that indicate placeholder / dry-run CI configuration. */
const PLACEHOLDER_HOSTNAMES: readonly string[] = [
  'placeholder.supabase.co',
  'example.supabase.co',
  'dry-run',
  'example.com',
];

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

const PLACEHOLDER_KEY_MARKERS: readonly string[] = [
  'placeholder',
  'dry-run',
  'changeme',
  'your-service-role-key',
];

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

/**
 * Loads the E2E-specific env file (default `.env.e2e`, gitignored) if present.
 * NEVER loads `.env.local`: that file points at production. When the file is
 * absent — as in CI — the caller relies on real environment variables, and the
 * guard below still rejects anything that is not the dedicated E2E project.
 *
 * The file is authoritative when present, so a stray exported SUPABASE_URL in a
 * developer's shell cannot silently redirect the suite.
 */
export function loadE2EEnvFile(dotenvConfig: (opts: { path: string; override: boolean }) => unknown): string | null {
  const file = process.env.AUTH_E2E_ENV_FILE || '.env.e2e';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  if (!existsSync(file)) return null;
  dotenvConfig({ path: file, override: true });
  return file;
}

export class E2EEnvironmentError extends Error {
  constructor(message: string) {
    super(`[auth-e2e guard] ${message}`);
    this.name = 'E2EEnvironmentError';
  }
}

export type E2EGuardInput = {
  supabaseUrl?: string | null;
  serviceRoleKey?: string | null;
  /** Pass `null` to disable the allowlist check (denylist still applies). */
  expectedProjectRef?: string | null;
};

export type E2EGuardResult = {
  projectRef: string;
  hostname: string;
  /** Safe, secret-free description for logging. */
  description: string;
};

/** Extracts the Supabase project ref from a project URL, or null if not derivable. */
export function extractProjectRef(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const [firstLabel] = parsed.hostname.split('.');
  if (!firstLabel || !PROJECT_REF_PATTERN.test(firstLabel)) return null;
  return firstLabel;
}

function isProductionTarget(projectRef: string | null, hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (PRODUCTION_HOSTNAMES.some((h) => h.toLowerCase() === host)) return true;
  if (projectRef && PRODUCTION_PROJECT_REFS.includes(projectRef)) return true;
  // Defence in depth: a production ref appearing anywhere in the host.
  return PRODUCTION_PROJECT_REFS.some((ref) => host.includes(ref));
}

/**
 * Validates that the supplied Supabase configuration targets the dedicated,
 * non-production E2E project. Throws `E2EEnvironmentError` on any doubt.
 *
 * Fail-closed: every unrecognised, empty, malformed, local, placeholder or
 * production-looking configuration is rejected. There is no permissive path.
 */
export function assertNonProductionE2EEnvironment(input: E2EGuardInput): E2EGuardResult {
  const rawUrl = typeof input.supabaseUrl === 'string' ? input.supabaseUrl.trim() : '';
  const rawKey = typeof input.serviceRoleKey === 'string' ? input.serviceRoleKey.trim() : '';

  if (!rawUrl) {
    throw new E2EEnvironmentError(
      'no Supabase URL configured. Set E2E_SUPABASE_URL (or SUPABASE_URL) from .env.e2e — the suite refuses to guess.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new E2EEnvironmentError('Supabase URL is malformed and cannot be parsed as a URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new E2EEnvironmentError(`unsupported Supabase URL protocol "${parsed.protocol}".`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new E2EEnvironmentError('Supabase URL has no hostname.');
  }

  const projectRef = extractProjectRef(rawUrl);

  // ---- Production rejection (denylist). Must run before any admin API use. ----
  if (isProductionTarget(projectRef, hostname)) {
    throw new E2EEnvironmentError(
      `refusing to run against the PRODUCTION Supabase project (host "${hostname}"). ` +
        'The Auth-Integrity suite creates and deletes real users. Point it at the dedicated E2E project.',
    );
  }

  if (PLACEHOLDER_HOSTNAMES.includes(hostname)) {
    throw new E2EEnvironmentError(
      `Supabase URL "${hostname}" is a placeholder. A real dedicated E2E project is required.`,
    );
  }

  if (LOCAL_HOSTNAMES.includes(hostname) || hostname.endsWith('.local')) {
    throw new E2EEnvironmentError(
      `Supabase URL "${hostname}" is a local instance. The Auth-Integrity suite requires the dedicated hosted E2E project.`,
    );
  }

  if (!hostname.endsWith('.supabase.co') && !hostname.endsWith('.supabase.in')) {
    throw new E2EEnvironmentError(
      `Supabase URL host "${hostname}" is not a recognised Supabase project host.`,
    );
  }

  if (!projectRef) {
    throw new E2EEnvironmentError(
      `could not derive a Supabase project ref from host "${hostname}".`,
    );
  }

  // ---- Expected-project rejection (allowlist). ----
  const expected =
    input.expectedProjectRef === undefined
      ? DEFAULT_EXPECTED_E2E_PROJECT_REF
      : input.expectedProjectRef;
  if (expected && projectRef !== expected) {
    throw new E2EEnvironmentError(
      `Supabase project ref "${projectRef}" is not the expected E2E project "${expected}".`,
    );
  }

  // ---- Credential presence (value never logged). ----
  if (!rawKey) {
    throw new E2EEnvironmentError(
      'no Supabase service-role key configured for the E2E project.',
    );
  }
  const loweredKey = rawKey.toLowerCase();
  if (PLACEHOLDER_KEY_MARKERS.some((marker) => loweredKey.includes(marker))) {
    throw new E2EEnvironmentError('Supabase service-role key looks like a placeholder value.');
  }

  return {
    projectRef,
    hostname,
    description: `E2E project ${projectRef} (${hostname})`,
  };
}
