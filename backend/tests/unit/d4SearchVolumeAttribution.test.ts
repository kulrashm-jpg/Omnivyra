/**
 * D4 — SEARCH VOLUME / GOOGLE TRENDS ATTRIBUTION.
 *
 * WHY THIS SUITE EXISTS. `/api/trending/current` read Google's hot-trends Atom
 * feed, matched the `<title>` elements out of it, and returned each topic as
 * `{ keyword, searchVolume: "High", trend: "Rising", category: "General",
 * source: "Google Trends" }`.
 *
 * Only `keyword` came from the feed. The other three were hardcoded literals
 * applied uniformly to every topic and stamped with a real provider's name, and
 * the UI rendered "High search volume" from them.
 *
 * The failure path was worse: three invented topics — ChatGPT, Climate Change,
 * Electric Vehicles — were returned, still attributed to Google Trends. That is
 * not a mislabelled measurement but manufactured evidence under a provider's
 * name.
 *
 * The distinction this suite keeps: SEARCH VOLUME is how many searches a term
 * receives. "Currently trending" is membership of a ranked list Google
 * publishes. The feed establishes the second and says nothing about the first,
 * so volume is `unavailable` — a finding, not a gap to fill with a word.
 *
 * SECRETS: all synthetic. No network; every provider is a controlled fixture.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// D4 - the feed is read through the canonical outbound seam (HARDEN-005), so that
// is what the fixture replaces. No network.
const safeFetch = jest.fn();
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import handler from '../../../pages/api/trending/current';
import {
  GOOGLE_TRENDS_SUPPORTED_EVIDENCE,
  googleTrendsSupports,
  googleTrendsTopic,
  googleTrendsUnavailable,
  parseHotTrendsFeed,
} from '../../services/trends/googleTrendsContract';

const realFetch = global.fetch;

/** The hot-trends Atom feed in its actual shape: titles, and nothing else. */
const HOT_TRENDS_FEED = `<?xml version="1.0"?>
<rss><channel>
<item><title><![CDATA[quantum computing]]></title></item>
<item><title><![CDATA[local election results]]></title></item>
</channel></rss>`;

const invoke = async (platforms = 'linkedin') => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as never;
  await (handler as unknown as (q: unknown, r: unknown) => Promise<void>)(
    { method: 'GET', query: { platforms } } as never,
    res,
  );
  return json.mock.calls[0][0];
};

/** Only Google Trends answers; every other provider fails. */
const trendsOnly = (feed: string | null) => {
  safeFetch.mockReset();
  readCapped.mockReset();
  if (feed === null) {
    safeFetch.mockResolvedValue({ ok: false } as never);
  } else {
    safeFetch.mockResolvedValue({ ok: true } as never);
    readCapped.mockResolvedValue(Buffer.from(feed) as never);
  }
  // Reddit / YouTube use the plain fetch path and are deliberately untouched.
  global.fetch = jest.fn(async () => ({ ok: false }) as never) as never;
};

afterEach(() => { global.fetch = realFetch; });

// ── 1. WHAT THE FEED ACTUALLY ESTABLISHES ───────────────────────────────────

