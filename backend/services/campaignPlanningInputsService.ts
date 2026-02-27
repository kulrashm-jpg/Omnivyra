import { supabase } from '../db/supabaseClient';

export type CampaignPlanningInputs = {
  recommendation_snapshot: unknown;
  target_audience: string | null;
  audience_professional_segment?: string | null;
  communication_style?: string | null;
  action_expectation?: string | null;
  content_depth?: string | null;
  topic_continuity?: string | null;
  available_content: unknown;
  weekly_capacity: unknown;
  exclusive_campaigns: unknown;
  selected_platforms: unknown;
  platform_content_requests: unknown;
  planning_stage: unknown;
  is_completed: unknown;
};

export async function getCampaignPlanningInputs(
  campaignId: string
): Promise<CampaignPlanningInputs | null> {
  const { data, error } = await supabase
    .from('campaign_planning_inputs')
    .select(
      'recommendation_snapshot, available_content, weekly_capacity, exclusive_campaigns, selected_platforms, platform_content_requests, planning_stage, is_completed'
    )
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const msg = String((error as any)?.message ?? '');
    // Fail open on transient network/Supabase connectivity issues so planning can proceed.
    if (/(fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timed out)/i.test(msg)) {
      console.warn('[campaign_planning_inputs] load failed; continuing without persisted inputs:', msg);
      return null;
    }
    throw new Error(`Failed to load campaign_planning_inputs: ${msg || 'Unknown error'}`);
  }

  if (!data) return null;

  const snapshot = (data as any).recommendation_snapshot ?? null;
  const target_audience =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (() => {
          const raw = (snapshot as any)?.planning_inputs?.target_audience;
          const s = typeof raw === 'string' ? raw.trim() : '';
          return s ? s : null;
        })()
      : null;
  const pullPlanningInput = (key: string): string | null => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const raw = (snapshot as any)?.planning_inputs?.[key];
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s ? s : null;
  };

  return {
    recommendation_snapshot: snapshot,
    target_audience,
    audience_professional_segment: pullPlanningInput('audience_professional_segment'),
    communication_style: pullPlanningInput('communication_style'),
    action_expectation: pullPlanningInput('action_expectation'),
    content_depth: pullPlanningInput('content_depth'),
    topic_continuity: pullPlanningInput('topic_continuity'),
    available_content: (data as any).available_content ?? null,
    weekly_capacity: (data as any).weekly_capacity ?? null,
    exclusive_campaigns: (data as any).exclusive_campaigns ?? null,
    selected_platforms: (data as any).selected_platforms ?? null,
    platform_content_requests: (data as any).platform_content_requests ?? null,
    planning_stage: (data as any).planning_stage ?? null,
    is_completed: (data as any).is_completed ?? null,
  };
}

export async function saveCampaignPlanningInputs(input: {
  campaignId: string;
  companyId: string;
  recommendation_snapshot?: unknown;
  target_audience?: unknown;
  audience_professional_segment?: unknown;
  communication_style?: unknown;
  action_expectation?: unknown;
  content_depth?: unknown;
  topic_continuity?: unknown;
  available_content?: unknown;
  weekly_capacity?: unknown;
  exclusive_campaigns?: unknown;
  platform_content_requests?: unknown;
  selected_platforms?: unknown;
  planning_stage?: unknown;
  is_completed?: unknown;
}): Promise<void> {
  if (!input.companyId || typeof input.companyId !== 'string') {
    throw new Error('companyId is required to save campaign_planning_inputs');
  }
  const snapshotBase =
    input.recommendation_snapshot && typeof input.recommendation_snapshot === 'object' && !Array.isArray(input.recommendation_snapshot)
      ? { ...(input.recommendation_snapshot as any) }
      : {};
  const audience = typeof input.target_audience === 'string' ? input.target_audience.trim() : '';
  const existing = (snapshotBase as any).planning_inputs;
  const planning_inputs =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as any) } : {};
  if (audience) (planning_inputs as any).target_audience = audience;
  const seg = typeof input.audience_professional_segment === 'string' ? input.audience_professional_segment.trim() : '';
  if (seg) (planning_inputs as any).audience_professional_segment = seg;
  const style = typeof input.communication_style === 'string' ? input.communication_style.trim() : '';
  if (style) (planning_inputs as any).communication_style = style;
  const action = typeof input.action_expectation === 'string' ? input.action_expectation.trim() : '';
  if (action) (planning_inputs as any).action_expectation = action;
  const depth = typeof input.content_depth === 'string' ? input.content_depth.trim() : '';
  if (depth) (planning_inputs as any).content_depth = depth;
  const continuity = typeof input.topic_continuity === 'string' ? input.topic_continuity.trim() : '';
  if (continuity) (planning_inputs as any).topic_continuity = continuity;
  if (Object.keys(planning_inputs).length > 0) {
    (snapshotBase as any).planning_inputs = planning_inputs;
  }
  const payload: Record<string, unknown> = {
    campaign_id: input.campaignId,
    company_id: input.companyId,
    recommendation_snapshot: snapshotBase,
    updated_at: new Date().toISOString(),
  };
  if (input.available_content !== undefined) payload.available_content = input.available_content;
  if (input.weekly_capacity !== undefined) payload.weekly_capacity = input.weekly_capacity;
  if (input.exclusive_campaigns !== undefined) payload.exclusive_campaigns = input.exclusive_campaigns;
  if (input.platform_content_requests !== undefined) payload.platform_content_requests = input.platform_content_requests;
  if (input.selected_platforms !== undefined) payload.selected_platforms = input.selected_platforms;
  if (input.planning_stage !== undefined) payload.planning_stage = input.planning_stage;
  if (input.is_completed !== undefined) payload.is_completed = input.is_completed;

  // campaign_id is not guaranteed unique in all environments; append-only insert is deterministic
  // because readers always consume the latest row by updated_at.
  const { error } = await supabase.from('campaign_planning_inputs').insert(payload as any);
  if (error) {
    const msg = String((error as any)?.message ?? '');
    // Fail open on transient network/Supabase connectivity issues so planning can proceed.
    if (/(fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timed out)/i.test(msg)) {
      console.warn('[campaign_planning_inputs] save failed; continuing without persistence:', msg);
      return;
    }
    throw new Error(`Failed to save campaign_planning_inputs: ${msg || 'Unknown error'}`);
  }
}

