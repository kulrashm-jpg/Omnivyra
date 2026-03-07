/**
 * Signal Relevance Engine
 * Calculates relevance score and taxonomy before storing signals.
 * Injected inside insertFromTrendApiResults before database insert.
 */

import { supabase } from '../db/supabaseClient';

export const TAXONOMY_VALUES = [
  'TREND',
  'COMPETITOR',
  'PRODUCT',
  'CUSTOMER',
  'MARKETING',
  'PARTNERSHIP',
  'LEADERSHIP',
  'REGULATION',
  'EVENT',
] as const;

export type TaxonomyValue = (typeof TAXONOMY_VALUES)[number];

export type SignalForRelevance = {
  topic?: string | null;
  source?: string | null;
  geo?: string | null;
  volume?: number | null;
  velocity?: number | null;
  confidence_score?: number | null;
  normalized_payload?: Record<string, unknown> | null;
};

export type CompanyContext = {
  industryTerms: string[];
  keywords: string[];
  competitors: string[];
  region?: string | null;
};

export type QueryContext = {
  topic?: string | null;
  competitor?: string | null;
  product?: string | null;
  region?: string | null;
  keyword?: string | null;
};

export type RelevanceResult = {
  relevance_score: number;
  primary_category: TaxonomyValue | null;
  tags: string[];
};

const WEIGHT_TOPIC = 0.3;
const WEIGHT_COMPETITOR = 0.25;
const WEIGHT_REGION = 0.15;
const WEIGHT_COMPANY_FOCUS = 0.2;
const WEIGHT_MOMENTUM = 0.1;

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

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function inferCategory(
  signal: SignalForRelevance,
  queryContext: QueryContext
): TaxonomyValue | null {
  const topic = (signal.topic ?? '').toLowerCase();
  const qTopic = (queryContext.topic ?? '').toLowerCase();
  const qCompetitor = (queryContext.competitor ?? '').toLowerCase();
  const qProduct = (queryContext.product ?? '').toLowerCase();

  if (qCompetitor && topic.includes(qCompetitor)) return 'COMPETITOR';
  if (qProduct && topic.includes(qProduct)) return 'PRODUCT';
  if (/complaint|issue|problem|feedback/i.test(topic)) return 'CUSTOMER';
  if (/market|trend|growth/i.test(topic)) return 'TREND';
  if (/marketing|campaign|content|brand/i.test(topic)) return 'MARKETING';
  if (/partner|collaboration|alliance/i.test(topic)) return 'PARTNERSHIP';
  if (/regulation|compliance|law|policy/i.test(topic)) return 'REGULATION';
  if (/leadership|executive|ceo|strategy/i.test(topic)) return 'LEADERSHIP';
  if (/event|launch|conference|webinar/i.test(topic)) return 'EVENT';

  return 'TREND';
}

/**
 * Calculate relevance score for a signal.
 */
export function computeRelevance(
  signal: SignalForRelevance,
  companyContext: CompanyContext | null,
  queryContext: QueryContext
): RelevanceResult {
  let score = 0.5;
  const tags: string[] = [];

  const topic = (signal.topic ?? '').trim().toLowerCase();
  const topicTokens = tokenize(topic);

  if (queryContext.topic && topicTokens.size > 0) {
    const queryTokens = tokenize(queryContext.topic);
    const sim = jaccardSimilarity(topicTokens, queryTokens);
    score += WEIGHT_TOPIC * sim;
    if (sim > 0.3) tags.push('topic_match');
  }

  if (companyContext && companyContext.competitors.length > 0 && topic) {
    const competitorMatch = companyContext.competitors.some((c) =>
      topic.includes(c.toLowerCase())
    );
    if (competitorMatch) {
      score += WEIGHT_COMPETITOR;
      tags.push('competitor_match');
    }
  }

  if (queryContext.competitor && topic) {
    if (topic.includes(queryContext.competitor.toLowerCase())) {
      score += WEIGHT_COMPETITOR;
      tags.push('query_competitor_match');
    }
  }

  const region = (signal.geo ?? queryContext.region ?? '').toLowerCase();
  if (region && companyContext?.region) {
    if (region.includes(companyContext.region.toLowerCase())) {
      score += WEIGHT_REGION;
      tags.push('region_match');
    }
  } else if (queryContext.region && region) {
    if (region.includes(queryContext.region.toLowerCase())) {
      score += WEIGHT_REGION;
      tags.push('region_match');
    }
  }

  if (companyContext && (companyContext.keywords.length > 0 || companyContext.industryTerms.length > 0)) {
    const focusTerms = new Set([
      ...companyContext.keywords.map((k) => k.toLowerCase()),
      ...companyContext.industryTerms.map((i) => i.toLowerCase()),
    ]);
    const matchCount = [...topicTokens].filter((t) => focusTerms.has(t)).length;
    if (focusTerms.size > 0 && matchCount > 0) {
      const focusScore = Math.min(1, matchCount / Math.max(1, focusTerms.size));
      score += WEIGHT_COMPANY_FOCUS * focusScore;
      tags.push('company_focus_match');
    }
  }

  const momentum = (signal.velocity ?? 0) > 0 || (signal.volume ?? 0) > 0 ? 0.5 : 0;
  score += WEIGHT_MOMENTUM * momentum;
  if (momentum > 0) tags.push('momentum');

  const relevanceScore = Number(Math.max(0, Math.min(1, score)).toFixed(3));
  const primaryCategory = inferCategory(signal, queryContext);

  return {
    relevance_score: relevanceScore,
    primary_category: primaryCategory,
    tags: [...new Set(tags)],
  };
}

/**
 * Load company context for relevance scoring.
 */
export async function loadCompanyContextForRelevance(
  companyId: string | null
): Promise<CompanyContext | null> {
  if (!companyId) return null;

  const industryTerms: string[] = [];
  const keywords: string[] = [];
  const competitors: string[] = [];
  let region: string | null = null;

  const { data: company } = await supabase
    .from('companies')
    .select('id, industry')
    .eq('id', companyId)
    .maybeSingle();

  if (company?.industry) {
    industryTerms.push(
      ...String(company.industry)
        .split(/[,;]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  const { data: profile } = await supabase
    .from('company_profiles')
    .select('industry, industry_list, competitors, competitors_list, content_themes, content_themes_list')
    .eq('company_id', companyId)
    .maybeSingle();

  if (profile) {
    const p = profile as Record<string, unknown>;
    if (p.industry && typeof p.industry === 'string') {
      industryTerms.push(
        ...(p.industry as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
    }
    if (Array.isArray(p.industry_list)) {
      industryTerms.push(
        ...(p.industry_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      );
    }
    if (Array.isArray(p.competitors_list)) {
      competitors.push(
        ...(p.competitors_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      );
    }
    if (typeof p.competitors === 'string') {
      competitors.push(
        ...(p.competitors as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
    }
    if (Array.isArray(p.content_themes_list)) {
      keywords.push(
        ...(p.content_themes_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      );
    }
    if (typeof p.content_themes === 'string') {
      keywords.push(
        ...(p.content_themes as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
    }
  }

  return {
    industryTerms: [...new Set(industryTerms)],
    keywords: [...new Set(keywords)],
    competitors: [...new Set(competitors)],
    region,
  };
}
