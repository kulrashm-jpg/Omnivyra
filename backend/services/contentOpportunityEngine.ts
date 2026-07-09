import { ownedDbTable } from '../db/writeOwner';
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
  const { data, error } = await ownedDbTable('strategic_themes')
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
  const { data, error } = await ownedDbTable('theme_company_relevance')
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
    const fallback = await ownedDbTable('companies').select('id').eq('status', 'active').limit(10);
    companyIds.push(...((fallback.data ?? []).map((r: { id: string }) => r.id)));
  }

  let opportunitiesCreated = 0;
  let opportunitiesSkipped = 0;

  const typesPerTheme: OpportunityType[] = [
    'thought_leadership',
    'educational_framework',
    'industry_analysis',
  ];

  // ── HARDEN-004: the (theme, company) relevance lookup was ONE read per pair
  // (themes × companies round-trips). One .in() read + a Map applies the exact
  // same default (0.5 for missing/invalid rows).
  const relevanceByPair = new Map<string, number>();
  if (themes.length > 0 && companyIds.length > 0) {
    const { data: relRows } = await ownedDbTable('theme_company_relevance')
      .select('theme_id, company_id, relevance_score')
      .in('theme_id', themes.map((t) => t.id))
      .in('company_id', companyIds);
    for (const r of (relRows ?? []) as Array<{ theme_id: string; company_id: string; relevance_score?: number }>) {
      const score = typeof r.relevance_score === 'number' ? Math.max(0, Math.min(1, r.relevance_score)) : 0.5;
      relevanceByPair.set(`${r.theme_id}:${r.company_id}`, score);
    }
  }

  // Same rows in the same theme→company→type order; ONE bulk insert per chunk
  // replaces themes × companies × 3 sequential INSERTs. FK failures (the only
  // tolerated per-row error) fall back to the identical per-row path.
  const allRows = themes.flatMap((theme) => {
    const topic = topicFromThemeTitle(theme.theme_title);
    const momentum = theme.momentum_score ?? 0.5;
    return companyIds.flatMap((companyId) => {
      const relevance = relevanceByPair.get(`${theme.id}:${companyId}`) ?? 0.5;
      const priorityScore = Number((momentum * 0.6 + relevance * 0.4).toFixed(3));
      return typesPerTheme.map((oppType) => {
        const { title, description } = generateOpportunityForType(topic, theme.theme_title, oppType);
        return {
          theme_id: theme.id,
          company_id: companyId,
          opportunity_title: title,
          opportunity_description: description,
          opportunity_type: oppType,
          priority_score: priorityScore,
          momentum_score: momentum,
        };
      });
    });
  });

  const CHUNK = 500;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const { error } = await ownedDbTable('content_opportunities').insert(chunk);
    if (!error) {
      opportunitiesCreated += chunk.length;
      continue;
    }
    if (error.code !== '23503') {
      throw new Error(`content_opportunities insert failed: ${error.message}`);
    }
    // FK failure somewhere in the chunk — replay per row for identical
    // skip-counting semantics.
    for (const row of chunk) {
      const { error: rowError } = await ownedDbTable('content_opportunities').insert(row);
      if (rowError) {
        if (rowError.code === '23503') opportunitiesSkipped++;
        else throw new Error(`content_opportunities insert failed: ${rowError.message}`);
      } else {
        opportunitiesCreated++;
      }
    }
  }

  return {
    themes_processed: themes.length,
    opportunities_created: opportunitiesCreated,
    opportunities_skipped: opportunitiesSkipped,
  };
}
