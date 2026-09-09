/**
 * D6 — REDDIT FALLBACK FABRICATION.
 *
 * WHY THIS SUITE EXISTS. `/api/trending/current` really did call
 * `https://www.reddit.com/r/popular.json`. The success path was honest. The
 * FAILURE path invented rows:
 *
 *   { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", … }
 *   { keyword: "Remote Work",   upvotes: 12300, subreddit: "workfromhome", … }
 *
 * Two topics, two communities and two precise upvote counts, none of them
 * observed, all stamped `source: "Reddit"`. Because the same Reddit call feeds
 * BOTH the Twitter and the Facebook lane, `getFallbackTrendingData()` repeated
 * the class twice more (Facebook carried 18,700 and 14,200). The scheduler
 * rendered those numbers next to the subreddit name, and clicking the card wrote
 * `r/workfromhome` into the customer's draft.
 *
 * The distinction this suite keeps:
 *   listing read, score published  → a real measurement
 *   listing read, score withheld   → insufficient_signal, never a zero
 *   listing not read               → nothing at all, never a substitute
 *
 * SECRETS: all synthetic. No network; every provider is a controlled fixture.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// D6 - the listing is read through the canonical outbound seam (HARDEN-005), so
// that is what the fixture replaces. No network.
const safeFetch = jest.fn();
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import handler from '../../../pages/api/trending/current';
import {
  REDDIT_POPULAR_LISTING,
  REDDIT_SUPPORTED_EVIDENCE,
  parsePopularListing,
  redditSupports,
  redditTrendingPost,
  redditTrendingPosts,
  redditTrendingUnavailable,
} from '../../services/trends/redditTrendingContract';

const realFetch = global.fetch;

/** The invented values the pre-fix code emitted. None may reappear anywhere. */
const FABRICATED = ['15420', '12300', '18700', '14200', 'workfromhome', 'selfimprovement', 'socialskills'];

/** A listing in its actual shape. */
const LISTING = {
  data: {
    children: [
      { data: { title: 'Ask HN style thread', ups: 431, subreddit: 'programming' } },
      { data: { title: 'Local bridge reopens', ups: 12, subreddit: 'nyc' } },
    ],
  },
};

const child = (over: Record<string, unknown>) => ({
  data: { title: 'a post', ups: 5, subreddit: 'somewhere', ...over },
});

/**
 * Only Reddit answers; Google Trends fails. The two providers now share the
 * outbound seam, so the fixture dispatches on the URL.
 */
const redditOnly = (listing: unknown | 'unreadable') => {
  safeFetch.mockReset();
  readCapped.mockReset();
  safeFetch.mockImplementation(async (url: string) => {
    if (url === REDDIT_POPULAR_LISTING) {
      if (listing === 'unreadable') return { ok: false } as never;
      return { ok: true, __body: JSON.stringify(listing) } as never;
    }
    return { ok: false } as never; // Google Trends: deliberately silent.
  });
  readCapped.mockImplementation(async (res: unknown) =>
    Buffer.from((res as { __body?: string })?.__body ?? ''));
  // YouTube still uses its own path and is deliberately untouched by D6.
  global.fetch = jest.fn(async () => ({ ok: false }) as never) as never;
};

const invoke = async (platforms = 'twitter,facebook') => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as never;
  await (handler as unknown as (q: unknown, r: unknown) => Promise<void>)(
    { method: 'GET', query: { platforms } } as never,
    res,
  );
  return json.mock.calls[0][0];
};

afterEach(() => { global.fetch = realFetch; });

// ── 1. WHAT THE LISTING ACTUALLY ESTABLISHES ────────────────────────────────

