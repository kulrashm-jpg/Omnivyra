/**
 * D5 — YOUTUBE TRENDING / FABRICATED EVIDENCE.
 *
 * WHY THIS SUITE EXISTS. `/api/trending/current` exposed `fetchYouTubeTrending()`
 * whose `try` block contained nothing but a literal array. No request was ever
 * made, so the `catch` under it was unreachable — there was no API that could
 * fail. It returned five hardcoded videos:
 *
 *   { keyword: "AI Revolution",     views: "2.3M", growth: "+45%", source: "YouTube" }
 *   { keyword: "Remote Work Tips",  views: "1.8M", growth: "+32%", source: "YouTube" }
 *   { keyword: "Sustainable Living",views: "3.1M", growth: "+67%", source: "YouTube" }
 *   { keyword: "Mental Health",     views: "4.2M", growth: "+89%", source: "YouTube" }
 *   { keyword: "Cryptocurrency",    views: "1.5M", growth: "+23%", source: "YouTube" }
 *
 * `getFallbackTrendingData()` carried three more ("AI Tutorials" 5.2M / +78%,
 * "Tech Reviews" 3.8M / +56%, "Gaming Content" 4.1M / +43%). Every field was
 * invented and every row was stamped with a real provider's name.
 *
 * The blast radius was customer-facing, not internal: the suggestion builder
 * emitted `"…" trending with 2.3M views`, the scheduler card rendered
 * `2.3M views` and `+45%`, the response advertised YouTube as a live "Free Tier"
 * source, and clicking the card wrote `Visual trend: <keyword> with 2.3M views`
 * into the customer's own post body.
 *
 * THE DISTINCTIONS THIS SUITE KEEPS.
 *   • TRENDING MEMBERSHIP — appearing on a list YouTube publishes. Acquirable in
 *     principle; Omnivyra has no sanctioned path to it from this route.
 *   • VIEW COUNT — a real figure YouTube publishes, from a surface this route
 *     does not have.
 *   • VIEW GROWTH RATE — "+45%". No YouTube surface publishes one, at any tier.
 *     Permanently unsupportable, not merely unavailable.
 *
 * The fix is silence, not a second invention: no credential, no registered
 * provider and no endpoint exist, so nothing is claimed.
 *
 * SECRETS: all synthetic. No network; every provider is a controlled fixture.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
// ROUTE-AUTH-001 (STEP 3AH-85): /api/trending/current now requires an authenticated caller.
// This suite pins the route's evidence contract, not authentication, so the identity
// provider is faked as a signed-in user (the 401 path is covered by routeAuth001AiContent).
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'route-auth-test-user' }, error: null }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// D4 established the canonical outbound seam for this route (HARDEN-005); the
// Google Trends feed is read through it, so that is what the fixture replaces.
const safeFetch = jest.fn();
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import handler from '../../../pages/api/trending/current';
import {
  YOUTUBE_TRENDS_SOURCE_LABEL,
  YOUTUBE_TRENDS_SUPPORTED_EVIDENCE,
  YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE,
  youTubeTrendingObservation,
  youTubeTrendingUnavailable,
  youTubeTrendsAcquisition,
  youTubeTrendsSupports,
} from '../../services/trends/youtubeTrendsContract';

const realFetch = global.fetch;

/** Every fabricated string the defect published, in the exact form it published them. */
const FABRICATED_VIEWS = ['2.3M', '1.8M', '3.1M', '4.2M', '1.5M', '5.2M', '3.8M', '4.1M'];
const FABRICATED_GROWTH = ['+45%', '+32%', '+67%', '+89%', '+23%', '+78%', '+56%', '+43%'];
const FABRICATED_KEYWORDS = [
  'Sustainable Living', 'Remote Work Tips', 'Cryptocurrency',
  'AI Tutorials', 'Tech Reviews', 'Gaming Content',
];

const invoke = async (platforms = 'instagram,youtube') => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as never;
  await (handler as unknown as (q: unknown, r: unknown) => Promise<void>)(
    { method: 'GET', query: { platforms } } as never,
    res,
  );
  return json.mock.calls[0][0];
};

/** No provider answers. The route must still not invent YouTube rows. */
const nothingAnswers = () => {
  safeFetch.mockReset();
  readCapped.mockReset();
  safeFetch.mockResolvedValue({ ok: false } as never);
  global.fetch = jest.fn(async () => ({ ok: false }) as never) as never;
};

