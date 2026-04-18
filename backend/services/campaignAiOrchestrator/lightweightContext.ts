import type { DecisionResult } from '../omnivyreClient';
import type { CompanyStrategyDNA } from '../companyStrategyDNAService';

export const LIGHTWEIGHT_SNAPSHOT_HASH = 'conversational-fallback';

export function createLightweightContext(
  campaignId: string,
  companyContext: string | null,
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string },
  defaultPlatformStrategies: any[],
  forcedContextBlock?: string | null,
  strategyDNA?: CompanyStrategyDNA | null
) {
  return {
    snapshot: {
      campaign: { id: campaignId, status: null, timeframe: null, start_date: null, end_date: null, objective: null, goal_objectives: [] },
      weekly_plans: [],
      daily_plans: [],
      scheduled_posts: [],
      media_assets: [],
      platform_coverage: { platforms: [], daily_plan_counts: {}, scheduled_post_counts: {}, weekly_gaps: {} },
      asset_availability: { daily_plans_total: 0, daily_plans_with_content: 0, daily_plans_with_media_requirements: 0, daily_plans_with_media_attached: 0, media_assets_total: 0 },
    },
    snapshot_hash: LIGHTWEIGHT_SNAPSHOT_HASH,
    diagnostics: { overall_summary: 'Building campaign from conversation.' },
    omnivyreDecision: { status: 'ok', recommendation: 'proceed' } as DecisionResult,
    platformStrategies: defaultPlatformStrategies,
    companyContext,
    forcedContextBlock: forcedContextBlock ?? null,
    strategyDNA: strategyDNA ?? null,
    campaignIntentSummary,
  };
}
