/**
 * Campaign Recommendations Extension — Expert consultation to improve existing plans.
 * Generates stage-aware suggestions per week; stored in campaign_recommendation_weeks.
 */

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabaseClient';
import { getUnifiedCampaignBlueprint } from './campaignBlueprintService';
import { getProfile } from './companyProfileService';
import { runCompletionWithOperation } from './aiGateway';

export type RecommendationWeekInput = {
  week_number: number;
  topics_to_cover?: string[] | null;
  primary_objective?: string | null;
  summary?: string | null;
  objectives?: string[] | null;
  goals?: string[] | null;
  suggested_days_to_post?: string[] | null;
  suggested_best_times?: Record<string, string> | null;
  platform_allocation?: Record<string, number> | null;
  platform_content_breakdown?: Record<string, Array<{ type: string; count: number; topic?: string }>> | null;
  content_type_mix?: string[] | null;
};

export async function generateCampaignRecommendations(input: {
  campaignId: string;
  companyId: string;
}): Promise<{ sessionId: string; weeks: RecommendationWeekInput[] }> {
  const { campaignId, companyId } = input;
  const sessionId = uuidv4();

  const blueprint = await getUnifiedCampaignBlueprint(campaignId);
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, description, current_stage, duration_weeks')
    .eq('id', campaignId)
    .maybeSingle();
  let profile: any = {};
  try {
    profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  } catch {
    profile = {};
  }

  const stage = (campaign?.current_stage as string) || 'twelve_week_plan';
  const weeks = blueprint?.weeks ?? [];
  const durationWeeks = campaign?.duration_weeks ?? blueprint?.duration_weeks ?? weeks.length ?? 12;

  if (weeks.length === 0) {
    return {
      sessionId,
      weeks: Array.from({ length: durationWeeks }, (_, i) => ({
        week_number: i + 1,
        topics_to_cover: ['Topic to be defined'],
        primary_objective: 'Objective to be defined',
        suggested_days_to_post: ['Tuesday', 'Thursday'],
        platform_allocation: { linkedin: 2 },
        content_type_mix: ['post'],
      })),
    };
  }

  const systemPrompt = `You are an expert campaign consultant. Improve the existing campaign plan with targeted suggestions per week.
Stage: ${stage}. Focus suggestions on: topics, objectives, scheduling (best days/times), and platform×content mix.
Return JSON: { "weeks": [ { "week_number": 1, "topics_to_cover": ["..."], "primary_objective": "...", "summary": "...", "objectives": ["..."], "goals": ["..."], "suggested_days_to_post": ["Tue","Thu"], "suggested_best_times": {"linkedin":"9am"}, "platform_allocation": {"linkedin":2}, "platform_content_breakdown": {"linkedin":[{"type":"post","count":1,"topic":"..."}]}, "content_type_mix": ["post"] } ] }
Only include weeks that exist. Enhance, don't replace entirely.`;
  const userContent = `Campaign: ${campaign?.name || 'Campaign'}. Description: ${(campaign?.description || '').slice(0, 500)}.
Profile category: ${profile?.category || 'general'}.
Current plan weeks:
${JSON.stringify(weeks.slice(0, 12).map((w: any) => ({
  week_number: w.week_number,
  phase_label: w.phase_label,
  primary_objective: w.primary_objective,
  topics_to_cover: w.topics_to_cover,
  platform_allocation: w.platform_allocation,
  platform_content_breakdown: w.platform_content_breakdown,
})))}
Generate improvement suggestions for each week.`;

  let resultWeeks: RecommendationWeekInput[];
  try {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      operation: 'generateCampaignRecommendations',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
    const raw = result.output?.trim() || '{}';
    const parsed = JSON.parse(raw) as { weeks?: RecommendationWeekInput[] };
    resultWeeks = Array.isArray(parsed.weeks) ? parsed.weeks : [];
  } catch (err) {
    console.warn('AI recommendation generation failed, using heuristic:', err);
    resultWeeks = weeks.map((w: any) => ({
      week_number: w.week_number,
      topics_to_cover: w.topics_to_cover?.length ? [...w.topics_to_cover, 'Additional angle to explore'] : ['Topic refinement'],
      primary_objective: w.primary_objective || 'Objective refinement',
      suggested_days_to_post: ['Tuesday', 'Thursday'],
      platform_allocation: w.platform_allocation ?? {},
      platform_content_breakdown: w.platform_content_breakdown ?? undefined,
      content_type_mix: w.content_type_mix ?? w.content_type_mix ?? ['post'],
    }));
  }

  await supabase
    .from('campaign_recommendation_weeks')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('session_id', sessionId);

  for (const rec of resultWeeks) {
    await supabase.from('campaign_recommendation_weeks').insert({
      campaign_id: campaignId,
      week_number: rec.week_number,
      session_id: sessionId,
      status: 'pending',
      topics_to_cover: rec.topics_to_cover ?? null,
      primary_objective: rec.primary_objective ?? null,
      summary: rec.summary ?? null,
      objectives: rec.objectives ?? null,
      goals: rec.goals ?? null,
      suggested_days_to_post: rec.suggested_days_to_post ?? null,
      suggested_best_times: rec.suggested_best_times ?? null,
      platform_allocation: rec.platform_allocation ?? null,
      platform_content_breakdown: rec.platform_content_breakdown ?? null,
      content_type_mix: rec.content_type_mix ?? null,
    });
  }

  return { sessionId, weeks: resultWeeks };
}