afterEach(() => { global.fetch = realFetch; });

// ── 1. WHAT OMNIVYRA CAN ACTUALLY ESTABLISH ABOUT YOUTUBE ───────────────────

describe('D5 — the contract declares no YouTube trending capability', () => {
  it('nothing is declared supportable under the YouTube name', () => {
    // The guard the whole fix rests on. Widening this set is the deliberate,
    // visible act that would be required before ANY YouTube claim is legitimate,
    // and it cannot be done honestly without a credential and an endpoint.
    expect([...YOUTUBE_TRENDS_SUPPORTED_EVIDENCE]).toEqual([]);
    expect(youTubeTrendsSupports('trending_video')).toBe(false);
    expect(youTubeTrendsSupports('view_count')).toBe(false);
  });

  it('a view growth rate is permanently unsupportable, not merely unavailable', () => {
    // "+45%" is the sharpest part of the defect: YouTube publishes view, like and
    // comment counts and no growth percentage anywhere. Provisioning a key would
    // not make this acquirable, so widening the supported set can never reach it.
    expect(YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE.has('view_growth_rate')).toBe(true);
    expect(youTubeTrendsSupports('view_growth_rate')).toBe(false);
  });

  it('the supported and unsupportable sets never overlap', () => {
    const overlap = [...YOUTUBE_TRENDS_SUPPORTED_EVIDENCE]
      .filter((e) => YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE.has(e));
    expect(overlap).toEqual([]);
  });

  it('acquisition is unavailable, and says why', () => {
    const acquisition = youTubeTrendsAcquisition();
    expect(acquisition.available).toBe(false);
    // The reason is derived from the capability declaration, not stored beside
    // it, so the two can never disagree.
    expect(acquisition.available === false && acquisition.reason).toMatch(/no sanctioned/i);
  });

  it('the unavailable state is an empty list, never a substitute row', () => {
    // The fix must not swap one invention for another.
    expect(youTubeTrendingUnavailable()).toEqual([]);
  });
});

// ── 2. THE OBSERVATION SHAPE CONSUMERS ARE WRITTEN AGAINST ──────────────────

describe('D5 — a YouTube row cannot carry a view count or a growth rate', () => {
  it('views and growth are null and stated unavailable', () => {
    const row = youTubeTrendingObservation('quantum computing');
    expect(row.views).toBeNull();
    expect(row.views_state).toBe('unavailable');
    expect(row.growth).toBeNull();
    expect(row.growth_state).toBe('unavailable');
  });

  it('no fabricated literal can appear in an observation', () => {
    const serialized = JSON.stringify(youTubeTrendingObservation('quantum computing'));
    for (const literal of [...FABRICATED_VIEWS, ...FABRICATED_GROWTH]) {
      expect(serialized).not.toContain(literal);
    }
  });

  it('missing views become unavailable — never zero, never "0 views"', () => {
    const row = youTubeTrendingObservation('quantum computing');
    expect(row.views).not.toBe(0);
    expect(row.views).not.toBe('0');
    expect(row.views_state).not.toBe('measured');
    expect(row.views_state).not.toBe('inferred');
  });

  it('the row keeps the trending signal honest and invents no category', () => {
    // The fix must not flatten everything to "unknown" either: membership of a
    // published list IS a real observation, and that is what the row would say.
    const row = youTubeTrendingObservation('quantum computing');
    expect(row.trend).toBe('Trending');
    expect(row.trending_state).toBe('measured');
    expect(row.provenance).toBe('PUBLIC_OBSERVED');
    // `category: "Technology"` / "Lifestyle" / "Health" were as fabricated as the views.
    expect(row.category).toBeNull();
    expect(row.source).toBe(YOUTUBE_TRENDS_SOURCE_LABEL);
  });

  it('the evidence states come from the existing vocabulary', () => {
    const allowed = ['measured', 'inferred', 'insufficient_signal', 'unavailable'];
    const row = youTubeTrendingObservation('quantum computing');
    for (const state of [row.trending_state, row.views_state, row.growth_state]) {
      expect(allowed).toContain(state);
    }
  });
});

// ── 3. THE API RESPONSE ─────────────────────────────────────────────────────

