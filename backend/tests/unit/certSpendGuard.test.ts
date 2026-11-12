/**
 * Certification must never spend money (e9, 2026-11-12): a cert run refuses unless beta AI mode is in
 * effect. .env.cert sets OMNIVYRA_ENV=production, so a run without the explicit OMNIVYRA_ENV=beta
 * prefix would otherwise make REAL paid provider calls under the 98a06f585 guard.
 */
import { checkCertCannotSpend, isCertRun } from '../../../scripts/cert/certSpendGuard';

const CERT = { CERT_ENV: '1', DOTENV_CONFIG_PATH: '.env.cert' };

describe('checkCertCannotSpend', () => {
  it('REFUSES the exact .env.cert situation run without the prefix (BETA_AI_MODE=1, OMNIVYRA_ENV=production)', () => {
    const r = checkCertCannotSpend({ ...CERT, BETA_AI_MODE: '1', OMNIVYRA_ENV: 'production' }, 'scripts/cert/concurrency-cert.ts');
    expect(r.ok).toBe(false);
    const msg = (r as { message: string }).message;
    expect(msg).toContain('REFUSED');
    expect(msg).toContain('OMNIVYRA_ENV=beta');
    expect(msg).toContain('scripts/cert/concurrency-cert.ts');
  });

  it('allows the documented command (BETA_AI_MODE=1 + OMNIVYRA_ENV=beta)', () => {
    expect(checkCertCannotSpend({ ...CERT, BETA_AI_MODE: '1', OMNIVYRA_ENV: 'beta' })).toEqual({ ok: true });
  });

  it.each([
    ['no BETA_AI_MODE at all', { ...CERT, OMNIVYRA_ENV: 'beta' }],
    ['marker unset (resolves to production)', { ...CERT, BETA_AI_MODE: '1' }],
    ['DRISHIQ_ENV fallback is not beta', { ...CERT, BETA_AI_MODE: '1', DRISHIQ_ENV: 'staging' }],
  ])('refuses a cert run where beta mode would not take effect: %s', (_l, env) => {
    expect(checkCertCannotSpend(env).ok).toBe(false);
  });

  it('resolves OMNIVYRA_ENV as validateEnv does (OMNIVYRA_ENV || DRISHIQ_ENV)', () => {
    expect(checkCertCannotSpend({ ...CERT, BETA_AI_MODE: '1', DRISHIQ_ENV: 'beta' }).ok).toBe(true);
  });

  it('is not the concern of non-cert processes', () => {
    expect(checkCertCannotSpend({ BETA_AI_MODE: '1', OMNIVYRA_ENV: 'production' })).toEqual({ ok: true });
  });

  it.each([
    [{ CERT_ENV: '1' }, true],
    [{ DOTENV_CONFIG_PATH: '.env.cert' }, true],
    [{ DOTENV_CONFIG_PATH: 'C:\\repo\\.env.cert' }, true],
    [{ ENV_FILE: '.env.cert' }, true],
    [{ DOTENV_CONFIG_PATH: '.env.certify' }, false],
    [{ ENV_FILE: '.env.local' }, false],
    [{}, false],
  ])('isCertRun(%j) -> %s', (env, expected) => {
    expect(isCertRun(env)).toBe(expected);
  });
});
