/**
 * DG-001 — the canonical SERP result-type vocabulary, and the one place provider
 * labels are translated into it.
 *
 * ─── WHAT THIS FIXES ───────────────────────────────────────────────────────
 * The SERP model recognised four result types (`organic`, `featured_snippet`,
 * `paid`, `other`) and the parser produced only two of them: everything was
 * stamped `organic` unless a `featured_snippet` flag was set. DataForSEO's
 * adapter went further and DISCARDED every other item type before parsing
 * (`items.filter(type === 'organic' || type === 'featured_snippet')`), so
 * People Also Ask, knowledge panels, local packs, images, video, news, shopping
 * and paid results were fetched, paid for, and thrown away.
 *
 * ─── THIS IS A VOCABULARY AND A TRANSLATOR, NOT A SECOND PARSER ───────────
 * `serpAcquisitionService.parseProviderResults` remains the single parser and
 * the single acquisition path. This module holds the closed vocabulary, the
 * provider alias tables, and the rules about which fields each type can
 * meaningfully carry — the parts that would otherwise be duplicated once per
 * provider and drift.
 *
 * ─── THE VOCABULARY IS CLOSED, AND UNKNOWN MEANS REJECTED ─────────────────
 * `normalizeSerpResultType` returns null for anything it does not recognise.
 * A provider that invents a new block, renames one, or returns a malformed
 * label produces NO observation rather than a mis-labelled one. That direction
 * is deliberate: a missing observation is visible as absence, a wrong one is
 * indistinguishable from evidence.
 *
 * ─── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * No scoring, no AEO interpretation, no ownership inference, no recommendation.
 * `isAnswerFeature` exists so DG-007 can later ASK which observations are
 * answer-oriented; it decides nothing today.
 */

/**
 * Every result type Omnivyra can observe.
 *
 * `other` is retained from the original model as the honest bucket for a result
 * that is real, identified, and not one of the named kinds.
 */
export const SERP_RESULT_TYPES = [
  'organic',
  'featured_snippet',
  'people_also_ask',
  'knowledge_panel',
  'sitelink',
  'local',
  'image',
  'video',
  'news',
  'shopping',
  'paid',
  'other',
] as const;
export type SerpResultType = typeof SERP_RESULT_TYPES[number];

/**
 * The four types the deployed CHECK constraint on `analytics_serp_results`
 * accepts today.
 *
 * `CHECK (result_type IN ('organic','featured_snippet','paid','other'))` —
 * migration 20260660. Persisting anything else raises 23514, so the ingest path
 * reads this set rather than assuming the column is free text. Widening it is a
 * migration, documented and deliberately NOT applied by this change.
 */
export const PERSISTABLE_SERP_RESULT_TYPES: readonly SerpResultType[] = [
  'organic', 'featured_snippet', 'paid', 'other',
];

export const isPersistableSerpResultType = (type: SerpResultType): boolean =>
  PERSISTABLE_SERP_RESULT_TYPES.includes(type);

/**
 * Types that answer a question on the results page rather than linking to one.
 *
 * Provided for DG-007, which will consume answer evidence. It is a predicate
 * over the vocabulary and nothing else — no score, no eligibility, no verdict.
 */
export const ANSWER_FEATURE_TYPES: readonly SerpResultType[] = [
  'featured_snippet', 'people_also_ask', 'knowledge_panel',
];
export const isAnswerFeature = (type: SerpResultType): boolean =>
  ANSWER_FEATURE_TYPES.includes(type);

/**
 * Types for which a numeric rank is meaningful.
 *
 * A People Also Ask question or a knowledge panel is not "position 4" in any
 * sense a reader could act on — the block has a place on the page, but the
 * ENTRY does not have a rank among the organic ten. Stamping one anyway is how
 * a visibility average silently becomes wrong, so these carry `position: null`.
 */
export const RANKED_SERP_RESULT_TYPES: readonly SerpResultType[] = [
  'organic', 'featured_snippet', 'paid', 'local', 'shopping', 'news', 'video', 'other',
];
export const hasMeaningfulPosition = (type: SerpResultType): boolean =>
  RANKED_SERP_RESULT_TYPES.includes(type);

/**
 * Types that must carry a URL to be an observation at all.
 *
 * An organic result without a link is not a result. A People Also Ask entry
 * frequently has no link of its own — the question text IS the evidence — and a
 * knowledge panel often links nowhere. Requiring a URL for those would discard
 * true observations; inventing one would be fabrication. So the requirement is
 * per type, and the types that do not require it must still carry a title.
 */
export const URL_REQUIRED_SERP_RESULT_TYPES: readonly SerpResultType[] = [
  'organic', 'featured_snippet', 'paid', 'sitelink', 'news', 'video', 'shopping', 'other',
];
export const requiresUrl = (type: SerpResultType): boolean =>
  URL_REQUIRED_SERP_RESULT_TYPES.includes(type);

