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

async function run() {
  for (const spec of specs) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [tsxBin, '--test', '--test-concurrency=1', spec], {
        cwd: root,
        env,
        stdio: 'inherit',
        shell: false,
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${spec} failed with exit code ${code ?? 1}`));
      });
    });
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
