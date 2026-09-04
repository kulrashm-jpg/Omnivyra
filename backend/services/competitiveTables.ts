/**
 * The two competition tables (Phase 3).
 *
 * Report 1 must answer two DIFFERENT questions and must not conflate them:
 *
 *   Table A — PRODUCT / FUNCTIONAL: who solves a substantially similar problem?
 *   Table B — MARKET / SEGMENT:     who competes for the same customer decision?
 *
 * Phase 2 built the two-axis relation model (`competitorRelationModel`) that makes this
 * possible. This module renders those axes as the two customer-facing tables, and — the part
 * that matters most to a CMO — attaches the EVIDENCE TRAIL answering "why is this company
 * here at all?".
 *
 * Three rules are enforced structurally:
 *
 *  1. SERP overlap is a DISCOVERY signal, never a classification. A domain appearing on the
 *     same queries earns a row in the tables; it does not earn "direct competitor". The
 *     classification comes from the product and market axes, which SERP does not feed.
 *  2. Company size / segment is reported only where evidence supports it, otherwise
 *     'unknown'. No precision is manufactured from a revenue-range string.
 *  3. A competitor whose axes abstained appears as "Discovered — Unclassified" in BOTH
 *     tables rather than being dropped or forced into a category. Discovered-but-unknown is
 *     a real, useful state; a fabricated category is not.
 */
import {
  deriveCompetitorRelations,
  type CompetitorRelations,
  type CompositeRelation,
  type MarketRelation,
  type ProductRelation,
} from './competitorRelationModel';
import type { CompetitorVisibility } from './serpVisibilityMetrics';
import type { CompetitorDimensionScores } from '../../types/competitor';

/** Publicly observable size bands. Deliberately coarse — precision requires evidence. */
export type SegmentBand = 'smb' | 'mid_market' | 'enterprise' | 'unknown';

export interface CompetitorEvidenceTrail {
  /** Why this company entered the candidate pool at all. */
  discovery: string[];
  /** Product/functional evidence supporting Table A. */
  product: string[];
  /** Market/segment evidence supporting Table B. */
  market: string[];
  /** Search evidence — discovery only; never a classification input. */
  search: string[];
  /** Total independent signals behind this competitor. */
  signalCount: number;
}

export interface CompetitorTableRow {
  name: string;
  domain: string | null;
  relations: CompetitorRelations;
  evidence: CompetitorEvidenceTrail;
  segment: SegmentBand;
  geography: string | null;
  businessModel: string | null;
  /** True when either axis abstained — rendered as Discovered — Unclassified. */
  unclassified: boolean;
}

export interface ProductCompetitionRow {
  competitor: string;
  domain: string | null;
  /** Table A axis score, or null when abstained. */
  productOverlap: number | null;
  /** The problem/use-case component, shown separately per the required table shape. */
  problemUseCaseOverlap: number | null;
  evidence: string[];
  classification: ProductRelation;
  confidence: string;
  state: string;
}

export interface MarketCompetitionRow {
  competitor: string;
  domain: string | null;
  customerIcp: string | null;
  segment: SegmentBand;
  geography: string | null;
  /** Table B axis score, or null when abstained. */
  marketOverlap: number | null;
  evidence: string[];
  classification: MarketRelation;
  confidence: string;
  state: string;
}

export interface CompetitiveTables {
  productCompetition: ProductCompetitionRow[];
  marketCompetition: MarketCompetitionRow[];
  /** Competitors discovered but not classifiable on either axis. */
  unclassified: Array<{ competitor: string; domain: string | null; reason: string; signalCount: number }>;
  /** Composite relation counts — the one-line competitive landscape. */
  summary: Record<CompositeRelation, number>;
  /** True when no competitor could be discovered at all. */
  empty: boolean;
  /** Why the tables are empty, when they are. */
  emptyReason: string | null;
}