describe('D6 — the popular listing supports observed posts, and only those', () => {
  it('the contract declares exactly what the listing carries', () => {
    expect(redditSupports('post_score')).toBe(true);
    expect(redditSupports('popular_listing_membership')).toBe(true);
    expect(redditSupports('post_subreddit')).toBe(true);
    // Nothing modelled, estimated or filled in is supportable by this source.
    expect(redditSupports('estimated_engagement')).toBe(false);
    expect([...REDDIT_SUPPORTED_EVIDENCE].sort())
      .toEqual(['popular_listing_membership', 'post_score', 'post_subreddit']);
  });

  it('a published score IS a real observation and is kept as one', () => {
    // The fix must not flatten a genuine reading to "unknown": Reddit stated
    // this number publicly, and we read it.
    const post = redditTrendingPost(child({ title: 'Ask HN style thread', ups: 431, subreddit: 'programming' }));
    expect(post).toEqual({
      keyword: 'Ask HN style thread',
      subreddit: 'programming',
      upvotes: 431,
      upvotes_state: 'measured',
      category: null,
      source: 'Reddit',
      provenance: 'PUBLIC_OBSERVED',
    });
  });

  it('a score Reddit withholds is insufficient_signal — never a zero', () => {
    // Reddit hides the score on new posts. "Observed the post, did not observe
    // the score" is a third state, and 0 would read as "nobody upvoted this".
    const hidden = redditTrendingPost(child({ ups: 7, score_hidden: true }));
    expect(hidden?.upvotes).toBeNull();
    expect(hidden?.upvotes).not.toBe(0);
    expect(hidden?.upvotes_state).toBe('insufficient_signal');
  });

  it('a missing or non-numeric score is insufficient_signal, not invented', () => {
    for (const over of [{ ups: undefined }, { ups: null }, { ups: 'lots' }, { ups: NaN }]) {
      const post = redditTrendingPost(child(over as Record<string, unknown>));
      expect(post?.upvotes).toBeNull();
      expect(post?.upvotes_state).toBe('insufficient_signal');
    }
  });

  it('the listing carries no category, so none is invented', () => {
    // `category: "Reddit"` was the provider's name sitting in a category field.
    expect(redditTrendingPost(child({}))?.category).toBeNull();
  });

  it('a child without a title or a community yields no row at all', () => {
    // A row cannot be completed from thin air; it is dropped instead.
    expect(redditTrendingPost(child({ title: '' }))).toBeNull();
    expect(redditTrendingPost(child({ subreddit: '   ' }))).toBeNull();
    expect(redditTrendingPost({} as never)).toBeNull();
  });

  it('parsing recovers listing children and nothing more', () => {
    expect(parsePopularListing(LISTING)).toHaveLength(2);
    for (const junk of [null, undefined, {}, { data: {} }, { data: { children: 'no' } }, 'text']) {
      expect(parsePopularListing(junk)).toEqual([]);
    }
  });

  it('the honest answer to an unreadable listing is an empty list', () => {
    expect(redditTrendingUnavailable()).toEqual([]);
    expect(redditTrendingPosts(null)).toEqual([]);
    expect(redditTrendingPosts({ data: { children: [] } })).toEqual([]);
  });

  it('the limit is applied to observed posts, not padded up to it', () => {
    const many = { data: { children: Array.from({ length: 9 }, () => child({})) } };
    expect(redditTrendingPosts(many)).toHaveLength(5);
    expect(redditTrendingPosts(LISTING)).toHaveLength(2);
  });
});

// ── 2. THE API RESPONSE ─────────────────────────────────────────────────────

