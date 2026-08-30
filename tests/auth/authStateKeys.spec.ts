import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  EXACT_AUTH_APP_KEYS,
  PREFIXED_AUTH_APP_KEYS,
  SUPABASE_AUTH_PREFIXES,
  findAuthStateKeys,
  isAuthStateKey,
} from './authStateKeys';

/**
 * Anonymous visitor telemetry minted by lib/website/journeyIntelligence.ts.
 * These legitimately survive logout and MUST NOT fail the logged-out assertion.
 */
const ANONYMOUS_TELEMETRY_KEYS = ['omn_anon_id', 'omn_session', 'omn_journey', 'omn_click_ids'];

/** Real authentication / tenant keys, using the product's own naming. */
const AUTHENTICATION_KEYS = [
  'sb-lomndxmrpyudaegddpef-auth-token',
  'sb-lomndxmrpyudaegddpef-auth-token-code-verifier',
  'supabase.auth.token',
  'omnivyra_session',
  'mfa_challenge',
  'selected_company_id',
  'company_id',
  'auth_flow_session_established_v1',
  'omnivyra_onboarding',
  'company_profile_onboarding:abc-123',
  'campaign_chat_draft_42',
  // user-scoped variant produced by userScopedStorageKey()
  'selected_company_id:9f1c0f4e-0000-4000-8000-000000000000',
];

// ------------------------------------------------------------ MUST PASS
test('anonymous telemetry keys are NOT treated as auth state', () => {
  for (const key of ANONYMOUS_TELEMETRY_KEYS) {
    assert.equal(isAuthStateKey(key), false, `${key} must not count as auth state`);
  }
  assert.deepEqual(findAuthStateKeys(ANONYMOUS_TELEMETRY_KEYS), []);
});

test('a logged-out snapshot carrying only telemetry has zero auth-state keys', () => {
  // Exactly the state observed in the PHASE 147 run that failed the old assertion.
  const localStorageKeys = ['omn_anon_id', 'omnivyra_tour_seen'];
  const sessionStorageKeys = ['omn_journey', 'omn_session'];
  assert.deepEqual(findAuthStateKeys(localStorageKeys), []);
  assert.deepEqual(findAuthStateKeys(sessionStorageKeys), []);
});

test('unknown FUTURE anonymous telemetry is allowed automatically', () => {
  // The predicate is a deny-list of auth state, not an allow-list of telemetry,
  // so keys that do not exist yet must not break the security assertion.
  for (const key of ['omn_experiment_bucket', 'omn_ab_v2', 'analytics_pageviews', 'omnivyra_tour_seen']) {
    assert.equal(isAuthStateKey(key), false, `${key} must not count as auth state`);
  }
});

// ------------------------------------------------------------ MUST FAIL
test('authentication and tenant keys ARE treated as auth state', () => {
  for (const key of AUTHENTICATION_KEYS) {
    assert.equal(isAuthStateKey(key), true, `${key} MUST count as auth state`);
  }
  assert.equal(findAuthStateKeys(AUTHENTICATION_KEYS).length, AUTHENTICATION_KEYS.length);
});

test('auth keys are still detected when mixed into telemetry-only storage', () => {
  const mixed = ['omn_anon_id', 'omn_journey', 'sb-lomndxmrpyudaegddpef-auth-token', 'omn_session'];
  assert.deepEqual(findAuthStateKeys(mixed), ['sb-lomndxmrpyudaegddpef-auth-token']);
});

test('PKCE verifier keys are auth state regardless of prefix', () => {
  assert.equal(isAuthStateKey('my-code-verifier'), true);
  assert.equal(isAuthStateKey('PKCE_state'), true);
});

test('empty key is not auth state', () => {
  assert.equal(isAuthStateKey(''), false);
});

// ------------------------------------------------------------ DRIFT GUARD
test('DRIFT: predicate still mirrors utils/authStorage.ts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'utils', 'authStorage.ts'),
    'utf8',
  );

  const listOf = (name: string): string[] => {
    const match = source.match(new RegExp(`const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
    assert.ok(match, `${name} not found in utils/authStorage.ts — update tests/auth/authStateKeys.ts`);
    // Strip // comments first: prose inside the array (e.g. "the previous
    // user's tab") would otherwise be picked up as a quoted entry.
    const body = match[1].replace(/\/\/[^\n]*/g, '');
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  for (const key of listOf('EXACT_AUTH_APP_KEYS')) {
    assert.ok(
      EXACT_AUTH_APP_KEYS.includes(key),
      `utils/authStorage.ts clears "${key}" but the E2E predicate does not treat it as auth state`,
    );
    assert.equal(isAuthStateKey(key), true, `${key} must be detected as auth state`);
  }
  for (const prefix of listOf('PREFIXED_AUTH_APP_KEYS')) {
    assert.ok(
      PREFIXED_AUTH_APP_KEYS.includes(prefix),
      `utils/authStorage.ts clears prefix "${prefix}" but the E2E predicate does not`,
    );
    assert.equal(isAuthStateKey(`${prefix}x`), true, `${prefix}* must be detected as auth state`);
  }
  for (const prefix of listOf('SUPABASE_AUTH_PREFIXES')) {
    assert.ok(SUPABASE_AUTH_PREFIXES.includes(prefix), `missing Supabase prefix ${prefix}`);
  }
});

// ------------------------------------------------------------ MUTATION TEST
// Required: restoring `sessionStorageKeys.length === 0` must be caught.
test('MUTATION: restoring the blanket sessionStorage-empty assertion is caught', () => {
  const harness = fs.readFileSync(path.join(__dirname, 'authTestHarness.ts'), 'utf8');

  assert.ok(
    !/state\.sessionStorageKeys\.length === 0/.test(harness),
    'authTestHarness.ts has regressed to the blanket "sessionStorage must be empty" assertion; ' +
      'it fails on anonymous telemetry and is not an auth-state check',
  );
  assert.ok(
    harness.includes('findAuthStateKeys(state.sessionStorageKeys).length === 0'),
    'waitForLoggedOutState must use the auth-specific predicate',
  );

  // The same over-broad form must not reappear inline in any spec either.
  for (const spec of fs.readdirSync(__dirname).filter((f) => f.endsWith('.spec.ts'))) {
    if (spec === 'authStateKeys.spec.ts') continue;
    const body = fs.readFileSync(path.join(__dirname, spec), 'utf8');
    assert.ok(
      !/deepEqual\(\s*\w+\.sessionStorageKeys\s*,\s*\[\]\s*\)/.test(body),
      `${spec} asserts sessionStorage is entirely empty; use findAuthStateKeys(...) instead — ` +
        'anonymous telemetry legitimately survives logout',
    );
    assert.ok(
      !/\w+\.sessionStorageKeys\.length === 0/.test(body),
      `${spec} asserts sessionStorage.length === 0; use the auth-specific predicate instead`,
    );
  }

  // And prove the blanket form would actually reject a legitimate logged-out state.
  const legitimateLoggedOutSessionStorage = ['omn_journey', 'omn_session'];
  const blanketAssertionPasses = legitimateLoggedOutSessionStorage.length === 0;
  const authSpecificAssertionPasses =
    findAuthStateKeys(legitimateLoggedOutSessionStorage).length === 0;
  assert.equal(blanketAssertionPasses, false, 'blanket assertion should reject telemetry');
  assert.equal(authSpecificAssertionPasses, true, 'auth-specific assertion should accept telemetry');
});
