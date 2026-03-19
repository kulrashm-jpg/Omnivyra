/**
 * Strategy Mapper Service
 * Maps strategy context and account context to weekly skeleton
 * Assigns themes, funnel stages, and content distribution
 */

import type { AccountContext } from '../types/accountContext';
import type { DeterministicWeeklySkeleton } from './deterministicWeeklySkeleton';

export type FunnelStage = 'awareness' | 'education' | 'trust' | 'conversion';

export type WeeklyStrategy = {
  week: number;
  theme: string;
  funnel_stage: FunnelStage;
  primary_objective: string;
  content_distribution: Record<string, number>; // content_type -> count
  platform_focus: string[]; // prioritized platforms for this week
};

export type StrategyContext = {
  duration_weeks: number;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix?: Record<string, number>;
  campaign_goal?: string | null;
  target_audience?: string | null;
};

export type MappedWeeklySkeleton = {
  duration_weeks: number;
  weekly_strategies: WeeklyStrategy[];
  skeleton: DeterministicWeeklySkeleton;
};

/**
 * Maps strategy context and account context to weekly skeleton
 * Creates weekly themes, funnel progression, and content distribution
 */
export function mapStrategyToSkeleton(
  skeleton: DeterministicWeeklySkeleton,
  strategyContext: StrategyContext,
  accountContext: AccountContext | null
): MappedWeeklySkeleton {
  // Guard: invalid or missing skeleton
  if (!skeleton || !Array.isArray(skeleton.execution_items)) {
    console.warn('[PLANNER][STRATEGY][WARN] skeleton is null or malformed — returning empty mapped skeleton');
    return { duration_weeks: 0, weekly_strategies: [], skeleton: skeleton ?? { total_weekly_content_count: 0, platform_allocation: {}, content_type_mix: [], execution_items: [] } };
  }

  // Guard: invalid duration
  const rawDuration = Number(strategyContext?.duration_weeks);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    console.warn('[PLANNER][STRATEGY][WARN] duration_weeks is invalid (%s) — returning empty strategy', strategyContext?.duration_weeks);
    return { duration_weeks: 0, weekly_strategies: [], skeleton };
  }
  const durationWeeks = Math.min(Math.floor(rawDuration), 52); // hard cap at 52 weeks

  const weeklyStrategies = buildWeeklyStrategies(durationWeeks, strategyContext, accountContext, skeleton);

  return {
    duration_weeks: durationWeeks,
    weekly_strategies: weeklyStrategies,
    skeleton
  };
}

/**
 * Builds weekly strategy progression based on duration and account maturity
 */
function buildWeeklyStrategies(
  durationWeeks: number,
  strategyContext: StrategyContext,
  accountContext: AccountContext | null,
  skeleton: DeterministicWeeklySkeleton
): WeeklyStrategy[] {
  const strategies: WeeklyStrategy[] = [];

  // Define funnel progression based on campaign duration
  const funnelProgression = buildFunnelProgression(durationWeeks);

  // Generate themes based on account maturity and strategy
  const baseThemes = generateBaseThemes(strategyContext, accountContext);

  for (let week = 1; week <= durationWeeks; week++) {
    // Guard: funnelProgression may be shorter than durationWeeks for edge-case durations
    const funnelStage: FunnelStage = funnelProgression[week - 1] ?? 'awareness';
    const theme = baseThemes[week - 1] || `Week ${week} Strategy`;

    // Distribute content based on funnel stage and platform frequency
    const contentDistribution = distributeContentByStage(
      skeleton.execution_items,
      funnelStage,
      strategyContext.posting_frequency
    );

    const platformFocus = prioritizePlatformsForStage(
      strategyContext.platforms,
      funnelStage,
      accountContext
    );

    strategies.push({
      week,
      theme,
      funnel_stage: funnelStage,
      primary_objective: generateObjectiveForStage(funnelStage, theme, strategyContext),
      content_distribution: contentDistribution,
      platform_focus: platformFocus
    });
  }

  return strategies;
}

/**
 * Builds funnel progression based on campaign duration
 */
function buildFunnelProgression(durationWeeks: number): FunnelStage[] {
  if (durationWeeks <= 2) {
    return ['awareness', 'conversion'];
  } else if (durationWeeks <= 4) {
    return ['awareness', 'education', 'trust', 'conversion'];
  } else if (durationWeeks <= 6) {
    return ['awareness', 'awareness', 'education', 'trust', 'trust', 'conversion'];
  } else {
    // For longer campaigns, extend the middle stages
    const progression: FunnelStage[] = ['awareness', 'awareness'];
    const middleWeeks = durationWeeks - 4; // awareness + conversion + 2 middle
    for (let i = 0; i < middleWeeks; i++) {
      progression.push(i % 2 === 0 ? 'education' : 'trust');
    }
    progression.push('trust', 'conversion');
    return progression.slice(0, durationWeeks);
  }
}

/**
 * Generates base themes based on strategy and account maturity
 */
