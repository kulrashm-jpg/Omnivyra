/**
 * Certification must NEVER spend money (e9, 2026-11-12). Import this FIRST in every cert script.
 *
 * Cert runs rely on beta AI mode (a deterministic, zero-cost mock) instead of real, paid provider
 * calls. Since 98a06f585, beta AI mode takes effect ONLY with the explicit marker OMNIVYRA_ENV=beta
 * (config/betaAiMode.ts), and .env.cert itself sets OMNIVYRA_ENV=production. So a cert script run
 * without the documented prefix would silently make REAL paid calls. This guard REFUSES to run in cert
 * mode unless beta AI mode is actually in effect, and prints the correct command.
 *
 * OMNIVYRA_ENV is resolved exactly as config/env.schema.ts validateEnv does: OMNIVYRA_ENV ||
 * DRISHIQ_ENV, defaulting to 'production'.
 */
import { betaAiModeActive } from '../../config/betaAiMode';

export type CertSpendCheck = { ok: true } | { ok: false; message: string };

/** Is this process a certification run? (CERT_ENV=1, or .env.cert as the env file.) */
export function isCertRun(env: NodeJS.ProcessEnv): boolean {
  return env.CERT_ENV === '1'
    || /(^|[\\/])\.env\.cert$/.test(String(env.DOTENV_CONFIG_PATH ?? ''))
    || /(^|[\\/])\.env\.cert$/.test(String(env.ENV_FILE ?? ''));
}

/** Pure: may this process run without spending money? Non-cert processes are not this guard's concern. */
export function checkCertCannotSpend(env: NodeJS.ProcessEnv, script = 'scripts/cert/<script>.ts'): CertSpendCheck {
  if (!isCertRun(env)) return { ok: true };
  const resolved = env.OMNIVYRA_ENV || env.DRISHIQ_ENV || 'production';
  if (betaAiModeActive(env.BETA_AI_MODE, resolved)) return { ok: true };
  return {
    ok: false,
    message: [
      '[cert] REFUSED: this certification run would make REAL, paid provider calls.',
      `  BETA_AI_MODE=${env.BETA_AI_MODE ?? '(unset)'}, resolved OMNIVYRA_ENV=${resolved}. Beta AI mode (the zero-cost mock) needs`,
      '  BETA_AI_MODE=1 AND OMNIVYRA_ENV=beta. .env.cert sets OMNIVYRA_ENV=production, so pass the marker explicitly:',
      `    DOTENV_CONFIG_PATH=.env.cert BETA_AI_MODE=1 OMNIVYRA_ENV=beta CERT_ENV=1 \\`,
      `      npx tsx -r dotenv/config -r tsconfig-paths/register ${script}`,
    ].join('\n'),
  };
}

/** Side effect on import: refuse (exit 2) before anything else in the cert script runs. */
const verdict = checkCertCannotSpend(process.env, process.argv[1]);
if (verdict.ok === false) {
  console.error(verdict.message);
  process.exit(2);
}
