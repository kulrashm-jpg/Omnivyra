import { supabase } from './supabaseClient';
import { DecisionResult } from '../services/omnivyreClient';
import type { WeeklyBlueprintWeek } from '../services/campaignPlanParser';
import { fromStructuredPlan } from '../services/campaignBlueprintAdapter';
import type { CampaignBlueprint, CampaignBlueprintWeek } from '../types/CampaignBlueprint';

function totalPostsForWeek(week: { platform_allocation?: Record<string, number> }): number {
  const pa = week.platform_allocation ?? {};
  return Math.max(0, Object.values(pa).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)) || 0;
}

async function upsertCampaignResourceProjection(campaignId: string, blueprint: CampaignBlueprint): Promise<void> {
  const rows = blueprint.weeks.map((w: CampaignBlueprintWeek) => ({
    campaign_id: campaignId,
    week_number: w.week_number,
    total_posts: totalPostsForWeek(w) || 1,
    platform_allocation: w.platform_allocation ?? {},
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('campaign_resource_projection').upsert(rows, {
    onConflict: 'campaign_id,week_number',
  });
  if (error) {
    console.warn('campaign_resource_projection upsert failed:', error.message);
  }
}

export async function saveAiCampaignPlan(input: {
  campaignId: string;
  snapshot_hash: string;
  mode: string;
  response: string;
  omnivyre_decision: DecisionResult;
}): Promise<void> {
  const { error } = await supabase
    .from('twelve_week_plan')
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

/** Supports both new blueprint format and legacy daily[] format for backward compatibility */
export async function saveStructuredCampaignPlan(input: {
  campaignId: string;
  snapshot_hash: string;
  weeks: WeeklyBlueprintWeek[];
  omnivyre_decision: DecisionResult;
  raw_plan_text: string;
  /** Execution pressure from executionPressureBalancer (pressure level + balance report for UI). */
  executionPressureMetadata?: Record<string, unknown>;
  /** Execution momentum from executionMomentumTracker (state + signals for UI). */
  executionMomentumMetadata?: Record<string, unknown>;
  /** Momentum recovery suggestions when momentum is WEAK (from momentumRecoveryAdvisor). */
  momentumRecoveryMetadata?: Record<string, unknown>;
}): Promise<void> {
  const plan = { weeks: input.weeks, campaign_id: input.campaignId };
  const blueprint: CampaignBlueprint = fromStructuredPlan(plan);
  const hasPressure = input.executionPressureMetadata && Object.keys(input.executionPressureMetadata).length > 0;
  const hasMomentum = input.executionMomentumMetadata && Object.keys(input.executionMomentumMetadata).length > 0;
  const hasRecovery = input.momentumRecoveryMetadata && Object.keys(input.momentumRecoveryMetadata).length > 0;
  const executionIntelligence =
    hasPressure || hasMomentum || hasRecovery
      ? {
          executionPressure: hasPressure ? input.executionPressureMetadata : undefined,
          executionMomentum: hasMomentum ? input.executionMomentumMetadata : undefined,
          momentumRecovery: hasRecovery ? input.momentumRecoveryMetadata : undefined,
        }
      : undefined;
  const blueprintToSave =
    executionIntelligence
      ? ({ ...blueprint, executionIntelligence } as any)
      : (blueprint as any);

  const { error } = await supabase
    .from('twelve_week_plan')
    .insert({
      campaign_id: input.campaignId,
      snapshot_hash: input.snapshot_hash,
      weeks: input.weeks,
      raw_plan_text: input.raw_plan_text,
      omnivyre_decision: input.omnivyre_decision,
      source: 'ai',
      status: 'draft' as PlanStatus,
      blueprint: blueprintToSave,
      created_at: new Date().toISOString(),
    } as any);

  if (error) {
    throw new Error(`Failed to save structured campaign plan: ${error.message}`);
  }
  await upsertCampaignResourceProjection(input.campaignId, blueprint);
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
    .from('twelve_week_plan')
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

/**
 * Save blueprint from Flow A (recommendations) to twelve_week_plan.
 * Used when weekly_plan is generated by campaignRecommendationService.
 */
export async function saveCampaignBlueprintFromRecommendation(input: {
  campaignId: string;
  companyId: string;
  blueprint: CampaignBlueprint;
}): Promise<void> {
  const snapshot_hash = `recommendation-${input.companyId}-${Date.now()}`;
  const weeksForDb = input.blueprint.weeks.map((w) => ({
    week: w.week_number,
    phase_label: w.phase_label,
    primary_objective: w.primary_objective,
    platform_allocation: w.platform_allocation,
    content_type_mix: w.content_type_mix,
    cta_type: w.cta_type,
    weekly_kpi_focus: w.weekly_kpi_focus,
    topics_to_cover: Array.isArray(w.topics_to_cover) ? w.topics_to_cover : undefined,
    weeklyContextCapsule: w.weeklyContextCapsule ?? undefined,
    topics: Array.isArray(w.topics) ? w.topics : undefined,
    platform_content_breakdown: w.platform_content_breakdown,
    platform_topics: w.platform_topics,
    execution_items: Array.isArray((w as any).execution_items) ? (w as any).execution_items : undefined,
    posting_execution_map: Array.isArray((w as any).posting_execution_map) ? (w as any).posting_execution_map : undefined,
    resolved_postings: Array.isArray((w as any).resolved_postings) ? (w as any).resolved_postings : undefined,
    week_extras: w.week_extras ?? undefined,
  }));
  const { error } = await supabase.from('twelve_week_plan').insert({
    campaign_id: input.campaignId,
    snapshot_hash,
    weeks: weeksForDb,
    raw_plan_text: '',
    omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as DecisionResult,
    source: 'recommendation',
    status: 'committed' as PlanStatus,
    blueprint: input.blueprint as any,
    created_at: new Date().toISOString(),
  } as any);
  if (error) throw new Error(`Failed to save blueprint: ${error.message}`);
  await upsertCampaignResourceProjection(input.campaignId, input.blueprint);
}

export type PlanStatus = 'draft' | 'committed' | 'edited_committed';

function weeksForDbFromBlueprint(blueprint: CampaignBlueprint) {
  return blueprint.weeks.map((w) => ({
    week: w.week_number,
    phase_label: w.phase_label,
    primary_objective: w.primary_objective,
    platform_allocation: w.platform_allocation,
    content_type_mix: w.content_type_mix,
    cta_type: w.cta_type,
    weekly_kpi_focus: w.weekly_kpi_focus,
    topics_to_cover: Array.isArray(w.topics_to_cover) ? w.topics_to_cover : undefined,
    weeklyContextCapsule: w.weeklyContextCapsule ?? undefined,
    topics: Array.isArray(w.topics) ? w.topics : undefined,
    platform_content_breakdown: w.platform_content_breakdown,
    platform_topics: w.platform_topics,
    execution_items: Array.isArray((w as any).execution_items) ? (w as any).execution_items : undefined,
    posting_execution_map: Array.isArray((w as any).posting_execution_map) ? (w as any).posting_execution_map : undefined,
    resolved_postings: Array.isArray((w as any).resolved_postings) ? (w as any).resolved_postings : undefined,
    week_extras: w.week_extras ?? undefined,
  }));
}

/**
 * Save draft blueprint (view/Save for Later). Same table as committed; status='draft'.
 * Upserts: updates existing draft or inserts new.
 */
export async function saveDraftBlueprint(input: {
  campaignId: string;
  blueprint: CampaignBlueprint;
}): Promise<void> {
  const weeksForDb = weeksForDbFromBlueprint(input.blueprint);
  const snapshot_hash = `draft-${input.campaignId}`;
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    campaign_id: input.campaignId,
    snapshot_hash,
    weeks: weeksForDb,
    raw_plan_text: '',
    omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as DecisionResult,
    source: 'draft-save',
    blueprint: input.blueprint as any,
    updated_at: now,
  };

  let existing: { id: number } | null = null;
  const withStatus = await supabase
    .from('twelve_week_plan')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!withStatus.error && withStatus.data) {
    existing = withStatus.data as { id: number };
  }
  (row as any).status = 'draft';

  if (existing?.id) {
    const { error } = await supabase.from('twelve_week_plan').update(row).eq('id', existing.id);
    if (error) throw new Error(`Failed to update draft blueprint: ${error.message}`);
  } else {
    const insertPayload = { ...row, created_at: now } as any;
    const { error } = await supabase.from('twelve_week_plan').insert(insertPayload);
    if (error) throw new Error(`Failed to save draft blueprint: ${error.message}`);
  }
}

/**
 * Get the latest draft plan for a campaign (for restore-on-retry: avoid reprocessing when user says "continue" or "try again").
 */
export async function getLatestDraftPlan(campaignId: string): Promise<{ weeks: any[] } | null> {
  const { data } = await supabase
    .from('twelve_week_plan')
    .select('weeks, blueprint')
    .eq('campaign_id', campaignId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.weeks?.length && !(data as any)?.blueprint?.weeks?.length) return null;
  const weeks = (data as any)?.blueprint?.weeks ?? data.weeks;
  return Array.isArray(weeks) && weeks.length > 0 ? { weeks } : null;
}

/**
 * Promote draft to committed (same row, status change). Or insert committed if no draft.
 */
export async function commitDraftBlueprint(input: {
  campaignId: string;
  blueprint: CampaignBlueprint;
  source?: string;
}): Promise<void> {
  const weeksForDb = weeksForDbFromBlueprint(input.blueprint);
  const { data: draft } = await supabase
    .from('twelve_week_plan')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const updatePayload = {
    weeks: weeksForDb,
    blueprint: input.blueprint as any,
    source: input.source ?? 'structured-commit',
    status: 'committed' as PlanStatus,
    snapshot_hash: `legacy-${input.campaignId}-${Date.now()}`,
    updated_at: new Date().toISOString(),
  };
  if (draft?.id) {
    const { error } = await supabase.from('twelve_week_plan').update(updatePayload).eq('id', draft.id);
    if (error) throw new Error(`Failed to commit draft: ${error.message}`);
  } else {
    const snapshot_hash = `legacy-${input.campaignId}-${Date.now()}`;
    const { error } = await supabase.from('twelve_week_plan').insert({
      campaign_id: input.campaignId,
      snapshot_hash,
      weeks: weeksForDb,
      raw_plan_text: '',
      omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as DecisionResult,
      source: input.source ?? 'create-12week-plan',
      status: 'committed' as PlanStatus,
      blueprint: input.blueprint as any,
      created_at: new Date().toISOString(),
    } as any);
    if (error) throw new Error(`Failed to save committed blueprint: ${error.message}`);
  }
  await upsertCampaignResourceProjection(input.campaignId, input.blueprint);
}

/**
 * Update committed plan to edited_committed (post-commit edits).
 */
export async function updateToEditedCommitted(input: {
  campaignId: string;
  blueprint: CampaignBlueprint;
}): Promise<void> {
  const weeksForDb = weeksForDbFromBlueprint(input.blueprint);
  const { data: committed } = await supabase
    .from('twelve_week_plan')
    .select('id')
    .eq('campaign_id', input.campaignId)
    .in('status', ['committed', 'edited_committed'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!committed?.id) {
    throw new Error('No committed plan found to edit');
  }
  const { error } = await supabase
    .from('twelve_week_plan')
    .update({
      weeks: weeksForDb,
      blueprint: input.blueprint as any,
      source: 'edit-committed',
      status: 'edited_committed' as PlanStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', committed.id);
  if (error) throw new Error(`Failed to update to edited_committed: ${error.message}`);
  await upsertCampaignResourceProjection(input.campaignId, input.blueprint);
}

/**
 * Save blueprint from create-12week-plan (Flow C redirect).
 * Uses unified flow: promote draft to committed if draft exists, else insert committed.
 */
export async function saveCampaignBlueprintFromLegacy(input: {
  campaignId: string;
  blueprint: CampaignBlueprint;
  source?: string;
}): Promise<void> {
  await commitDraftBlueprint({
    campaignId: input.campaignId,
    blueprint: input.blueprint,
    source: input.source ?? 'create-12week-plan',
  });
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
    .from('twelve_week_plan')
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
