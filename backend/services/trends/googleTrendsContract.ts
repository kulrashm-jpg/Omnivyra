/**
 * D4 — what the Google Trends hot-trends feed can and cannot establish.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * `/api/trending/current` fetched Google's hot-trends Atom feed, matched the
 * `<title>` elements out of it, and returned each topic as:
 *
 *     { keyword, searchVolume: "High", trend: "Rising",
 *       category: "General", source: "Google Trends" }
 *
 * Only `keyword` came from the feed. `searchVolume`, `trend` and `category` were
 * hardcoded literals applied uniformly to every topic, and all of it was stamped
 * with a named provider. The UI then rendered "High search volume" verbatim.
 *
 * When the feed FAILED it was worse: three invented topics — ChatGPT, Climate
 * Change, Electric Vehicles — were returned, still attributed to Google Trends.
 * The whole row was fabricated, not merely the volume.
 *
 * ─── THE DISTINCTION THIS MODULE KEEPS ─────────────────────────────────────
 * SEARCH VOLUME is how many searches a term receives. SEARCH INTEREST is
 * relative popularity. "Currently trending" is neither: it is membership of a
 * ranked list Google publishes. The hot-trends feed establishes exactly that
 * membership and nothing else — it carries no volume figure this code reads, no
 * interest index, and no time series.
 *
 * So the honest output is: this term is on Google's currently-trending list.
 * Volume is `unavailable`, and that is a finding rather than a gap to fill.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * This is a contract for ONE existing feed, not a new provider, demand engine or
 * trend engine — DG-002 already established that search-demand intelligence
 * lives in Report 2 and must not be rebuilt. Nothing here acquires new data; it
 * describes what the existing call already returns.
 */

import type { EvidenceProvenanceClass } from '../evidenceProvenance';
import type { ScoreState } from '../snapshotReport/canonicalScoreState';

/** The public feed this contract describes. */
export const GOOGLE_TRENDS_HOT_TRENDS_FEED = 'https://trends.google.com/trends/hottrends/atom/feed';

/** The provider label shown to a customer. */
export const GOOGLE_TRENDS_SOURCE_LABEL = 'Google Trends' as const;

/**
 * What this feed is capable of supporting.
 *
 * `search_volume` is deliberately ABSENT, and its absence is what the
 * architectural guard asserts: a value may not be attributed to Google Trends
 * unless the evidence it rests on appears here.
 */
export const GOOGLE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([
  'trending_topic',
]);

/** True when this feed can support a claim of the given kind. */
export function googleTrendsSupports(evidence: string): boolean {
  return GOOGLE_TRENDS_SUPPORTED_EVIDENCE.has(evidence);
}

/**
 * One topic observed on the hot-trends list.
 *
 * `search_volume` is present and permanently null, rather than omitted: a reader
 * — and a renderer — should be able to see that volume was CONSIDERED and found
 * unavailable, which is a different statement from the field never existing.
 */
export type GoogleTrendsTopic = {
  readonly keyword: string;
  /** What the feed actually establishes. */
  readonly trend: 'Trending';
  readonly search_interest_state: ScoreState;
  /** No volume figure is read from this feed. Never a number, never "High". */
  readonly search_volume: null;
  readonly search_volume_state: ScoreState;
  /** The feed carries no category; inventing one was part of the defect. */
  readonly category: null;
  readonly source: typeof GOOGLE_TRENDS_SOURCE_LABEL;
  readonly provenance: EvidenceProvenanceClass;
};

/**
 * Fetch the hot-trends feed through the canonical outbound seam.
 *
 * HARDEN-005: `lib/security/safeFetch` is the repo's one outbound path, and the
 * SSRF guard enforces it. Hoisting the endpoint into a constant (so the parse and
 * the capability declaration cannot drift from the call) turned the route's
 * `fetch('https://…')` literal into a dynamic-URL call, which the guard correctly
 * flagged. Routing through the seam is the answer rather than an `ssrf-ok`
 * exemption: the URL is fixed, so validation costs nothing and the boundary stays
 * uniform.
 *
 * Returns the raw feed body, or null when it could not be read.
 */
export async function fetchHotTrendsFeed(timeoutMs = 8000): Promise<string | null> {
  const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
  try {
    const response = await safeFetch(
      GOOGLE_TRENDS_HOT_TRENDS_FEED,
      { method: 'GET', headers: { Accept: 'application/atom+xml, application/xml, text/xml' } },
      { timeoutMs, maxRedirects: 3, maxBytes: 2 * 1024 * 1024 },
    );
    if (!response.ok) return null;
    return (await readCapped(response)).toString('utf8');
  } catch {
    // A feed we could not read establishes nothing. The caller returns silence.
    return null;
  }
}

/**
 * Parse the hot-trends Atom feed into topic titles.
 *
 * Titles only, because titles are all this code has ever read. If the feed's
 * approximate-traffic element is ever parsed, THAT is the point at which a
 * volume-shaped claim could begin to be justified — and the supported-evidence
 * set above would have to be widened deliberately, in the open.
 */
export function parseHotTrendsFeed(xml: string): string[] {
  const matches = xml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g) ?? [];
  return matches
    .map((entry) => entry.replace(/<title><!\[CDATA\[(.*?)\]\]><\/title>/, '$1').trim())
    .filter((title) => title.length > 0);
}

/**
 * Build the honest observation for one trending topic.
 *
 * `search_interest_state` is `measured`: we read Google's published list and
 * observed this term on it. That is a real public observation. It is emphatically
 * NOT a measurement of how much the term is searched, which is why
 * `search_volume_state` is `unavailable` in the same object.
 */
export function googleTrendsTopic(keyword: string): GoogleTrendsTopic {
  return {
    keyword,
    trend: 'Trending',
    search_interest_state: 'measured',
    search_volume: null,
    search_volume_state: 'unavailable',
    category: null,
    source: GOOGLE_TRENDS_SOURCE_LABEL,
    provenance: 'PUBLIC_OBSERVED',
  };
}

/**
 * What to return when the feed could not be read.
 *
 * An empty list. The previous code invented three topics here and attributed
 * them to Google Trends, which is the most serious form of this defect: not a
 * mislabelled measurement but manufactured evidence under a real provider's
 * name. The consumer already renders nothing for an empty list, so honest
 * silence costs no UI work.
 */
export function googleTrendsUnavailable(): GoogleTrendsTopic[] {
  return [];
}
