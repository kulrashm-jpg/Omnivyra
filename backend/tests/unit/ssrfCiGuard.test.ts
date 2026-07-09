/**
 * HARDEN-005A — outbound-SSRF CI guard tests.
 *
 * Verifies:
 *   1. the guard DETECTS dynamic-URL outbound calls (fetch/axios/http.request
 *      with a bare variable),
 *   2. it ALLOWS trusted forms (constant URLs, const-host variables, wrapper
 *      calls, `// ssrf-ok` suppressions, local `fetch` shadows),
 *   3. the remaining externalApi base_url path is now protected (routes through
 *      safeFetch, no raw fetch/observedFetch), and the SSRF layer is wired into
 *      the other previously-open dynamic paths.
 */
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource } = require('../../../scripts/check-outbound-ssrf.js') as {
  scanSource: (src: string) => Array<{ line: number; call: string; arg: string }>;
};

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('CI guard — detects dynamic-URL outbound calls', () => {
  it('flags fetch(<variable>)', () => {
    const v = scanSource('async function f(url: string) {\n  const r = await fetch(url);\n}');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ call: 'fetch', arg: 'url' });
  });

  it('flags axios.get/post(<variable>)', () => {
    expect(scanSource('const r = await axios.get(endpoint);')).toHaveLength(1);
    expect(scanSource('const r = await axios.post(webhookUrl, body);')).toHaveLength(1);
  });

  it('flags a member-expression URL (input.sourceUrl)', () => {
    const v = scanSource('const r = await fetch(input.sourceUrl, init);');
    expect(v).toHaveLength(1);
    expect(v[0].arg).toBe('input.sourceUrl');
  });

  it('flags http(s).request(<variable>)', () => {
    expect(scanSource('const req = https.request(target);')).toHaveLength(1);
  });
});

describe('CI guard — allows trusted forms', () => {
  it('allows a string / template literal (constant URL)', () => {
    expect(scanSource("const r = await fetch('https://api.openai.com/v1');")).toHaveLength(0);
    expect(scanSource('const r = await fetch(`https://graph.facebook.com/${id}`);')).toHaveLength(0);
  });

  it('allows a variable proven to hold a fixed-host literal', () => {
    const src = 'const apiUrl = `https://graph.facebook.com/${id}/media`;\nconst r = await axios.post(apiUrl, body);';
    expect(scanSource(src)).toHaveLength(0);
  });

  it('allows a variable built from an UPPER_SNAKE constant base', () => {
    const src = 'const url = `${GRAPH_API}/me/threads`;\nconst r = await fetch(url);';
    expect(scanSource(src)).toHaveLength(0);
  });

  it('allows the centralized wrappers', () => {
    expect(scanSource('const r = await safeFetch(url, init, opts);')).toHaveLength(0);
    expect(scanSource('const b = await safeFetchBuffer(url);')).toHaveLength(0);
    expect(scanSource('await assertUrlSafe(url);')).toHaveLength(0);
  });

  it('allows a `// ssrf-ok:` suppression (same line or line above)', () => {
    expect(scanSource('const r = await fetch(url); // ssrf-ok: fixed host')).toHaveLength(0);
    expect(scanSource('// ssrf-ok: platform-returned upload URL\nconst r = await fetch(uploadUrl);')).toHaveLength(0);
  });

  it('allows a file with a local `fetch` shadow (not the global)', () => {
    const src = 'async function fetch(orgId: string) { return db(orgId); }\nconst { events } = await fetch(orgId);';
    expect(scanSource(src)).toHaveLength(0);
  });

  it('does not flag method DEFINITIONS named fetch or comments/prose', () => {
    expect(scanSource('  async fetch(orgId: string): Promise<X> {')).toHaveLength(0);
    expect(scanSource('  // N search pages + comment fetch(es) via the API')).toHaveLength(0);
    expect(scanSource('  rationale: `pages + ~${n} comment fetch(es)`,')).toHaveLength(0);
  });
});

describe('remaining path protected — externalApi base_url', () => {
  const src = read('backend/services/externalApi/internalHelpers.ts');
  it('routes the central external fetcher through safeFetch', () => {
    expect(src).toContain("from '../../../lib/security/safeFetch'");
    expect(src).toMatch(/return safeFetch\(url,/);
  });
  it('no longer uses observedFetch or a raw fetch(url)', () => {
    expect(src).not.toContain('observedFetch');
    expect(scanSource(src)).toHaveLength(0);
  });
});

describe('other previously-open dynamic paths are wired to the SSRF layer', () => {
  const files = [
    'backend/services/cms/BaseCmsAdapter.ts',
    'backend/services/integrationService.ts',
    'backend/services/socialPlatformPublisher.ts',
    'backend/services/creatorOcrProvider.ts',
    'backend/services/intelligence/oauthRefreshService.ts',
    'backend/services/intelligence/productionPrimitives.ts',
    'backend/services/publishReconciliationService.ts',
    'pages/api/accounts/[platform]/test.ts',
  ];
  for (const f of files) {
    it(`${f} imports safeFetch and has no unguarded dynamic call`, () => {
      const src = read(f);
      expect(src).toContain('lib/security/safeFetch');
      expect(scanSource(src)).toHaveLength(0);
    });
  }
});

describe('whole-repo guard is green (no bypasses remain)', () => {
  it('the scanner reports zero violations across backend/** and pages/api/**', () => {
    const { execFileSync } = require('child_process');
    // Exit 0 = PASS. Throws on non-zero (a real violation).
    const out = execFileSync('node', [path.join(REPO, 'scripts/check-outbound-ssrf.js')], { encoding: 'utf8' });
    expect(out).toContain('RESULT: PASS');
  });
});
