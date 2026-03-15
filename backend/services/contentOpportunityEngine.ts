/**
 * Content Opportunity Engine
 * Transforms strategic themes into structured content opportunities.
 * New layer after strategic_themes. Does not modify existing intelligence pipeline.
 */

import { supabase } from '../db/supabaseClient';

const OPPORTUNITY_TYPES = [
  'thought_leadership',
  'industry_analysis',
  'contrarian_take',
  'educational_framework',
  'trend_explainer',
] as const;

type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

type ThemeRow = {
  id: string;
  theme_title: string;
  theme_description: string;
  momentum_score: number | null;
};

function topicFromThemeTitle(themeTitle: string): string {
  const t = (themeTitle ?? '').trim();
  if (!t) return t;
  const extractors: RegExp[] = [
    /^How\s+(.+?)\s+Is\s+(?:Transforming|Shaping)/i,
    /^Why\s+(.+?)\s+(?:Will|Is)/i,
    /^The\s+(.+?)\s+Landscape/i,
    /^A\s+\d+-Step\s+Framework\s+for\s+(.+?)$/i,
    /^(.+?)\s+Is\s+Entering/i,
  ];
  for (const re of extractors) {
    const m = t.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return t.length > 50 ? t.slice(0, 50) : t;
}

function generateOpportunityForType(
  topic: string,
  themeTitle: string,
  type: OpportunityType
): { title: string; description: string } {
  const t = topic || themeTitle.slice(0, 40);
  switch (type) {
    case 'thought_leadership':
      return {
        title: `Why ${t} Will Replace Rule-Based Approaches`,
        description: `Executive perspective on the shift from traditional methods to ${t}-driven strategies.`,
      };
    case 'industry_analysis':
      return {
        title: `The ${t} Landscape Is Being Rewritten`,
        description: `Analysis of how the industry is evolving around ${t} and what it means for stakeholders.`,
      };
    case 'contrarian_take':
      return {
        title: `What Most Companies Get Wrong About ${t}`,
        description: `A contrarian view on common misconceptions and overlooked aspects of ${t}.`,
      };
    case 'educational_framework':
      return {
        title: `A 5-Step Framework for ${t}`,
        description: `Practical, actionable framework to help teams adopt and implement ${t} effectively.`,
      };
    case 'trend_explainer':
      return {
        title: `How ${t} Is Transforming the Industry`,
        description: `Clear explanation of the trend, its drivers, and implications for the market.`,
      };
    default:
      return {
        title: `Content Opportunity: ${t}`,
        description: `Leverage ${t} for content and campaign planning.`,
      };
  }
}

export type GenerateContentOpportunitiesResult = {
  themes_processed: number;
  opportunities_created: number;
  opportunities_skipped: number;
};

/**
 * Load strategic themes from the last 24 hours.
 */
async function loadRecentThemes(): Promise<ThemeRow[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('strategic_themes')
    .select('id, theme_title, theme_description, momentum_score')
    .gte('created_at', since)
    .order('momentum_score', { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to load strategic_themes: ${error.message}`);
  return (data ?? []) as ThemeRow[];
}

/**
 * Get relevance_score for (theme_id, company_id) from theme_company_relevance.
 * Returns 0.5 if no row exists.
 */
async function getRelevanceForThemeCompany(
  themeId: string,
  companyId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('theme_company_relevance')
    .select('relevance_score')
    .eq('theme_id', themeId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error || !data) return 0.5;
  const score = (data as { relevance_score?: number }).relevance_score;
  return typeof score === 'number' ? Math.max(0, Math.min(1, score)) : 0.5;
}

/**
 * Get active company IDs (companies with Phase-3 config).
 */
async function getActiveCompanyIds(): Promise<string[]> {
  const { fetchActiveCompanies } = await import('./companySignalDistributionService');
  return fetchActiveCompanies();
}

/**
 * Generate content opportunities from strategic themes.
 * Creates 2–3 opportunity types per theme per company.
 */
export async function generateContentOpportunities(): Promise<GenerateContentOpportunitiesResult> {
  const themes = await loadRecentThemes();
  const companyIds = await getActiveCompanyIds();

  if (companyIds.length === 0) {
    const fallback = await supabase.from('companies').select('id').eq('status', 'active').limit(10);
    companyIds.push(...((fallback.data ?? []).map((r: { id: string }) => r.id)));
  }

  let opportunitiesCreated = 0;
  let opportunitiesSkipped = 0;

  const typesPerTheme: OpportunityType[] = [
    'thought_leadership',
    'educational_framework',
    'industry_analysis',
  ];

  for (const theme of themes) {
    const topic = topicFromThemeTitle(theme.theme_title);
    const momentum = theme.momentum_score ?? 0.5;

    for (const companyId of companyIds) {
      const relevance = await getRelevanceForThemeCompany(theme.id, companyId);
      const priorityScore = Number(
        (momentum * 0.6 + relevance * 0.4).toFixed(3)
      );

      for (const oppType of typesPerTheme) {
        const { title, description } = generateOpportunityForType(
          topic,
          theme.theme_title,
          oppType
        );

        const { error } = await supabase.from('content_opportunities').insert({
          theme_id: theme.id,
          company_id: companyId,
          opportunity_title: title,
          opportunity_description: description,
          opportunity_type: oppType,
          priority_score: priorityScore,
          momentum_score: momentum,
        });

        if (error) {
          if (error.code === '23503') opportunitiesSkipped++;
          else throw new Error(`content_opportunities insert failed: ${error.message}`);
        } else {
          opportunitiesCreated++;
        }
      }
    }
  }

  return {
    themes_processed: themes.length,
    opportunities_created: opportunitiesCreated,
    opportunities_skipped: opportunitiesSkipped,
  };
}
