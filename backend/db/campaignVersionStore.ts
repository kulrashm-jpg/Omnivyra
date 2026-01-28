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
