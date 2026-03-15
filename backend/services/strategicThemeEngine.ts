/**
 * Strategic Theme Generation Engine
 * Converts signal_intelligence records (momentum >= 0.6, UP) into strategic marketing themes.
 * Does not modify the intelligence pipeline.
 *
 * Uses Theme Angle Engine for diverse editorial themes, refined via languageRefinementService.
 * Also provides getStrategicThemesAsOpportunities() for Campaign Builder, suggest-themes,
 * and regenerate-blueprint — replacing the old LLM-based generateTrendOpportunities.
 */

import { supabase } from '../db/supabaseClient';
import { runCompletionWithOperation } from './aiGateway';
import { getProfile } from './companyProfileService';
import { generateThemeKey } from './themeKeyService';
import type { OpportunityInput } from './opportunityService';
import {
  generateThemeFromTopic as generateThemeTitle,
  getDiversitySeedForAngle,
  generateThemeAngleForProgression,
} from './themeAngleEngine';
import { refineLanguageOutput } from './languageRefinementService';
import { generateWeeklyAngles } from './angleDistributionEngine';
import { generateTopicVariants } from './topicVariationEngine';
import { normalizeThemePhrase } from './themePhraseNormalizer';
import { getHeadlineStructure, getHeadlinePrefix } from './headlineStructureEngine';

const MOMENTUM_THRESHOLD = 0.6;
const TREND_DIRECTION_UP = 'UP';

/** Marketing narrative progression for campaign themes. */
const THEME_PROGRESSION = [
  'Awareness',
  'Education',
  'Problem',
  'Solution',
  'Proof',
  'Conversion',
];

type IntelligenceRow = {
  id: string;
  cluster_id: string;
  topic: string;
  momentum_score: number | null;
  trend_direction: string | null;
  companies: unknown;
  keywords: unknown;
  influencers: unknown;
};

function log(
  event: 'theme_generation_started' | 'theme_created' | 'theme_generation_completed',
  data: Record<string, unknown>
) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Generate theme_title and theme_description from topic.
 * Uses Theme Angle Engine for diverse editorial titles, refined via language layer.
 */
export async function generateThemeFromTopic(
  topic: string,
  campaign_tone?: string
): Promise<{ theme_title: string; theme_description: string }> {
  const t = topic.trim();
  const rawTitle = generateThemeTitle(t, campaign_tone as import('./languageRefinementService').CampaignTone);

  const refined = await refineLanguageOutput({
    content: rawTitle,
    card_type: 'strategic_theme',
    campaign_tone,
  });
  const theme_title = (typeof refined.refined === 'string' ? refined.refined : String(refined.refined)).trim() || rawTitle;

  const theme_description =
    `Organizations are rapidly adopting ${t} to improve productivity and streamline workflows.`;

  return { theme_title, theme_description };
}

/**
 * Generate theme titles for each campaign week.
 * Primary: Strategic Theme Progression Engine for marketing narrative
 * (Awareness → Education → Problem → Solution → Proof → Conversion).
 * Fallback: topic-based angle distribution when progression is unavailable.
 * themeTitle = `${THEME_PROGRESSION[weekIndex]} — ${topic}`
 * Deterministic: same topic + week_index yields identical result.
 */
