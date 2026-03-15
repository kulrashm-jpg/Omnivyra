/**
 * Plan Preview Service
 * Generates campaign plan preview without persistence.
 * Uses generateCampaignPlanAI then parseAndValidateCampaignPlan.
 * When platform_content_requests is provided, uses deterministic skeleton path.
 */

import { generateCampaignPlanAI } from './aiPlanningService';
import { parseAndValidateCampaignPlan } from './campaignPlanCore';
import { buildDeterministicWeeklySkeleton, DeterministicWeeklySkeletonError } from './deterministicWeeklySkeleton';
import type { PlanningGenerationInput } from '../types/campaignPlanning';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CREATOR_CONTENT_TYPES = new Set(['video', 'carousel', 'story', 'reel', 'image']);
type CampaignType = 'TEXT' | 'CREATOR' | 'HYBRID';
type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

function executionModeForSlot(campaignType: CampaignType, contentType: string): ExecutionMode {
  if (campaignType === 'TEXT') return 'AI_AUTOMATED';
  if (campaignType === 'CREATOR') return 'CREATOR_REQUIRED';
  const ct = String(contentType ?? '').toLowerCase().trim();
  return CREATOR_CONTENT_TYPES.has(ct) ? 'CREATOR_REQUIRED' : 'AI_AUTOMATED';
}

function skeletonToWeeks(
  skeleton: { execution_items: Array<{ content_type: string; slot_platforms?: string[][]; topic_slots?: unknown[] }> },
  durationWeeks: number,
  campaignType: CampaignType,
  themeTitle: string
): unknown[] {
  const weeks: unknown[] = [];
  for (let w = 1; w <= durationWeeks; w += 1) {
    const daily: Array<{ execution_id: string; platform: string; content_type: string; topic: string; title: string; day: string; execution_mode?: string }> = [];
    let slotIndex = 0;
    for (const item of skeleton.execution_items) {
      const ct = item.content_type ?? 'post';
      const slotPlatforms = Array.isArray(item.slot_platforms) ? item.slot_platforms : [];
      const topics = Array.isArray(item.topic_slots) ? item.topic_slots : [];
      for (let si = 0; si < slotPlatforms.length; si += 1) {
        const platforms = slotPlatforms[si] ?? [];
        const topicSlot = topics[si];
        const topicStr = topicSlot && typeof (topicSlot as { topic?: string }).topic === 'string'
          ? (topicSlot as { topic: string }).topic
          : themeTitle;
        for (const p of platforms) {
          const dayIndex = slotIndex % DAYS_ORDER.length;
          daily.push({
            execution_id: `wk${w}-${p}-${ct}-${si}`,
            platform: p,
            content_type: ct,
            topic: topicStr ?? themeTitle,
            title: topicStr ?? themeTitle,
            day: DAYS_ORDER[dayIndex] ?? 'Monday',
            execution_mode: executionModeForSlot(campaignType, ct),
          });
          slotIndex += 1;
        }
      }
    }
    weeks.push({
      week: w,
      theme: themeTitle,
      phase_label: `Week ${w}`,
      daily_execution_items: daily,
    });
  }
  return weeks;
}

export class PlanningValidationError extends Error {
  readonly code = 'PLANNING_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'PlanningValidationError';
  }
}