describe('D4 — the hot-trends feed supports a trending signal, not a volume', () => {
  it('the contract does NOT declare search-volume support', () => {
    // The guard the whole fix rests on. Widening this set is the deliberate,
    // visible act that would be required before any volume claim is legitimate.
    expect(googleTrendsSupports('search_volume')).toBe(false);
    expect(googleTrendsSupports('trending_topic')).toBe(true);
    expect([...GOOGLE_TRENDS_SUPPORTED_EVIDENCE]).toEqual(['trending_topic']);
  });

  it('a topic carries an unavailable volume, not a qualitative word', () => {
    const topic = googleTrendsTopic('quantum computing');
    expect(topic.search_volume).toBeNull();
    expect(topic.search_volume_state).toBe('unavailable');
    // "High" was never a measurement; it must not reappear as one.
    expect(JSON.stringify(topic)).not.toContain('High');
  });

  it('the trending signal itself IS a real public observation', () => {
    // The fix must not flatten everything to "unknown": we did observe this term
    // on Google's published list, and that is worth saying.
    const topic = googleTrendsTopic('quantum computing');
    expect(topic.trend).toBe('Trending');
    expect(topic.search_interest_state).toBe('measured');
    expect(topic.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('the feed carries no category, so none is invented', () => {
    // `category: "General"` was as fabricated as the volume.
    expect(googleTrendsTopic('quantum computing').category).toBeNull();
  });

  it('parsing recovers the titles and nothing more', () => {
    expect(parseHotTrendsFeed(HOT_TRENDS_FEED)).toEqual(['quantum computing', 'local election results']);
    expect(parseHotTrendsFeed('<rss></rss>')).toEqual([]);
  });
});

// ── 2. THE API RESPONSE ─────────────────────────────────────────────────────

describe('D4 — the API never claims Google Trends search volume', () => {
  it('real trending topics reach the response without a volume claim', async () => {
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke();
    const items = body.trending.linkedin;
    expect(items.map((i: { keyword: string }) => i.keyword))
      .toEqual(['quantum computing', 'local election results']);
    for (const item of items) {
      expect(item.search_volume).toBeNull();
      expect(item.search_volume_state).toBe('unavailable');
      expect(item.searchVolume).toBeUndefined();
    }
  });

  it('no "High" is attributed to Google Trends anywhere in the response', async () => {
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke();
    const linkedinPayload = JSON.stringify({
      items: body.trending.linkedin,
      suggestions: body.suggestions.filter((s: { platform: string }) => s.platform === 'LinkedIn'),
    });
    expect(linkedinPayload).not.toContain('High');
    expect(linkedinPayload).not.toContain('Very High');
  });

  it('the AI suggestion carries the volume STATE, never a volume word', async () => {
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke();
    const suggestion = body.suggestions.find((s: { type: string }) => s.type === 'linkedin_trend');
    expect(suggestion.searchVolumeState).toBe('unavailable');
    expect(suggestion.searchVolume).toBeUndefined();
    expect(suggestion.source).toBe('Google Trends');
  });

  it('a failed feed yields NOTHING, not invented topics', async () => {
    // Pre-fix this returned ChatGPT / Climate Change / Electric Vehicles under
    // the Google Trends name.
    trendsOnly(null);
    const body = await invoke();
    expect(body.trending.linkedin).toEqual([]);
    const payload = JSON.stringify(body.trending.linkedin);
    for (const invented of ['ChatGPT', 'Climate Change', 'Electric Vehicles']) {
      expect(payload).not.toContain(invented);
    }
  });

  it('missing volume becomes unavailable — never zero', async () => {
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke();
    for (const item of body.trending.linkedin) {
      expect(item.search_volume).not.toBe(0);
      expect(item.search_volume).toBeNull();
      expect(item.search_volume_state).toBe('unavailable');
    }
  });
});

// ── 3. EXISTING BEHAVIOUR PRESERVED ─────────────────────────────────────────

describe('D4 — the rest of the trending route is untouched', () => {
  it('the endpoint still responds with its existing shape', async () => {
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke();
    for (const key of ['trending', 'suggestions', 'connectedPlatforms', 'timestamp', 'sources']) {
      expect(body).toHaveProperty(key);
    }
    expect(body.trending).toHaveProperty('lastUpdated');
  });

  it('other providers keep their own signals and are not renamed', async () => {
    // Scope discipline: D4 is the Google Trends attribution. Reddit's upvotes and
    // YouTube's shape are deliberately left exactly as they were.
    trendsOnly(HOT_TRENDS_FEED);
    const body = await invoke('linkedin,twitter,youtube');
    expect(body.trending.twitter[0]).toHaveProperty('upvotes');
    expect(body.trending.youtube[0]).toHaveProperty('views');
  });

  it('the keyword itself — the one thing the feed DID supply — survives', () => {
    expect(googleTrendsTopic('local election results').keyword).toBe('local election results');
    expect(googleTrendsUnavailable()).toEqual([]);
  });
});

// ── 4. THE RENDERER ─────────────────────────────────────────────────────────

describe('D4 — the customer-facing wording no longer claims volume', () => {
  const fs = require('fs');
  const raw: string = fs.readFileSync('pages/creative-scheduler.tsx', 'utf8');
  // Comments are stripped first: this file necessarily DISCUSSES the removed
  // expression in the note explaining why it went, and a guard that matched its
  // own documentation would fail forever.
  const ui = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');

  it('the trending card does not render a search-volume claim', () => {
    // Fixing the API alone would leave the false sentence on screen.
    expect(ui).not.toContain('{trend.searchVolume} search volume');
    expect(raw).toContain('Currently trending on Google');
  });

  it('no consumer reads a searchVolume field from the trending payload', () => {
    expect(ui).not.toMatch(/trend\.searchVolume/);
  });
});

// ── 5. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D4 — Google Trends cannot declare volume it does not provide', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const executable = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const productionFiles = (): string[] =>
    execSync('git ls-files --cached --others --exclude-standard -- "pages/api/*.ts" "backend/services/*.ts" "backend/services/**/*.ts"', { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));

  it('no production module pairs a Google Trends attribution with a volume literal', () => {
    // THE GUARD, at the source boundary: a module may name the provider, and a
    // module may talk about volume, but a module that does both while asserting a
    // qualitative literal is reintroducing the defect.
    const offenders = productionFiles().filter((file: string) => {
      const code = executable(fs.readFileSync(file, 'utf8'));
      if (!code.includes('Google Trends')) return false;
      return /searchVolume\s*:\s*["'](Very High|High|Medium|Low)["']/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('the trending route reaches the feed only through the contract', () => {
    const code = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    // The route no longer knows the endpoint at all: acquisition, parsing and the
    // capability declaration live together in the contract, so they cannot drift
    // apart. A route that fetched the feed itself could parse it its own way and
    // reintroduce a volume claim the contract never sanctioned.
    expect(code).toContain('fetchHotTrendsFeed()');
    expect(code).not.toContain('trends.google.com');
  });

  it('the feed is acquired through the canonical SSRF seam', () => {
    // HARDEN-005: `lib/security/safeFetch` is the one outbound path, and the
    // repo's SSRF scanner enforces it. Hoisting the URL into a constant turned a
    // literal fetch into a dynamic-URL call, which that guard caught.
    const contract = executable(fs.readFileSync('backend/services/trends/googleTrendsContract.ts', 'utf8'));
    expect(contract).toContain("import('../../../lib/security/safeFetch')");
    expect(contract).not.toMatch(/(?<!safe)\bfetch\(GOOGLE_TRENDS_HOT_TRENDS_FEED\)/);
  });

  it('no search-demand engine or provider was introduced', () => {
    // DG-002 established that search-demand intelligence already lives in
    // Report 2. D4 is an attribution fix and must not grow into a second one.
    const added = execSync('git diff --name-only --cached --diff-filter=A HEAD -- "backend/services" || true', { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const file of added) {
      expect(file).not.toMatch(/keywordVolume|searchDemand|demandEngine|trendEngine/i);
    }
  });
});
