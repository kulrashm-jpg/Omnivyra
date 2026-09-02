/**
 * Supabase new API-key migration — contract and secret-boundary tests.
 *
 * Pins three things the migration must not silently lose:
 *   1. Resolution precedence: the canonical variable wins; the legacy variable
 *      is a fallback, not a peer.
 *   2. The secret boundary: no client-reachable file names a server credential,
 *      and no NEXT_PUBLIC_* variable is ever fed from the server key.
 *   3. No unexplained runtime dependency on the legacy variables — the set of
 *      runtime files still naming them is closed and enumerated here, so a new
 *      one fails this test rather than slipping through review.
 */
import fs from 'fs';
import path from 'path';

import {
  resolveSupabaseSecretKey,
  hasSupabaseSecretKey,
  requireSupabaseSecretKey,
  SECRET_KEY_VAR,
  LEGACY_SECRET_KEY_VAR,
} from '../../db/supabaseKeys';
import {
  resolveSupabasePublishableKey,
  PUBLISHABLE_KEY_VAR,
  LEGACY_PUBLISHABLE_KEY_VAR,
} from '../../../lib/supabase/publishableKey';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Build a ProcessEnv for the resolver under test. NODE_ENV is required by the
 * Next.js ProcessEnv augmentation, so it is supplied rather than cast away —
 * a struct-to-ProcessEnv assertion would hide exactly that kind of drift.
 */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  return Object.assign(base, vars);
}

describe('server secret-key resolution', () => {
  it('prefers the canonical variable over the legacy one', () => {
    const r = resolveSupabaseSecretKey(
      env({ [SECRET_KEY_VAR]: 'canonical', [LEGACY_SECRET_KEY_VAR]: 'legacy' }),
    );
    expect(r).toEqual({ key: 'canonical', source: 'secret' });
  });

  it('falls back to the legacy variable when the canonical one is absent', () => {
    const r = resolveSupabaseSecretKey(env({ [LEGACY_SECRET_KEY_VAR]: 'legacy' }));
    expect(r).toEqual({ key: 'legacy', source: 'legacy-service-role' });
  });

  it('treats empty and whitespace-only values as absent, not as a key', () => {
    expect(resolveSupabaseSecretKey(env({ [SECRET_KEY_VAR]: '' })).source).toBe('missing');
    expect(resolveSupabaseSecretKey(env({ [SECRET_KEY_VAR]: '   ' })).source).toBe('missing');
    // an empty canonical value must not mask a usable legacy one
    expect(
      resolveSupabaseSecretKey(
        env({ [SECRET_KEY_VAR]: '  ', [LEGACY_SECRET_KEY_VAR]: 'legacy' }),
      ),
    ).toEqual({ key: 'legacy', source: 'legacy-service-role' });
  });

  it('trims surrounding whitespace so a copy-paste newline cannot corrupt the header', () => {
    expect(resolveSupabaseSecretKey(env({ [SECRET_KEY_VAR]: '  k  ' })).key).toBe('k');
  });

  it('reports missing when neither variable is set', () => {
    expect(resolveSupabaseSecretKey(env({}))).toEqual({ key: undefined, source: 'missing' });
    expect(hasSupabaseSecretKey(env({}))).toBe(false);
    expect(hasSupabaseSecretKey(env({ [LEGACY_SECRET_KEY_VAR]: 'legacy' }))).toBe(true);
  });

  it('throws an actionable error naming the canonical variable when nothing is set', () => {
    expect(() => requireSupabaseSecretKey(env({}))).toThrow(SECRET_KEY_VAR);
  });

  it('never returns the legacy variable name as the canonical one', () => {
    expect(SECRET_KEY_VAR).toBe('SUPABASE_SECRET_KEY');
    expect(LEGACY_SECRET_KEY_VAR).toBe('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('browser publishable-key resolution', () => {
  it('prefers the publishable key over the legacy anon key', () => {
    expect(resolveSupabasePublishableKey({ publishable: 'pub', legacyAnon: 'anon' })).toEqual({
      key: 'pub',
      source: 'publishable',
    });
  });

  it('falls back to the legacy anon key', () => {
    expect(resolveSupabasePublishableKey({ legacyAnon: 'anon' })).toEqual({
      key: 'anon',
      source: 'legacy-anon',
    });
  });

  it('reports missing when neither is set', () => {
    expect(resolveSupabasePublishableKey({})).toEqual({ key: undefined, source: 'missing' });
  });

  it('names only NEXT_PUBLIC_* variables', () => {
    expect(PUBLISHABLE_KEY_VAR.startsWith('NEXT_PUBLIC_')).toBe(true);
    expect(LEGACY_PUBLISHABLE_KEY_VAR.startsWith('NEXT_PUBLIC_')).toBe(true);
  });
});

// ── Static secret-boundary scan ────────────────────────────────────────────
// Walks real source rather than trusting review: a file that starts naming a
// server credential from client-reachable code fails here.

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(rel, out);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      out.push(rel);
    }
  }
  return out;
}

