import { ownedDbTable } from '../db/writeOwner';
import type { CompanyContext } from './activeLeadsCompanyContext';
import {
  SCORED_OPPORTUNITY_TYPES,
  type AbstractSource,
  type OpportunityType,
} from './sourceRecommendationEngine';
import type { DiscoveryCandidate, DiscoveryProfile } from './communityDiscoveryService';

export type CuratedIndustrySource = {
  id: string;
  source_name: string;
  source_type: string;
  source_identifier: string;
  source_url: string | null;
  platform: string | null;
  integration_mode: 'public' | 'public_login' | 'oauth' | 'api_key' | 'manual';
  industry_tags: string[];
  similar_industry_tags: string[];
  opportunity_types: string[];
  recommendation_reason: string | null;
  estimated_signal_quality: number;
  estimated_volume: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CuratedSourceMatch = {
  source: CuratedIndustrySource;
  abstractSource: AbstractSource;
  reason: string;
  matchedIndustries: string[];
  matchedSimilarIndustries: string[];
};

const OPPORTUNITY_ALIASES: Record<string, OpportunityType[]> = {
  product_research: ['buying_intent', 'growth_signal'],
  competitor_pain: ['competitor_dissatisfaction'],
  competitor_dissatisfaction: ['competitor_dissatisfaction'],
  buying_intent: ['buying_intent'],
  migration_signal: ['migration_signal'],
  hiring_signal: ['hiring_signal'],
  growth_signal: ['growth_signal'],
  integration_need: ['integration_need'],
  integration_needs: ['integration_need'],
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeList(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeToken(String(value ?? ''));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function intersect(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const setB = new Set(b);
  return a.filter((value) => setB.has(value));
}

function deriveCompanyIndustryTokens(context: CompanyContext): string[] {
  return normalizeList([
    ...context.industry.values,
    ...context.products.values,
    ...context.services.values,
    ...context.icp.values,
  ]);
}

function deriveProfileTokens(profile: DiscoveryProfile): string[] {
  return normalizeList([
    profile.industryCategory,
    profile.description,
    profile.icp,
    ...(profile.keywords ?? []),
  ]);
}

function opportunityPriors(values: string[]): AbstractSource['opportunity_priors'] {
  const selected = new Set<OpportunityType>();
  for (const raw of values ?? []) {
    const key = normalizeToken(raw).replace(/\s+/g, '_');
    for (const type of OPPORTUNITY_ALIASES[key] ?? []) selected.add(type);
  }

  const priors: Partial<Record<OpportunityType, number>> = {};
  for (const type of SCORED_OPPORTUNITY_TYPES) {
    priors[type] = selected.has(type) ? 0.72 : 0.32;
  }
  return priors as AbstractSource['opportunity_priors'];
}

function defaultReason(row: CuratedIndustrySource, matched: string[], similar: string[]): string {
  if (row.recommendation_reason?.trim()) return row.recommendation_reason.trim();
  const industryText = matched.length > 0
    ? matched.slice(0, 3).join(', ')
    : similar.slice(0, 3).join(', ');
  if (industryText) {
    return `${row.source_name} is curated for ${industryText} companies and can be reviewed before enabling.`;
  }
  return `${row.source_name} is a curated source for companies with a similar listening profile.`;
}

function toMatch(row: CuratedIndustrySource, tokens: string[]): CuratedSourceMatch | null {
  const industryTags = normalizeList(row.industry_tags ?? []);
  const similarTags = normalizeList(row.similar_industry_tags ?? []);
  const matchedIndustries = intersect(industryTags, tokens);
  const matchedSimilarIndustries = intersect(similarTags, tokens);

  if (industryTags.length > 0 && similarTags.length > 0 && matchedIndustries.length === 0 && matchedSimilarIndustries.length === 0) {
    return null;
  }

  const strategicBoost = matchedIndustries.length > 0 ? 0.78 : matchedSimilarIndustries.length > 0 ? 0.64 : 0.45;
  const reason = defaultReason(row, matchedIndustries, matchedSimilarIndustries);
  return {
    source: row,
    reason,
    matchedIndustries,
    matchedSimilarIndustries,
    abstractSource: {
      source_type: row.source_type,
      source_identifier: row.source_identifier,
      display_name: row.source_name,
      strategic_relevance: strategicBoost,
      matched_verticals: [...matchedIndustries, ...matchedSimilarIndustries],
      matched_keywords: normalizeList(row.opportunity_types ?? []),
      estimated_signal_quality: Number(row.estimated_signal_quality ?? 0.65),
      estimated_volume: Number(row.estimated_volume ?? 120),
      opportunity_priors: opportunityPriors(row.opportunity_types ?? []),
      persona_tags: row.platform ? [row.platform] : [],
    },
  };
}

export async function listCuratedIndustrySources(options?: {
  activeOnly?: boolean;
}): Promise<CuratedIndustrySource[]> {
  let query = ownedDbTable('curated_industry_sources')
    .select('*')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false });

  if (options?.activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list curated industry sources: ${error.message}`);
  return ((data ?? []) as CuratedIndustrySource[]).map((row) => ({
    ...row,
    estimated_signal_quality: Number(row.estimated_signal_quality ?? 0.65),
    estimated_volume: Number(row.estimated_volume ?? 120),
    industry_tags: row.industry_tags ?? [],
    similar_industry_tags: row.similar_industry_tags ?? [],
    opportunity_types: row.opportunity_types ?? [],
  }));
}

export async function loadCuratedIndustrySourceMatches(
  context: CompanyContext,
): Promise<CuratedSourceMatch[]> {
  const rows = await listCuratedIndustrySources({ activeOnly: true });
  const tokens = deriveCompanyIndustryTokens(context);
  return rows
    .map((row) => toMatch(row, tokens))
    .filter((match): match is CuratedSourceMatch => match !== null);
}

export async function loadCuratedDiscoveryCandidatesForProfile(
  profile: DiscoveryProfile,
): Promise<DiscoveryCandidate[]> {
  const rows = await listCuratedIndustrySources({ activeOnly: true });
  const tokens = deriveProfileTokens(profile);
  const matches = rows
    .map((row) => toMatch(row, tokens))
    .filter((match): match is CuratedSourceMatch => match !== null);

  return matches.map((match): DiscoveryCandidate => ({
    source_type: match.source.source_type as DiscoveryCandidate['source_type'],
    source_identifier: match.source.source_identifier,
    display_name: match.source.source_name,
    recommendation_reason: match.reason,
    recommendation_category: 'industry_match',
    confidence_score: Number((match.abstractSource.strategic_relevance ?? 0.5).toFixed(3)),
    estimated_signal_quality: Number(match.source.estimated_signal_quality ?? 0.65),
    estimated_volume: Number(match.source.estimated_volume ?? 120),
    estimated_cost: 0,
    strategic_relevance: Number((match.abstractSource.strategic_relevance ?? 0.5).toFixed(3)),
    related_keywords: [...match.matchedIndustries, ...match.matchedSimilarIndustries],
    related_competitors: [],
    source_metadata: {
      curated: true,
      source_url: match.source.source_url,
      platform: match.source.platform,
      integration_mode: match.source.integration_mode,
      industry_tags: match.source.industry_tags,
      similar_industry_tags: match.source.similar_industry_tags,
    },
  }));
}

export function curatedDiscoveryMetadata(match: CuratedSourceMatch) {
  return {
    curated: true,
    source_url: match.source.source_url,
    platform: match.source.platform,
    integration_mode: match.source.integration_mode,
    industry_tags: match.source.industry_tags,
    similar_industry_tags: match.source.similar_industry_tags,
  };
}
