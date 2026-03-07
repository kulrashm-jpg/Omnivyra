/**
 * Company Signal Filtering Engine
 * Phase-4: Filters global intelligence signals by company intelligence configuration.
 * Uses Phase-3 tables: company_intelligence_topics, competitors, products, regions, keywords.
 */

import {
  getCompanyTopics,
  getCompanyCompetitors,
  getCompanyProducts,
  getCompanyRegions,
  getCompanyKeywords,
} from './companyIntelligenceConfigService';

export type CompanyIntelligenceConfiguration = {
  topics: string[];
  competitors: string[];
  products: string[];
  regions: string[];
  keywords: string[];
};

export type IntelligenceSignalInput = {
  id: string;
  topic?: string | null;
  normalized_payload?: Record<string, unknown> | null;
};

export type SignalMatchEvaluation = {
  signal_id: string;
  topic_match: boolean;
  competitor_match: boolean;
  product_match: boolean;
  region_match: boolean;
  keyword_match: boolean;
  matched_topics: string[];
  matched_competitors: string[];
  matched_regions: string[];
};

export type FilteredSignalWithEvaluation<T extends IntelligenceSignalInput = IntelligenceSignalInput> = {
  signal: T;
  evaluation: SignalMatchEvaluation;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  );
}

function hasTokenOverlap(text: string, values: string[]): boolean {
  if (values.length === 0) return false;
  const textTokens = tokenize(text);
  if (textTokens.size === 0) return false;
  const valueSet = new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
  for (const t of textTokens) {
    if (valueSet.has(t)) return true;
  }
  return false;
}

/**
 * Load configuration from Phase-3 tables.
 * Returns only enabled items.
 */
export async function loadCompanyIntelligenceConfiguration(
  companyId: string
): Promise<CompanyIntelligenceConfiguration> {
  const [topicsRes, competitorsRes, productsRes, regionsRes, keywordsRes] = await Promise.all([
    getCompanyTopics(companyId),
    getCompanyCompetitors(companyId),
    getCompanyProducts(companyId),
    getCompanyRegions(companyId),
    getCompanyKeywords(companyId),
  ]);

  const topics = topicsRes.filter((t) => t.enabled).map((t) => t.topic.trim().toLowerCase());
  const competitors = competitorsRes
    .filter((c) => c.enabled)
    .map((c) => c.competitor_name.trim().toLowerCase());
  const products = productsRes
    .filter((p) => p.enabled)
    .map((p) => p.product_name.trim().toLowerCase());
  const regions = regionsRes
    .filter((r) => r.enabled)
    .map((r) => r.region.trim().toLowerCase());
  const keywords = keywordsRes
    .filter((k) => k.enabled)
    .map((k) => k.keyword.trim().toLowerCase());

  return {
    topics: [...new Set(topics)].filter(Boolean),
    competitors: [...new Set(competitors)].filter(Boolean),
    products: [...new Set(products)].filter(Boolean),
    regions: [...new Set(regions)].filter(Boolean),
    keywords: [...new Set(keywords)].filter(Boolean),
  };
}

/**
 * Evaluate a signal against company configuration.
 * Returns match evaluation.
 */
export function evaluateSignalAgainstCompany(
  signal: IntelligenceSignalInput,
  companyConfig: CompanyIntelligenceConfiguration
): SignalMatchEvaluation {
  const topic = (signal.topic ?? '').trim().toLowerCase();
  const geo = (
    (signal.normalized_payload?.geo ?? signal.normalized_payload?.region ?? '') as string
  )
    .toString()
    .toLowerCase();

  const matched_topics: string[] = [];
  if (companyConfig.topics.length > 0) {
    for (const t of companyConfig.topics) {
      if (t && (topic.includes(t) || hasTokenOverlap(topic, [t]))) {
        matched_topics.push(t);
      }
    }
  }
  const topic_match = matched_topics.length > 0;

  const matched_competitors: string[] = [];
  if (companyConfig.competitors.length > 0) {
    for (const c of companyConfig.competitors) {
      if (c && topic.includes(c)) {
        matched_competitors.push(c);
      }
    }
  }
  const competitor_match = matched_competitors.length > 0;

  const product_match = companyConfig.products.some((p) => p && topic.includes(p));

  const matched_regions: string[] = [];
  if (companyConfig.regions.length > 0 && geo) {
    for (const r of companyConfig.regions) {
      if (r && geo.includes(r)) {
        matched_regions.push(r);
      }
    }
  }
  const region_match = matched_regions.length > 0;

  const keyword_match = companyConfig.keywords.some((k) => k && topic.includes(k));

  return {
    signal_id: signal.id,
    topic_match,
    competitor_match,
    product_match,
    region_match,
    keyword_match,
    matched_topics,
    matched_competitors,
    matched_regions,
  };
}

/**
 * Filter signals for company. Returns only signals relevant to the company.
 * A signal is relevant if at least one of topic_match, competitor_match,
 * product_match, region_match, keyword_match is true.
 */
export async function filterSignalsForCompany<T extends IntelligenceSignalInput>(
  companyId: string,
  signals: T[]
): Promise<FilteredSignalWithEvaluation<T>[]> {
  if (signals.length === 0) return [];

  const config = await loadCompanyIntelligenceConfiguration(companyId);

  const hasAnyConfig =
    config.topics.length > 0 ||
    config.competitors.length > 0 ||
    config.products.length > 0 ||
    config.regions.length > 0 ||
    config.keywords.length > 0;

  if (!hasAnyConfig) {
    return [];
  }

  const result: FilteredSignalWithEvaluation<T>[] = [];
  for (const signal of signals) {
    const topic = (signal.topic ?? '').trim();
    if (!topic) continue;

    const evaluation = evaluateSignalAgainstCompany(signal, config);
    const isRelevant =
      evaluation.topic_match ||
      evaluation.competitor_match ||
      evaluation.product_match ||
      evaluation.region_match ||
      evaluation.keyword_match;

    if (isRelevant) {
      result.push({ signal, evaluation });
    }
  }

  return result;
}
