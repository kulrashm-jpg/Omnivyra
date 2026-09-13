/**
 * D6 — what Reddit's r/popular listing can and cannot establish.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * `/api/trending/current` really did call `https://www.reddit.com/r/popular.json`.
 * The success path was honest: title, `ups` and `subreddit` all came off the
 * listing. The FAILURE path was not. When the call threw or returned a non-2xx,
 * the `catch` returned:
 *
 *     { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology",
 *       category: "Reddit", source: "Reddit" }
 *     { keyword: "Remote Work",   upvotes: 12300, subreddit: "workfromhome", … }
 *
 * Nothing there was observed. Two topics, two subreddits and two precise upvote
 * counts were invented and stamped with a real provider's name — and because the
 * same Reddit call feeds BOTH the Twitter and the Facebook lane, the module-level
 * `getFallbackTrendingData()` repeated the class a second and third time (the
 * Facebook rows carried `18700` and `14200`). The scheduler rendered those
 * numbers verbatim next to the subreddit name, and clicking the card wrote
 * `r/workfromhome` into the customer's draft post.
 *
 * That is the most serious form of this defect: not a mislabelled measurement,
 * but manufactured evidence under a provider's name.
 *
 * ─── THE DISTINCTION THIS MODULE KEEPS ─────────────────────────────────────
 * Reddit's listing establishes three things about a post that is ON it: its
 * title, the community it was posted to, and the score Reddit currently
 * publishes for it. That score is a real public observation and is kept as one —
 * the fix must not flatten a genuine reading to "unknown".
 *
 * It establishes them ONLY for posts that were actually read. A listing that
 * could not be read establishes nothing at all, and there is no substitute for
 * an observation that was never made.
 *
 * Reddit also publishes posts with `score_hidden: true` — new posts whose score
 * it deliberately withholds. Those are a third case, distinct from both: the
 * post was observed, the score was not. That is `insufficient_signal`, and it is
 * a finding rather than a zero.
 *
 *   listing read, score published   → upvotes: <n>,  state: measured
 *   listing read, score withheld    → upvotes: null, state: insufficient_signal
 *   listing not read                → no rows at all
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * A contract for ONE existing public listing, not a new provider, engagement
 * engine or social-listening subsystem. Nothing here acquires data the route did
 * not already acquire; it describes what that one call can support, and owns the
 * call so the description and the acquisition cannot drift apart.
 */

import type { EvidenceProvenanceClass } from '../evidenceProvenance';
import type { ScoreState } from '../snapshotReport/canonicalScoreState';

/** The public listing this contract describes. */
export const REDDIT_POPULAR_LISTING = 'https://www.reddit.com/r/popular.json?limit=5';

/** The provider label shown to a customer. */
export const REDDIT_SOURCE_LABEL = 'Reddit' as const;

/** How many posts the route surfaces per lane. */
export const REDDIT_TRENDING_LIMIT = 5;

/**
 * What this listing is capable of supporting.
 *
 * `post_score` is here because Reddit genuinely publishes it. What is
 * deliberately ABSENT is any notion of a score that was not read — and the
 * architectural guard asserts that absence: an upvote figure may not be
 * attributed to Reddit unless it came off a listing this contract parsed.
 */
export const REDDIT_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([
  'popular_listing_membership',
  'post_score',
  'post_subreddit',
]);

/** True when this listing can support a claim of the given kind. */
export function redditSupports(evidence: string): boolean {
  return REDDIT_SUPPORTED_EVIDENCE.has(evidence);
}

/**
 * One post observed on r/popular.
 *
 * `upvotes` is `number | null` and `upvotes_state` always accompanies it, rather
 * than a bare number: a reader — and a renderer — must be able to tell a score
 * Reddit published from a score Reddit withheld. A single number field cannot
 * carry that difference, and the pre-fix code exploited exactly that gap.
 */
export type RedditTrendingPost = {
  readonly keyword: string;
  /** The community the post was observed in. Never invented. */
  readonly subreddit: string;
  /** Reddit's published score at read time. Null when Reddit withheld it. */
  readonly upvotes: number | null;
  readonly upvotes_state: ScoreState;
  /** The listing carries no category taxonomy; `category: "Reddit"` was the source name in a category field. */
  readonly category: null;
  readonly source: typeof REDDIT_SOURCE_LABEL;
  readonly provenance: EvidenceProvenanceClass;
};

