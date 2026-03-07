/**
 * Company Trend Relevance Engine
 * Scores how relevant each strategic theme is for a company (industry, keywords, competitors).
 * Sits between signal_intelligence / strategic_themes and the UI. Does not modify the intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

const WEIGHT_KEYWORD = 0.5;
const WEIGHT_COMPETITOR = 0.3;
const WEIGHT_INDUSTRY = 0.2;

type CompanyContext = {
  industryTerms: string[];
  keywords: string[];
  competitors: string[];
};

type ThemeWithTopic = {
  id: string;
  intelligence_id: string;
  keywords: unknown;
  companies: unknown;
  topic: string;
};

function log(event: 'theme_relevance_calculated', data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

function normalizeToLowerSet(values: unknown): Set<string> {
  if (Array.isArray(values)) {
    return new Set(
      values
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).trim().toLowerCase()))
        .filter(Boolean)
    );
  }
  if (typeof values === 'string') {
    const split = values.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return new Set(split);
  }
  return new Set<string>();
}

/**
 * Load company context from companies + company_profiles.
 */
async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const industryTerms: string[] = [];
  const keywords: string[] = [];
  const competitors: string[] = [];

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id, industry')
    .eq('id', companyId)
    .maybeSingle();

  if (!companyError && company?.industry) {
    industryTerms.push(...String(company.industry).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  }

  const { data: profile, error: profileError } = await supabase
    .from('company_profiles')
    .select('industry, industry_list, competitors, competitors_list, content_themes, content_themes_list')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!profileError && profile) {
    const p = profile as Record<string, unknown>;
    if (p.industry && typeof p.industry === 'string') {
      industryTerms.push(...(p.industry as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
    if (Array.isArray(p.industry_list)) {
      industryTerms.push(
        ...(p.industry_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      );
    }
    if (Array.isArray(p.competitors_list)) {
      competitors.push(...(p.competitors_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    }
    if (typeof p.competitors === 'string') {
      competitors.push(...(p.competitors as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
    if (Array.isArray(p.content_themes_list)) {
      keywords.push(...(p.content_themes_list as string[]).map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    }
    if (typeof p.content_themes === 'string') {
      keywords.push(...(p.content_themes as string).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
  }

  return {
    industryTerms: [...new Set(industryTerms)],
    keywords: [...new Set(keywords)],
    competitors: [...new Set(competitors)],
  };
}

/**
 * Load strategic themes with topic from signal_intelligence.
 */
async function loadThemesWithTopic(): Promise<ThemeWithTopic[]> {
  const { data: themes, error: themesError } = await supabase
    .from('strategic_themes')
    .select('id, intelligence_id, keywords, companies');

  if (themesError || !themes?.length) return [];

  const intelligenceIds = [...new Set((themes as { intelligence_id: string }[]).map((t) => t.intelligence_id))];
  const { data: intelRows, error: intelError } = await supabase
    .from('signal_intelligence')
    .select('id, topic')
    .in('id', intelligenceIds);

  if (intelError) return [];

  const topicById = new Map<string, string>(
    (intelRows ?? []).map((r: { id: string; topic: string }) => [r.id, r.topic ?? ''])
  );

  return (themes as { id: string; intelligence_id: string; keywords: unknown; companies: unknown }[]).map((t) => ({
    id: t.id,
    intelligence_id: t.intelligence_id,
    keywords: t.keywords,
    companies: t.companies,
    topic: topicById.get(t.intelligence_id) ?? '',
  }));
}

/**
 * Keyword match: intersection of theme keywords and company keywords.
 * Score = |intersection| / max(|theme_keywords|, 1), normalized 0-1.
 */
function keywordMatchScore(
  themeKeywords: unknown,
  companyKeywords: string[],
  matchedOut: string[]
): number {
  const themeSet = normalizeToLowerSet(themeKeywords);
  const companySet = new Set(companyKeywords.map((k) => k.toLowerCase()));
  const intersection = [...themeSet].filter((k) => companySet.has(k));
  matchedOut.push(...intersection);
  if (themeSet.size === 0) return 0;
  return Math.min(1, intersection.length / themeSet.size);
}

/**
 * Competitor match: intersection of theme companies and company competitors.
 * Score = |intersection| / max(|theme_companies|, 1), normalized 0-1.
 */
function competitorMatchScore(
  themeCompanies: unknown,
  companyCompetitors: string[],
  matchedOut: string[]
): number {
  const themeSet = normalizeToLowerSet(themeCompanies);
  const companySet = new Set(companyCompetitors.map((c) => c.toLowerCase()));
  const intersection = [...themeSet].filter((c) => companySet.has(c));
  matchedOut.push(...intersection);
  if (themeSet.size === 0) return 0;
  return Math.min(1, intersection.length / themeSet.size);
}

/**
 * Industry match: theme topic contains any company industry term.
 * Score = 1 if any term found, else 0. (Alternative: fraction of terms found.)
 */
function industryMatchScore(topic: string, industryTerms: string[]): number {
  if (!topic || !industryTerms.length) return 0;
  const topicLower = topic.toLowerCase();
  const found = industryTerms.some((term) => topicLower.includes(term));
  return found ? 1 : 0;
}

/**
 * Compute relevance for one theme and upsert.
 */
async function upsertRelevance(
  companyId: string,
  theme: ThemeWithTopic,
  ctx: CompanyContext
): Promise<void> {
  const matchedKeywords: string[] = [];
  const matchedCompanies: string[] = [];

  const keyword_match_score = keywordMatchScore(theme.keywords, ctx.keywords, matchedKeywords);
  const competitor_match_score = competitorMatchScore(theme.companies, ctx.competitors, matchedCompanies);
  const industry_match_score = industryMatchScore(theme.topic, ctx.industryTerms);

  const relevance_score = Math.min(
    1,
    Math.max(
      0,
      WEIGHT_KEYWORD * keyword_match_score +
        WEIGHT_COMPETITOR * competitor_match_score +
        WEIGHT_INDUSTRY * industry_match_score
    )
  );

  const row = {
    company_id: companyId,
    theme_id: theme.id,
    relevance_score,
    matched_keywords: matchedKeywords,
    matched_companies: matchedCompanies,
  };

  const { error } = await supabase.from('theme_company_relevance').upsert(row, {
    onConflict: 'company_id,theme_id',
  });

  if (error) throw new Error(`Failed to upsert theme_company_relevance: ${error.message}`);

  log('theme_relevance_calculated', {
    company_id: companyId,
    theme_id: theme.id,
    relevance_score,
  });
}

export type ComputeThemeRelevanceForCompanyResult = {
  company_id: string;
  themes_scored: number;
  errors: string[];
};

/**
 * Compute theme relevance for a single company and persist.
 * 1. Load company context
 * 2. Load recent strategic themes (with topic)
 * 3. Calculate relevance score per theme
 * 4. Insert or update theme_company_relevance
 */
export async function computeThemeRelevanceForCompany(
  companyId: string
): Promise<ComputeThemeRelevanceForCompanyResult> {
  const errors: string[] = [];
  const ctx = await loadCompanyContext(companyId);
  const themes = await loadThemesWithTopic();
  let themesScored = 0;

  for (const theme of themes) {
    try {
      await upsertRelevance(companyId, theme, ctx);
      themesScored++;
    } catch (e: any) {
      errors.push(e?.message ?? String(e));
    }
  }

  return { company_id: companyId, themes_scored: themesScored, errors };
}

const FILTER_KEYS = [
  'keywords',
  'topics',
  'competitors',
  'industries',
  'companies',
  'influencers',
  'technologies',
  'geography',
] as const;

function toLowerSet(arr: unknown): Set<string> {
  if (!Array.isArray(arr)) return new Set();
  return new Set(
    arr.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).trim().toLowerCase())).filter(Boolean)
  );
}

/** Build concatenated search text from theme.topic, title, keywords, entities for filter matching. */
function themeSearchText(theme: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'string' && v.trim()) parts.push(v.trim().toLowerCase());
    if (Array.isArray(v)) parts.push(...v.map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  };
  push(theme.topic);
  push(theme.theme_title);
  push(theme.title);
  push(theme.keywords);
  push(theme.entities);
  push(theme.companies);
  return parts.join(' ');
}

export type ConfigFilters = { include: Record<string, unknown>; exclude: Record<string, unknown> };

/** True if filter record has no values (empty or all keys have empty arrays). */
function isEmptyFilterRecord(filters: Record<string, unknown>): boolean {
  if (!filters || typeof filters !== 'object') return true;
  for (const v of Object.values(filters)) {
    if (Array.isArray(v) && v.length > 0) return false;
    if (typeof v === 'string' && v.trim().length > 0) return false;
  }
  return true;
}

/**
 * Apply filters from a single config. If no config → allow. If theme matches exclude → reject.
 * If config has include and theme does not match include → reject. Otherwise allow.
 * If both include_filters and exclude_filters are empty → allow (config fallback).
 */
function themePassesSingleConfigFilters(
  theme: Record<string, unknown>,
  includeFilters: Record<string, unknown>,
  excludeFilters: Record<string, unknown>
): boolean {
  if (isEmptyFilterRecord(includeFilters) && isEmptyFilterRecord(excludeFilters)) return true;
  const text = themeSearchText(theme);

  const allExcludeValues = new Set<string>();
  for (const key of FILTER_KEYS) {
    const val = excludeFilters[key];
    if (Array.isArray(val)) val.forEach((v) => allExcludeValues.add(String(v).trim().toLowerCase()));
    else if (typeof val === 'string' && val.trim()) allExcludeValues.add(val.trim().toLowerCase());
  }
  for (const value of allExcludeValues) {
    if (value && text.includes(value)) return false;
  }

  const allIncludeValues = new Set<string>();
  for (const key of FILTER_KEYS) {
    const val = includeFilters[key];
    if (Array.isArray(val)) val.forEach((v) => allIncludeValues.add(String(v).trim().toLowerCase()));
    else if (typeof val === 'string' && val.trim()) allIncludeValues.add(val.trim().toLowerCase());
  }
  const hasInclude = allIncludeValues.size > 0;
  if (!hasInclude) return true;
  for (const value of allIncludeValues) {
    if (value && text.includes(value)) return true;
  }
  return false;
}

/**
 * Per-API-source filtering: use the config for theme.source_api_id only (do not merge configs).
 * If no config for that API → allow. If theme matches that config's exclude → reject.
 * If that config has include and theme does not match → reject.
 */
function themePassesConfigFilters(
  theme: Record<string, unknown>,
  configByApiSourceId: Record<string, ConfigFilters>,
  sourceApiId: string | null
): boolean {
  if (!sourceApiId) return true;
  const config = configByApiSourceId[sourceApiId];
  if (!config) return true;
  return themePassesSingleConfigFilters(theme, config.include, config.exclude);
}

/**
 * Preload company config once per request (cached 5 min). Return config keyed by api_source_id
 * so each theme is filtered by its own API's config only (no global merge).
 */
async function loadCompanyConfigByApiSource(companyId: string): Promise<Record<string, ConfigFilters>> {
  const { getCompanyConfigRows } = await import('./companyApiConfigCache');
  const rows = await getCompanyConfigRows(companyId);
  const enabledRows = rows.filter((r) => r.enabled);
  const result: Record<string, ConfigFilters> = {};
  for (const row of enabledRows) {
    const include = (row.include_filters && typeof row.include_filters === 'object' ? row.include_filters : {}) as Record<string, unknown>;
    const exclude = (row.exclude_filters && typeof row.exclude_filters === 'object' ? row.exclude_filters : {}) as Record<string, unknown>;
    result[row.api_source_id] = { include, exclude };
  }
  return result;
}

/**
 * Get one source_api_id per cluster from signal_clusters (avoids querying intelligence_signals).
 * Requires signal_clusters.source_api_id to be populated (migration + cluster engine).
 */
async function getClusterToSourceApiId(clusterIds: string[]): Promise<Record<string, string>> {
  if (clusterIds.length === 0) return {};
  const { data } = await supabase
    .from('signal_clusters')
    .select('cluster_id, source_api_id')
    .in('cluster_id', clusterIds);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.cluster_id && row.source_api_id && !map[row.cluster_id]) {
      map[row.cluster_id] = row.source_api_id;
    }
  }
  return map;
}

/**
 * Get themes for a company filtered by relevance (for UI).
 * Applies tenant filtering: company_api_configs include/exclude filters at read time.
 * Configs are preloaded once per request (cached 5 min); filter applied per theme.
 */
export async function getThemesForCompany(
  companyId: string,
  minScore: number = 0.4
): Promise<Array<{ theme: Record<string, unknown>; relevance_score: number; matched_keywords: unknown; matched_companies: unknown }>> {
  const { data: relRows, error: relError } = await supabase
    .from('theme_company_relevance')
    .select('theme_id, relevance_score, matched_keywords, matched_companies')
    .eq('company_id', companyId)
    .gte('relevance_score', minScore)
    .order('relevance_score', { ascending: false });

  if (relError) throw new Error(`Failed to load theme relevance: ${relError.message}`);
  const relList = (relRows ?? []) as Array<{
    theme_id: string;
    relevance_score: number;
    matched_keywords: unknown;
    matched_companies: unknown;
  }>;
  if (relList.length === 0) return [];

  const themeIds = relList.map((r) => r.theme_id);
  const { data: themes, error: themesError } = await supabase
    .from('strategic_themes')
    .select('*')
    .in('id', themeIds);

  if (themesError) throw new Error(`Failed to load strategic themes: ${themesError.message}`);
  const themeMap = new Map<string, Record<string, unknown>>();
  (themes ?? []).forEach((t: Record<string, unknown>) => {
    const id = t.id as string;
    if (id) themeMap.set(id, t);
  });

  const configByApiSourceId = await loadCompanyConfigByApiSource(companyId);
  const clusterIds = [...new Set((themes ?? []).map((t: Record<string, unknown>) => t.cluster_id as string).filter(Boolean))];
  const clusterToSourceApiId = await getClusterToSourceApiId(clusterIds);

  return relList
    .filter((r) => themeMap.has(r.theme_id))
    .filter((r) => {
      const theme = themeMap.get(r.theme_id)!;
      const sourceApiId = (theme.cluster_id && clusterToSourceApiId[theme.cluster_id as string]) || null;
      return themePassesConfigFilters(theme, configByApiSourceId, sourceApiId);
    })
    .map((r) => ({
      theme: themeMap.get(r.theme_id)!,
      relevance_score: r.relevance_score,
      matched_keywords: r.matched_keywords,
      matched_companies: r.matched_companies,
    }));
}
