/**
 * D5 — what a YouTube trending feed can and cannot establish, and what
 * Omnivyra is actually able to acquire from YouTube today.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * `/api/trending/current` exposed `fetchYouTubeTrending()`. Its `try` block
 * contained a single literal array and no network call whatsoever, so the
 * `catch` beneath it was unreachable — there was no API to fail. It returned:
 *
 *     { keyword: "AI Revolution",   views: "2.3M", growth: "+45%", ... }
 *     { keyword: "Mental Health",   views: "4.2M", growth: "+89%", ... }
 *       ... five rows, each stamped  source: "YouTube"
 *
 * Every field was invented. Not a mislabelled measurement — manufactured
 * observations published under a real provider's name. The route's own comment
 * conceded it ("we'll use mock data that simulates real trending videos"), but
 * nothing downstream knew that: the API returned the rows as evidence, the
 * suggestion builder rendered "trending with 2.3M views", the scheduler card
 * rendered "2.3M views" and "+45%", and clicking that card wrote
 * `Visual trend: <keyword> with 2.3M views` into a customer's post.
 *
 * `getFallbackTrendingData()` carried three more of the same rows, so even the
 * failure path published fabrications.
 *
 * ─── THE DISTINCTION THIS MODULE KEEPS ─────────────────────────────────────
 * Three different claims were collapsed into one row:
 *
 *   TRENDING MEMBERSHIP — that a video or topic appears on a list YouTube
 *     publishes. Acquirable in principle; requires a credential and a
 *     sanctioned endpoint. Omnivyra has neither for this route (see below).
 *   VIEW COUNT — an absolute figure YouTube does publish per video. Acquirable
 *     in principle, from a surface this route does not have.
 *   VIEW GROWTH RATE — "+45%". YouTube publishes no such figure on any surface.
 *     It is not merely unavailable to us; there is nothing to acquire. A growth
 *     percentage attributed to YouTube is ALWAYS a fabrication, which is why it
 *     is recorded below as permanently unsupportable rather than as a gap.
 *
 * ─── WHY THIS RETURNS SILENCE ──────────────────────────────────────────────
 * The architecture was audited before writing a line of acquisition:
 *
 *   - `backend/adapters/youtubeAdapter.ts` and
 *     `backend/services/platformAdapters/youtubeAdapter.ts` are per-account
 *     OAuth adapters. They publish to a connected channel and read that
 *     channel's own comments. They establish nothing about global trending.
 *   - `backend/services/externalApiPresets.ts` declares a "YouTube Trends"
 *     PRESET — a template a super-admin may register as an
 *     `external_api_sources` row, executed by the external-API executor under
 *     its account loop, health tracking and cost governance. It is not a
 *     provider this route may call, it needs `YOUTUBE_API_KEY`, and its
 *     endpoint (`search.list?order=viewCount` for a `q` term) is a
 *     relevance-ranked topic search — which is not a trending list, carries no
 *     view count in its response, and needs a query term this route has none of.
 *   - `YOUTUBE_API_KEY` is NOT declared in `config/env.schema.ts` and NOT
 *     registered in `backend/services/providerCredentialResolver.ts`
 *     PROVIDER_CREDENTIALS. `providerCatalog.ts` declares no `youtube` provider.
 *     Only `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` exist, and those are
 *     the publishing OAuth app.
 *
 * So there is no credential, no registered provider and no sanctioned endpoint.
 * Inventing any of the three to keep the card populated would repeat the defect
 * one layer deeper. The honest output is an empty list, and the consumer already
 * renders nothing for one — exactly the resolution D4 reached for the same class
 * of defect in the same route.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * This is a source-boundary contract for one feed, not a new provider, trend
 * engine or acquisition layer. Nothing here fetches. When a sanctioned YouTube
 * acquisition path is provisioned, the deliberate and visible act required is to
 * widen YOUTUBE_TRENDS_SUPPORTED_EVIDENCE below — and `view_growth_rate` may
 * never be among the additions.
 */

import type { EvidenceProvenanceClass } from '../evidenceProvenance';
import type { ScoreState } from '../snapshotReport/canonicalScoreState';

/** The provider label shown to a customer. */
export const YOUTUBE_TRENDS_SOURCE_LABEL = 'YouTube' as const;

