/**
 * Content Distribution Intelligence Engine — Phase 5 + 7
 *
 * Re-exports from shared lib so backend consumers import from here.
 * Phase 7: Adds signal-driven scheduling insights via analyzeSignalInfluence.
 */

import { analyzeWeeklyDistribution } from '../../lib/planning/contentDistributionIntelligence';
import { analyzeSignalInfluence } from './signalSchedulingInfluence';
import type { SignalSchedulingInsight } from './signalSchedulingInfluence';

export {
  analyzeWeeklyDistribution,
  type DistributionInsight,
  type AnalyzeWeeklyDistributionOptions,
} from '../../lib/planning/contentDistributionIntelligence';

export type { SignalSchedulingInsight } from './signalSchedulingInfluence';

export interface EnrichedDistributionOptions {
  campaignStartDate?: string | null;
  region?: string | string[] | null;
  weekNumber?: number;
  companyId?: string | null;
}

/**
 * Get distribution insights enriched with signal-driven scheduling insights (Phase 7).
 * Appends signal opportunity insights when companyId, campaignStartDate, and weekNumber are provided.
 * Signals are filtered by score ≥ 0.6 and limited to top 5.
 */
export async function getEnrichedDistributionInsights(
  weekPlan: Record<string, unknown> | null | undefined,
  options?: EnrichedDistributionOptions
): Promise<Array<{ type: string; severity: string; message: string; recommendation?: string }>> {
  const distribution = analyzeWeeklyDistribution(weekPlan, {
    campaignStartDate: options?.campaignStartDate ?? undefined,
    region: options?.region ?? undefined,
    weekNumber: options?.weekNumber,
  });

  const companyId = options?.companyId?.trim();
  const campaignStart = options?.campaignStartDate?.trim().split('T')[0];
  const weekNum = Number(options?.weekNumber);

  if (!companyId || !campaignStart || !Number.isFinite(weekNum) || weekNum < 1) {
    return distribution;
  }

  try {
    const startDate = new Date(campaignStart + 'T12:00:00');
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const signalInsights = await analyzeSignalInfluence(
      weekPlan,
      companyId,
      weekStart.toISOString(),
      weekEnd.toISOString()
    );

    const formatted: Array<{ type: string; severity: string; message: string; recommendation?: string }> =
      signalInsights.map((s: SignalSchedulingInsight) => ({
        type: s.type,
        severity: 'info' as const,
        message: s.message,
        recommendation: s.recommendation,
      }));

    return [...distribution, ...formatted];
  } catch {
    return distribution;
  }
}
