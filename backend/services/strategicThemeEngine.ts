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
import type { OpportunityInput } from './opportunityService';
import { generateThemeFromTopic as generateThemeTitle, getDiversitySeedForAngle } from './themeAngleEngine';
import { refineLanguageOutput } from './languageRefinementService';
import { generateWeeklyAngles } from './angleDistributionEngine';
import { generateTopicVariants } from './topicVariationEngine';
import { normalizeThemePhrase } from './themePhraseNormalizer';
import { getHeadlineStructure, getHeadlinePrefix } from './headlineStructureEngine';

const MOMENTUM_THRESHOLD = 0.6;
const TREND_DIRECTION_UP = 'UP';

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
 * Generate theme titles for each campaign week using the Weekly Angle Distribution Engine.
 * Each week gets a different editorial angle (trend, problem, strategy, etc.).
 * Deterministic: same topic + week_index yields identical result.
 */
export async function generateThemesForCampaignWeeks(
  topic: string,
  weeks: number,
  campaign_tone?: string
): Promise<string[]> {
  const t = topic.trim();
  if (!t || weeks < 1) return [];

  const angles = generateWeeklyAngles(weeks, t);
  const variants = generateTopicVariants(t);
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

  return results;
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
