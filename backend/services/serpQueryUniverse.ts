/**
 * SERP query universe (Phase 3).
 *
 * Turns a company's PUBLIC evidence into a classified set of search queries, and classifies
 * queries the platform already holds. Report 1 needs to distinguish branded from
 * non-branded visibility and commercial from informational intent; before this, queries were
 * an unclassified string list, so "we rank for our own name" and "we rank for the category"
 * were indistinguishable in the output.
 *
 * Two problems this fixes in the existing extraction:
 *
 *  1. NO CLASSIFICATION. `extractTopKeywords` returns strings. Visibility could not be split
 *     by intent, which is the difference between a useful and a misleading SEO reading.
 *  2. BOILERPLATE. Extraction reads page titles, headings and internal anchor text, so site
 *     chrome scores as highly as real topics. A live run on omnivyra.com produced
 *     'get', 'features', 'sales', 'credits', 'help', 'privacy', 'policy', 'terms' — eight
 *     queries of which six were navigation furniture. Spending SERP quota on "privacy"
 *     measures nothing about the business.
 *
 * This module does NOT replace `extractTopKeywords`; that extraction is sound and stays the
 * source. This filters and classifies its output, and derives category/comparison queries
 * from public positioning evidence.
 */

export type QueryClass =
  | 'branded'
  | 'category'
  | 'use_case'
  | 'problem'
  | 'comparison'
  | 'commercial'
  | 'informational';

/** Intent grouping used for the visibility split. Derived from QueryClass, never asserted separately. */
export type QueryIntent = 'branded' | 'commercial' | 'informational';

export interface SerpQuery {
  query: string;
  queryClass: QueryClass;
  intent: QueryIntent;
  /** Where the query text came from — kept so a ranking can be traced to its origin. */
  origin: 'crawl_keyword' | 'positioning' | 'offering' | 'brand';
}

const INTENT_BY_CLASS: Record<QueryClass, QueryIntent> = {
  branded: 'branded',
  category: 'commercial',
  comparison: 'commercial',
  commercial: 'commercial',
  use_case: 'informational',
  problem: 'informational',
  informational: 'informational',
};

/**
 * Site-chrome and legal/navigation terms that carry no commercial meaning. Deliberately a
 * denylist of NAVIGATION vocabulary, not of short words — a genuinely short category term
 * ("crm", "seo", "ai") must survive.
 */
const BOILERPLATE = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'privacy', 'privacy policy', 'policy',
  'terms', 'terms of service', 'cookie', 'cookies', 'legal', 'imprint', 'disclaimer',
  'sitemap', 'login', 'log in', 'sign in', 'signin', 'signup', 'sign up', 'register',
  'get', 'get started', 'start', 'help', 'support', 'faq', 'search', 'menu', 'careers',
  'jobs', 'press', 'blog', 'news', 'team', 'company', 'pricing', 'plans', 'features',
  'credits', 'account', 'dashboard', 'settings', 'profile', 'sales', 'demo', 'book a demo',
  'read more', 'learn more', 'click here', 'contact sales', 'free trial', 'services',
  'solutions', 'products', 'resources', 'documentation', 'docs', 'download', 'subscribe',
]);

const COMMERCIAL_MARKERS = /\b(best|top|software|platform|tool|tools|vendor|vendors|provider|providers|pricing|price|cost|buy|compare|alternative|alternatives|competitor|competitors|review|reviews|for\s+\w+)\b/i;
const PROBLEM_MARKERS = /\b(how to|why|what is|guide|tutorial|checklist|template|example|examples|problem|issue|fix|improve|reduce|increase)\b/i;
const COMPARISON_MARKERS = /\b(vs|versus|compare|comparison|alternative|alternatives)\b/i;