/**
 * Classify company size from PUBLICLY OBSERVABLE evidence only.
 *
 * Employee count is preferred because it is the most commonly disclosed and least ambiguous
 * public signal. Revenue is used only when it carries an explicit magnitude token. Anything
 * else is 'unknown' — a revenue band like "growth" or a vague descriptor is not evidence of
 * a segment, and guessing one would be exactly the manufactured precision this phase forbids.
 *
 * Bands follow the conventional B2B split: SMB < 200 employees, mid-market 200–999,
 * enterprise 1000+.
 */
export function classifySegment(params: {
  employeeCount?: number | null;
  employeeRange?: string | null;
  revenueRange?: string | null;
}): SegmentBand {
  const count = Number(params.employeeCount);
  if (Number.isFinite(count) && count > 0) {
    if (count >= 1000) return 'enterprise';
    if (count >= 200) return 'mid_market';
    return 'smb';
  }

  const range = String(params.employeeRange ?? '').toLowerCase();
  if (range) {
    // Read the UPPER bound of a declared range ("11-50", "1000+", "5,000-10,000").
    const numbers = range.replace(/,/g, '').match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length) {
      const upper = Math.max(...numbers);
      if (/\+|plus|more/.test(range) && upper >= 1000) return 'enterprise';
      if (upper >= 1000) return 'enterprise';
      if (upper >= 200) return 'mid_market';
      return 'smb';
    }
    if (/enterprise/.test(range)) return 'enterprise';
    if (/mid[- ]?market/.test(range)) return 'mid_market';
    if (/small|smb|startup/.test(range)) return 'smb';
  }

  const revenue = String(params.revenueRange ?? '').toLowerCase();
  // Only an explicit magnitude counts. "growth", "scale", "1-10m" without a unit do not.
  if (/\b(\d+\s*)?(b|bn|billion)\b/.test(revenue)) return 'enterprise';
  if (/\b(100|250|500)\s*m(illion)?\b/.test(revenue)) return 'enterprise';
  if (/\b(10|25|50)\s*m(illion)?\b/.test(revenue)) return 'mid_market';

  return 'unknown';
}

/** Build the evidence trail for one competitor. Every entry is a statement of observed fact. */
export function buildEvidenceTrail(params: {
  discoverySources?: readonly string[] | null;
  category?: string | null;
  productSignals?: readonly string[] | null;
  useCase?: string | null;
  targetCustomer?: string | null;
  geography?: string | null;
  businessModel?: string | null;
  segment: SegmentBand;
  companyGeography?: string | null;
  searchVisibility?: CompetitorVisibility | null;
  totalQueriesObserved?: number;
}): CompetitorEvidenceTrail {
  const discovery: string[] = [];
  const product: string[] = [];
  const market: string[] = [];
  const search: string[] = [];

  for (const source of params.discoverySources ?? []) {
    discovery.push(
      source === 'serp' ? 'Appeared in live search results for the company\'s query universe'
        : source === 'provider' ? 'Returned by an external competitor data source'
          : source === 'stored' ? 'Carried forward from previously stored competitor evidence'
            : source === 'manual' ? 'Supplied directly rather than discovered'
              : `Discovery source: ${source}`,
    );
  }

  if (params.category) product.push(`Same category: ${params.category}`);
  for (const signal of params.productSignals ?? []) product.push(`Product signal: ${signal}`);
  if (params.useCase) product.push(`Same use case: ${params.useCase}`);

  if (params.targetCustomer) market.push(`Target customer: ${params.targetCustomer}`);
  if (params.segment !== 'unknown') market.push(`Segment: ${params.segment.replace('_', '-')}`);
  if (params.geography) {
    market.push(
      params.companyGeography && params.geography === params.companyGeography
        ? `Same geography: ${params.geography}`
        : `Geography: ${params.geography}`,
    );
  }
  if (params.businessModel) market.push(`Business model: ${params.businessModel}`);

  const visibility = params.searchVisibility;
  if (visibility) {
    const total = params.totalQueriesObserved ?? 0;
    search.push(
      `Appears on ${visibility.queriesAppeared}${total ? `/${total}` : ''} observed queries`
      + (visibility.averagePosition !== null ? `, average observed position ${visibility.averagePosition}` : ''),
    );
    if (visibility.gapQueries.length > 0) {
      search.push(`Ranks where this company does not on ${visibility.gapQueries.length} quer${visibility.gapQueries.length === 1 ? 'y' : 'ies'}: ${visibility.gapQueries.slice(0, 3).join(', ')}`);
    }
  }

  return {
    discovery, product, market, search,
    signalCount: discovery.length + product.length + market.length + search.length,
  };
}

