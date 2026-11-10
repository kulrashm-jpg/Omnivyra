/**
 * Portability of the extension-source test seam
 * (backend/tests/helpers/extensionSourceRoot.ts).
 *
 *   - the root comes ONLY from OMNIVYRA_EXTENSION_ROOT (no hard-coded machine path);
 *   - files resolve with path.join on Windows AND POSIX roots;
 *   - a missing root registers the dependent block as SKIPPED with a reason,
 *     and its tests never execute (so they cannot be counted as passed);
 *   - a set root reads real files; a set-but-incomplete root is reported.
 *
 * Fixtures are synthetic files written to a temp dir — no extension source.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EXTENSION_ROOT_ENV,
  resolveExtensionRoot,
  extensionFilePath,
  missingExtensionFiles,
  describeWithExtensionSource,
} from '../helpers/extensionSourceRoot';

describe('root resolution', () => {
  it('unset or blank → not ok, with a specific reason naming the variable', () => {
    for (const env of [{}, { [EXTENSION_ROOT_ENV]: '' }, { [EXTENSION_ROOT_ENV]: '   ' }]) {
      const r = resolveExtensionRoot(env);
      expect(r.ok).toBe(false);
      if (r.ok === false) {
        expect(r.reason).toContain(EXTENSION_ROOT_ENV);
        expect(r.reason).toMatch(/SKIPPED \(not passed\)/);
      }
    }
  });

  it('a Windows root is kept and joined with backslashes', () => {
    const r = resolveExtensionRoot({ [EXTENSION_ROOT_ENV]: 'D:\\work\\omnivyra ext\\extension' }, path.win32);
    expect(r).toEqual({ ok: true, root: 'D:\\work\\omnivyra ext\\extension' });
    if (r.ok === true) {
      expect(extensionFilePath(r.root, ['core', 'apiClient.js'], path.win32))
        .toBe('D:\\work\\omnivyra ext\\extension\\core\\apiClient.js');
    }
  });

  it('a Windows root written with forward slashes normalizes under win32', () => {
    expect(extensionFilePath('D:/work/ext', ['background', 'serviceWorker.js'], path.win32))
      .toBe('D:\\work\\ext\\background\\serviceWorker.js');
  });

  it('a POSIX root is kept and joined with forward slashes', () => {
    const r = resolveExtensionRoot({ [EXTENSION_ROOT_ENV]: '/home/ci/omnivyra ext/extension' }, path.posix);
    expect(r).toEqual({ ok: true, root: '/home/ci/omnivyra ext/extension' });
    if (r.ok === true) {
      expect(extensionFilePath(r.root, ['manifest.json'], path.posix)).toBe('/home/ci/omnivyra ext/extension/manifest.json');
    }
  });

  it('a relative root is resolved to an absolute path', () => {
    const r = resolveExtensionRoot({ [EXTENSION_ROOT_ENV]: 'ext' }, path.posix);
    expect(r.ok === true && path.posix.isAbsolute(r.root)).toBe(true);
  });

  it('segments may not smuggle a separator of either kind', () => {
    expect(() => extensionFilePath('/r', ['core/apiClient.js'], path.posix)).toThrow(/separator/);
    expect(() => extensionFilePath('C:\\r', ['core\\apiClient.js'], path.win32)).toThrow(/separator/);
  });

  it('no test or helper hard-codes a machine-specific extension path', () => {
    const files = [
      'backend/tests/unit/extensionDispatchLeaseRenewal.test.ts',
      'backend/tests/unit/extensionProductionTargeting.test.ts',
      'backend/tests/helpers/extensionSourceRoot.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), ...f.split('/')), 'utf8');
      expect(src).not.toMatch(/OneDrive|Users[\\/]Admin|omnivyra chrome ext/);
    }
  });
});

describe('missing-file detection', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-root-'));
  fs.mkdirSync(path.join(tmp, 'core'));
  fs.writeFileSync(path.join(tmp, 'core', 'apiClient.js'), '// synthetic fixture\n');
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('a complete root reports nothing missing', () => {
    expect(missingExtensionFiles(tmp, [['core', 'apiClient.js']])).toEqual([]);
  });
  it('a missing file is reported by its full path', () => {
    expect(missingExtensionFiles(tmp, [['manifest.json']])).toEqual([path.join(tmp, 'manifest.json')]);
  });
  it('a nonexistent root is reported', () => {
    const ghost = path.join(tmp, 'does-not-exist');
    expect(missingExtensionFiles(ghost, [['manifest.json']])).toEqual([ghost]);
  });
});

// ── Registration behaviour (runs at collection time) ─────────────────────────
const registration: { skippedBodyCalls: number; readThrew: boolean; executed: number } = {
  skippedBodyCalls: 0,
  readThrew: false,
  executed: 0,
};
const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
describeWithExtensionSource(
  'portability probe — root absent',
  [['manifest.json']],
  (ext) => {
    registration.skippedBodyCalls += 1;
    try {
      ext.read('manifest.json');
    } catch {
      registration.readThrew = true;
    }
    it('MUST be reported as skipped, never run', () => {
      registration.executed += 1;
      throw new Error('a test needing the extension source ran without OMNIVYRA_EXTENSION_ROOT');
    });
  },
  {},
);
const warnedReason = warn.mock.calls.map((c) => String(c[0])).join('\n');
warn.mockRestore();

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-root-set-'));
fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
describeWithExtensionSource(
  'portability probe — root set',
  [['manifest.json']],
  (ext) => {
    afterAll(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    it('reads files from the configured root', () => {
      expect(JSON.parse(ext.read('manifest.json')).version).toBe('9.9.9');
    });
  },
  { [EXTENSION_ROOT_ENV]: fixtureRoot },
);

describe('missing root → skip with reason', () => {
  it('the dependent block was registered (so it is counted) but its test never executed', () => {
    expect(registration.skippedBodyCalls).toBe(1);
    expect(registration.executed).toBe(0);
  });
  it('reading source in a skipped block throws instead of returning content', () => {
    expect(registration.readThrew).toBe(true);
  });
  it('a loud, specific reason is emitted', () => {
    expect(warnedReason).toContain('SKIPPING "portability probe — root absent"');
    expect(warnedReason).toContain(`${EXTENSION_ROOT_ENV} is not set`);
  });
});
