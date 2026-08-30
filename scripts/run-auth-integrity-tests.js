#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const tsxBin = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const specs = [
  'tests/auth/auth-callback-isolation.spec.ts',
  'tests/auth/expired-link-failclosed.spec.ts',
  'tests/auth/logout-session-revocation.spec.ts',
  'tests/auth/org-context-isolation.spec.ts',
  'tests/auth/multitab-auth-isolation.spec.ts',
];
const env = {
  ...process.env,
  AUTH_E2E_TIMEOUT_MS: process.env.AUTH_E2E_TIMEOUT_MS || '120000',
  // Default to Playwright's global browser cache (shared across all projects)
  // instead of forcing a per-repo ~660MB .playwright-browsers download. Set
  // AUTH_E2E_INREPO_BROWSERS=1 for a hermetic in-repo install if ever needed.
  ...(process.env.AUTH_E2E_INREPO_BROWSERS === '1'
    ? { PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.playwright-browsers') }
    : {}),
};

function runSpec(spec) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [tsxBin, '--test', '--test-concurrency=1', spec], {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', (error) => {
      resolve({ spec, code: 1, durationMs: Date.now() - startedAt, error: error.message });
    });
    child.on('exit', (code) => {
      resolve({ spec, code: code ?? 1, durationMs: Date.now() - startedAt, error: null });
    });
  });
}

async function run() {
  // Every spec runs regardless of earlier failures: a failure in spec 1 must
  // not hide the state of specs 2-5. Each spec still reports its own result and
  // the process still exits non-zero if ANY spec failed.
  const results = [];
  for (const spec of specs) {
    results.push(await runSpec(spec));
  }

  const failed = results.filter((r) => r.code !== 0);

  console.log('\n===== AUTH INTEGRITY SUMMARY =====');
  for (const r of results) {
    const status = r.code === 0 ? 'PASS' : 'FAIL';
    const suffix = r.error ? ` (${r.error})` : '';
    console.log(`${status}  ${r.spec}  ${(r.durationMs / 1000).toFixed(1)}s${suffix}`);
  }
  console.log(
    `${results.length - failed.length}/${results.length} specs passed, ${failed.length} failed`,
  );
  console.log('==================================\n');

  if (failed.length > 0) {
    console.error(`Auth integrity: ${failed.length} spec(s) failed.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
