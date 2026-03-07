/**
 * Company Intelligence Signal Engine
 * Phase 2: Converts global intelligence_signals into company-specific signals.
 * Filters and scores using company industry, competitors, keywords, region, product focus.
 */

import { supabase } from '../db/supabaseClient';

export type CompanyIntelligenceContext = {
  industryTerms: string[];
  competitors: string[];
  keywords: string[];
  region: string | null;
  productFocus: string[];
};

export type GlobalSignalInput = {
  id: string;
  topic?: string | null;
  relevance_score?: number | null;
  primary_category?: string | null;
  tags?: string[] | null;
  normalized_payload?: Record<string, unknown> | null;
  detected_at?: string | null;
};

export type CompanySignalOutput = {
  company_id: string;
  signal_id: string;
  company_relevance_score: number;
  company_signal_type: string;
  impact_score: number;
};

const MIN_RELEVANCE_THRESHOLD = 0.2;
const WEIGHT_BASE_RELEVANCE = 0.4;
const WEIGHT_INDUSTRY = 0.2;
const WEIGHT_COMPETITOR = 0.25;
const WEIGHT_KEYWORD = 0.2;
const WEIGHT_REGION = 0.15;
const WEIGHT_PRODUCT = 0.2;
const WEIGHT_IMPACT_MOMENTUM = 0.3;
const WEIGHT_IMPACT_VOLUME = 0.3;
const WEIGHT_IMPACT_CONFIDENCE = 0.2;

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

function inferCompanySignalType(
  signal: GlobalSignalInput,
  context: CompanyIntelligenceContext
): string {
  const topic = (signal.topic ?? '').toLowerCase();
  const cat = (signal.primary_category ?? 'TREND').toUpperCase();

  if (context.competitors.some((c) => topic.includes(c))) return 'competitor_activity';
  if (context.productFocus.some((p) => topic.includes(p))) return 'product_signal';
  if (context.keywords.some((k) => topic.includes(k))) return 'keyword_trend';
  if (/complaint|issue|problem|feedback|sentiment/i.test(topic)) return 'customer_sentiment';
  if (/market|trend|growth|shift/i.test(topic)) return 'market_shift';
  if (/launch|product|release/i.test(topic)) return 'product_launch';

  return cat === 'COMPETITOR'
    ? 'competitor_activity'
    : cat === 'CUSTOMER'
      ? 'customer_sentiment'
      : cat === 'PRODUCT'
        ? 'product_signal'
        : 'trend';
}

/**
 * Compute company-specific relevance and impact for a single signal.
 */
export function computeCompanyRelevance(
  signal: GlobalSignalInput,
  companyId: string,
  context: CompanyIntelligenceContext
): CompanySignalOutput | null {
  const topic = (signal.topic ?? '').trim().toLowerCase();
  if (!topic) return null;

  const topicTokens = tokenize(topic);
  let companyScore = 0;
  const baseRelevance = Math.min(1, Math.max(0, signal.relevance_score ?? 0.5));
  companyScore += WEIGHT_BASE_RELEVANCE * baseRelevance;

  if (context.industryTerms.length > 0) {
    const industrySet = new Set(context.industryTerms.map((t) => t.toLowerCase()));
    const matchCount = [...topicTokens].filter((t) => industrySet.has(t)).length;
    if (matchCount > 0) {
      companyScore += WEIGHT_INDUSTRY * Math.min(1, matchCount / Math.max(1, industrySet.size));
    }
  }

  if (context.competitors.length > 0 && context.competitors.some((c) => topic.includes(c.toLowerCase()))) {
    companyScore += WEIGHT_COMPETITOR;
  }

  if (context.keywords.length > 0) {
    const keywordSet = new Set(context.keywords.map((k) => k.toLowerCase()));
    const matchCount = [...topicTokens].filter((t) => keywordSet.has(t)).length;
    if (matchCount > 0) {
      companyScore += WEIGHT_KEYWORD * Math.min(1, matchCount / Math.max(1, keywordSet.size));
    }
  }

  const geo = (signal.normalized_payload?.geo ?? signal.normalized_payload?.region ?? '').toString().toLowerCase();
  if (context.region && geo && geo.includes(context.region.toLowerCase())) {
    companyScore += WEIGHT_REGION;
  }

  if (context.productFocus.length > 0 && context.productFocus.some((p) => topic.includes(p.toLowerCase()))) {
    companyScore += WEIGHT_PRODUCT;
  }

  const companyRelevanceScore = Number(Math.max(0, Math.min(1, companyScore)).toFixed(3));
  if (companyRelevanceScore < MIN_RELEVANCE_THRESHOLD) return null;

  const np = signal.normalized_payload ?? {};
  const velocity = (np.velocity as number) ?? 0;
  const volume = (np.volume as number) ?? 0;
  const confidence = typeof signal.relevance_score === 'number' ? signal.relevance_score : 0.5;

  let impactScore = 0.3;
  impactScore += WEIGHT_IMPACT_MOMENTUM * Math.min(1, velocity / 10);
  impactScore += WEIGHT_IMPACT_VOLUME * Math.min(1, volume / 100);
  impactScore += WEIGHT_IMPACT_CONFIDENCE * confidence;
  impactScore = Number(Math.max(0, Math.min(1, impactScore)).toFixed(3));

  const companySignalType = inferCompanySignalType(signal, context);

  return {
    company_id: companyId,
    signal_id: signal.id,
    company_relevance_score: companyRelevanceScore,
    company_signal_type: companySignalType,
    impact_score: impactScore,
  };
}

/**
 * Load company context for intelligence scoring.
 */
export async function loadCompanyContextForIntelligence(
  companyId: string
): Promise<CompanyIntelligenceContext> {
  const industryTerms: string[] = [];
  const keywords: string[] = [];
  const competitors: string[] = [];
  const productFocus: string[] = [];
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
    .select(
      'industry, industry_list, competitors, competitors_list, content_themes, content_themes_list, geography, geography_list, products_services, products_services_list'
    )
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
    if (Array.isArray(p.products_services_list)) {
      productFocus.push(
        ...(p.products_services_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      );
    }
    if (typeof p.products_services === 'string') {
      productFocus.push(
        ...(p.products_services as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
    }
    if (p.geography && typeof p.geography === 'string') {
      region = (p.geography as string).split(/[,;]/)[0]?.trim() ?? null;
    }
    if (Array.isArray(p.geography_list) && (p.geography_list as string[]).length > 0) {
      region = (p.geography_list as string[])[0]?.trim() ?? region;
    }
  }

  return {
    industryTerms: [...new Set(industryTerms)],
    competitors: [...new Set(competitors)],
    keywords: [...new Set(keywords)],
    region,
    productFocus: [...new Set(productFocus)],
  };
}

/**
 * Transform global signals into company-specific signals.
 * Returns only signals that pass the relevance threshold.
 */
export function transformToCompanySignals(
  signals: GlobalSignalInput[],
  companyId: string,
  context: CompanyIntelligenceContext
): CompanySignalOutput[] {
  const out: CompanySignalOutput[] = [];
  for (const s of signals) {
    const result = computeCompanyRelevance(s, companyId, context);
    if (result) out.push(result);
  }
  return out;
}