describe('D5 — the API publishes no fabricated YouTube observation', () => {
  it('the YouTube-sourced keys are empty, not populated with mock videos', async () => {
    nothingAnswers();
    const body = await invoke();
    // Both keys are YouTube-sourced: `instagram` was fed by fetchYouTubeTrending too.
    expect(body.trending.instagram).toEqual([]);
    expect(body.trending.youtube).toEqual([]);
  });

  it('not one invented keyword, view count or growth rate reaches the response', async () => {
    nothingAnswers();
    const body = await invoke('linkedin,twitter,instagram,facebook,youtube');
    const payload = JSON.stringify({
      instagram: body.trending.instagram,
      youtube: body.trending.youtube,
      suggestions: body.suggestions.filter(
        (s: { source: string }) => s.source === 'YouTube',
      ),
    });
    for (const literal of [...FABRICATED_VIEWS, ...FABRICATED_GROWTH, ...FABRICATED_KEYWORDS]) {
      expect(payload).not.toContain(literal);
    }
  });

  it('the fallback path invents nothing either', async () => {
    // getFallbackTrendingData() published three more fabricated videos. Force the
    // failure path by making the aggregate throw.
    nothingAnswers();
    global.fetch = jest.fn(async () => { throw new Error('network down'); }) as never;
    const body = await invoke();
    expect(body.trending.instagram).toEqual([]);
    expect(body.trending.youtube).toEqual([]);
    const payload = JSON.stringify(body.trending);
    for (const literal of ['AI Tutorials', 'Tech Reviews', 'Gaming Content', '5.2M', '+78%']) {
      expect(payload).not.toContain(literal);
    }
  });

  it('no YouTube-sourced suggestion is emitted at all', async () => {
    nothingAnswers();
    const body = await invoke();
    const youtubeSuggestions = body.suggestions.filter(
      (s: { type: string }) => s.type === 'instagram_trend' || s.type === 'youtube_trend',
    );
    expect(youtubeSuggestions).toEqual([]);
  });

  it('the response no longer advertises YouTube as a live free-tier source', async () => {
    // `status: "Free Tier"` told the customer a YouTube integration was running.
    // None exists — no credential, no registered provider, no endpoint.
    nothingAnswers();
    const body = await invoke();
    const youtubeSources = body.sources.filter((s: { name: string }) => s.name === 'YouTube');
    expect(youtubeSources).toHaveLength(2);
    for (const source of youtubeSources) {
      expect(source.status).toBe('Unavailable');
      expect(source.status).not.toBe('Free Tier');
    }
  });
});

// ── 4. EXISTING BEHAVIOUR PRESERVED ─────────────────────────────────────────

describe('D5 — the rest of the trending route is untouched', () => {
  it('the endpoint still responds with its existing shape', async () => {
    nothingAnswers();
    const body = await invoke();
    for (const key of ['trending', 'suggestions', 'connectedPlatforms', 'timestamp', 'sources']) {
      expect(body).toHaveProperty(key);
    }
    expect(body.trending).toHaveProperty('lastUpdated');
    // The keys survive as keys — D5 removes fabricated rows, it does not remove
    // the contract the consumer reads.
    for (const key of ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube']) {
      expect(Array.isArray(body.trending[key])).toBe(true);
    }
  });

  it('other providers keep their own signals and are not renamed', async () => {
    // Scope discipline: D5 is the YouTube fabrication. D4's Google Trends fix and
    // the Reddit path are deliberately left exactly as they are.
    nothingAnswers();
    const body = await invoke('linkedin,twitter,facebook');
    expect(body.trending).toHaveProperty('twitter');
    expect(body.trending).toHaveProperty('facebook');
    expect(body.sources.some((s: { name: string }) => s.name === 'Reddit')).toBe(true);
    expect(body.sources.some((s: { name: string }) => s.name === 'Google Trends')).toBe(true);
  });
});

// ── 5. THE RENDERER AND THE GENERATED POST ──────────────────────────────────

describe('D5 — the customer-facing wording claims no views or growth', () => {
  const fs = require('fs');
  const raw: string = fs.readFileSync('pages/creative-scheduler.tsx', 'utf8');
  // Comments are stripped first: this file necessarily DISCUSSES the removed
  // expressions in the notes explaining why they went, and a guard that matched
  // its own documentation would fail forever.
  const ui = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  it('the trending card renders no view count and no growth rate', () => {
    // Fixing the API alone would leave the false numbers on screen.
    expect(ui).not.toContain('{trend.views} views');
    expect(ui).not.toMatch(/trend\.views/);
    expect(ui).not.toMatch(/trend\.growth/);
  });

  it('the generated post body no longer embeds a fabricated view count', () => {
    // The worst consumer: clicking the card wrote the invented figure into the
    // customer's own draft, where it outlives the API response entirely.
    expect(ui).not.toContain('with ${trend.views} views');
    expect(raw).toContain('content: `Visual trend: ${trend.keyword}`');
  });

  it('the Reddit-sourced cards keep their own signal', () => {
    // Scope discipline in the other direction: upvotes are not D5's to remove.
    expect(ui).toMatch(/trend\.upvotes/);
  });
});

