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

/**
 * Get campaign IDs that belong to a company (via campaign_versions).
 * Shared to avoid duplicate queries across governance, analytics, and admin services.
 */
export async function getCompanyCampaignIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);
  if (error) return [];
  return Array.from(new Set((data || []).map((r: any) => r.campaign_id).filter(Boolean)));
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
  /** Full CampaignHealthReport for UI consumption (low_confidence_activities, score_breakdown, health_flags, activity_diagnostics, etc.) */
  report_json?: Record<string, unknown> | null;
  campaign_version_id?: string | null;
  /** From CampaignHealthReport.health_score (0–100) */
  health_score?: number | null;
  /** From CampaignHealthReport.health_status (excellent|strong|moderate|weak|critical) */
  health_status?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    status: input.status,
    confidence: input.confidence,
    issues: input.issues,
    scores: input.scores,
    created_at: now,
    evaluated_at: now,
    updated_at: now,
  };
  if (input.report_json != null) payload.report_json = input.report_json;
  if (input.campaign_version_id != null) payload.campaign_version_id = input.campaign_version_id;
  if (input.health_score != null && Number.isFinite(input.health_score)) payload.health_score = Math.round(input.health_score);
  if (input.health_status != null && String(input.health_status).trim()) payload.health_status = input.health_status;
  const { error } = await supabase.from('campaign_health_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save campaign health report: ${error.message}`);
  }
  if (input.campaignId) {
    enforceHealthReportRetention(input.campaignId).catch((e) =>
      console.warn('[campaignVersionStore] enforceHealthReportRetention failed:', e)
    );
  }
}

function buildCrossPlatformSharingFromWizard(wizardState: { cross_platform_sharing_enabled?: boolean }): { enabled: boolean; mode: 'shared' | 'unique' } {
  const enabled = wizardState.cross_platform_sharing_enabled !== false;
  const mode: 'shared' | 'unique' = enabled ? 'shared' : 'unique';
  return { enabled, mode };
}

/** Update wizard_state in the latest campaign_versions snapshot. Used for draft autosave. */
export async function updateWizardStateInSnapshot(input: {
  campaignId: string;
  companyId: string;
  wizardState: {
    wizard_state_version: number;
    step: number;
    questionnaire_answers: Record<string, unknown>;
    planned_start_date: string;
    pre_planning_result: Record<string, unknown> | null;
    cross_platform_sharing_enabled?: boolean;
    updated_at: string;
  };
}): Promise<void> {
  const { data: latestVersion, error: fetchError } = await supabase
    .from('campaign_versions')
    .select('id, campaign_snapshot')
    .eq('company_id', input.companyId)
    .eq('campaign_id', input.campaignId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError || !latestVersion) {
    throw new Error('Campaign version not found');
  }

  const currentSnapshot = (latestVersion.campaign_snapshot as Record<string, unknown>) || {};
  const wizardState = input.wizardState;
  const cross_platform_sharing = buildCrossPlatformSharingFromWizard(wizardState);

  const updatedSnapshot: Record<string, unknown> = {
    ...currentSnapshot,
    wizard_state: wizardState,
    cross_platform_sharing,
  };

  const { error: updateError } = await supabase
    .from('campaign_versions')
    .update({ campaign_snapshot: updatedSnapshot })
    .eq('id', (latestVersion as { id: string }).id);

  if (updateError) {
    throw new Error(`Failed to save wizard state: ${updateError.message}`);
  }
}

const HEALTH_REPORT_RETENTION_LIMIT = 20;

async function enforceHealthReportRetention(campaignId: string): Promise<void> {
  const { data: rows, error: selError } = await supabase
    .from('campaign_health_reports')
    .select('id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });

  if (selError || !rows?.length) return;
  if (rows.length <= HEALTH_REPORT_RETENTION_LIMIT) return;

  const idsToKeep = rows.slice(0, HEALTH_REPORT_RETENTION_LIMIT).map((r) => r.id).filter(Boolean);
  const idsToDelete = rows.slice(HEALTH_REPORT_RETENTION_LIMIT).map((r) => r.id).filter(Boolean);
  if (idsToDelete.length === 0) return;

  await supabase
    .from('campaign_health_reports')
    .delete()
    .in('id', idsToDelete);
}