const EMPTY_SUMMARY = (): Record<CompositeRelation, number> => ({
  direct: 0, adjacent: 0, substitute: 0, strategic: 0, not_competitive: 0, unclassified: 0,
});

/**
 * The minimum shape this module needs from a competitor the engine already produced.
 * Structural rather than an import of `DetectedCompetitor`, so the tables module stays a
 * leaf and cannot pull the competitor engine into its dependency graph.
 */
export interface CompetitorLike {
  name: string;
  domain?: string | null;
  category?: string | null;
  relations?: CompetitorRelations;
  dimensions?: CompetitorDimensionScores | null;
  discoverySources?: readonly string[] | null;
  /**
   * COMPETITOR-OWNED evidence. This is the only source the tables may describe a competitor
   * from — see the note on `fit_signals` below.
   */
  enrichment?: {
    description?: string | null;
    business_model?: string | null;
    geography?: string | null;
    icp?: { use_case?: string | null; user_intent?: string | null } | null;
    scale_signals?: { notes?: string | null } | null;
  } | null;
  /**
   * DELIBERATELY NOT READ by this module.
   *
   * `fit_signals` is built by `buildCompetitorFitSignals(context)` from the COMPANY's own
   * profile — `team_size`, `revenue_range`, `target_customer`, `business_model` and
   * `geography` are the company's attributes, echoed onto every competitor row as the
   * criteria being matched against. Reading them here would make Report 1 assert, as
   * competitor evidence, facts about the company itself: HubSpot would be described as
   * "Segment: smb · Target customer: B2B SaaS marketing teams" purely because that is what
   * Omnivyra is. Declared so the trap is visible, and never consumed.
   */
  fit_signals?: unknown;
}

/**
 * Convert competitors the engine already ranked into table rows.
 *
 * The canonical relation model remains the SOLE owner of classification. This function does
 * not classify: it uses `competitor.relations` when the ranking engine attached it, and
 * otherwise calls the same canonical `deriveCompetitorRelations` — never a second
 * implementation. Nothing here can promote a competitor into a category.
 *
 * Evidence count mirrors the ranking engine's own accounting (discovery sources + enrichment
 * + a resolvable domain) so a competitor abstains here for exactly the reason it abstains there.
 */
