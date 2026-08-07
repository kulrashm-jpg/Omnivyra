/**
 * WS-0 Phase-8B — regression guard for the sanitizer's CommonJS loadability.
 *
 * THE INCIDENT THIS PREVENTS. `isomorphic-dompurify` resolves its `node`
 * condition to `dist/index.js`, which eagerly constructs a JSDOM at module load.
 * jsdom 27.4.0 added `@exodus/bytes` — an ESM-only package with no `require`
 * condition — and jsdom 27.3.0 already pulled an ESM-only `@csstools/css-calc`
 * through `cssstyle`. A CommonJS `require()` of an ES module only works on a
 * loader that implements `require(esm)`.
 *
 * Node 22.12+ implements it, so the failure is INVISIBLE locally and in CI.
 * The Vercel Lambda loader does NOT, so the same code threw ERR_REQUIRE_ESM in
 * production and returned 500 on every route reaching
 * `lib/security/htmlSanitizer.ts` — the HARDEN-003 XSS control.
 *
 * The guard therefore cannot simply `require()` the package in-process: this
 * runner has require(esm) enabled and would pass while production burned. It
 * spawns a child with `--no-experimental-require-module`, reproducing the
 * production loader's constraint exactly.
 *
 * Everything runs in ONE child process: loading the full jsdom graph costs
 * tens of seconds, and three spawns made the suite slow enough to time out
 * under parallel workers — a guard that flakes is worse than no guard.
 *
 * IF THIS FAILS: some dependency in the jsdom chain has regained an ESM-only
 * require. Do not delete this test and do not relax the flag — find the version
 * boundary and pin it in the `overrides` block of package.json, exactly as
 * `isomorphic-dompurify → jsdom` already is.
 */
import { execFileSync } from 'child_process';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** Loading the whole jsdom graph in a cold child is slow; 5s is not survivable. */
const CHILD_TIMEOUT_MS = 120_000;

interface Probe {
  loaded: boolean;
  esmFilesInGraph: string[];
  exodusBytes: string[];
  sanitized: { img: string; script: string; href: string };
}

const PROBE_SRC = `
  const D = require('isomorphic-dompurify');
  const files = Object.keys(require.cache).map((f) => f.split(require('path').sep).join('/'));
  process.stdout.write(JSON.stringify({
    loaded: true,
    // With require(esm) disabled a CommonJS graph cannot contain a single .mjs;
    // if one is here the loader silently changed under us.
    esmFilesInGraph: files.filter((f) => f.endsWith('.mjs')),
    exodusBytes: files.filter((f) => f.includes('@exodus/bytes')),
    sanitized: {
      img: D.sanitize('<img src=x onerror=alert(1)><b>ok</b>'),
      script: D.sanitize('<script>alert(1)</script><p>safe</p>'),
      href: D.sanitize('<a href="javascript:alert(1)">x</a>'),
    },
  }));
`;

describe('sanitizer CommonJS loadability (production loader parity)', () => {
  let probe: Probe;

  beforeAll(() => {
    const out = execFileSync(
      process.execPath,
      ['--no-experimental-require-module', '-e', PROBE_SRC],
      { cwd: repoRoot, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    probe = JSON.parse(out.trim()) as Probe;
  }, CHILD_TIMEOUT_MS);

  it('isomorphic-dompurify loads without require(esm) — the Vercel Lambda constraint', () => {
    expect(probe.loaded).toBe(true);
  });

  it('no ES module is present in the CommonJS load graph', () => {
    expect(probe.esmFilesInGraph).toEqual([]);
  });

  it('@exodus/bytes — the package the production trace named — is not loaded', () => {
    expect(probe.exodusBytes).toEqual([]);
  });

  it('XSS protection is intact when loaded under that constraint', () => {
    expect(probe.sanitized.img).not.toContain('onerror');
    expect(probe.sanitized.img).toContain('<b>ok</b>');
    expect(probe.sanitized.script).not.toContain('<script');
    expect(probe.sanitized.script).toContain('<p>safe</p>');
    expect(probe.sanitized.href).not.toContain('javascript:');
  });
});