export async function fetchRecommendationWeeks(input: {
  campaignId: string;
  sessionId?: string;
  status?: 'pending' | 'agreed' | 'applied';
}): Promise<any[]> {
  let query = supabase
    .from('campaign_recommendation_weeks')
    .select('*')
    .eq('campaign_id', input.campaignId)
    .order('week_number');
  if (input.sessionId) query = query.eq('session_id', input.sessionId);
  if (input.status) query = query.eq('status', input.status);
  const { data } = await query;
  return data ?? [];
}

export async function markWeeksAgreed(input: {
  campaignId: string;
  sessionId: string;
  weekNumbers: number[];
}): Promise<void> {
  await supabase
    .from('campaign_recommendation_weeks')
    .update({ status: 'agreed', agreed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('campaign_id', input.campaignId)
    .eq('session_id', input.sessionId)
    .in('week_number', input.weekNumbers);
}

export async function mergeRecommendationsIntoPlan(input: {
  campaignId: string;
  sessionId: string;
  weekNumbers: number[];
}): Promise<{ merged: number }> {
  const { data: recs } = await supabase
    .from('campaign_recommendation_weeks')
    .select('*')
    .eq('campaign_id', input.campaignId)
    .eq('session_id', input.sessionId)
    .in('week_number', input.weekNumbers)
    .in('status', ['agreed', 'pending']);
  if (!recs || recs.length === 0) return { merged: 0 };

  const blueprint = await getUnifiedCampaignBlueprint(input.campaignId);
  if (!blueprint?.weeks?.length) {
    throw new Error('No blueprint found. Create a plan first before merging recommendations.');
  }

  const recByWeek = new Map(recs.map((r) => [r.week_number, r]));
  const mergedWeeks = blueprint.weeks.map((w: any) => {
    const rec = recByWeek.get(w.week_number);
    if (!rec) return w;
    return {
      ...w,
      topics_to_cover: rec.topics_to_cover ?? w.topics_to_cover,
      primary_objective: rec.primary_objective ?? w.primary_objective,
      platform_allocation: rec.platform_allocation ?? w.platform_allocation,
      platform_content_breakdown: rec.platform_content_breakdown ?? w.platform_content_breakdown,
      content_type_mix: rec.content_type_mix ?? w.content_type_mix,
      week_extras: {
        ...(w.week_extras ?? {}),
        ...(rec.summary ? { summary: rec.summary } : {}),
        ...(rec.objectives?.length ? { objectives: rec.objectives } : {}),
        ...(rec.goals?.length ? { goals: rec.goals } : {}),
        ...(rec.suggested_days_to_post?.length ? { days_to_post: rec.suggested_days_to_post } : {}),
        ...(rec.suggested_best_times ? { best_times: rec.suggested_best_times } : {}),
      },
    };
  });

  let { data: planRow } = await supabase
    .from('twelve_week_plan')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .in('status', ['edited_committed', 'committed'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!planRow?.id) {
    const { data: anyPlan } = await supabase
      .from('twelve_week_plan')
      .select('id')
      .eq('campaign_id', input.campaignId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    planRow = anyPlan;
  }
  if (!planRow?.id) throw new Error('No plan row found for campaign');

  const weeksForDb = mergedWeeks.map((w: any) => ({
    week: w.week_number,
    phase_label: w.phase_label,
    primary_objective: w.primary_objective,
    platform_allocation: w.platform_allocation,
    content_type_mix: w.content_type_mix,
    cta_type: w.cta_type,
    weekly_kpi_focus: w.weekly_kpi_focus,
    topics_to_cover: w.topics_to_cover,
    platform_content_breakdown: w.platform_content_breakdown,
    platform_topics: w.platform_topics,
    week_extras: w.week_extras,
  }));

  const { error } = await supabase
    .from('twelve_week_plan')
    .update({
      weeks: weeksForDb,
      blueprint: { campaign_id: input.campaignId, duration_weeks: mergedWeeks.length, weeks: mergedWeeks },
      status: 'edited_committed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', planRow.id);

  if (error) throw new Error(`Failed to merge: ${error.message}`);

  await supabase
    .from('campaign_recommendation_weeks')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', input.campaignId)
    .eq('session_id', input.sessionId)
    .in('week_number', input.weekNumbers);

  return { merged: recs.length };
}
