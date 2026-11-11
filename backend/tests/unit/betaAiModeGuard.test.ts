/**
 * BETA_AI_MODE production guard (83 / e9, 2026-11-12). Beta AI mode skips real provider calls AND image
 * billing, so it must never take effect in production. VERCEL_ENV / NODE_ENV cannot distinguish a beta
 * deployment, so the gate is INVERTED and fail-safe: it takes effect ONLY when the deployment carries
 * the explicit marker OMNIVYRA_ENV === 'beta', judged on the RESOLVED config value (after the schema's
 * default), never on the raw environment alone.
 */
import { envSchema } from '../../../config/env.schema';
import { betaAiModeActive, betaAiModeRequested, BETA_AI_MODE_NEUTRALISED_MESSAGE } from '../../../config/betaAiMode';

const ENV_BASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'placeholder-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'placeholder-publishable',
  REDIS_URL: 'redis://127.0.0.1:6399',
  OPENAI_API_KEY: 'placeholder-openai',
  ENCRYPTION_KEY: '0'.repeat(64),
};
/** OMNIVYRA_ENV as the schema resolves it. validateEnv passes `process.env.OMNIVYRA_ENV || DRISHIQ_ENV`, so '' is "unset". */
const resolve = (raw: string | undefined) => envSchema.parse({ ...ENV_BASE, OMNIVYRA_ENV: raw || undefined }).OMNIVYRA_ENV;

describe('the gate, on the RESOLVED OMNIVYRA_ENV', () => {
  it.each([
    ['unset', undefined, 'production'],
    ['empty', '', 'production'],
    ['production', 'production', 'production'],
    ['staging', 'staging', 'staging'],
    ['development', 'development', 'development'],
  ])('BETA_AI_MODE=1 with OMNIVYRA_ENV %s (resolves to %s): NEUTRALISED, billing stays ON', (_l, raw, resolved) => {
    expect(resolve(raw)).toBe(resolved);
    expect(betaAiModeActive('1', resolve(raw))).toBe(false);
    expect(betaAiModeActive('true', resolve(raw))).toBe(false);
  });

  it("BETA_AI_MODE=1 with OMNIVYRA_ENV 'beta': the ONLY combination that skips billing", () => {
    expect(resolve('beta')).toBe('beta');
    expect(betaAiModeActive('1', resolve('beta'))).toBe(true);
    expect(betaAiModeActive('true', resolve('beta'))).toBe(true);
  });

  it("'prod' (or any other spelling) is not the marker: the schema refuses it at boot, and the gate itself is false", () => {
    expect(() => resolve('prod')).toThrow();
    expect(betaAiModeActive('1', 'prod')).toBe(false);
    expect(betaAiModeActive('1', 'Beta')).toBe(false);
    expect(betaAiModeActive('1', ' beta')).toBe(false);
  });

  it('the marker alone does nothing: BETA_AI_MODE must also be on', () => {
    expect(betaAiModeActive(undefined, 'beta')).toBe(false);
    expect(betaAiModeActive('0', 'beta')).toBe(false);
    expect(betaAiModeActive('false', 'beta')).toBe(false);
    expect(betaAiModeRequested('yes')).toBe(false);
  });
});

describe('isBetaAiRenderMode reads the RESOLVED config value', () => {
  const run = (omnivyraEnv: string | undefined, betaFlag: string | undefined): boolean => {
    let out = false;
    jest.isolateModules(() => {
      jest.doMock('@/config', () => ({ config: { OMNIVYRA_ENV: omnivyraEnv } }));
      const prev = process.env.BETA_AI_MODE;
      if (betaFlag === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = betaFlag;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        out = require('../../services/creator/rendering/providers/betaMockRenderProvider').isBetaAiRenderMode();
      } finally {
        if (prev === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = prev;
      }
    });
    return out;
  };
  it.each([['production', '1', false], ['staging', '1', false], ['beta', '1', true], ['beta', undefined, false], ['production', undefined, false]])(
    'OMNIVYRA_ENV=%s, BETA_AI_MODE=%s -> %s', (env, flag, expected) => {
      expect(run(env, flag)).toBe(expected);
    },
  );
});

describe('the boot log', () => {
  /** Initialise the REAL config module with BETA_AI_MODE / OMNIVYRA_ENV as given; return the console.error calls. */
  const boot = (betaFlag: string | undefined, omnivyraEnv: string | undefined) => {
    const saved = { b: process.env.BETA_AI_MODE, o: process.env.OMNIVYRA_ENV };
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      if (betaFlag === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = betaFlag;
      if (omnivyraEnv === undefined) delete process.env.OMNIVYRA_ENV; else process.env.OMNIVYRA_ENV = omnivyraEnv;
      jest.isolateModules(() => {
        jest.dontMock('@/config');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { config } = require('../../../config');
        void config.NODE_ENV; // first read initialises (validates) the config
      });
      return err.mock.calls.filter((c) => c[0] === BETA_AI_MODE_NEUTRALISED_MESSAGE);
    } finally {
      err.mockRestore(); info.mockRestore();
      if (saved.b === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = saved.b;
      if (saved.o === undefined) delete process.env.OMNIVYRA_ENV; else process.env.OMNIVYRA_ENV = saved.o;
    }
  };
  it('BETA_AI_MODE set WITHOUT the marker: exactly one ERROR line at boot, naming the resolved value', () => {
    const calls = boot('1', undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ OMNIVYRA_ENV: 'production' });
  });
  it('BETA_AI_MODE with the beta marker: no line (beta mode is intended there)', () => {
    expect(boot('1', 'beta')).toHaveLength(0);
  });
  it('no BETA_AI_MODE: no line', () => {
    expect(boot(undefined, undefined)).toHaveLength(0);
  });
});
