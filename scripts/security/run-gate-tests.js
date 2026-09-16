#!/usr/bin/env node
/**
 * STEP 3AH-91 (F7) — run the security gates' fixture suites, failing loudly if
 * any suite is missing (a renamed/deleted suite must not silently drop out of
 * CI — `jest <path>` on a missing path just runs the others).
 *
 * Usage: node scripts/security/run-gate-tests.js   (CI: npm run test:security-gates)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SUITES = [
  // ROUTE-AUTH-001 (3AH-85) + R1-METHOD (3AH-91)
  'backend/tests/unit/routeAuth001Scanner.test.ts',
  'backend/tests/unit/sec91FRouteAuthMethod.test.ts',
  'backend/tests/unit/sec91FDormantRoutes.test.ts',
  // migration-quality exposure rules (3AH-70 + 3AH-91)
  'backend/tests/unit/migrationQualitySecurityRules.test.ts',
  'backend/tests/unit/sec91FMigrationQuality.test.ts',
  // outbound SSRF scanner (HARDEN-005A + 3AH-91)
  'backend/tests/unit/ssrfCiGuard.test.ts',
  'backend/tests/unit/sec91FSsrfScanner.test.ts',
  // secret-pattern gate (3AH-91)
  'backend/tests/unit/sec91FSecretsGate.test.ts',
  // gate relationships + CI wiring (3AH-91)
  'backend/tests/unit/sec91FGateHardening.test.ts',
  // wave 2 (3AH-91 W2F): default re-exports, R4-ENV, constant-time secret
  // compares (+ the 3 converted sites), SSRF fetch aliases (+ render provider)
  'backend/tests/unit/sec91W2FRouteAuthReExport.test.ts',
  'backend/tests/unit/sec91W2FR4Env.test.ts',
  'backend/tests/unit/sec91W2FConstantTime.test.ts',
  'backend/tests/unit/sec91W2FSsrfAlias.test.ts',
  'backend/tests/unit/sec91W2FCiWiring.test.ts',
  // wave 2 (3AH-91 W2E): every server read of the client IP goes through the
  // platform-trusted resolver (repo-wide source pin + route behaviour)
  'backend/tests/unit/sec91W2EClientIpAdoption.test.ts',
];

const missing = SUITES.filter((s) => !fs.existsSync(path.join(ROOT, s)));
if (missing.length) {
  console.error(`[security-gate-tests] missing suite(s) — renamed, moved or deleted:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
const jest = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
const args = [jest, ...SUITES, '--no-coverage', '--ci', ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