describe('D6 — the API never claims Reddit engagement it did not read', () => {
  it('observed posts reach both Reddit-backed lanes with a measured state', async () => {
    redditOnly(LISTING);
    const body = await invoke();
    for (const lane of ['twitter', 'facebook'] as const) {
      expect(body.trending[lane].map((i: { keyword: string }) => i.keyword))
        .toEqual(['Ask HN style thread', 'Local bridge reopens']);
      expect(body.trending[lane][0].upvotes).toBe(431);
      expect(body.trending[lane][0].upvotes_state).toBe('measured');
      expect(body.trending[lane][0].subreddit).toBe('programming');
    }
  });

  it('an unreadable listing yields NOTHING in either lane, not invented posts', async () => {
    // Pre-fix this returned AI Revolution / Remote Work on the twitter lane and
    // Mental Health / Community Building on the facebook lane, under the Reddit
    // name, with precise upvote counts.
    redditOnly('unreadable');
    const body = await invoke();
    expect(body.trending.twitter).toEqual([]);
    expect(body.trending.facebook).toEqual([]);
  });

  it('no fabricated Reddit value appears anywhere in a failed response', async () => {
    redditOnly('unreadable');
    const payload = JSON.stringify(await invoke('linkedin,twitter,facebook'));
    for (const invented of FABRICATED) expect(payload).not.toContain(invented);
  });

  it('the Reddit-derived suggestions vanish with the observations', async () => {
    redditOnly('unreadable');
    const body = await invoke();
    const reddit = body.suggestions.filter(
      (s: { type: string }) => s.type === 'twitter_trend' || s.type === 'facebook_trend');
    expect(reddit).toEqual([]);
  });

  it('a real suggestion carries the upvote STATE alongside the number', async () => {
    redditOnly(LISTING);
    const body = await invoke();
    const suggestion = body.suggestions.find((s: { type: string }) => s.type === 'twitter_trend');
    expect(suggestion.upvotes).toBe(431);
    expect(suggestion.upvotesState).toBe('measured');
    expect(suggestion.source).toBe('Reddit');
    expect(suggestion.text).toContain('r/programming');
  });

  it('a withheld score reaches the suggestion as a state, not as a number', async () => {
    redditOnly({ data: { children: [child({ title: 'Brand new post', score_hidden: true })] } });
    const body = await invoke();
    const suggestion = body.suggestions.find((s: { type: string }) => s.type === 'facebook_trend');
    expect(suggestion.upvotes).toBeNull();
    expect(suggestion.upvotesState).toBe('insufficient_signal');
  });

  it('the generated draft text is built only from observed fields', async () => {
    // The scheduler writes `trending on r/<subreddit>` into the customer's post.
    // Pre-fix that could seed a draft with r/workfromhome, a community nobody read.
    redditOnly(LISTING);
    const body = await invoke();
    for (const s of body.suggestions.filter((x: { source: string }) => x.source === 'Reddit')) {
      expect(['Ask HN style thread', 'Local bridge reopens']).toContain(s.text.split('"')[1]);
    }
  });
});

// ── 3. EXISTING BEHAVIOUR PRESERVED ─────────────────────────────────────────

describe('D6 — the rest of the trending route is untouched', () => {
  it('the endpoint still responds with its existing shape', async () => {
    redditOnly(LISTING);
    const body = await invoke('linkedin,twitter,instagram,facebook,youtube');
    for (const key of ['trending', 'suggestions', 'connectedPlatforms', 'timestamp', 'sources']) {
      expect(body).toHaveProperty(key);
    }
    expect(body.trending).toHaveProperty('lastUpdated');
    expect(body.trending.twitter[0]).toHaveProperty('upvotes');
  });

  it('the other providers keep their own signals and are not renamed', async () => {
    // Scope discipline: D6 is the Reddit fabrication. Google Trends (D4) and the
    // YouTube lanes are deliberately left exactly as D6 found them.
    //
    // RECONCILED WITH D5: this originally asserted `youtube[0].views` and
    // `instagram[0].growth`, which held while D6 stood alone — those lanes still
    // carried YouTube's fabricated "5.2M" / "+78%". D5 removed the rows that
    // carried them, so under this fixture (which fails every provider but Reddit)
    // both lanes are now honestly empty.
    //
    // The claim under test is unchanged: D6 did not rename or repurpose another
    // provider's lane. Asserted exactly — `toEqual([])` distinguishes an honestly
    // empty lane from one refilled with fabrications, which `Array.isArray` or a
    // property check would not.
    redditOnly(LISTING);
    const body = await invoke('linkedin,twitter,instagram,youtube');
    expect(body.trending.linkedin).toEqual([]); // D4's honest silence, unchanged.
    expect(body.trending.youtube).toEqual([]);  // D5's honest silence.
    expect(body.trending.instagram).toEqual([]); // D5's honest silence.
    // Reddit itself answered, so its lane still carries a real observation.
    expect(body.trending.twitter.length).toBeGreaterThan(0);
  });

  it('unconnected platforms still produce no suggestions', async () => {
    redditOnly(LISTING);
    const body = await invoke('linkedin');
    expect(body.suggestions.filter((s: { source: string }) => s.source === 'Reddit')).toEqual([]);
  });
});

// ── 4. THE RENDERER ─────────────────────────────────────────────────────────

