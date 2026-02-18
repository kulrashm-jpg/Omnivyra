import { supabase } from './supabaseClient';

export async function saveCampaignVersion(input: {
  companyId: string;
  campaignId?: string;
  campaignSnapshot: any;
  status?: string;
  version?: number;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    campaign_snapshot: input.campaignSnapshot,
    status: input.status ?? 'draft',
    version: input.version ?? 1,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('campaign_versions').insert(payload);
  if (error) {
    throw new Error(`Failed to save campaign version: ${error.message}`);
  }
}

export async function saveWeekVersions(input: {
  companyId: string;
  campaignId?: string;
  weeks: Array<{ week_number: number; version?: number; [key: string]: any }>;
}): Promise<void> {
  if (!input.weeks || input.weeks.length === 0) return;
  console.warn('DEPRECATED: week_versions write path triggered');
  const payload = input.weeks.map((week) => ({
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    week_number: week.week_number,
    week_snapshot: week,
    version: week.version ?? 1,
    created_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('week_versions').insert(payload);
  if (error) {
    throw new Error(`Failed to save week versions: ${error.message}`);
  }
}

export async function saveOptimizationHistory(input: {
  companyId: string;
  campaignId?: string;
  weekNumber: number;
  proposal: any;
  status?: string;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    week_number: input.weekNumber,
    proposal: input.proposal,
    status: input.status ?? 'proposal',
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('optimization_history').insert(payload);
  if (error) {
    throw new Error(`Failed to save optimization history: ${error.message}`);
  }
}

export async function saveTrendSnapshot(input: {
  companyId: string;
  campaignId?: string;
  snapshot: any;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    snapshot: input.snapshot,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('trend_snapshots').insert(payload);
  if (error) {
    throw new Error(`Failed to save trend snapshot: ${error.message}`);
  }
}

export async function getLatestCampaignVersion(
  companyId: string,
  campaignId?: string
): Promise<any | null> {
  let query = supabase
    .from('campaign_versions')
    .select('*')
    .eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).single();
  if (error) {
    return null;
  }
  return data;
}

/** Get latest campaign_versions row by campaign_id (resolves company_id from mapping). */
export async function getLatestCampaignVersionByCampaignId(
  campaignId: string
): Promise<{
  company_id: string;
  build_mode: string | null;
  context_scope: string[] | null;
  campaign_types: string[];
  campaign_weights: Record<string, number>;
  campaign_snapshot?: any;
  company_stage?: string | null;
  market_scope?: string | null;
  baseline_override?: Record<string, unknown> | null;
} | null> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id, build_mode, context_scope, campaign_types, campaign_weights, campaign_snapshot, company_stage, market_scope, baseline_override')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.company_id) return null;

  const {
    build_mode,
    context_scope,
    campaign_types,
    campaign_weights,
    campaign_snapshot,
    company_stage,
    market_scope,
    baseline_override,
  } = data;

  const types = Array.isArray(campaign_types)
    ? campaign_types.filter((t) => typeof t === 'string')
    : [];
  const weights =
    campaign_weights && typeof campaign_weights === 'object'
      ? (campaign_weights as Record<string, number>)
      : {};
  const scope = Array.isArray(context_scope)
    ? context_scope.filter((s) => typeof s === 'string')
    : null;

  return {
    company_id: String(data.company_id),
    build_mode: build_mode ?? null,
    context_scope: scope && scope.length > 0 ? scope : null,
    campaign_types: types.length > 0 ? types : ['brand_awareness'],
    campaign_weights:
      Object.keys(weights).length > 0 ? weights : { brand_awareness: 100 },
    campaign_snapshot,
    company_stage: company_stage ?? null,
    market_scope: market_scope ?? null,
    baseline_override: baseline_override && typeof baseline_override === 'object' ? baseline_override : null,
  };
}

export async function getWeekVersions(companyId: string, campaignId?: string): Promise<any[]> {
  let query = supabase.from('week_versions').select('*').eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('week_number', { ascending: true });
  if (error || !data) return [];
  return data;
}

export async function getOptimizationHistory(
  companyId: string,
  campaignId?: string
): Promise<any[]> {
  let query = supabase.from('optimization_history').select('*').eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error || !data) return [];
  return data;
}

export async function getTrendSnapshots(companyId: string, campaignId?: string): Promise<any[]> {
  let query = supabase.from('trend_snapshots').select('*').eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error || !data) return [];
  return data;
}

/** Sync campaign_versions status when campaigns.current_stage changes. Call after updating campaigns. */
export async function syncCampaignVersionStage(
  campaignId: string,
  newStage: string,
  companyId?: string | null
): Promise<void> {
  try {
    let query = supabase
      .from('campaign_versions')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data: rows, error: fetchError } = await query;
    if (fetchError || !rows?.length) return;
    const ids = rows.map((r: { id: string }) => r.id);
    await supabase
      .from('campaign_versions')
      .update({ status: newStage })
      .in('id', ids);
  } catch (e) {
    console.warn('syncCampaignVersionStage failed:', e);
  }
}

export async function saveCampaignHealthReport(input: {
  companyId: string;
  campaignId?: string;
  status: string;
  confidence: number;
  issues: any[];
  scores: Record<string, number>;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    status: input.status,
    confidence: input.confidence,
    issues: input.issues,
    scores: input.scores,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('campaign_health_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save campaign health report: ${error.message}`);
  }
}
