/**
 * WS1-E8-T005 — SESSION_COOKIE_SECRET minimum-length drift guard.
 *
 * The minimum-length rule for SESSION_COOKIE_SECRET is enforced in TWO
 * independent validators, deliberately (defence in depth — see the WS-1
 * governance ruling on env validation, which keeps the modules intact and
 * unifies only their invocation):
 *
 *   1. backend/utils/validateEnv.ts    — assertAuthEnvOrThrow(), called
 *                                        explicitly at worker/cron/API entry.
 *   2. backend/security/env.ts         — memoized, triggered by the first
 *                                        import from any security module.
 *
 * Duplication is intentional; DIVERGENCE is not. If one is raised (or
 * lowered) without the other, the effective floor silently becomes whichever
 * validator happens to run first on a given code path — the exact
 * nondeterminism this rule exists to prevent.
 *
 * These constants are module-private in both files, so this guard reads the
 * source text. That mirrors the repository's existing source-scanning gates
 * (scripts/check-bridge-cookie-usage.js, scripts/check-route-policy.js).
 *
 * No database, no network, no env mutation.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const VALIDATE_ENV_PATH = path.join(REPO_ROOT, 'backend', 'utils', 'validateEnv.ts');
const SECURITY_ENV_PATH = path.join(REPO_ROOT, 'backend', 'security', 'env.ts');

/** Read a `const <NAME> = <int>;` declaration out of a source file. */
function readNumericConst(filePath: string, constName: string): number {
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(new RegExp(`\\bconst\\s+${constName}\\s*=\\s*(\\d+)\\s*;`));
  if (!match) {
    throw new Error(
      `${path.relative(REPO_ROOT, filePath)}: could not find \`const ${constName} = <number>;\`. ` +
        'If the constant was renamed or moved, update this drift guard in the same change.',
    );
  }
  return Number(match[1]);
}

describe('SESSION_COOKIE_SECRET minimum-length rule', () => {
  it('is declared in backend/utils/validateEnv.ts', () => {
    expect(readNumericConst(VALIDATE_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LENGTH')).toBeGreaterThan(0);
  });

  it('is declared in backend/security/env.ts', () => {
    expect(readNumericConst(SECURITY_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LEN')).toBeGreaterThan(0);
  });

  it('does not drift between the two validators', () => {
    const fromValidateEnv = readNumericConst(VALIDATE_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LENGTH');
    const fromSecurityEnv = readNumericConst(SECURITY_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LEN');

    expect({ validateEnv: fromValidateEnv, securityEnv: fromSecurityEnv }).toEqual({
      validateEnv: fromSecurityEnv,
      securityEnv: fromSecurityEnv,
    });
  });

  it('never falls below the 32-character floor', () => {
    // 32 chars is the floor both validators shipped with. Lowering it weakens
    // every signed cookie on the platform, so it must be a deliberate,
    // reviewed change — not something a refactor can do quietly.
    expect(readNumericConst(VALIDATE_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LENGTH')).toBeGreaterThanOrEqual(32);
    expect(readNumericConst(SECURITY_ENV_PATH, 'SESSION_COOKIE_SECRET_MIN_LEN')).toBeGreaterThanOrEqual(32);
  });

  it('still enforces the rule in both validators (constant is actually used)', () => {
    const validateEnvSrc = fs.readFileSync(VALIDATE_ENV_PATH, 'utf8');
    const securityEnvSrc = fs.readFileSync(SECURITY_ENV_PATH, 'utf8');

    // A declared-but-unused constant would pass every assertion above while
    // the rule itself had been deleted.
    expect(validateEnvSrc).toMatch(/value\.length\s*<\s*SESSION_COOKIE_SECRET_MIN_LENGTH/);
    expect(securityEnvSrc).toMatch(/sessionSecret\.length\s*<\s*SESSION_COOKIE_SECRET_MIN_LEN/);
  });
});