/**
 * What Omnivyra can currently support under the YouTube name on this route.
 *
 * Empty, and the emptiness is the guard: no value may be attributed to YouTube
 * unless the evidence it rests on appears here. Widening this set without a
 * credential, a registered provider and a real endpoint behind it re-creates the
 * defect — which is why the acquisition resolver below reads this set rather
 * than a separate flag that could drift from it.
 */
export const YOUTUBE_TRENDS_SUPPORTED_EVIDENCE: ReadonlySet<string> = new Set([]);

/**
 * Evidence no YouTube surface publishes at all.
 *
 * `view_growth_rate` is the "+45%" the defect invented. YouTube exposes view,
 * like and comment counts; it exposes no growth percentage, on any endpoint, at
 * any tier. Provisioning a credential would therefore not make this claim
 * acquirable, so it is recorded here permanently rather than left to look like a
 * gap that a future integration might fill.
 */
export const YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE: ReadonlySet<string> = new Set([
  'view_growth_rate',
]);

/** True when Omnivyra can support a claim of the given kind under the YouTube name. */
export function youTubeTrendsSupports(evidence: string): boolean {
  if (YOUTUBE_TRENDS_UNSUPPORTABLE_EVIDENCE.has(evidence)) return false;
  return YOUTUBE_TRENDS_SUPPORTED_EVIDENCE.has(evidence);
}

/**
 * One trending video observed on a YouTube-published list.
 *
 * No instance of this is produced today, because nothing is acquired. It exists
 * as the declaration of the row shape the route's suggestion builder and the
 * scheduler card read, so those consumers are written against a shape that
 * cannot carry "2.3M" or "+45%" even if acquisition is switched on later.
 *
 * `views` and `growth` are present and permanently null rather than omitted: a
 * reader — and a renderer — should see that both were CONSIDERED and found
 * unavailable, which is a different statement from the fields never existing.
 */
export type YouTubeTrendingObservation = {
  readonly keyword: string;
  /** What a trending list would establish: membership of it. */
  readonly trend: 'Trending';
  readonly trending_state: ScoreState;
  /** Never a string like "2.3M", never a number this route did not read. */
  readonly views: null;
  readonly views_state: ScoreState;
  /** Never "+45%". No YouTube surface publishes a growth rate. */
  readonly growth: null;
  readonly growth_state: ScoreState;
  /** No list this route reads carries a category, so none is invented. */
  readonly category: null;
  readonly source: typeof YOUTUBE_TRENDS_SOURCE_LABEL;
  readonly provenance: EvidenceProvenanceClass;
};

/** Why YouTube trending cannot be acquired, in the words an operator sees in logs. */
export const YOUTUBE_TRENDS_NO_ACQUISITION_REASON =
  'No sanctioned YouTube trending acquisition path: no registered provider, no credential in PROVIDER_CREDENTIALS, and no endpoint this route may call.';

/**
 * Whether an acquisition may be attempted at all.
 *
 * Derived from the supported-evidence set rather than stored beside it, so the
 * capability declaration and the decision to call out can never disagree.
 */
export type YouTubeTrendsAcquisition =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export function youTubeTrendsAcquisition(): YouTubeTrendsAcquisition {
  if (YOUTUBE_TRENDS_SUPPORTED_EVIDENCE.size === 0) {
    return { available: false, reason: YOUTUBE_TRENDS_NO_ACQUISITION_REASON };
  }
  return { available: true };
}

/**
 * Build the honest observation for one trending video.
 *
 * `trending_state` is `measured` only in the sense that it would record reading
 * a list YouTube published. It is emphatically NOT a measurement of views, which
 * is why `views_state` and `growth_state` are `unavailable` in the same object.
 */
export function youTubeTrendingObservation(keyword: string): YouTubeTrendingObservation {
  return {
    keyword,
    trend: 'Trending',
    trending_state: 'measured',
    views: null,
    views_state: 'unavailable',
    growth: null,
    growth_state: 'unavailable',
    category: null,
    source: YOUTUBE_TRENDS_SOURCE_LABEL,
    provenance: 'PUBLIC_OBSERVED',
  };
}

/**
 * What to return when YouTube trending cannot be acquired.
 *
 * An empty list. The previous code returned five invented videos with invented
 * view counts and invented growth rates under YouTube's name, and three more on
 * the fallback path. The consumer gates on `length > 0`, so honest silence costs
 * no UI work.
 */
export function youTubeTrendingUnavailable(): YouTubeTrendingObservation[] {
  return [];
}