export async function generateThemesForCampaignWeeks(
  topic: string,
  weeks: number,
  campaign_tone?: string
): Promise<string[]> {
  const t = topic.trim();
  if (!t || weeks < 1) return [];

  const variants = generateTopicVariants(t);

  // Progression engine (primary): stage + editorial angle per week
  const progressionResults: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const stage = THEME_PROGRESSION[i % THEME_PROGRESSION.length];
    let angle: string;
    try {
      angle = generateThemeAngleForProgression(t, stage, i) || t;
    } catch {
      angle = t;
    }
    progressionResults.push(`${stage} — ${angle}`);
  }

  // Fallback: if topic-based themes exist (from angle distribution), keep them
  try {
    const angles = generateWeeklyAngles(weeks, t);
    const results: string[] = [];
    const MAX_ATTEMPTS = 3;
    let previousPrefix: string | null = null;

    for (let i = 0; i < weeks; i++) {
      let theme_title = '';
      let rawTitle = '';

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const variantIdx = attempt < 2 ? i % variants.length : (i + 1) % variants.length;
        const variant = variants[variantIdx];
        const seed = getDiversitySeedForAngle(t, angles[i]);
        const structure = attempt < 2 ? getHeadlineStructure(t, i) : undefined;
        const avoidPrefix = attempt >= 1 && previousPrefix ? previousPrefix : undefined;

        rawTitle = generateThemeTitle(
          variant,
          campaign_tone as import('./languageRefinementService').CampaignTone,
          seed,
          structure,
          avoidPrefix
        );
        rawTitle = normalizeThemePhrase(rawTitle);

        const refined = await refineLanguageOutput({
          content: rawTitle,
          card_type: 'strategic_theme',
          campaign_tone,
        });
        theme_title = (typeof refined.refined === 'string' ? refined.refined : String(refined.refined)).trim() || rawTitle;
        const prefix = getHeadlinePrefix(theme_title);

        if (previousPrefix === null || prefix !== previousPrefix) {
          previousPrefix = prefix;
          break;
        }
        if (attempt === MAX_ATTEMPTS - 1) {
          previousPrefix = prefix;
          break;
        }
      }
      results.push(theme_title);
    }

  } catch {
    // Fall through to progression engine
  }

  return progressionResults;
}

/**
 * Load signal_intelligence records where momentum_score >= 0.6 and trend_direction = 'UP'.
 */
async function loadEligibleIntelligence(): Promise<IntelligenceRow[]> {
  const { data, error } = await supabase
    .from('signal_intelligence')
    .select('id, cluster_id, topic, momentum_score, trend_direction, companies, keywords, influencers')
    .gte('momentum_score', MOMENTUM_THRESHOLD)
    .eq('trend_direction', TREND_DIRECTION_UP)
    .order('momentum_score', { ascending: false });

  if (error) throw new Error(`Failed to load signal_intelligence: ${error.message}`);
  return (data ?? []) as IntelligenceRow[];
}

/**
 * Load cluster_ids that already have a strategic theme.
 */
async function loadExistingThemeClusterIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('strategic_themes')
    .select('cluster_id');

  if (error) throw new Error(`Failed to load existing themes: ${error.message}`);
  const ids = new Set<string>((data ?? []).map((r: { cluster_id: string }) => r.cluster_id));
  return ids;
}

export type GenerateStrategicThemesResult = {
  intelligence_eligible: number;
  themes_created: number;
  themes_skipped: number;
};

/**
 * Generate strategic themes from eligible signal_intelligence records.
 * Only one theme per cluster (skip if theme already exists).
 */
export async function generateStrategicThemes(): Promise<GenerateStrategicThemesResult> {
  const start = Date.now();
  log('theme_generation_started', {});

  const eligible = await loadEligibleIntelligence();
  const existingClusterIds = await loadExistingThemeClusterIds();

  let themesCreated = 0;
  let themesSkipped = 0;

  for (const row of eligible) {
    if (existingClusterIds.has(row.cluster_id)) {
      themesSkipped++;
      continue;
    }

    const { theme_title, theme_description } = await generateThemeFromTopic(row.topic);

    const { error } = await supabase.from('strategic_themes').insert({
      cluster_id: row.cluster_id,
      intelligence_id: row.id,
      theme_title,
      theme_description,
      momentum_score: row.momentum_score,
      trend_direction: row.trend_direction,
      companies: row.companies ?? [],
      keywords: row.keywords ?? [],
      influencers: row.influencers ?? [],
    });

    if (error) {
      if (error.code === '23505') {
        existingClusterIds.add(row.cluster_id);
        themesSkipped++;
        continue;
      }
      throw new Error(`Failed to insert strategic theme: ${error.message}`);
    }

    themesCreated++;
    existingClusterIds.add(row.cluster_id);

    log('theme_created', {
      cluster_id: row.cluster_id,
      theme_title,
      momentum_score: row.momentum_score,
    });
  }

  const durationMs = Date.now() - start;
  log('theme_generation_completed', {
    duration_ms: durationMs,
    intelligence_eligible: eligible.length,
    themes_created: themesCreated,
    themes_skipped: themesSkipped,
  });

  return {
    intelligence_eligible: eligible.length,
    themes_created: themesCreated,
    themes_skipped: themesSkipped,
  };
}

