/**
 * STEP 3AH-91 (W2F-4) — the outbound-SSRF gate sees fetch ALIASES, and the
 * creator render provider's reference-image download goes through the SSRF
 * layer (lib/security/safeFetch) at runtime.
 *
 * Before: scripts/check-outbound-ssrf.js matched only `fetch(`, `axios.*(`
 * and `http(s).request(`; `const doFetch = cfg.fetchImpl || globalThis.fetch;
 * await doFetch(referenceUrl.trim(), …)` (openAIRenderProvider.ts:95/119 on
 * base) was invisible, and that fetch took a URL carried by persisted
 * production data with no scheme/host/private-range/redirect/size policy.
 */
import path from 'path';
import { spawnSync } from 'child_process';

/* eslint-disable @typescript-eslint/no-var-requires */
const scanner = require('../../../scripts/check-outbound-ssrf.js') as {
  scanSource: (src: string) => Array<{ line: number; call: string; arg: string }>;
  fetchAliases: (src: string) => Set<string>;
  REVIEWED_ALIAS_CALLS: Array<{ file: string; contains: string; reason: string }>;
};
const REPO = path.resolve(__dirname, '../../..');
const calls = (src: string) => scanner.scanSource(src).map((v) => `${v.call}(${v.arg})`);

describe('W2F-4 scanner — fetch aliases and injected fetch implementations', () => {
  it('`const doFetch = fetch` then a dynamic URL', () => {
    expect(calls('const doFetch = fetch;\nconst r = await doFetch(url, { method: "GET" });')).toEqual(['fetch-alias(url)']);
  });

  it('the pre-W2F-4 openAIRenderProvider shape (fallback to globalThis.fetch, `.trim()`-ed member URL)', () => {
    const src = [
      'const doFetch = cfg.fetchImpl || (globalThis.fetch as typeof fetch);',
      'const referenceUrl = spec.blueprint_projection.reference_image_url;',
      'const refResp = await doFetch(referenceUrl.trim(), { signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS) });',
      "const editResp = await doFetch('https://api.openai.com/v1/images/edits', { method: 'POST' });",
    ].join('\n');
    expect(calls(src)).toEqual(['fetch-alias(referenceUrl)']);
  });

  it('window.fetch.bind / undici.fetch aliases', () => {
    expect(calls('const f = window.fetch.bind(window);\nawait f(target);')).toEqual(['fetch-alias(target)']);
    expect(calls("const get = undici.fetch;\nreturn get(input.url);")).toEqual(['fetch-alias(input.url)']);
  });

  it('an injected fetchImpl called with a dynamic URL, and a dynamic-host template through an alias', () => {
    expect(calls('const r = await cfg.fetchImpl(u, init);')).toEqual(['fetch-alias(u)']);
    expect(calls('const r = await deps?.fetchImpl(target.href);')).toEqual(['fetch-alias(target.href)']);
    expect(calls('const doFetch = fetch;\nawait doFetch(`https://${host}/x`);')).toEqual(['fetch-alias(`https://${host}/x`)']);
  });

  it('a RAW fetch injected as another module\'s fetch implementation (flagged at the injection site)', () => {
    expect(calls('const p = createOpenAIRenderProvider({ fetchImpl: fetch });')).toHaveLength(1);
    expect(calls('detect(provider, siteUrl, { fetchFn: globalThis.fetch, timeoutMs });')).toHaveLength(1);
    expect(calls('const t = createTransport({ fetchImpl: window.fetch.bind(window) });')).toHaveLength(1);
  });
});

describe('W2F-4 scanner — shapes that must stay green', () => {
  it('a value that CALLS fetch is not an alias; a literal URL through an alias is fine', () => {
    expect(scanner.fetchAliases('const resp = await fetch("https://api.x.com/v1");')).toEqual(new Set());
    expect(calls("const doFetch = fetch;\nawait doFetch('https://api.openai.com/v1/images/generations', { method: 'POST' });")).toEqual([]);
  });

  it('aliases of the SSRF layer and SSRF-layer fetchers injected by name are not raw', () => {
    expect(calls('const f = safeFetch;\nawait f(url);')).toEqual([]);
    expect(calls('fetchFn: (url) => safeFetch(url, {}, { allowHttp: true }),')).toEqual([]);
    expect(calls('res = await ctx.fetcher(url, { allowedHosts: [host] });')).toEqual([]);
    expect(calls('batch = await fetcher(offset);')).toEqual([]);
  });

  it('a reviewed `// ssrf-ok: <reason>` suppresses an alias call', () => {
    expect(calls('// ssrf-ok: test seam only\nconst r = await cfg.fetchImpl(u, init);')).toEqual([]);
  });

  it('the repository passes; reviewed alias call sites are real and still match', () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/check-outbound-ssrf.js')], { cwd: REPO, encoding: 'utf8' });
    expect(r.stdout).toContain('RESULT: PASS');
    expect(r.stdout).not.toContain('WARN: reviewed alias call no longer matches');
    expect(r.status).toBe(0);
    for (const k of scanner.REVIEWED_ALIAS_CALLS) expect(k.reason.length).toBeGreaterThan(40);
  });

  it('the converted provider: its only dynamic-URL alias call is the annotated test seam', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(REPO, 'backend/services/creator/rendering/providers/openAIRenderProvider.ts'), 'utf8');
    expect(scanner.scanSource(src)).toEqual([]);
    expect(src).toMatch(/await safeFetch\(referenceUrl\.trim\(\)/);
    const withoutAnnotation = src.replace(/\/\/ ssrf-ok:[^\n]*\n/, '\n');
    expect(scanner.scanSource(withoutAnnotation).map((v) => v.call)).toEqual(['fetch-alias']);
  });
});