/** The shape of one listing child, as far as this contract reads it. */
type RedditListingChild = {
  data?: {
    title?: unknown;
    ups?: unknown;
    score?: unknown;
    score_hidden?: unknown;
    subreddit?: unknown;
  };
};

/**
 * Fetch the popular listing through the canonical outbound seam.
 *
 * HARDEN-005: `lib/security/safeFetch` is the repo's one outbound path and the
 * SSRF guard enforces it. Hoisting the endpoint into a constant (so the parse and
 * the capability declaration cannot drift from the call) turns a literal
 * `fetch('https://…')` into a dynamic-URL call, which the guard correctly flags.
 * Routing through the seam is the answer rather than an `ssrf-ok` exemption: the
 * URL is fixed, so validation costs nothing and the boundary stays uniform.
 *
 * Returns the parsed listing body, or null when it could not be read. Null is
 * not an error to recover from with invented rows — it is the finding.
 */
export async function fetchPopularListing(timeoutMs = 8000): Promise<unknown | null> {
  const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
  try {
    const response = await safeFetch(
      REDDIT_POPULAR_LISTING,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { timeoutMs, maxRedirects: 3, maxBytes: 2 * 1024 * 1024 },
    );
    if (!response.ok) return null;
    return JSON.parse((await readCapped(response)).toString('utf8')) as unknown;
  } catch {
    // A listing we could not read establishes nothing. The caller returns silence.
    return null;
  }
}

/**
 * Recover the listing's children, defensively.
 *
 * A body that is present but not shaped like a listing is the same epistemic
 * situation as a body that never arrived: nothing was observed.
 */
export function parsePopularListing(body: unknown): RedditListingChild[] {
  const children = (body as { data?: { children?: unknown } } | null)?.data?.children;
  return Array.isArray(children) ? (children as RedditListingChild[]) : [];
}

/**
 * Build the honest observation for one listing child, or null if the child does
 * not carry the two things a row cannot exist without: a title and a community.
 *
 * `upvotes_state` is `measured` only when Reddit published a finite score for
 * this post. Reddit's `score_hidden` posts, and any child whose score is missing
 * or non-numeric, yield `insufficient_signal` with a null value — never a zero,
 * which would read as "nobody upvoted this".
 *
 * Note on precision, recorded rather than papered over: Reddit fuzzes published
 * vote counts to frustrate vote manipulation, so this is a measurement of what
 * Reddit reports, not of the underlying ballot. `PUBLIC_OBSERVED` says exactly
 * that — it is what the public source stated at read time.
 */
export function redditTrendingPost(child: RedditListingChild): RedditTrendingPost | null {
  const data = child?.data;
  const keyword = typeof data?.title === 'string' ? data.title.trim() : '';
  const subreddit = typeof data?.subreddit === 'string' ? data.subreddit.trim() : '';
  if (!keyword || !subreddit) return null;

  const raw = typeof data?.ups === 'number' ? data.ups : data?.score;
  const hidden = data?.score_hidden === true;
  const observed = !hidden && typeof raw === 'number' && Number.isFinite(raw);

  return {
    keyword,
    subreddit,
    upvotes: observed ? (raw as number) : null,
    upvotes_state: observed ? 'measured' : 'insufficient_signal',
    category: null,
    source: REDDIT_SOURCE_LABEL,
    provenance: 'PUBLIC_OBSERVED',
  };
}

/**
 * The one path from a listing body to rows.
 *
 * Every `RedditTrendingPost` the system emits originates here, from a child that
 * was actually parsed out of a listing that was actually read. There is no other
 * constructor, which is what makes "no invented Reddit engagement" a structural
 * property rather than a convention.
 */
export function redditTrendingPosts(body: unknown, limit = REDDIT_TRENDING_LIMIT): RedditTrendingPost[] {
  return parsePopularListing(body)
    .slice(0, limit)
    .map(redditTrendingPost)
    .filter((post): post is RedditTrendingPost => post !== null);
}

/**
 * What to return when the listing could not be read.
 *
 * An empty list. The previous code invented two topics per lane here — with
 * subreddits and precise upvote counts — and attributed them to Reddit. The
 * consumer already renders nothing for an empty list, so honest silence costs no
 * UI work.
 */
export function redditTrendingUnavailable(): RedditTrendingPost[] {
  return [];
}