export function normalizeQuery(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s+&-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a term is navigation furniture rather than a topic worth measuring. */
export function isBoilerplateQuery(value: string): boolean {
  const normalized = normalizeQuery(value);
  if (!normalized) return true;
  if (BOILERPLATE.has(normalized)) return true;
  // A single word that is pure chrome — but keep short real category terms.
  const words = normalized.split(' ');
  if (words.length === 1 && BOILERPLATE.has(words[0])) return true;
  return false;
}

/** Classify one query against the company's brand tokens. Deterministic. */
export function classifyQuery(query: string, brandTokens: readonly string[]): QueryClass {
  const normalized = normalizeQuery(query);
  const isBranded = brandTokens.some((token) => token.length >= 3 && normalized.includes(token));
  if (isBranded) return COMPARISON_MARKERS.test(normalized) ? 'comparison' : 'branded';
  if (COMPARISON_MARKERS.test(normalized)) return 'comparison';
  if (PROBLEM_MARKERS.test(normalized)) return 'problem';
  if (COMMERCIAL_MARKERS.test(normalized)) return 'commercial';
  // Multi-word non-branded, non-commercial terms read as the company's category or use case.
  return normalized.split(' ').length >= 2 ? 'category' : 'use_case';
}

export function intentForClass(queryClass: QueryClass): QueryIntent {
  return INTENT_BY_CLASS[queryClass];
}

/** Brand tokens used to detect branded queries — the company name plus its bare domain label. */
export function brandTokensFor(params: { companyName?: string | null; domain?: string | null }): string[] {
  const tokens = new Set<string>();
  const name = normalizeQuery(params.companyName ?? '');
  if (name) {
    tokens.add(name);
    for (const word of name.split(' ')) if (word.length >= 4) tokens.add(word);
  }
  const host = String(params.domain ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const label = host.split('.')[0];
  if (label && label.length >= 3) tokens.add(label);
  return [...tokens];
}

/**
 * Build the classified query universe from PUBLIC evidence only.
 *
 * `crawlKeywords` are the output of the existing `extractTopKeywords` (canonical keywords,
 * page titles, headings, internal anchors, page content). Positioning/offering terms come
 * from the company's own public description. Nothing here reaches a private source.
 */
export function buildSerpQueryUniverse(params: {
  companyName?: string | null;
  domain?: string | null;
  crawlKeywords?: readonly string[] | null;
  category?: string | null;
  offerings?: readonly string[] | null;
  limit?: number;
}): SerpQuery[] {
  const limit = Math.max(1, params.limit ?? 20);
  const brandTokens = brandTokensFor(params);
  const seen = new Set<string>();
  const out: SerpQuery[] = [];

  const push = (raw: string, origin: SerpQuery['origin']) => {
    const query = normalizeQuery(raw);
    if (!query || query.length < 3 || seen.has(query)) return;
    if (isBoilerplateQuery(query)) return;
    seen.add(query);
    const queryClass = classifyQuery(query, brandTokens);
    out.push({ query, queryClass, intent: intentForClass(queryClass), origin });
  };

  // 1. Brand — the one query every company must be measured on.
  const brandName = normalizeQuery(params.companyName ?? '');
  if (brandName) push(brandName, 'brand');

  // 2. Category / comparison from public positioning. These are the queries a buyer runs.
  const category = normalizeQuery(params.category ?? '');
  if (category && !isBoilerplateQuery(category)) {
    push(category, 'positioning');
    push(`best ${category}`, 'positioning');
    if (brandName) push(`${brandName} alternatives`, 'positioning');
  }

  // 3. Offerings — what the company says it does.
  for (const offering of params.offerings ?? []) push(offering, 'offering');

  // 4. Crawl-derived terms, boilerplate removed.
  for (const keyword of params.crawlKeywords ?? []) push(keyword, 'crawl_keyword');

  return out.slice(0, limit);
}

export interface QueryUniverseSummary {
  total: number;
  byClass: Record<QueryClass, number>;
  byIntent: Record<QueryIntent, number>;
  /** Terms dropped as navigation furniture — retained so the filtering is auditable. */
  rejectedBoilerplate: string[];
}

export function summarizeQueryUniverse(
  queries: readonly SerpQuery[],
  rejected: readonly string[] = [],
): QueryUniverseSummary {
  const byClass = {
    branded: 0, category: 0, use_case: 0, problem: 0, comparison: 0, commercial: 0, informational: 0,
  } as Record<QueryClass, number>;
  const byIntent = { branded: 0, commercial: 0, informational: 0 } as Record<QueryIntent, number>;
  for (const q of queries) {
    byClass[q.queryClass] += 1;
    byIntent[q.intent] += 1;
  }
  return { total: queries.length, byClass, byIntent, rejectedBoilerplate: [...rejected] };
}
