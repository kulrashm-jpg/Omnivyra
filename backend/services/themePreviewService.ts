/**
 * Theme Opportunity Preview
 * Returns strategic theme + related signal intelligence + campaign opportunities
 * for UI Strategy Theme Card with action buttons.
 * Does not modify intelligence pipeline or campaign creation APIs.
 */

import { supabase } from '../db/supabaseClient';
import { refineLanguageOutput } from './languageRefinementService';

type StrategicThemeRow = {
  id: string;
  intelligence_id: string;
  theme_title: string;
  theme_description: string;
  momentum_score: number | null;
  trend_direction: string | null;
  keywords: unknown;
  companies: unknown;
  influencers: unknown;
};

type SignalIntelligenceRow = {
  id: string;
  topic: string;
  signal_count: number;
  first_detected_at: string | null;
  last_detected_at: string | null;
};

type CampaignOpportunityRow = {
  id: string;
  opportunity_title: string;
  opportunity_description: string;
  opportunity_type: string;
  momentum_score: number | null;
};

export type ThemePreviewTheme = {
  id: string;
  title: string;
  description: string;
  momentum_score: number | null;
  trend_direction: string | null;
  keywords: unknown;
  companies: unknown;
  influencers: unknown;
};

export type ThemePreviewIntelligence = {
  topic: string;
  signal_count: number;
  first_detected_at: string | null;
  last_detected_at: string | null;
};

export type ThemePreviewOpportunity = {
  id: string;
  opportunity_title: string;
  opportunity_description: string;
  opportunity_type: string;
  momentum_score: number | null;
};

export type ThemePreviewResult = {
  theme: ThemePreviewTheme;
  intelligence: ThemePreviewIntelligence;
  opportunities: ThemePreviewOpportunity[];
};

function log(event: 'theme_preview_requested', data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Load strategic theme by id.
 */
async function loadStrategicTheme(themeId: string): Promise<StrategicThemeRow | null> {
  const { data, error } = await supabase
    .from('strategic_themes')
    .select('id, intelligence_id, theme_title, theme_description, momentum_score, trend_direction, keywords, companies, influencers')
    .eq('id', themeId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load strategic theme: ${error.message}`);
  return data as StrategicThemeRow | null;
}

/**
 * Load signal_intelligence by id.
 */
async function loadSignalIntelligence(intelligenceId: string): Promise<SignalIntelligenceRow | null> {
  const { data, error } = await supabase
    .from('signal_intelligence')
    .select('id, topic, signal_count, first_detected_at, last_detected_at')
    .eq('id', intelligenceId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load signal intelligence: ${error.message}`);
  return data as SignalIntelligenceRow | null;
}

/**
 * Load campaign opportunities by theme_id.
 */
async function loadCampaignOpportunities(themeId: string): Promise<CampaignOpportunityRow[]> {
  const { data, error } = await supabase
    .from('campaign_opportunities')
    .select('id, opportunity_title, opportunity_description, opportunity_type, momentum_score')
    .eq('theme_id', themeId)
    .order('opportunity_type');

  if (error) throw new Error(`Failed to load campaign opportunities: ${error.message}`);
  return (data ?? []) as CampaignOpportunityRow[];
}

/**
 * Get combined theme preview: strategic theme + signal intelligence + campaign opportunities.
 * 1. Load strategic theme
 * 2. Load signal intelligence record (via intelligence_id)
 * 3. Load campaign opportunities (by theme_id)
 * 4. Return combined response
 */
export async function getThemePreview(themeId: string): Promise<ThemePreviewResult | null> {
  const theme = await loadStrategicTheme(themeId);
  if (!theme) return null;

  const [intelligence, opportunities] = await Promise.all([
    loadSignalIntelligence(theme.intelligence_id),
    loadCampaignOpportunities(themeId),
  ]);

  log('theme_preview_requested', {
    theme_id: themeId,
    opportunities_count: opportunities.length,
  });

  const [titleRef, descRef] = await Promise.all([
    theme.theme_title?.trim()
      ? refineLanguageOutput({ content: theme.theme_title, card_type: 'strategic_theme' })
      : Promise.resolve({ refined: theme.theme_title } as { refined: string }),
    theme.theme_description?.trim()
      ? refineLanguageOutput({ content: theme.theme_description, card_type: 'strategic_theme' })
      : Promise.resolve({ refined: theme.theme_description } as { refined: string }),
  ]);

  const refinedOpportunities = await Promise.all(
    opportunities.map(async (o) => {
      const [titleRef, descRef] = await Promise.all([
        o.opportunity_title?.trim()
          ? refineLanguageOutput({ content: o.opportunity_title, card_type: 'strategic_theme' })
          : Promise.resolve({ refined: o.opportunity_title } as { refined: string }),
        o.opportunity_description?.trim()
          ? refineLanguageOutput({ content: o.opportunity_description, card_type: 'strategic_theme' })
          : Promise.resolve({ refined: o.opportunity_description } as { refined: string }),
      ]);
      return {
        id: o.id,
        opportunity_title: (titleRef.refined as string) || o.opportunity_title,
        opportunity_description: (descRef.refined as string) || o.opportunity_description,
        opportunity_type: o.opportunity_type,
        momentum_score: o.momentum_score,
      };
    })
  );

  return {
    theme: {
      id: theme.id,
      title: (titleRef.refined as string) || theme.theme_title,
      description: (descRef.refined as string) || theme.theme_description,
      momentum_score: theme.momentum_score,
      trend_direction: theme.trend_direction,
      keywords: theme.keywords ?? [],
      companies: theme.companies ?? [],
      influencers: theme.influencers ?? [],
    },
    intelligence: {
      topic: intelligence?.topic ?? '',
      signal_count: intelligence?.signal_count ?? 0,
      first_detected_at: intelligence?.first_detected_at ?? null,
      last_detected_at: intelligence?.last_detected_at ?? null,
    },
    opportunities: refinedOpportunities,
  };
}
