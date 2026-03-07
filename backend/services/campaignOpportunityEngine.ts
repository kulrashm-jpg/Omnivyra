/**
 * Campaign Opportunity Engine
 * Converts strategic themes into actionable campaign opportunities for
 * Campaign Builder, Content Planning, and Marketing Teams.
 * Does not modify previous systems (strategic themes, signal intelligence, etc.).
 */

import { supabase } from '../db/supabaseClient';

export const OPPORTUNITY_TYPES = [
  'content_marketing',
  'thought_leadership',
  'product_positioning',
  'industry_education',
] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

type StrategicThemeRow = {
  id: string;
  cluster_id: string;
  theme_title: string;
  theme_description: string;
  momentum_score: number | null;
  keywords: unknown;
};

type OpportunityRow = {
  theme_id: string;
  opportunity_type: string;
};

function log(
  event: 'opportunity_generation_started' | 'opportunity_created' | 'opportunity_generation_completed',
  data: Record<string, unknown>
) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Derive a short topic phrase from theme_title for use in templates.
 * Handles legacy "The Rise of X" and new Theme Angle Engine formats.
 */
function topicFromThemeTitle(themeTitle: string): string {
  const t = (themeTitle ?? '').trim();
  if (!t) return t;

  const legacyPrefix = /^The Rise of\s+/i;
  if (legacyPrefix.test(t)) {
    return t.replace(legacyPrefix, '').trim();
  }

  const extractors: RegExp[] = [
    /^How\s+(.+?)\s+Is\s+(?:Transforming|Shaping)/i,
    /Impact of\s+(.+?)\s+on\s+/i,
    /Ignoring\s+(.+?)$/i,
    /Without\s+(.+?)$/i,
    /^Why\s+(.+?)\s+Is\s+Becoming/i,
    /Opportunity\s+(.+?)\s+Creates/i,
    /About\s+(.+?)$/i,
    /^Why\s+(.+?)\s+Alone\s+/i,
    /with\s+(.+?)$/i,
    /Using\s+(.+?)\s+in\s+/i,
    /Use\s+(.+?)\s+More\s+/i,
  ];
  for (const re of extractors) {
    const m = t.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return t;
}

/**
 * Rule-based generation: one title + description per opportunity type.
 * Uses the same intelligence (topic, momentum) from strategic themes.
 */
function generateOpportunityForType(
  topic: string,
  opportunityType: OpportunityType
): { title: string; description: string } {
  switch (opportunityType) {
    case 'content_marketing':
      return {
        title: `Create blog posts explaining how ${topic} improves productivity.`,
        description: `Educational content that explains how ${topic} improves productivity for teams.`,
      };
    case 'thought_leadership':
      return {
        title: `Publish executive insights on the future of ${topic}-driven productivity.`,
        description: `Executive-level thought leadership on ${topic} and its impact on productivity.`,
      };
    case 'product_positioning':
      return {
        title: `Position your product as a productivity enabler through ${topic}.`,
        description: `Position your product as enabling productivity gains via ${topic}.`,
      };
    case 'industry_education':
      return {
        title: `Develop educational resources about ${topic} trends.`,
        description: `Educational resources that help audiences understand ${topic} trends and adoption.`,
      };
    default:
      return {
        title: `Create content around ${topic}.`,
        description: `Leverage ${topic} for campaign and content planning.`,
      };
  }
}

/**
 * Load all strategic themes (we will skip those already converted).
 */
async function loadStrategicThemes(): Promise<StrategicThemeRow[]> {
  const { data, error } = await supabase
    .from('strategic_themes')
    .select('id, cluster_id, theme_title, theme_description, momentum_score, keywords')
    .order('momentum_score', { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to load strategic_themes: ${error.message}`);
  return (data ?? []) as StrategicThemeRow[];
}

/**
 * Load theme_ids that already have at least one campaign_opportunity.
 */
async function loadThemesWithOpportunities(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('campaign_opportunities')
    .select('theme_id');

  if (error) throw new Error(`Failed to load campaign_opportunities: ${error.message}`);
  const rows = (data ?? []) as OpportunityRow[];
  return new Set(rows.map((r) => r.theme_id));
}

export type GenerateCampaignOpportunitiesResult = {
  themes_processed: number;
  opportunities_created: number;
  opportunities_skipped: number;
};

/**
 * Generate campaign opportunities from strategic themes.
 * 1. Load strategic themes.
 * 2. Skip themes that already have any campaign_opportunities.
 * 3. For each remaining theme, generate 4 opportunities (one per type).
 * 4. Insert into campaign_opportunities (unique on theme_id + opportunity_type).
 */
export async function generateCampaignOpportunities(): Promise<GenerateCampaignOpportunitiesResult> {
  const start = Date.now();
  log('opportunity_generation_started', {});

  const themes = await loadStrategicThemes();
  const themesWithOpportunities = await loadThemesWithOpportunities();
  const themesToProcess = themes.filter((t) => !themesWithOpportunities.has(t.id));

  let opportunitiesCreated = 0;
  let opportunitiesSkipped = 0;

  for (const theme of themesToProcess) {
    const topic = topicFromThemeTitle(theme.theme_title);
    const keywords = Array.isArray(theme.keywords) ? theme.keywords : [];

    for (const opportunityType of OPPORTUNITY_TYPES) {
      const { title, description } = generateOpportunityForType(topic, opportunityType);
      const row = {
        theme_id: theme.id,
        cluster_id: theme.cluster_id,
        opportunity_title: title,
        opportunity_description: description,
        opportunity_type: opportunityType,
        momentum_score: theme.momentum_score,
        keywords: keywords,
      };

      const { error } = await supabase.from('campaign_opportunities').insert(row);

      if (error) {
        if (error.code === '23505') {
          // unique violation (theme_id, opportunity_type)
          opportunitiesSkipped++;
          continue;
        }
        throw new Error(`Failed to insert campaign_opportunity: ${error.message}`);
      }
      opportunitiesCreated++;
      log('opportunity_created', {
        theme_id: theme.id,
        opportunity_type: opportunityType,
        title: title.slice(0, 80),
      });
    }
  }

  log('opportunity_generation_completed', {
    themes_processed: themesToProcess.length,
    opportunities_created: opportunitiesCreated,
    opportunities_skipped: opportunitiesSkipped,
    duration_ms: Date.now() - start,
  });

  return {
    themes_processed: themesToProcess.length,
    opportunities_created: opportunitiesCreated,
    opportunities_skipped: opportunitiesSkipped,
  };
}