// ── behaviour: the reference image is downloaded through the SSRF layer ──

describe('openAIRenderProvider — runtime reference download goes through safeFetch', () => {
  const safeFetchModule = require('../../../lib/security/safeFetch');
  const { createOpenAIRenderProvider, REFERENCE_FETCH_TIMEOUT_MS } = require('../../services/creator/rendering/providers/openAIRenderProvider');
  const spec = (referenceUrl: string | null) => ({
    render_modality: 'image',
    canonical_asset_family: 'image',
    platform_projection: { resolution: { w: 1080, h: 1080 } },
    blueprint_projection: { visual_prompt: 'a lighthouse', scene_direction: 'dawn', reference_image_url: referenceUrl },
  });
  const realFetch = global.fetch;
  const prevMode = process.env.CREATOR_IMAGE_REFERENCE_MODE;
  let globalCalls: string[] = [];

  beforeEach(() => {
    process.env.CREATOR_IMAGE_REFERENCE_MODE = 'edit';
    globalCalls = [];
    global.fetch = jest.fn(async (url: unknown) => {
      globalCalls.push(String(url));
      if (String(url).includes('/images/edits')) return { ok: true, json: async () => ({ data: [{ url: 'https://img/edited.png' }] }) };
      return { ok: true, json: async () => ({ data: [{ url: 'https://img/plain.png' }] }) };
    }) as never;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    if (prevMode === undefined) delete process.env.CREATOR_IMAGE_REFERENCE_MODE; else process.env.CREATOR_IMAGE_REFERENCE_MODE = prevMode;
  });

  it('the reference URL goes to safeFetch (with SEC-D\'s AbortSignal and a matching SSRF timeout); only OpenAI hosts reach raw fetch', async () => {
    const spy = jest.spyOn(safeFetchModule, 'safeFetch').mockImplementation(async () => ({
      ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4),
    }) as never);
    jest.spyOn(safeFetchModule, 'readCapped').mockImplementation(async () => Buffer.from([1, 2, 3, 4]));
    const p = createOpenAIRenderProvider({ apiKey: 'sk-test-placeholder' });
    const handle = await p.submit(spec(' https://storage.example.test/ref.webp '), 'idem-1');
    expect((handle.provider_metadata as { mode?: string }).mode).toBe('edit-reference');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init, opts] = spy.mock.calls[0] as unknown as [string, { signal?: unknown; method?: string }, { timeoutMs?: number }];
    expect(url).toBe('https://storage.example.test/ref.webp');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(opts.timeoutMs).toBe(REFERENCE_FETCH_TIMEOUT_MS);
    expect(globalCalls).toEqual(['https://api.openai.com/v1/images/edits']);
  });

  it('a private / metadata / non-https reference is refused by the SSRF layer before any request, and generation falls back to plain', async () => {
    for (const ref of ['https://169.254.169.254/latest/meta-data/', 'http://storage.example.test/ref.webp', 'https://127.0.0.1:5432/']) {
      globalCalls = [];
      const p = createOpenAIRenderProvider({ apiKey: 'sk-test-placeholder' });
      const handle = await p.submit(spec(ref), 'idem-2');
      expect((handle.provider_metadata as { mode?: string }).mode).toBeUndefined();
      expect(globalCalls).toEqual(['https://api.openai.com/v1/images/generations']);
    }
  });

  it('an injected fetchImpl (composition/test seam) is still used as before', async () => {
    const fetchImpl = jest.fn(async (url: unknown) => (String(url).includes('/images/edits')
      ? { ok: true, json: async () => ({ data: [{ url: 'https://img/edited.png' }] }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
    const spy = jest.spyOn(safeFetchModule, 'safeFetch');
    const p = createOpenAIRenderProvider({ apiKey: 'sk-test-placeholder', fetchImpl: fetchImpl as never });
    await p.submit(spec('https://cdn.example/showcase.webp'), 'idem-3');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(spy).not.toHaveBeenCalled();
  });
});