function generateBaseThemes(
  strategyContext: StrategyContext,
  accountContext: AccountContext | null
): string[] {
  const durationWeeks = strategyContext.duration_weeks;
  const campaignGoal = strategyContext.campaign_goal || 'campaign success';
  const audience = strategyContext.target_audience || 'target audience';

  // Maturity-influenced theme patterns
  const maturityPatterns = {
    'NEW': [
      `Introducing ${campaignGoal} to ${audience}`,
      `Building awareness of ${campaignGoal}`,
      `Establishing credibility with ${audience}`,
      `First steps toward ${campaignGoal}`
    ],
    'GROWING': [
      `Deepening understanding of ${campaignGoal}`,
      `Building trust with ${audience}`,
      `Demonstrating value through ${campaignGoal}`,
      `Growing engagement with ${audience}`
    ],
    'ESTABLISHED': [
      `Maximizing ${campaignGoal} impact`,
      `Converting ${audience} to action`,
      `Scaling ${campaignGoal} results`,
      `Optimizing ${campaignGoal} performance`
    ]
  };

  const maturityStage = accountContext?.maturityStage ?? 'GROWING';
  // Guard: unknown maturity stage falls back to GROWING patterns
  const patterns = maturityPatterns[maturityStage] ?? maturityPatterns['GROWING'];

  const themes: string[] = [];
  for (let i = 0; i < durationWeeks; i++) {
    const patternIndex = i % patterns.length;
    themes.push(patterns[patternIndex]);
  }

  return themes;
}

/**
 * Distributes content by funnel stage and platform frequency
 */
function distributeContentByStage(
  executionItems: any[],
  funnelStage: FunnelStage,
  postingFrequency: Record<string, number>
): Record<string, number> {
  const distribution: Record<string, number> = {};

  // Stage-based content type preferences
  const stagePreferences: Record<FunnelStage, string[]> = {
    'awareness': ['post', 'video', 'story'],
    'education': ['post', 'video', 'blog', 'thread'],
    'trust': ['post', 'video', 'carousel', 'blog'],
    'conversion': ['post', 'video', 'story', 'carousel']
  };

  const preferredTypes = stagePreferences[funnelStage];

  // Guard: null/non-array executionItems
  if (!Array.isArray(executionItems)) return distribution;

  // Distribute based on execution items and preferences
  executionItems.forEach(item => {
    const contentType = item?.content_type;
    const count = Number(item?.count_per_week) || 0;
    if (!contentType) return;

    // Boost preferred content types for this stage
    const multiplier = preferredTypes.includes(contentType) ? 1.2 : 0.8;
    distribution[contentType] = Math.max(1, Math.floor(count * multiplier));
  });

  return distribution;
}

/**
 * Prioritizes platforms based on funnel stage and account context
 */
function prioritizePlatformsForStage(
  platforms: string[],
  funnelStage: FunnelStage,
  accountContext: AccountContext | null
): string[] {
  // Stage-based platform preferences
  const stagePlatformPrefs: Record<FunnelStage, string[]> = {
    'awareness': ['linkedin', 'facebook', 'instagram'], // Broad reach
    'education': ['linkedin', 'youtube', 'blog'], // Thought leadership
    'trust': ['linkedin', 'instagram', 'facebook'], // Community building
    'conversion': ['linkedin', 'instagram', 'facebook'] // Direct engagement
  };

  const preferredPlatforms = stagePlatformPrefs[funnelStage];

  // Guard: null/non-array platforms
  if (!Array.isArray(platforms) || platforms.length === 0) return [];

  // Sort platforms by preference, then by account performance if available
  return [...platforms].sort((a, b) => {
    const aPreferred = preferredPlatforms.includes(a) ? 1 : 0;
    const bPreferred = preferredPlatforms.includes(b) ? 1 : 0;

    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    // If account context available, prefer platforms with better performance
    if (accountContext) {
      const aMetrics = accountContext.platforms.find(p => p.platform === a);
      const bMetrics = accountContext.platforms.find(p => p.platform === b);

      const aScore = aMetrics ? aMetrics.engagementRate : 0;
      const bScore = bMetrics ? bMetrics.engagementRate : 0;

      return bScore - aScore;
    }

    return 0;
  });
}

/**
 * Generates primary objective for a funnel stage
 */
function generateObjectiveForStage(
  funnelStage: FunnelStage,
  theme: string,
  strategyContext: StrategyContext
): string {
  const stageObjectives: Record<FunnelStage, string> = {
    'awareness': `Build awareness and introduce ${theme.toLowerCase()}`,
    'education': `Educate audience about ${theme.toLowerCase()}`,
    'trust': `Build trust and demonstrate value through ${theme.toLowerCase()}`,
    'conversion': `Drive action and conversion with ${theme.toLowerCase()}`
  };

  const baseObjective = stageObjectives[funnelStage];
  const campaignGoal = strategyContext.campaign_goal;

  if (campaignGoal) {
    return `${baseObjective} to achieve ${campaignGoal}`;
  }

  return baseObjective;
}