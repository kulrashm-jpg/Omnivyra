/**
 * Planner Activity Card Service
 * Transforms campaign plan weeks into activity cards for execution system integration.
 * Maps execution categories for ai_generated compatibility.
 */

export type ExecutionCategory = 'AI_GENERATED' | 'AI_ASSISTED' | 'CREATOR_REQUIRED';

export interface ActivityCard {
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  platform: string;
  theme: string;
  content_type: string;
  execution_category: ExecutionCategory;
}

export interface PlanWeekLike {
  week_number?: number;
  week?: number;
  phase_label?: string;
  primary_objective?: string;
  platform_allocation?: Record<string, number>;
  content_type_mix?: string[];
  topics_to_cover?: string[];
  execution_items?: unknown[];
  [key: string]: unknown;
}

const CREATOR_REQUIRED_TYPES = new Set([
  'video',
  'reel',
  'carousel',
  'podcast',
  'livestream',
  'live',
]);

/**
 * Derive execution category from content type.
 * AI_GENERATED/AI_ASSISTED -> ai_generated=true
 * CREATOR_REQUIRED -> ai_generated=false
 */
export function getExecutionCategoryForContentType(contentType: string): ExecutionCategory {
  const normalized = String(contentType || 'post').toLowerCase().trim();
  if (CREATOR_REQUIRED_TYPES.has(normalized)) return 'CREATOR_REQUIRED';
  return 'AI_ASSISTED';
}

/**
 * Map execution category to ai_generated flag for daily_content_plans.
 */
export function executionCategoryToAiGenerated(category: ExecutionCategory): boolean {
  return category === 'AI_GENERATED' || category === 'AI_ASSISTED';
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/**
 * Transform plan weeks into activity cards.
 */
export function planWeeksToActivityCards(
  campaignId: string,
  weeks: PlanWeekLike[]
): ActivityCard[] {
  const cards: ActivityCard[] = [];
  const normalizedWeeks = Array.isArray(weeks) ? weeks : [];

  for (const week of normalizedWeeks) {
    const weekNum = Number(week.week_number ?? week.week ?? 0) || 1;
    const theme = String(week.phase_label ?? week.primary_objective ?? `Week ${weekNum}`).trim();
    const platformAlloc = week.platform_allocation && typeof week.platform_allocation === 'object'
      ? week.platform_allocation
      : {};
    const contentTypeMix = Array.isArray(week.content_type_mix) && week.content_type_mix.length > 0
      ? week.content_type_mix
      : ['post'];

    const platforms = Object.entries(platformAlloc)
      .filter(([, count]) => typeof count === 'number' && count > 0)
      .map(([p]) => String(p).toLowerCase().replace(/^twitter$/i, 'x'));

    if (platforms.length === 0) {
      platforms.push('linkedin');
    }

    let contentIndex = 0;
    for (let dayIndex = 0; dayIndex < DAYS_OF_WEEK.length; dayIndex++) {
      const platform = platforms[dayIndex % platforms.length];
      const contentType = contentTypeMix[contentIndex % contentTypeMix.length] ?? 'post';
      contentIndex++;

      const executionCategory = getExecutionCategoryForContentType(contentType);

      cards.push({
        campaign_id: campaignId,
        week_number: weekNum,
        day_of_week: DAYS_OF_WEEK[dayIndex],
        platform,
        theme,
        content_type: contentType,
        execution_category: executionCategory,
      });
    }
  }

  return cards;
}
