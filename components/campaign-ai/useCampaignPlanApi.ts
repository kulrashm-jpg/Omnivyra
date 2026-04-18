import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import type { PlatformCustomization, RefinedDay, StructuredPlan } from './types';

type PlanMode = 'generate_plan' | 'refine_day' | 'platform_customize';

type PlanApiOptions = {
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  conversationHistory?: Array<{ type: 'user' | 'ai'; message: string }>;
  currentPlan?: { weeks: any[] };
  scopeWeeks?: number[] | null;
  chatContext?: string;
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  collectedPlanningContextOverride?: Record<string, unknown>;
  planAbortRef?: React.MutableRefObject<AbortController | null>;
};

type Params = {
  campaignId?: string;
  resolvedCompanyId: string;
  recommendationContext?: unknown;
  optimizationContext?: unknown;
  vetScope?: { selectedWeeks: number[]; areasByWeek?: Record<number, string[]> };
  lastCollectedPlanningContextFromApi: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  buildCollectedPlanningContextForApi: () => Record<string, unknown> | undefined;
};

export function useCampaignPlanApi({
  campaignId,
  resolvedCompanyId,
  recommendationContext,
  optimizationContext,
  vetScope,
  lastCollectedPlanningContextFromApi,
  collectedPlanningContext,
  buildCollectedPlanningContextForApi,
}: Params) {
  return async function callCampaignPlanAPI(
    message: string,
    mode: PlanMode,
    options?: PlanApiOptions
  ): Promise<{
    plan?: StructuredPlan;
    day?: RefinedDay;
    platform_content?: PlatformCustomization;
    conversationalResponse?: string;
    validation_result?: any;
    collectedPlanningContext?: Record<string, unknown>;
    startDateConflictWarning?: string;
  }> {
    const baseContext =
      options?.collectedPlanningContextOverride ??
      (lastCollectedPlanningContextFromApi && Object.keys(lastCollectedPlanningContextFromApi).length > 0 ? lastCollectedPlanningContextFromApi : null) ??
      (collectedPlanningContext && Object.keys(collectedPlanningContext).length > 0 ? collectedPlanningContext : null);
    const fromForm = buildCollectedPlanningContextForApi();
    const mergedCollectedPlanningContext =
      baseContext || fromForm ? { ...(baseContext ?? {}), ...(fromForm ?? {}) } : undefined;

    if (!resolvedCompanyId) {
      throw new Error('companyId is required to persist campaign_planning_inputs');
    }

    const durationWeeks = options?.durationWeeks ?? 12;
    const timeoutMs = Math.min(600000, 300000 + durationWeeks * 45000);
    const timeoutMinutes = Math.round(timeoutMs / 60000);
    const controller = new AbortController();
    if (options?.planAbortRef) {
      options.planAbortRef.current = controller;
    }
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`Plan request timed out after ${timeoutMinutes} minutes`, 'AbortError'));
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetchWithAuth('/api/campaigns/ai/plan', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          companyId: resolvedCompanyId,
          mode,
          message,
          durationWeeks: options?.durationWeeks,
          targetDay: options?.targetDay,
          platforms: options?.platforms,
          messages: options?.conversationHistory,
          recommendationContext,
          optimizationContext,
          currentPlan: options?.currentPlan,
          scopeWeeks: options?.scopeWeeks,
          chatContext: options?.chatContext,
          vetScope: options?.vetScope ?? vetScope,
          collectedPlanningContext: mergedCollectedPlanningContext,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
      if (options?.planAbortRef) {
        options.planAbortRef.current = null;
      }
    }

    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // ignore non-JSON error bodies
    }

    if (!response.ok) {
      if (response.status === 422 && (data?.conversationalResponse || data?.validation_result)) {
        return {
          conversationalResponse: (data.conversationalResponse as string) || 'Capacity validation failed.',
          validation_result: data.validation_result,
        };
      }
      const raw = (data.error || data.message) as string | undefined;
      let friendly: string;
      if (response.status === 400) {
        friendly = "Your message couldn't be processed. Please rephrase and try again.";
      } else if (response.status === 401) {
        friendly = raw || 'Session expired. Please sign in again.';
      } else if (response.status === 403) {
        friendly = raw || "You don't have permission to update this campaign.";
      } else if (response.status === 404) {
        friendly = raw || 'Campaign not found.';
      } else if (raw) {
        friendly = raw;
      } else {
        friendly = `AI plan request failed (${response.status}). Please try again.`;
      }
      throw new Error(friendly);
    }

    return {
      plan: data.plan as StructuredPlan | undefined,
      day: data.day as RefinedDay | undefined,
      platform_content: data.platform_content as PlatformCustomization | undefined,
      conversationalResponse: data.conversationalResponse as string | undefined,
      validation_result: data.validation_result,
      collectedPlanningContext: data.collectedPlanningContext as Record<string, unknown> | undefined,
      startDateConflictWarning: data.startDateConflictWarning as string | undefined,
    };
  };
}
