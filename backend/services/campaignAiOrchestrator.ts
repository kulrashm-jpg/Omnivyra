import { generateCampaignPlan } from './aiGateway';
import { assessVirality } from './viralityAdvisorService';
import { buildCampaignSnapshotWithHash, canonicalJsonStringify } from './viralitySnapshotBuilder';
import { buildDecideRequest, requestDecision, DecisionResult } from './omnivyreClient';
import { parseAiPlanToWeeks, parseAiRefinedDay, parseAiPlatformCustomization } from './campaignPlanParser';
import { getPlatformStrategies } from './externalApiService';
import { saveStructuredCampaignPlan, saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent } from '../db/campaignPlanStore';

export type CampaignAiMode = 'generate_plan' | 'refine_day' | 'platform_customize';

export interface CampaignAiPlanInput {
  campaignId: string;
  mode: CampaignAiMode;
  message: string;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
}

export interface CampaignAiPlanResult {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyre_decision: DecisionResult;
  plan?: {
    weeks: Array<{
      week: number;
      theme: string;
      daily: Array<{
        day: string;
        objective: string;
        content: string;
        platforms: Record<string, string>;
        hashtags?: string[];
        seo_keywords?: string[];
        meta_title?: string;
        meta_description?: string;
        hook?: string;
        cta?: string;
        best_time?: string;
        effort_score?: number;
        success_projection?: number;
      }>;
    }>;
  };
  day?: {
    week: number;
    day: string;
    objective: string;
    content: string;
    platforms: Record<string, string>;
    hashtags?: string[];
    seo_keywords?: string[];
    meta_title?: string;
    meta_description?: string;
    hook?: string;
    cta?: string;
    best_time?: string;
    effort_score?: number;
    success_projection?: number;
  };
  platform_content?: {
    day: string;
    platforms: Record<string, string>;
  };
  raw_plan_text: string;
}

function buildPromptContext(input: {
  message: string;
  mode: CampaignAiMode;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  snapshotHash: string;
  snapshot: any;
  diagnostics: any;
  omnivyreDecision?: DecisionResult;
  platformStrategies: any;
}): { system: string; user: string } {
  const userPayload = {
    mode: input.mode,
    snapshot_hash: input.snapshotHash,
    message: input.message,
    durationWeeks: input.durationWeeks,
    targetDay: input.targetDay,
    platforms: input.platforms,
    snapshot: input.snapshot,
    diagnostics: input.diagnostics,
    omnivyre_decision: input.omnivyreDecision || null,
    platform_strategies: input.platformStrategies,
  };

  const modeHint =
    input.mode === 'platform_customize'
      ? '\nFocus only on the target day and provide platform-specific variants for the requested platforms.\n'
      : '\n';

  const user =
    'You are a campaign planning assistant.\n' +
    'You MUST only use platforms and content types provided in platform_strategies.\n' +
    'Do not invent platforms or content formats.\n' +
    'Return a detailed FREE-FORM TEXT campaign plan only.\n' +
    'Include:\n' +
    '- overall strategy\n' +
    '- weekly themes\n' +
    '- daily content ideas\n' +
    '- platform-specific customization (Instagram, LinkedIn, X, YouTube, Facebook where applicable)\n' +
    'Do NOT return JSON. Do NOT wrap in code blocks.\n' +
    modeHint +
    `Input JSON:\n${canonicalJsonStringify(userPayload)}`;

  return {
    system: 'You are a campaign planning assistant.',
    user,
  };
}

export async function runCampaignAiPlan(
  input: CampaignAiPlanInput
): Promise<CampaignAiPlanResult> {
  const { snapshot } = await buildCampaignSnapshotWithHash(input.campaignId);
  const viralityAssessment = await assessVirality(input.campaignId);
  const platformStrategies = await getPlatformStrategies();

  const decidePayload = buildDecideRequest({
    campaign_id: input.campaignId,
    snapshot_hash: viralityAssessment.snapshot_hash,
    model_version: viralityAssessment.model_version,
    snapshot,
    diagnostics: viralityAssessment.diagnostics,
    comparisons: viralityAssessment.comparisons,
    overall_summary: viralityAssessment.overall_summary,
  });

  const omnivyreDecision = await requestDecision(decidePayload);

  console.log('Campaign AI orchestration', {
    snapshot_hash: viralityAssessment.snapshot_hash,
    decision_id: omnivyreDecision.decision_id,
    recommendation: omnivyreDecision.recommendation,
    mode: input.mode,
  });

  const prompt = buildPromptContext({
    message: input.message,
    mode: input.mode,
    durationWeeks: input.durationWeeks,
    targetDay: input.targetDay,
    platforms: input.platforms,
    snapshotHash: viralityAssessment.snapshot_hash,
    snapshot,
    diagnostics: viralityAssessment,
    omnivyreDecision,
    platformStrategies,
  });

  const completion = await generateCampaignPlan({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  });

  const raw = completion.output?.trim() || '';
  if (input.mode === 'refine_day') {
    const dayPlan = await parseAiRefinedDay(raw);

    await saveStructuredCampaignPlanDayUpdate({
      campaignId: input.campaignId,
      snapshot_hash: viralityAssessment.snapshot_hash,
      dayPlan,
      omnivyre_decision: omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: viralityAssessment.snapshot_hash,
      omnivyre_decision: omnivyreDecision,
      day: dayPlan,
      raw_plan_text: raw,
    };
  }

  if (input.mode === 'platform_customize') {
    const customization = await parseAiPlatformCustomization(raw);

    await savePlatformCustomizedContent({
      campaignId: input.campaignId,
      snapshot_hash: viralityAssessment.snapshot_hash,
      day: customization.day,
      platforms: customization.platforms,
      omnivyre_decision: omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: viralityAssessment.snapshot_hash,
      omnivyre_decision: omnivyreDecision,
      platform_content: customization,
      raw_plan_text: raw,
    };
  }

  const structured = await parseAiPlanToWeeks(raw);

  await saveStructuredCampaignPlan({
    campaignId: input.campaignId,
    snapshot_hash: viralityAssessment.snapshot_hash,
    weeks: structured.weeks,
    omnivyre_decision: omnivyreDecision,
    raw_plan_text: raw,
  });

  return {
    mode: input.mode,
    snapshot_hash: viralityAssessment.snapshot_hash,
    omnivyre_decision: omnivyreDecision,
    plan: structured,
    raw_plan_text: raw,
  };
}