export function buildCompetitorTableRows(
  competitors: readonly CompetitorLike[],
  context?: { geography?: string | null; visibilityByDomain?: Map<string, CompetitorVisibility>; totalQueriesObserved?: number },
): CompetitorTableRow[] {
  return competitors.map((competitor) => {
    const relations = competitor.relations
      ?? deriveCompetitorRelations({
        dimensions: competitor.dimensions ?? null,
        evidenceCount: (competitor.discoverySources?.length ?? 0)
          + (competitor.enrichment ? 1 : 0)
          + (competitor.domain ? 1 : 0),
        sources: [...(competitor.discoverySources ?? [])],
        hasStrongSource: (competitor.discoverySources ?? []).some((s) => s === 'serp' || s === 'provider'),
      });

    // Segment comes ONLY from competitor-owned scale evidence. There is currently no
    // employee/revenue field on `CompetitorEnrichmentProfile`, so this resolves to 'unknown'
    // for most competitors — which is the honest answer, and exactly what Phase 3 requires
    // rather than manufacturing precision from the company's own numbers.
    const segment = classifySegment({
      employeeRange: competitor.enrichment?.scale_signals?.notes ?? null,
      revenueRange: null,
    });

    const enrichment = competitor.enrichment ?? null;
    const domain = competitor.domain ?? null;
    return {
      name: competitor.name,
      domain,
      relations,
      evidence: buildEvidenceTrail({
        discoverySources: competitor.discoverySources ?? null,
        category: competitor.category ?? null,
        productSignals: enrichment?.description ? [enrichment.description] : null,
        useCase: enrichment?.icp?.use_case ?? null,
        targetCustomer: enrichment?.icp?.user_intent ?? null,
        geography: enrichment?.geography ?? null,
        businessModel: enrichment?.business_model ?? null,
        segment,
        companyGeography: context?.geography ?? null,
        searchVisibility: domain ? context?.visibilityByDomain?.get(domain) ?? null : null,
        totalQueriesObserved: context?.totalQueriesObserved,
      }),
      segment,
      geography: enrichment?.geography ?? null,
      businessModel: enrichment?.business_model ?? null,
      unclassified: relations.abstained,
    };
  });
}

/**
 * Render Table A and Table B from already-derived competitor rows.
 *
 * This performs NO classification of its own — it reads the relations the Phase 2 model
 * produced. That separation is deliberate: presentation must not be able to promote a
 * competitor into a category the evidence did not support.
 */
export function buildCompetitiveTables(rows: readonly CompetitorTableRow[]): CompetitiveTables {
  const summary = EMPTY_SUMMARY();
  const productCompetition: ProductCompetitionRow[] = [];
  const marketCompetition: MarketCompetitionRow[] = [];
  const unclassified: CompetitiveTables['unclassified'] = [];

  for (const row of rows) {
    const { relations } = row;
    summary[relations.compositeRelation] += 1;

    if (row.unclassified || relations.abstained) {
      unclassified.push({
        competitor: row.name,
        domain: row.domain,
        reason: relations.abstainReason ?? 'Insufficient evidence to classify.',
        signalCount: row.evidence.signalCount,
      });
    }

    // Both tables include every discovered competitor. An abstained axis shows a null score
    // and an 'unknown' classification rather than being omitted — the reader learns that the
    // company exists and that we could not place it, which is itself information.
    productCompetition.push({
      competitor: row.name,
      domain: row.domain,
      productOverlap: relations.product.value,
      // The problem/use-case component of the product axis, surfaced separately as the
      // required table shape asks. Null whenever the axis abstained.
      problemUseCaseOverlap: relations.product.value,
      evidence: [...row.evidence.product, ...row.evidence.discovery],
      classification: relations.productRelation,
      confidence: relations.product.confidence,
      state: relations.product.state,
    });

    marketCompetition.push({
      competitor: row.name,
      domain: row.domain,
      customerIcp: null,
      segment: row.segment,
      geography: row.geography,
      marketOverlap: relations.market.value,
      evidence: [...row.evidence.market, ...row.evidence.discovery],
      classification: relations.marketRelation,
      confidence: relations.market.confidence,
      state: relations.market.state,
    });
  }

  // Strongest overlap first; abstained rows (null) sort last without being dropped.
  const byScore = <T extends { productOverlap?: number | null; marketOverlap?: number | null }>(key: 'productOverlap' | 'marketOverlap') =>
    (left: T, right: T) => (Number(right[key] ?? -1)) - (Number(left[key] ?? -1));
  productCompetition.sort(byScore('productOverlap'));
  marketCompetition.sort(byScore('marketOverlap'));

  return {
    productCompetition,
    marketCompetition,
    unclassified,
    summary,
    empty: rows.length === 0,
    emptyReason: rows.length === 0
      ? 'No competitors could be discovered from public evidence for this domain.'
      : null,
  };
}
