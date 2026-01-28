import { supabase } from './supabaseClient';
import { DecisionResult } from '../services/omnivyreClient';

export async function saveAiCampaignPlan(input: {
  campaignId: string;
  snapshot_hash: string;
  mode: string;
  response: string;
  omnivyre_decision: DecisionResult;
}): Promise<void> {
  const { error } = await supabase
    .from('12_week_plan')
    .insert({
      campaign_id: input.campaignId,
      snapshot_hash: input.snapshot_hash,
      mode: input.mode,
      response: input.response,
      omnivyre_decision: input.omnivyre_decision,
      source: 'ai',
      created_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to save AI campaign plan: ${error.message}`);
  }
}

export async function saveStructuredCampaignPlan(input: {
  campaignId: string;
  snapshot_hash: string;
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
  omnivyre_decision: DecisionResult;
  raw_plan_text: string;
}): Promise<void> {
  const { error } = await supabase
    .from('12_week_plan')
    .insert({
      campaign_id: input.campaignId,
      snapshot_hash: input.snapshot_hash,
      weeks: input.weeks,
      raw_plan_text: input.raw_plan_text,
      omnivyre_decision: input.omnivyre_decision,
      source: 'ai',
      created_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to save structured campaign plan: ${error.message}`);
  }
}

export async function saveStructuredCampaignPlanDayUpdate(input: {
  campaignId: string;
  snapshot_hash: string;
  dayPlan: {
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
  omnivyre_decision: DecisionResult;
  raw_plan_text: string;
}): Promise<void> {
  const { error } = await supabase
    .from('12_week_plan')
    .update({
      refined_day: input.dayPlan,
      raw_plan_text: input.raw_plan_text,
      omnivyre_decision: input.omnivyre_decision,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', input.campaignId)
    .eq('snapshot_hash', input.snapshot_hash);

  if (error) {
    throw new Error(`Failed to update structured campaign plan day: ${error.message}`);
  }
}

export async function savePlatformCustomizedContent(input: {
  campaignId: string;
  snapshot_hash: string;
  day: string;
  platforms: Record<string, string>;
  omnivyre_decision: DecisionResult;
  raw_plan_text: string;
}): Promise<void> {
  const { error } = await supabase
    .from('12_week_plan')
    .update({
      platform_content: {
        day: input.day,
        platforms: input.platforms,
      },
      raw_plan_text: input.raw_plan_text,
      omnivyre_decision: input.omnivyre_decision,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', input.campaignId)
    .eq('snapshot_hash', input.snapshot_hash);

  if (error) {
    throw new Error(`Failed to save platform customized content: ${error.message}`);
  }
}