describe('D6 — the customer-facing card no longer shows unobserved engagement', () => {
  const fs = require('fs');
  const raw: string = fs.readFileSync('pages/creative-scheduler.tsx', 'utf8');
  // Comments are stripped first: this file necessarily DISCUSSES the removed
  // expression in the note explaining why it went, and a guard that matched its
  // own documentation would fail forever.
  const ui = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');

  it('neither Reddit-backed card renders a bare upvote count', () => {
    // Fixing the API alone would still print `null` on a score Reddit withheld.
    expect(ui).not.toContain('{trend.upvotes}');
  });

  it('the score renders only when Reddit published it', () => {
    const guarded = ui.match(/trend\.upvotes_state === 'measured' \? trend\.upvotes/g) ?? [];
    // Twitter and Facebook: the same Reddit observation, rendered twice.
    expect(guarded).toHaveLength(2);
    expect(ui).toContain('Score hidden');
  });

  it('no fabricated Reddit value is hardcoded in the renderer', () => {
    for (const invented of FABRICATED) expect(ui).not.toContain(invented);
  });
});

// ── 5. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D6 — no production module can invent Reddit engagement', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const executable = (code: string): string => code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const productionFiles = (): string[] =>
    execSync('git ls-files --cached --others --exclude-standard -- "pages/api/*.ts" "pages/api/**/*.ts" "backend/services/*.ts" "backend/services/**/*.ts"', { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));

  it('no module pairs a Reddit attribution with a hardcoded upvote count', () => {
    // THE GUARD, at the source boundary: a module may name Reddit, and a module
    // may carry an upvote number that it READ. A module that writes a numeric
    // upvote literal beside the provider's name is inventing evidence.
    const offenders = productionFiles().filter((file: string) => {
      const code = executable(fs.readFileSync(file, 'utf8'));
      if (!code.includes('Reddit')) return false;
      return /upvotes\s*:\s*\d/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('the trending route reaches the listing only through the contract', () => {
    const code = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    // The route no longer knows the endpoint: acquisition, parsing and the
    // capability declaration live together in the contract, so they cannot drift.
    // A route that fetched the listing itself could shape it its own way and
    // reintroduce a fallback the contract never sanctioned.
    expect(code).toContain('fetchPopularListing()');
    expect(code).toContain('redditTrendingUnavailable()');
    expect(code).not.toContain('reddit.com');
  });

  it('both Reddit-backed fallback lanes are the empty observation', () => {
    const code = executable(fs.readFileSync('pages/api/trending/current.ts', 'utf8'));
    expect(code).toMatch(/twitter:\s*redditTrendingUnavailable\(\)/);
    expect(code).toMatch(/facebook:\s*redditTrendingUnavailable\(\)/);
    // The invented rows themselves, gone from the module entirely.
    for (const invented of ['AI Revolution', 'Remote Work', 'Mental Health', 'Community Building']) {
      expect(code.split('Reddit')[0] + code).not.toMatch(
        new RegExp(`${invented}[^\\n]*upvotes`));
    }
  });

  it('the listing is acquired through the canonical SSRF seam', () => {
    // HARDEN-005: `lib/security/safeFetch` is the one outbound path, and the
    // repo's SSRF scanner enforces it. Hoisting the URL into a constant turns a
    // literal fetch into a dynamic-URL call, which that guard catches.
    const contract = executable(fs.readFileSync('backend/services/trends/redditTrendingContract.ts', 'utf8'));
    expect(contract).toContain("import('../../../lib/security/safeFetch')");
    expect(contract).not.toMatch(/(?<!safe)\bfetch\(REDDIT_POPULAR_LISTING\)/);
  });

  it('there is exactly one constructor for a Reddit trending row', () => {
    // What makes "no invented Reddit engagement" structural rather than a
    // convention: every row originates from a parsed listing child.
    const contract = executable(fs.readFileSync('backend/services/trends/redditTrendingContract.ts', 'utf8'));
    const constructors = contract.match(/upvotes_state:/g) ?? [];
    expect(constructors).toHaveLength(2); // the type declaration, and the one builder.
  });

  it('no social-listening engine or provider was introduced', () => {
    // D6 is a fabrication fix for one existing call and must not grow into a
    // second trending subsystem.
    const added = execSync('git diff --name-only --diff-filter=A HEAD -- "backend/services" || true', { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const file of added) {
      expect(file).not.toMatch(/socialListening|engagementEngine|virality[A-Z]|redditProvider/i);
    }
  });
});