/**
 * Provider label → canonical type.
 *
 * ─── SOURCED FROM THE ADAPTERS, NOT FROM VENDOR MARKETING ─────────────────
 * DataForSEO is the only provider for which this repository contains proof that
 * a richer item stream is already received: its adapter filters
 * `item.type === 'organic' || item.type === 'featured_snippet'` out of a mixed
 * `items` array, which is only meaningful if other `type` values arrive. Its
 * labels below are therefore the ones that filter was discarding.
 *
 * SerpAPI and ScaleSERP are read through their `organic_results` array only, so
 * this repository holds NO evidence of their other blocks. Their aliases are
 * included because the adapters now read those sibling keys, and a key that is
 * absent simply yields nothing — but see the implementation report: for those
 * two providers the response shape is unverified in-repo and unverified against
 * a live account, so nothing here should be read as a claim that they deliver.
 *
 * Every alias is lower-cased and compared exactly. Aliases are not guessed from
 * substrings: `related_questions` maps, `questions` does not.
 */
export const PROVIDER_TYPE_ALIASES: Readonly<Record<string, SerpResultType>> = {
  // ── organic ─────────────────────────────────────────────────────────────
  organic: 'organic',
  organic_result: 'organic',
  organic_results: 'organic',

  // ── featured snippet / direct answer ────────────────────────────────────
  featured_snippet: 'featured_snippet',
  answer_box: 'featured_snippet',
  answer_box_results: 'featured_snippet',

  // ── People Also Ask ─────────────────────────────────────────────────────
  people_also_ask: 'people_also_ask',
  related_questions: 'people_also_ask',
  related_question: 'people_also_ask',

  // ── knowledge panel / graph ─────────────────────────────────────────────
  knowledge_graph: 'knowledge_panel',
  knowledge_panel: 'knowledge_panel',

  // ── sitelinks ───────────────────────────────────────────────────────────
  sitelink: 'sitelink',
  sitelinks: 'sitelink',
  inline_sitelinks: 'sitelink',

  // ── local ───────────────────────────────────────────────────────────────
  local_pack: 'local',
  local_results: 'local',
  local_result: 'local',
  map_pack: 'local',

  // ── media ───────────────────────────────────────────────────────────────
  images: 'image',
  image: 'image',
  inline_images: 'image',
  images_results: 'image',
  video: 'video',
  videos: 'video',
  inline_videos: 'video',
  video_results: 'video',

  // ── news ────────────────────────────────────────────────────────────────
  news: 'news',
  top_stories: 'news',
  news_results: 'news',

  // ── shopping ────────────────────────────────────────────────────────────
  shopping: 'shopping',
  shopping_results: 'shopping',
  popular_products: 'shopping',

  // ── paid ────────────────────────────────────────────────────────────────
  paid: 'paid',
  ads: 'paid',
  ad: 'paid',
  shopping_ads: 'paid',
};

/**
 * Translate a provider's label into the canonical vocabulary.
 *
 * Returns null — never a fallback — for an absent, malformed or unrecognised
 * label. The caller decides what an unrecognised block means; this function
 * refuses to guess.
 */
export function normalizeSerpResultType(raw: unknown): SerpResultType | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (key === '') return null;
  return PROVIDER_TYPE_ALIASES[key] ?? null;
}

/**
 * ─── RANK PROVENANCE ───────────────────────────────────────────────────────
 *
 * The single parser derives a rank from the 1-based ARRAY INDEX when a
 * provider entry declares none. That proxy is sound for exactly one input
 * shape: a provider's ORDERED result array (`organic_results`, DataForSEO's
 * `items`), where the array order IS the ranking.
 *
 * DG-001 began appending the sibling feature blocks onto that array — BOTH
 * acquisition paths call the parser as `parse([...organic, ...siblings])`
 * (serpAcquisitionService's SerpAPI/ScaleSERP adapters and
 * serp/canonicalSerpClient, the Report 1 path). For an appended feature entry
 * the index is an offset into a CONCATENATION and carries no rank at all, so
 * the proxy stopped being a proxy and became fabrication: a local pack, a top
 * story, an inline video, a shopping result or an ad — all ranked types — was
 * stamped with an organic-scale position nothing on the page had. Those
 * positions are persisted (`analytics_serp_results`), participate in the
 * persistence conflict key, and feed the top-ten counts and threat scores in
 * externalCompetitiveIntelligenceService — which is precisely how, in this
 * module's own words, "a visibility average silently becomes wrong".
 *
 * The provenance is therefore marked ON THE ENTRY rather than passed beside it:
 * the distinction was lost by concatenating two positional streams into one,
 * and a positional argument would be lost the same way again. A module-private
 * Symbol cannot appear in provider JSON (`JSON.parse` produces string keys
 * only), so an entry can neither forge nor suppress it, and it is defined
 * non-enumerably so it is invisible to spreads, `JSON.stringify` and deep
 * equality.
 */
const FEATURE_BLOCK_ENTRY = Symbol('omnivyra.serp.feature_block_entry');

/** Mark an entry lifted out of a sibling feature block. Returns the same object. */
export function markFeatureBlockEntry<T extends object>(entry: T): T {
  Object.defineProperty(entry, FEATURE_BLOCK_ENTRY, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return entry;
}

/**
 * True only for an entry this module marked. Anything else — including a
 * provider row that literally spells the description out — is false, so the
 * positional fallback is never suppressed by untrusted input either.
 */
export function isFeatureBlockEntry(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as Record<symbol, unknown>)[FEATURE_BLOCK_ENTRY] === true;
}