// ── 6. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D5 — YouTube cannot be re-attributed evidence it never supplied', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const executable = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const productionFiles = (): string[] =>
    execSync('git ls-files --cached --others --exclude-standard -- "pages/api/*.ts" "pages/api/**/*.ts" "backend/services/*.ts" "backend/services/**/*.ts"', { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));

  it('no production module pairs a YouTube attribution with an invented metric literal', () => {
    // THE GUARD, at the source boundary: a module may name YouTube, and a module
    // may talk about views, but a module that does both while asserting a
    // human-formatted count or a growth percentage is reintroducing the defect.
    const offenders = productionFiles().filter((file: string) => {
      const code = executable(fs.readFileSync(file, 'utf8'));
      if (!code.includes('"YouTube"') && !code.includes("'YouTube'")) return false;
      return /views\s*:\s*["'][\d.]+[KMB]["']/.test(code)
        || /growth\s*:\s*["'][+-]?\d+%["']/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('the trending route reaches YouTube only through the contract', () => {
    const code = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    // The route no longer holds any YouTube data or endpoint of its own:
    // acquisition, capability and the unavailable state live together in the
    // contract, so they cannot drift apart. A route that built its own rows could
    // reintroduce a metric the contract never sanctioned.
    expect(code).toContain('youTubeTrendsAcquisition()');
    expect(code).toContain('youTubeTrendingUnavailable()');
    expect(code).not.toContain('mockTrendingVideos');
    expect(code).not.toContain('googleapis.com/youtube');
  });

  it('the YouTube suggestion builder reads no view count and no growth rate', () => {
    // This one MUST be static. Because nothing is acquired, the suggestion loops
    // never execute, so a runtime assertion cannot see `${trend.views}` come back
    // into the text or `engagement: trend.growth` come back into the payload —
    // the mutation battery proved exactly that blind spot. The source is the only
    // place the constraint can be held until acquisition exists, and it is where
    // it matters: the day a row is produced, these reads would publish `null` or
    // a fabricated figure with no test standing in the way.
    const code = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    expect(code).not.toMatch(/trend\.views(?!_state)/);
    expect(code).not.toMatch(/trend\.growth(?!_state)/);
    // Only the STATES travel, the way D4's suggestion carries search_volume_state.
    expect(code).toContain('viewsState: trend.views_state');
    expect(code).toContain('growthState: trend.growth_state');
    expect(code).not.toMatch(/engagement\s*:/);
  });

  it('the contract performs no outbound call, because there is nothing sanctioned to call', () => {
    const contract = executable(
      fs.readFileSync('backend/services/trends/youtubeTrendsContract.ts', 'utf8'),
    );
    // HARDEN-005: had an endpoint existed it would have to go through
    // lib/security/safeFetch. None does, so the contract must not fetch at all —
    // and must certainly not do it with a raw client.
    expect(contract).not.toMatch(/(?<![.\w])fetch\s*\(/);
    expect(contract).not.toMatch(/axios/);
    expect(contract).not.toContain('googleapis.com');
  });

  it('no YouTube provider, credential or acquisition layer was invented', () => {
    // The audit finding this fix rests on: YOUTUBE_API_KEY is registered neither
    // in the env schema nor in PROVIDER_CREDENTIALS, and providerCatalog declares
    // no youtube provider. D5 is an evidence fix and must not quietly become a
    // provider onboarding.
    const schema = fs.readFileSync('config/env.schema.ts', 'utf8');
    expect(schema).not.toContain('YOUTUBE_API_KEY');
    const resolver = executable(fs.readFileSync('backend/services/providerCredentialResolver.ts', 'utf8'));
    expect(resolver).not.toMatch(/youtube\s*:/);
    const added = execSync('git diff --name-only --diff-filter=A HEAD -- "backend/services" || true', { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const file of added) {
      expect(file).not.toMatch(/youtubeProvider|youtubeTrendEngine|trendAcquisition/i);
    }
  });
});
