import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_EXPECTED_E2E_PROJECT_REF,
  E2EEnvironmentError,
  assertNonProductionE2EEnvironment,
  extractProjectRef,
} from './e2eEnvironmentGuard';

const PRODUCTION_URL = 'https://klkiseupptzbecbxwrky.supabase.co';
const E2E_URL = 'https://' + DEFAULT_EXPECTED_E2E_PROJECT_REF + '.supabase.co';
const VALID_KEY = 'sb-service-role-key-for-tests-only-not-a-real-credential';

function expectRejected(
  input: Parameters<typeof assertNonProductionE2EEnvironment>[0],
  why: string,
): void {
  assert.throws(
    () => assertNonProductionE2EEnvironment(input),
    (error: unknown) => error instanceof E2EEnvironmentError,
    `guard must reject ${why}`,
  );
}

// ------------------------------------------------------------ Case 1: production
test('guard REJECTS the production Supabase URL', () => {
  expectRejected({ supabaseUrl: PRODUCTION_URL, serviceRoleKey: VALID_KEY }, 'the production URL');
});

test('guard REJECTS production even when the expected-project allowlist is disabled', () => {
  // Targets the production denylist SPECIFICALLY. Without this test, deleting the
  // denylist would be masked by the allowlist check.
  expectRejected(
    { supabaseUrl: PRODUCTION_URL, serviceRoleKey: VALID_KEY, expectedProjectRef: null },
    'the production URL with the allowlist disabled',
  );
});

test('guard REJECTS production when it is also named as the expected project', () => {
  expectRejected(
    {
      supabaseUrl: PRODUCTION_URL,
      serviceRoleKey: VALID_KEY,
      expectedProjectRef: 'klkiseupptzbecbxwrky',
    },
    'production even if misconfigured as the expected project',
  );
});

test('guard REJECTS the production project ref smuggled into another host', () => {
  expectRejected(
    {
      supabaseUrl: 'https://klkiseupptzbecbxwrky.pooler.supabase.co',
      serviceRoleKey: VALID_KEY,
      expectedProjectRef: null,
    },
    'a host containing the production ref',
  );
});

// ------------------------------------------------------------ Case 2: empty
test('guard REJECTS an empty Supabase URL', () => {
  expectRejected({ supabaseUrl: '', serviceRoleKey: VALID_KEY }, 'an empty URL');
});

test('guard REJECTS an undefined Supabase URL', () => {
  expectRejected({ supabaseUrl: undefined, serviceRoleKey: VALID_KEY }, 'an undefined URL');
});

test('guard REJECTS a whitespace-only Supabase URL', () => {
  expectRejected({ supabaseUrl: '   ', serviceRoleKey: VALID_KEY }, 'a whitespace URL');
});

// ------------------------------------------------------------ Case 3: valid E2E
test('guard ACCEPTS the dedicated E2E project', () => {
  const result = assertNonProductionE2EEnvironment({
    supabaseUrl: E2E_URL,
    serviceRoleKey: VALID_KEY,
  });
  assert.equal(result.projectRef, DEFAULT_EXPECTED_E2E_PROJECT_REF);
  assert.equal(result.hostname, DEFAULT_EXPECTED_E2E_PROJECT_REF + '.supabase.co');
});

test('guard result never contains the service-role key', () => {
  const result = assertNonProductionE2EEnvironment({
    supabaseUrl: E2E_URL,
    serviceRoleKey: VALID_KEY,
  });
  assert.ok(
    !JSON.stringify(result).includes(VALID_KEY),
    'guard result leaked the service-role key',
  );
});

// ------------------------------------------------------------ Case 4: malformed
test('guard REJECTS a malformed Supabase URL', () => {
  expectRejected({ supabaseUrl: 'not a url', serviceRoleKey: VALID_KEY }, 'a malformed URL');
});

test('guard REJECTS a URL with an unsupported protocol', () => {
  expectRejected(
    { supabaseUrl: 'ftp://lomndxmrpyudaegddpef.supabase.co', serviceRoleKey: VALID_KEY },
    'a non-http(s) URL',
  );
});

// ------------------------------------------------------- placeholder / local hosts
test('guard REJECTS the CI placeholder host', () => {
  expectRejected(
    { supabaseUrl: 'https://placeholder.supabase.co', serviceRoleKey: VALID_KEY, expectedProjectRef: null },
    'the CI placeholder',
  );
});

test('guard REJECTS a local Supabase instance', () => {
  expectRejected(
    { supabaseUrl: 'http://127.0.0.1:54321', serviceRoleKey: VALID_KEY, expectedProjectRef: null },
    'a local instance',
  );
  expectRejected(
    { supabaseUrl: 'http://localhost:54321', serviceRoleKey: VALID_KEY, expectedProjectRef: null },
    'localhost',
  );
});

test('guard REJECTS a non-Supabase host', () => {
  expectRejected(
    { supabaseUrl: 'https://evil.example.net', serviceRoleKey: VALID_KEY, expectedProjectRef: null },
    'a non-Supabase host',
  );
});

test('guard REJECTS an unexpected Supabase project', () => {
  expectRejected(
    { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: VALID_KEY },
    'a project that is not the expected E2E project',
  );
});

// ------------------------------------------------------------ credentials
test('guard REJECTS a missing service-role key', () => {
  expectRejected({ supabaseUrl: E2E_URL, serviceRoleKey: '' }, 'a missing service-role key');
});

test('guard REJECTS a placeholder service-role key', () => {
  expectRejected(
    { supabaseUrl: E2E_URL, serviceRoleKey: 'ci-hermetic-placeholder-service-role-key' },
    'a placeholder key',
  );
});

test('extractProjectRef derives refs only from well-formed Supabase hosts', () => {
  assert.equal(extractProjectRef(E2E_URL), DEFAULT_EXPECTED_E2E_PROJECT_REF);
  assert.equal(extractProjectRef('https://short.supabase.co'), null);
  assert.equal(extractProjectRef('nonsense'), null);
});

// ------------------------------------------------------------ MUTATION TEST
// Required by PHASE 147 / step 3: disabling the production rejection MUST be caught.
test('MUTATION: removing the production rejection is caught by the guard tests', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'e2eEnvironmentGuard.ts'), 'utf8');
  const marker = 'if (isProductionTarget(projectRef, hostname)) {';
  assert.ok(
    source.includes(marker),
    'production rejection block not found — update this mutation test',
  );

  // Mutate: neutralise the production rejection.
  const mutated = source.replace(marker, 'if (false && isProductionTarget(projectRef, hostname)) {');
  assert.notEqual(mutated, source, 'mutation was not applied');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-e2e-mutant-'));
  const mutantPath = path.join(dir, 'mutantGuard.ts');
  fs.writeFileSync(mutantPath, mutated);

  try {
    const mutant = await import(pathToFileURL(mutantPath).href);

    // With the denylist neutralised the mutant must now ACCEPT production while the
    // allowlist is disabled. That is precisely the condition asserted by the
    // 'guard REJECTS production even when the expected-project allowlist is disabled'
    // test above, which therefore FAILS against the mutant => the mutation is caught.
    let mutantAcceptedProduction = false;
    try {
      mutant.assertNonProductionE2EEnvironment({
        supabaseUrl: PRODUCTION_URL,
        serviceRoleKey: VALID_KEY,
        expectedProjectRef: null,
      });
      mutantAcceptedProduction = true;
    } catch {
      mutantAcceptedProduction = false;
    }

    assert.equal(
      mutantAcceptedProduction,
      true,
      'mutant did not accept production, so no test detects removal of the production denylist — strengthen the guard tests',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