function isTestFile(file: string): boolean {
  return /(?:\.test\.|\.spec\.|(?:^|\/)(?:tests|__tests__|__mocks__)\/)/.test(file);
}

/** Directories whose code can be bundled into, or imported by, the browser. */
const CLIENT_REACHABLE_DIRS = ['components', 'hooks', 'lib'];

describe('secret boundary', () => {
  const serverKeyVars = [SECRET_KEY_VAR, LEGACY_SECRET_KEY_VAR];

  it('no client-reachable source file names a server Supabase credential', () => {
    const offenders: string[] = [];
    for (const dir of CLIENT_REACHABLE_DIRS) {
      for (const file of walk(dir)) {
        if (isTestFile(file)) continue;
        const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        if (serverKeyVars.some((v) => source.includes(v))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the browser key module never reads a server credential', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'lib/supabase/publishableKey.ts'),
      'utf8',
    );
    expect(source.includes('SUPABASE_SECRET_KEY')).toBe(false);
    expect(source.includes('SUPABASE_SERVICE_ROLE_KEY')).toBe(false);
  });

  it('no NEXT_PUBLIC_* variable is ever assigned from a server credential', () => {
    const offenders: string[] = [];
    for (const dir of ['backend', 'lib', 'pages', 'components', 'config', 'observability']) {
      for (const file of walk(dir)) {
        if (isTestFile(file)) continue;
        const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        // e.g. NEXT_PUBLIC_ANYTHING = ...SUPABASE_SECRET_KEY / ...SERVICE_ROLE_KEY
        if (/NEXT_PUBLIC_[A-Z0-9_]*\s*[:=][^\n]*(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)/.test(source)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('legacy runtime references are closed and explained', () => {
  /**
   * Every runtime file still naming a legacy variable, with why. Anything not
   * on this list is an unexplained runtime dependency and fails the test.
   */
  const ALLOWED: Record<string, string> = {
    'backend/db/supabaseKeys.ts':
      'the migration seam itself — owns the legacy fallback',
    'lib/supabase/publishableKey.ts':
      'the browser migration seam — owns the legacy anon fallback',
    'config/env.schema.ts':
      'legacy passthrough fields, kept optional so either contract validates',
    'config/integrity/runtimeIntegrity.ts':
      'security guard — must keep naming the legacy variable to detect it',
    'backend/utils/validateEnv.ts':
      'reports the accepted legacy variable name in its missing-var message',
    'backend/workers/renderParityPreflight.ts':
      'declares the legacy alias that still satisfies the preflight contract',
    'observability/runtime/startupDiagnostics.ts':
      'presence-only diagnostics; reports both names during the migration',
    'config/integrity/environmentIntegrity.ts':
      'security guard — asserts the auth-integrity CI workflow still declares a '
      + 'Supabase server key; that workflow is out of scope for this migration '
      + 'and still spells the legacy name, so the guard accepts either',
    'backend/services/extensionSessionService.ts':
      'NOT an API-key consumer — legacy value used as an HMAC signing secret; '
      + 'changing it would invalidate already-issued extension session tokens',
    'backend/services/rpaWorker/rpaAuthTokens.ts':
      'NOT an API-key consumer — HMAC signing secret fallback; see above',
    'backend/services/invitationService.ts':
      'NOT an API-key consumer — HMAC signing secret fallback; see above',
    'pages/api/super-admin/invitations/[invitationId]/resend.ts':
      'NOT an API-key consumer — HMAC signing secret fallback; see above',
  };

  it('every runtime file naming a legacy Supabase key variable is accounted for', () => {
    const found: string[] = [];
    for (const dir of ['backend', 'lib', 'pages', 'components', 'config', 'observability']) {
      for (const file of walk(dir)) {
        if (isTestFile(file)) continue;
        // scripts colocated under backend/ are operator tooling, not runtime
        if (file.startsWith('backend/scripts/')) continue;
        const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        if (
          source.includes('SUPABASE_SERVICE_ROLE_KEY') ||
          source.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')
        ) {
          found.push(file);
        }
      }
    }
    const unexplained = found.filter((f) => !(f in ALLOWED));
    expect(unexplained).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const stale = Object.keys(ALLOWED).filter((f) => {
      const abs = path.join(REPO_ROOT, f);
      if (!fs.existsSync(abs)) return true;
      const source = fs.readFileSync(abs, 'utf8');
      return !(
        source.includes('SUPABASE_SERVICE_ROLE_KEY') ||
        source.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')
      );
    });
    expect(stale).toEqual([]);
  });
});
