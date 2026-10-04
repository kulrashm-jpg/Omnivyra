/**
 * Regression lock for the `process.env` governance Proxy's `set` trap.
 *
 * WP-14 A1 generated a real production Report 1 whose PDF export then failed on
 * Vercel with:
 *
 *   TypeError: 'set' on proxy: trap returned falsish for property 'FONTCONFIG_PATH'
 *     at setupLambdaEnvironment (@sparticuz/chromium/build/helper.js:34:36)
 *
 * `@sparticuz/chromium` writes `process.env.FONTCONFIG_PATH` while it is being
 * imported. The enforcer's `set` trap returned `false`, and a falsish `set` trap
 * THROWS in strict mode (every ES module is strict), so the import aborted. The
 * Playwright and chrome-cli fallbacks have no browser binary in Lambda, so all
 * three renderer tiers fell through and report PDF export returned 500.
 *
 * This is the same defect the `deleteProperty` trap already carries a comment
 * about (`delete process.env.DEBUG` aborting `import('playwright')`). That trap
 * was fixed; `set` was not. This test locks both halves of the contract:
 * the write must SUCCEED, and the warning must still be emitted.
 *
 * SINGLE-PURPOSE FILE — DO NOT ADD UNRELATED TESTS HERE. `initEnforcer()`
 * installs the proxy with `configurable: false`, so the install cannot be undone
 * for the remainder of this worker process.
 */
import { initEnforcer, isEnforcerActive } from '../../../lib/config/enforcer';

describe('config enforcer — process.env set trap', () => {
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    // Under jest NODE_ENV is 'test', so initEnforcer() is a no-op unless
    // enforcement is explicitly requested. SKIP_ENV_PROXY would also short it out.
    delete process.env.SKIP_ENV_PROXY;
    process.env.ENFORCE_CONFIG_SECURITY = 'true';
    initEnforcer();
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('installs the proxy, so the trap below is the real one', () => {
    expect(isEnforcerActive()).toBe(true);
  });

  it('returns true from the set trap instead of falsish', () => {
    // Reflect.set surfaces the trap's own boolean return, which is the exact
    // value that decides whether strict-mode assignment throws.
    expect(Reflect.set(process.env, 'FONTCONFIG_PATH', '/var/task/fonts')).toBe(true);
  });

  it('does not throw on a strict-mode assignment, the way @sparticuz/chromium writes it', () => {
    const writeLikeSparticuz = (): void => {
      'use strict';
      process.env.FONTCONFIG_PATH = '/tmp/aws/fonts';
    };
    expect(writeLikeSparticuz).not.toThrow();
  });

  it('actually performs the write, so the library sees the value it set', () => {
    process.env.FONTCONFIG_PATH = '/tmp/chromium/fonts';
    expect(process.env.FONTCONFIG_PATH).toBe('/tmp/chromium/fonts');
  });

  it('still reports the env write for observability', () => {
    process.env.LD_LIBRARY_PATH = '/tmp/chromium/lib';
    const warnedAboutTheWrite = warnSpy.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('Attempted to set process.env.LD_LIBRARY_PATH'),
    );
    expect(warnedAboutTheWrite).toBe(true);
  });
});