export class PlanningGenerationError extends Error {
  readonly code = 'PLANNING_GENERATION_ERROR';
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PlanningGenerationError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export interface PlanPreviewResult {
  plan: { weeks: unknown[] };
  recommended_goal?: string | null;
  recommended_audience?: string[] | null;
}

const CAMPAIGN_GOAL_OPTIONS = [
  'Brand Awareness', 'Lead Generation', 'Product Education', 'Product Launch',
  'Community Growth', 'Customer Retention', 'Thought Leadership', 'Event Promotion',
];

const TARGET_AUDIENCE_OPTIONS = [
  'B2B Marketers', 'Founders / Entrepreneurs', 'Marketing Leaders', 'Sales Teams',
  'Product Managers', 'Developers', 'General Consumers',
];

/** Best-effort extract recommended_goal and recommended_audience from AI rawOutput. */
function extractRecommendedFromRawOutput(rawOutput: string): { goal?: string; audience?: string[] } | null {
  if (!rawOutput || typeof rawOutput !== 'string') return null;
  const parseAndValidate = (jsonStr: string): { goal?: string; audience?: string[] } | null => {
    try {
      const parsed = JSON.parse(jsonStr) as { recommended_goal?: string; recommended_audience?: string[] };
      const goalRaw = typeof parsed.recommended_goal === 'string' ? parsed.recommended_goal.trim() : '';
      const goal = goalRaw && CAMPAIGN_GOAL_OPTIONS.includes(goalRaw) ? goalRaw : null;
      const audience = Array.isArray(parsed.recommended_audience)
        ? parsed.recommended_audience
            .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
            .map((s) => s.trim())
            .filter((s) => TARGET_AUDIENCE_OPTIONS.includes(s))
        : [];
      if (!goal && audience.length === 0) return null;
      return { goal: goal ?? undefined, audience: audience.length > 0 ? audience : undefined };
    } catch {
      return null;
    }
  };
  try {
    // Prefer ```recommendations block from prompt
    const blockMatch = rawOutput.match(/```(?:recommendations|json)\s*([\s\S]*?)```/);
    const jsonStr = blockMatch ? blockMatch[1].trim() : null;
    if (jsonStr) {
      const result = parseAndValidate(jsonStr);
      if (result) return result;
    }
    // Fallback: find JSON object with recommended_goal or recommended_audience
    const objMatch = rawOutput.match(/\{\s*"recommended_goal"\s*:\s*"[^"]*"[\s\S]*?\}/);
    if (objMatch) {
      const result = parseAndValidate(objMatch[0]);
      if (result) return result;
    }
    const audMatch = rawOutput.match(/\{\s*"recommended_audience"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
    if (audMatch) {
      const result = parseAndValidate(audMatch[0]);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a campaign plan preview. No database records created or modified.
 * When platform_content_requests is provided, uses deterministic skeleton instead of AI.
 */
export async function generatePlanPreview(input: PlanningGenerationInput): Promise<PlanPreviewResult> {
  if (!input.companyId || typeof input.companyId !== 'string' || !input.companyId.trim()) {
    throw new PlanningValidationError('companyId is required');
  }
  if (!input.idea_spine || typeof input.idea_spine !== 'object' || Array.isArray(input.idea_spine)) {
    throw new PlanningValidationError('idea_spine is required');
  }
  if (!input.strategy_context || typeof input.strategy_context !== 'object' || Array.isArray(input.strategy_context)) {
    throw new PlanningValidationError('strategy_context is required');
  }
  if (!input.campaign_direction || typeof input.campaign_direction !== 'string' || !input.campaign_direction.trim()) {
    throw new PlanningValidationError('campaign_direction is required');
  }

  const platform_content_requests = input.platform_content_requests;
  const campaignType: CampaignType = (input.campaign_type === 'TEXT' || input.campaign_type === 'CREATOR' || input.campaign_type === 'HYBRID')
    ? input.campaign_type
    : 'TEXT';

  const hasMatrix =
    platform_content_requests != null &&
    typeof platform_content_requests === 'object' &&
    !Array.isArray(platform_content_requests) &&
    Object.keys(platform_content_requests).length > 0;

  if (hasMatrix) {
    // STEP 2: Skeleton generation validation — reject invalid payloads with 400
    for (const [p, ctMap] of Object.entries(platform_content_requests as Record<string, Record<string, number>>)) {
      if (!p || typeof ctMap !== 'object' || Array.isArray(ctMap)) continue;
      for (const [ct, freq] of Object.entries(ctMap)) {
        if (freq == null || typeof freq !== 'number') {
          throw new PlanningValidationError(
            `platform_content_requests[${p}][${ct}]: frequency must be a number`
          );
        }
        if (!Number.isFinite(freq) || freq < 0) {
          throw new PlanningValidationError(
            `platform_content_requests[${p}][${ct}]: frequency must be >= 0 (got ${freq})`
          );
        }
        if (freq > 14) {
          throw new PlanningValidationError(
            `platform_content_requests[${p}][${ct}]: frequency must be <= 14 (got ${freq})`
          );
        }
      }
    }

    try {
      const skeleton = await buildDeterministicWeeklySkeleton({
        platform_content_requests,
      } as any);
      const durationWeeks = input.strategy_context.duration_weeks || 12;
      const themeTitle = String(input.idea_spine.refined_title ?? input.idea_spine.title ?? 'Campaign').trim() || 'Campaign';
      const weeks = skeletonToWeeks(skeleton, durationWeeks, campaignType, themeTitle);
      return { plan: { weeks } };
    } catch (err) {
      if (err instanceof DeterministicWeeklySkeletonError) {
        throw new PlanningValidationError(err.message);
      }
      throw new PlanningGenerationError(
        err instanceof Error ? err.message : 'Deterministic skeleton failed',
        err
      );
    }
  }

  try {
    const { rawOutput } = await generateCampaignPlanAI(input);
    const plan = await parseAndValidateCampaignPlan({ companyId: input.companyId, rawOutput });
    const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
    const recommended = extractRecommendedFromRawOutput(rawOutput);
    return {
      plan: { weeks },
      recommended_goal: recommended?.goal ?? undefined,
      recommended_audience: recommended?.audience ?? undefined,
    };
  } catch (err) {
    if (err instanceof PlanningValidationError) throw err;
    throw new PlanningGenerationError(
      err instanceof Error ? err.message : 'Plan generation failed',
      err
    );
  }
}
