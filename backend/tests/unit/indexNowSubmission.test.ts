/**
 * IndexNow: key file, URL eligibility, duplicate suppression, local rate limiting, retries, outcomes.
 * Every request goes to an injected fake fetch; no network, no real key.
 */
import { eligibleIndexNowUrl, indexNowKeyFile, INDEXNOW_ENDPOINT, readIndexNowConfig, submitIndexNow, type IndexNowStore } from '../../services/indexNow/indexNow';

const ORIGIN = 'https://www.omnivyra.com';
// Fixture key, assembled at runtime: valid IndexNow shape, never a real key.
const KEY = ['fixture', 'indexnow', 'key', '0001'].join('-');
const cfg = (o: Partial<ReturnType<typeof readIndexNowConfig>> = {}) => ({ key: KEY, submitEnabled: true, publishKeyFile: true, origin: ORIGIN, ...o });
const store = (): IndexNowStore => ({ lastSent: new Map(), lastSubmitAt: null });

function fakeFetch(statuses: Array<number | 'throw'>, calls: Array<{ url: string; body: any }> = []): typeof fetch {
  let i = 0;
  return (async (url: any, init: any) => {
    const s = statuses[Math.min(i++, statuses.length - 1)];
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (s === 'throw') throw new Error(`socket hang up key=${KEY}`);
    return new Response(s === 200 ? '' : `error mentioning ${KEY}`, { status: s });
  }) as typeof fetch;
}
const page = (path: string) => ({ url: `${ORIGIN}${path}`, change: 'updated' as const });
const noSleep = async () => {};

describe('IndexNow configuration and key file', () => {
  it('reads the documented env names; a malformed key is absent; everything defaults off', () => {
    expect(readIndexNowConfig(ORIGIN + '/', { INDEXNOW_API_KEY: KEY })).toEqual({ key: KEY, submitEnabled: false, publishKeyFile: false, origin: ORIGIN });
    expect(readIndexNowConfig(ORIGIN, { INDEXNOW_API_KEY: 'short' }).key).toBeNull();
    expect(readIndexNowConfig(ORIGIN, { INDEXNOW_API_KEY: 'has space in it' }).key).toBeNull();
    expect(readIndexNowConfig(ORIGIN, { INDEXNOW_API_KEY: KEY, INDEXNOW_SUBMIT_ENABLED: 'true', INDEXNOW_PUBLISH_KEY_FILE: 'true' })).toMatchObject({ submitEnabled: true, publishKeyFile: true });
  });

  it('serves the key only for its exact name, and only when publishing is switched on', () => {
    expect(indexNowKeyFile(KEY, cfg())).toEqual({ status: 200, body: KEY });
    expect(indexNowKeyFile(KEY, cfg({ publishKeyFile: false }))).toEqual({ status: 404 });
    expect(indexNowKeyFile(KEY, cfg({ key: null }))).toEqual({ status: 404 });
    expect(indexNowKeyFile(`${KEY}x`, cfg())).toEqual({ status: 404 });
    expect(indexNowKeyFile(KEY.toUpperCase(), cfg())).toEqual({ status: 404 });
    expect(indexNowKeyFile('robots', cfg())).toEqual({ status: 404 });
    expect(indexNowKeyFile(undefined, cfg())).toEqual({ status: 404 });
  });
});

describe('IndexNow URL eligibility: only the site’s own sitemap pages', () => {
  it.each([
    ['https://www.omnivyra.com', 'https://www.omnivyra.com'],
    ['https://www.omnivyra.com/', 'https://www.omnivyra.com'],
    ['https://www.omnivyra.com/pricing', 'https://www.omnivyra.com/pricing'],
    ['https://WWW.OMNIVYRA.COM/about/', 'https://www.omnivyra.com/about'],
    ['https://www.omnivyra.com/blog', 'https://www.omnivyra.com/blog'],
    ['https://www.omnivyra.com/blog/ai-marketing-guide', 'https://www.omnivyra.com/blog/ai-marketing-guide'],
  ])('%s → eligible', (raw, url) => expect(eligibleIndexNowUrl(raw, ORIGIN)).toEqual({ ok: true, url }));

  it.each([
    ['http://www.omnivyra.com/pricing', 'not https'],
    ['https://omnivyra.com/pricing', 'not the canonical host'],
    ['https://evil.example/pricing', 'not the canonical host'],
    ['https://www.omnivyra.com.evil.example/pricing', 'not the canonical host'],
    ['https://user:pw@www.omnivyra.com/pricing', 'credentials or port in URL'],
    ['https://www.omnivyra.com:8443/pricing', 'credentials or port in URL'],
    ['https://www.omnivyra.com/pricing?ref=x', 'query or fragment'],
    ['https://www.omnivyra.com/pricing#plans', 'query or fragment'],
    ['https://www.omnivyra.com/blog/a%2Fb', 'encoded or dot path'],
    ['https://www.omnivyra.com/api/health', 'not a page listed in the site’s sitemaps'],
    ['https://www.omnivyra.com/auth/login', 'not a page listed in the site’s sitemaps'],
    ['https://www.omnivyra.com/super-admin', 'not a page listed in the site’s sitemaps'],
    ['https://www.omnivyra.com/reports/4bbd775b', 'not a page listed in the site’s sitemaps'],
    ['https://www.omnivyra.com/blog/Bad_Slug', 'not a page listed in the site’s sitemaps'],
    ['https://www.omnivyra.com/blog/a/b', 'not a page listed in the site’s sitemaps'],
    ['javascript:alert(1)', 'not https'],
    ['', 'not a URL'],
  ])('%s → rejected (%s)', (raw, reason) => expect(eligibleIndexNowUrl(raw, ORIGIN)).toEqual({ ok: false, reason }));

  it('rejects non-strings', () => expect(eligibleIndexNowUrl({ url: ORIGIN } as any, ORIGIN).ok).toBe(false));
});

