import { composeBehaviorReport } from './performanceReportService';
import { buildPerformanceBehaviorIntelligence } from './performanceBehaviorIntelligenceService';
import { buildPerformanceSearchIntelligence } from './performanceSearchIntelligenceService';
import {
  buildCreatorIntelligenceBrief,
  buildSharedPerformanceIntelligencePrimitives,
  type CreatorIntelligenceBrief,
} from './sharedPerformanceIntelligencePrimitivesService';

export async function buildCreatorPerformanceIntelligenceBrief(input: {
  companyId: string;
  contentType: string;
  sinceDays?: number;
}): Promise<CreatorIntelligenceBrief | null> {
  const behavior = await composeBehaviorReport(input.companyId, { sinceDays: input.sinceDays ?? 30 });
  if (behavior.status !== 'ready' && behavior.status !== 'partial') {
    return null;
  }

  const [behaviorIntelligence, searchIntelligence] = await Promise.all([
    buildPerformanceBehaviorIntelligence({
      companyId: input.companyId,
      currentData: behavior,
      windowDays: behavior.window_days,
    }).catch(() => null),
    buildPerformanceSearchIntelligence({
      companyId: input.companyId,
      behaviorData: behavior,
      windowDays: behavior.window_days,
    }).catch(() => null),
  ]);

  const primitives = buildSharedPerformanceIntelligencePrimitives({
    behavior: behaviorIntelligence,
    search: searchIntelligence,
  });

  return buildCreatorIntelligenceBrief({
    contentType: input.contentType,
    primitives,
  });
}