/** Row from strategic_themes for mapping to OpportunityInput */
type StrategicThemeRow = {
  id: string;
  theme_title: string;
  theme_description: string;
  momentum_score: number | null;
  trend_direction: string | null;
  companies: unknown;
  keywords: unknown;
  influencers: unknown;
};

/**
 * Load strategic themes from the pipeline and return as OpportunityInput[].
 * Replaces the old generateTrendOpportunities for Campaign Builder, suggest-themes, regenerate-blueprint.
 * Preserves same shape: title, summary, payload (momentum_score, keywords, etc.).
 */
export async function getStrategicThemesAsOpportunities(
  options?: { companyId?: string; limit?: number }
): Promise<OpportunityInput[]> {
  const limit = options?.limit ?? 20;
  const { data, error } = await supabase
    .from('strategic_themes')
    .select('id, theme_title, theme_description, momentum_score, trend_direction, companies, keywords, influencers')
    .order('momentum_score', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load strategic themes: ${error.message}`);
  const rows = (data ?? []) as StrategicThemeRow[];

  return rows.map((r) => ({
    title: (r.theme_title ?? '').trim() || 'Strategic theme',
    summary: (r.theme_description ?? '').trim() || null,
    payload: {
      momentum_score: r.momentum_score ?? null,
      trend_direction: r.trend_direction ?? null,
      companies: r.companies ?? [],
      keywords: r.keywords ?? [],
      influencers: r.influencers ?? [],
      strategic_theme_id: r.id,
    },
  }));
}

export type ThemeRankingContext = {
  historicalThemeCache: Map<string, Set<string>>;
};

export type GenerateAdditionalStrategicThemesParams = {
  companyId: string;
  strategicPayload?: Record<string, unknown> | null;
  limit: number;
  /** Theme keys or topic strings to avoid (CONSUMED, IN_USE, DISMISSED, or already in use). */
  existingThemeKeys: string[];
  /** Request-scoped cache for historical theme keys. Caller must initialize. */
  rankingContext: ThemeRankingContext;
};

type MarketSignal = {
  topic: string;
  momentum_score: number | null;
  source_type?: 'cluster' | 'signal_intelligence';
  created_at?: string | null;
};

/** Signal with evidence metadata for theme explainability. */
type MarketSignalWithEvidence = MarketSignal & {
  relevance_score: number;
};

/** Evidence entry for theme explainability. */
export type ThemeEvidence = {
  signal: string;
  momentum: number;
  relevance: number;
  source_type?: 'cluster' | 'signal_intelligence';
  trend_direction?: 'rising' | 'stable' | 'declining';
  trend_strength?: number;
  signal_age_hours?: number;
  signal_age_label?: string;
};

function formatSignalAge(hours: number): string {
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

function determineTrendDirection(momentum: number | null): 'rising' | 'stable' | 'declining' {
  const m = momentum ?? 0;
  if (m >= 0.75) return 'rising';
  if (m >= 0.45) return 'stable';
  return 'declining';
}

function computeSignalAgeHours(createdAt: string | null | undefined): number | undefined {
  if (!createdAt) return undefined;
  const created = new Date(createdAt).getTime();
  const hours = (Date.now() - created) / (1000 * 60 * 60);
  return Math.round(hours);
}

type KeywordWeight = {
  keyword: string;
  weight: number;
};

/** Extract weighted company keywords from profile and strategic payload for relevance scoring. */
function extractCompanyKeywords(
  profile: { [key: string]: unknown } | null,
  strategicPayload?: Record<string, unknown> | null
): KeywordWeight[] {
  const toTokens = (v: unknown): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 1);
    return String(v)
      .split(/[,;|\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 1);
  };
  const result: KeywordWeight[] = [];
  const seen = new Set<string>();
  const add = (tokens: string[], weight: number) => {
    for (const t of tokens) {
      if (t && !seen.has(t)) {
        seen.add(t);
        result.push({ keyword: t, weight });
      }
    }
  };
  if (profile) {
    add([...toTokens(profile.industry), ...toTokens(profile.industry_list)], 3);
    add([...toTokens(profile.products_services), ...toTokens(profile.products_services_list)], 3);
    add([...toTokens(profile.competitors), ...toTokens(profile.competitors_list)], 2);
    add([...toTokens(profile.content_themes), ...toTokens(profile.content_themes_list)], 1);
  }
  if (strategicPayload) {
    add([...toTokens(strategicPayload.selected_aspects), ...toTokens(strategicPayload.selected_aspect)], 2);
    add(toTokens(strategicPayload.strategic_text), 2);
  }
  return result;
}

/** Compute relevance score from weighted keyword matches (token-based for single words, phrase for multi-word). */
function computeKeywordRelevanceScore(topic: string, keywords: KeywordWeight[]): number {
  if (!keywords.length) return 0;
  const topicNormalized = topic
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const topicTokens = topicNormalized.split(/\s+/).filter(Boolean);
  return keywords
    .filter((k) => {
      const kw = k.keyword.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      if (!kw) return false;
      const kwTokens = kw.split(/\s+/).filter(Boolean);
      if (kwTokens.length > 1) return topicNormalized.includes(kw);
      return topicTokens.includes(kw);
    })
    .reduce((sum, k) => sum + k.weight, 0);
}

/** Compute final ranking score: momentum * 0.65 + normalizedRelevance * 0.25 + historicalBoost. */
function computeFinalScore(
  momentum: number | null,
  relevanceScore: number,
  historicalBoost: number = 0
): number {
  const normalizedRelevance = Math.min(relevanceScore / 10, 1);
  return (momentum ?? 0) * 0.65 + normalizedRelevance * 0.25 + historicalBoost;
}

/** First N tokens of topic for similarity grouping. */
function getTopicPrefix(topic: string, tokenCount: number): string {
  const tokens = String(topic ?? '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.slice(0, tokenCount).join(' ') || '';
}

/**
 * Apply diversity filtering to signals: dedupe by theme key, collapse similar topics.
 * Incorporates company relevance into ranking before selecting top signals.
 */
async function applyDiversityFilter(
  signals: MarketSignal[],
  companyKeywords: KeywordWeight[] = [],
  companyId: string | null | undefined,
  rankingContext: ThemeRankingContext
): Promise<MarketSignalWithEvidence[]> {
  if (!rankingContext || !rankingContext.historicalThemeCache) {
    throw new Error('ThemeRankingContext is required for signal ranking');
  }
  let relevantThemeKeys = new Set<string>();
  const cache = rankingContext.historicalThemeCache;
  if (companyId) {
    if (cache?.has(companyId)) {
      relevantThemeKeys = cache.get(companyId)!;
    } else {
      try {
        const { getThemesForCompany } = await import('./companyTrendRelevanceEngine');
        const companyThemes = await getThemesForCompany(companyId, 0.3);
        const topics = companyThemes
          .slice(0, 10)
          .map((t) => (t.theme?.theme_title ?? t.theme?.title ?? '').toString().trim())
          .filter(Boolean);
        const keys = new Set(topics.map((topic) => generateThemeKey(topic)));
        cache.set(companyId, keys);
        relevantThemeKeys = keys;
      } catch {
        relevantThemeKeys = new Set();
      }
    }
  }

  const score = (s: MarketSignal): number => {
    const relevanceScore = computeKeywordRelevanceScore(s.topic, companyKeywords);
    const historicalBoost = relevantThemeKeys.has(generateThemeKey(s.topic)) ? 0.15 : 0;
    return computeFinalScore(s.momentum_score, relevanceScore, historicalBoost);
  };

  const uniqueByKey = new Map<string, MarketSignal>();
  for (const s of signals) {
    if (!s.topic?.trim()) continue;
    const key = generateThemeKey(s.topic);
    const existing = uniqueByKey.get(key);
    if (!existing || score(s) > score(existing)) {
      uniqueByKey.set(key, s);
    }
  }

  const byPrefix = new Map<string, MarketSignal>();
  const PREFIX_TOKEN_COUNT = 2;
  for (const s of uniqueByKey.values()) {
    const prefix = getTopicPrefix(s.topic, PREFIX_TOKEN_COUNT) || generateThemeKey(s.topic);
    const existing = byPrefix.get(prefix);
    if (!existing || score(s) > score(existing)) {
      byPrefix.set(prefix, s);
    }
  }

  const sorted = [...byPrefix.values()].sort((a, b) => score(b) - score(a)).slice(0, 10);
  return sorted.map((s) => ({
    ...s,
    relevance_score: Math.min(computeKeywordRelevanceScore(s.topic, companyKeywords) / 10, 1),
  })) as MarketSignalWithEvidence[];
}

/** Recent market signals from signal_clusters + signal_intelligence (last 7 days). */
async function loadRecentMarketSignals(
  companyKeywords: KeywordWeight[] = [],
  companyId: string | null | undefined,
  rankingContext: ThemeRankingContext
): Promise<MarketSignalWithEvidence[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rawSignals: MarketSignal[] = [];

  const { data: clusterRows, error: clusterError } = await supabase
    .from('signal_clusters')
    .select('cluster_id, cluster_topic, created_at')
    .gte('created_at', sevenDaysAgo)
    .limit(20);

  if (clusterError || !clusterRows?.length) {
    const { data: siRows } = await supabase
      .from('signal_intelligence')
      .select('topic, momentum_score, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('momentum_score', { ascending: false, nullsFirst: false })
      .limit(30);
    for (const r of siRows ?? []) {
      const row = r as { topic: string; momentum_score: number | null; created_at?: string };
      if (row.topic?.trim()) {
        rawSignals.push({
          topic: row.topic.trim(),
          momentum_score: row.momentum_score ?? null,
          source_type: 'signal_intelligence',
          created_at: row.created_at ?? null,
        });
      }
    }
    return applyDiversityFilter(rawSignals, companyKeywords, companyId, rankingContext);
  }

  const clusterIds = (clusterRows as { cluster_id: string }[]).map((r) => r.cluster_id);
  const { data: siRows } = await supabase
    .from('signal_intelligence')
    .select('cluster_id, topic, momentum_score, created_at')
    .in('cluster_id', clusterIds);

  const clusterTopicByCluster = new Map(
    (clusterRows as { cluster_id: string; cluster_topic: string }[]).map((r) => [r.cluster_id, r.cluster_topic ?? ''])
  );
  for (const r of siRows ?? []) {
    const row = r as { cluster_id: string; topic: string; momentum_score: number | null; created_at?: string };
    const topic = clusterTopicByCluster.get(row.cluster_id) ?? row.topic ?? '';
    if (topic.trim()) {
      rawSignals.push({
        topic: topic.trim(),
        momentum_score: row.momentum_score ?? null,
        source_type: 'cluster',
        created_at: row.created_at ?? null,
      });
    }
  }

  return applyDiversityFilter(rawSignals, companyKeywords, companyId, rankingContext);
}

/** Company-relevant signal topics from theme_company_relevance + strategic_themes. */
async function loadCompanyRelevantSignals(companyId: string): Promise<Array<{ topic: string; momentum_score: number | null }>> {
  try {
    const { getThemesForCompany } = await import('./companyTrendRelevanceEngine');
    const themes = await getThemesForCompany(companyId, 0.3);
    const rows: Array<{ topic: string; momentum_score: number | null }> = [];
    for (const { theme } of themes.slice(0, 10)) {
      const title = (theme.theme_title ?? theme.title ?? '').toString().trim();
      const momentum = typeof (theme as { momentum_score?: number }).momentum_score === 'number'
        ? (theme as { momentum_score: number }).momentum_score
        : null;
      if (title) rows.push({ topic: title, momentum_score: momentum });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Generate additional strategic campaign themes via LLM when lifecycle filtering removes most themes.
 * Used as fallback so the recommendation engine never runs out of strategic theme cards.
 * Themes are different from existing topics; duplicates are filtered by caller.
 * Injects recent market intelligence signals so themes are grounded in real discussions and trends.
 */
export type GeneratedThemeWithEvidence = {
  topic: string;
  evidence?: ThemeEvidence[];
};

export async function generateAdditionalStrategicThemes(
  params: GenerateAdditionalStrategicThemesParams
): Promise<GeneratedThemeWithEvidence[]> {
  const { companyId, strategicPayload, limit, existingThemeKeys, rankingContext } = params;
  if (!rankingContext || !rankingContext.historicalThemeCache) {
    throw new Error('ThemeRankingContext is required for signal ranking');
  }

  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
  const companyKeywords = extractCompanyKeywords(profile as { [key: string]: unknown } | null, strategicPayload);
  const [recentSignals, companySignals] = await Promise.all([
    loadRecentMarketSignals(companyKeywords, companyId, rankingContext),
    loadCompanyRelevantSignals(companyId),
  ]);

  const topEvidence: ThemeEvidence[] = recentSignals.slice(0, 3).map((s) => {
    const momentum = s.momentum_score ?? 0;
    const ageHours = computeSignalAgeHours(s.created_at);
    return {
      signal: s.topic,
      momentum,
      relevance: s.relevance_score ?? 0,
      source_type: s.source_type,
      trend_direction: determineTrendDirection(s.momentum_score),
      trend_strength: Math.round(momentum * 100),
      ...(ageHours !== undefined && {
        signal_age_hours: ageHours,
        signal_age_label: formatSignalAge(ageHours),
      }),
    };
  });

  const marketSignalsBlock =
    recentSignals.length > 0
      ? `Recent Market Signals (last 7 days):\n${recentSignals.map((s) => `* ${s.topic}${s.momentum_score != null ? ` (momentum: ${s.momentum_score})` : ''}`).join('\n')}`
      : '';

  const companySignalsBlock =
    companySignals.length > 0
      ? `\n\nCompany-Relevant Signals:\n${companySignals.map((s) => `* ${s.topic}${s.momentum_score != null ? ` (momentum: ${s.momentum_score})` : ''}`).join('\n')}`
      : '';

  const companyContext = profile
    ? [
        profile.industry ? `Industry: ${profile.industry}` : '',
        profile.unique_value ? `Unique value: ${profile.unique_value}` : '',
        profile.target_audience ? `Target audience: ${profile.target_audience}` : '',
        Array.isArray(profile.competitors_list) && profile.competitors_list.length > 0
          ? `Competitors: ${profile.competitors_list.slice(0, 5).join(', ')}`
          : profile.competitors ? `Competitors: ${profile.competitors}` : '',
        profile.key_messages ? `Key messages: ${profile.key_messages}` : '',
        strategicPayload?.strategic_text ? `Strategic direction: ${strategicPayload.strategic_text}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const companyContextBlock =
    companyContext.length > 0 ? `\n\nCompany Context:\n${companyContext}` : '';

  const avoidList =
    existingThemeKeys.length > 0
      ? `\n\nAVOID these topics (do not repeat or paraphrase):\n${existingThemeKeys.slice(0, 50).map((k) => `- ${k}`).join('\n')}`
      : '';

  const systemPrompt = `You are an expert marketing strategist. Generate strategic campaign theme titles (6-12 words each) that align with company context and leverage the provided market signals. Each theme should be actionable for B2B marketing campaigns and grounded in real market conversations and momentum trends. Output theme titles only, one per line. Do not number or explain.`;
  const userPrompt = `Generate ${limit} new strategic campaign themes that align with company context and leverage these market signals.${marketSignalsBlock}${companySignalsBlock}${companyContextBlock}${avoidList}\n\nOutput ${limit} theme titles, one per line:`;

  try {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      operation: 'generateAdditionalStrategicThemes',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const text = (result?.output ?? '').toString().trim();
    if (!text) return [];

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\d+[.)]\s*/, '').trim())
      .filter((line) => line.length > 5 && line.length < 120);

    const seen = new Set<string>();
    const themes: GeneratedThemeWithEvidence[] = [];
    for (const line of lines) {
      const topic = line.trim();
      const key = topic.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        themes.push({
          topic,
          evidence: topEvidence.length > 0 ? topEvidence : undefined,
        });
        if (themes.length >= limit) break;
      }
    }
    return themes;
  } catch (err) {
    console.warn(
      '[generateAdditionalStrategicThemes] LLM call failed:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}