describe('IndexNow submission', () => {
  it('fails closed: switched off or no key → no request at all', async () => {
    const calls: any[] = [];
    const off = await submitIndexNow([page('/pricing')], cfg({ submitEnabled: false }), { fetchImpl: fakeFetch([200], calls), store: store() });
    const nokey = await submitIndexNow([page('/pricing')], cfg({ key: null }), { fetchImpl: fakeFetch([200], calls), store: store() });
    expect([off.outcome, nokey.outcome]).toEqual(['disabled', 'not_configured']);
    expect(calls).toEqual([]);
  });

  it('posts the documented JSON body for eligible URLs only; 200 is "received", not indexed', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const r = await submitIndexNow([page('/pricing'), page('/pricing'), { url: 'https://evil.example/x', change: 'added' }, page('/blog/new-post')], cfg(), { fetchImpl: fakeFetch([200], calls), store: store() });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(INDEXNOW_ENDPOINT);
    expect(calls[0].body).toEqual({ host: 'www.omnivyra.com', key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList: [`${ORIGIN}/pricing`, `${ORIGIN}/blog/new-post`] });
    expect(r).toMatchObject({ outcome: 'received', httpStatus: 200, attempts: 1, submitted: [`${ORIGIN}/pricing`, `${ORIGIN}/blog/new-post`], suppressed: [`${ORIGIN}/pricing`] });
    expect(r.rejected).toEqual([{ url: 'https://evil.example/x', reason: 'not the canonical host' }]);
    expect(r.detail).toMatch(/does not mean the pages are indexed/);
  });

  it('suppresses a URL already received within the window, and holds back a submission sooner than the minimum interval', async () => {
    let t = 1_000_000;
    const s = store();
    const now = () => t;
    await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([200]), store: s, now });
    t += 30_000;
    const again = await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([200]), store: s, now });
    expect(again.outcome).toBe('nothing_to_submit');
    const tooSoon = await submitIndexNow([page('/about')], cfg(), { fetchImpl: fakeFetch([200]), store: s, now });
    expect(tooSoon).toMatchObject({ outcome: 'rate_limited_local', suppressed: [`${ORIGIN}/about`] });
    t += 3_600_000;
    expect((await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([200]), store: s, now })).outcome).toBe('received');
  });

  it('caps the batch and reports the rest as held back', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const r = await submitIndexNow([page('/pricing'), page('/about'), page('/landing')], cfg(), { fetchImpl: fakeFetch([200], calls), store: store(), maxBatch: 2 });
    expect(calls[0].body.urlList).toHaveLength(2);
    expect(r.suppressed).toEqual([`${ORIGIN}/landing`]);
  });

  it('retries 429 / 5xx / network failures with backoff, up to the limit', async () => {
    const waits: number[] = [];
    const r = await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([429, 'throw', 200]), store: store(), sleep: async (ms) => { waits.push(ms); } });
    expect(r).toMatchObject({ outcome: 'received', attempts: 3 });
    expect(waits).toEqual([1000, 2000]);
    const fail = await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([503]), store: store(), sleep: noSleep, maxRetries: 2 });
    expect(fail).toMatchObject({ outcome: 'failed', httpStatus: 503, attempts: 3, submitted: [] });
  });

  it.each([[202, 'received_key_pending'], [400, 'bad_request'], [403, 'key_invalid'], [422, 'urls_rejected']])('HTTP %i → %s, never retried, key never echoed', async (status, outcome) => {
    const calls: any[] = [];
    const r = await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([status], calls), store: store(), sleep: noSleep });
    expect(r.outcome).toBe(outcome);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a failed submission is not remembered, so it can be sent again', async () => {
    const s = store();
    await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch([403]), store: s, sleep: noSleep });
    expect(s.lastSent.size).toBe(0);
    expect(JSON.stringify((await submitIndexNow([page('/pricing')], cfg(), { fetchImpl: fakeFetch(['throw']), store: store(), sleep: noSleep, maxRetries: 0 })))).not.toContain(KEY);
  });
});
