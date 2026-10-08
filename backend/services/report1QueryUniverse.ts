/**
 * REPORT 1 QUERY UNIVERSE — why Report 1 asked each question.
 *
 * ONE CLAIM, AND ONLY ONE. A query origin records this and nothing else:
 *
 *     Report 1 chose to check this query, and this is the permitted input it came from.
 *
 * It is NOT evidence. It says nothing about search demand, volume, or whether anyone runs the
 * query. The SERP result is the observation; the origin is the reason the question was asked.
 *
 * ─── WHY THIS EXISTS: THE GSC ISOLATION DECISION ───────────────────────────
 *
 * `evidenceProvenance.ts` classes `gsc` as CONNECTED_SOURCE and calls that entry "the boundary
 * that keeps Report 1 honest about being a public report". The boundary held for EVIDENCE and
 * was bypassed for SELECTION: the query set was seeded from `canonical_keywords` (a table only
 * GSC ingestion writes) ordered by `keyword_metrics.impressions`, with GSC membership carrying
 * the largest ranking term in the scorer. Private Search Console history therefore decided which
 * public queries got checked, and two tenants with identical public sites could receive
 * different query universes with nothing recording the difference.
 *
 * The owner decision is OPTION 3 — GSC ISOLATED. GSC stays fully available to its other
 * consumers; it is structurally outside Report 1's query selection.
 *
 * ─── ALLOW-LIST, NOT DENY-LIST ─────────────────────────────────────────────
 *
 * This module admits ONLY the four origins below. There is deliberately no `gsc` member and no
 * escape hatch: a private source cannot be expressed as a Report 1 query origin, so it cannot
 * enter by being added to a list someone forgot to update. That mirrors `REPORT1_PROVENANCE`,
 * which is itself an allow-list of permitted classes rather than a list of banned ones.
 *
 * ─── RATIONALE IS CONSTRUCTION-TIME DATA ───────────────────────────────────
 *
 * `rationale` and `basis` are recorded when the query is BUILT, by the code that knows why.
 * Nothing downstream may re-derive them from the query text: a query reading `"x competitors"`
 * is not evidence that a competitor template produced it, and a renderer that guessed would be
 * manufacturing provenance. Absent origin stays absent.
 *
 * PURE. No I/O, no clock, no database, no network.
 */

/**
 * The permitted Report 1 query origins. There is no private member, by design.
 *
 *  - `observed_public`   derived from public material: page titles, headings, body phrases,
 *                        internal anchor text, the public domain label. DERIVED FROM public
 *                        observation — never itself a SERP observation.
 *  - `declared`          the company's own statement about itself in the Company Profile.
 *  - `derived_template`  a deterministic template applied to a declared or public base.
 *  - `derived_fallback`  a generic query used because no declared or public subject context was
 *                        available. Discloses its own insufficiency; never a company claim.
 */
export type Report1QueryOrigin =
  | 'observed_public'
  | 'declared'
  | 'derived_template'
  | 'derived_fallback';

/** A query that survived into the universe, with the reason recorded at construction. */
export type Report1Query = {
  /** The query text as dispatched to the SERP provider. */
  query: string;
  origin: Report1QueryOrigin;
  /** Why this query was checked. Written where the query is built; never re-derived. */
  rationale: string;
  /** The specific permitted input behind it (profile field, page element, template id). */
  basis: string | null;
};

/** A proposed query, before normalization, dedupe and the cap. */
export type Report1QueryCandidate = {
  value: string | null | undefined;
  origin: Report1QueryOrigin;
  rationale: string;
  basis?: string | null;
};

/** Normalizer supplied by the caller, so this module stays free of I/O and of helper imports. */
export type QueryNormalizer = (value: string | null | undefined) => string | null;

/**
 * Merge candidates into the final universe.
 *
 * FIRST-ORIGIN-WINS. The first candidate to produce a given normalized query keeps its origin,
 * and later duplicates are dropped. This matches the construction order the engine already used
 * (`pushUniqueQuery` keeps the first spelling) so the merge policy is not a new behaviour, and it
 * is deterministic: the same candidates in the same order always yield the same universe.
 *
 * Case-insensitive on the dedupe key only. The dispatched `query` keeps the normalizer's own
 * spelling, exactly as the previous implementation did.
 */
export function mergeReport1QueryUniverse(
  candidates: readonly Report1QueryCandidate[],
  options: { limit: number; normalize: QueryNormalizer },
): Report1Query[] {
  const seen = new Set<string>();
  const universe: Report1Query[] = [];
  for (const candidate of candidates) {
    if (universe.length >= options.limit) break;
    const query = options.normalize(candidate.value);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    universe.push({
      query,
      origin: candidate.origin,
      rationale: candidate.rationale,
      basis: candidate.basis ?? null,
    });
  }
  return universe;
}

/**
 * Index the universe so the SERP producer can attach the RECORDED origin to each observation.
 *
 * This is retrieval of construction-time data keyed by the exact dispatched query — not an
 * inference from query text. A query absent from the index gets no origin rather than a guess.
 */
export function indexQueryOrigins(
  queries: readonly Report1Query[],
): ReadonlyMap<string, Report1Query> {
  const index = new Map<string, Report1Query>();
  for (const entry of queries) {
    const key = entry.query.toLowerCase();
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/** The plain string list the existing SERP acquisition signature takes. */
export function queryTexts(queries: readonly Report1Query[]): string[] {
  return queries.map((entry) => entry.query);
}

/** True when the universe had to fall back because no declared or public subject was available. */
export function usedGenericFallback(queries: readonly Report1Query[]): boolean {
  return queries.some((entry) => entry.origin === 'derived_fallback');
}

/**
 * Reader-facing wording for an origin. Centralised so the renderer cannot invent its own and so
 * the forbidden readings ("observed query", "search demand") have one place to be excluded.
 *
 * Note `observed_public` deliberately reads "derived from public page text" rather than
 * "observed": the PAGE text was observed, the QUERY was derived from it, and the SERP result is
 * the only thing in this chain that is an observation.
 */
export const QUERY_ORIGIN_LABEL: Record<Report1QueryOrigin, string> = {
  observed_public: 'derived from public page text',
  declared: 'declared in the company profile',
  derived_template: 'deterministic category template',
  derived_fallback: 'generic fallback',
};
