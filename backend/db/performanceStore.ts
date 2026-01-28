import { supabase } from './supabaseClient';

export async function upsertPerformanceMetric(input: {
  contentAssetId: string;
  platform: string;
  campaignId?: string;
  weekNumber?: number;
  day?: string;
  metrics: any;
  capturedAt: string;
}): Promise<void> {
  const payload = {
    content_asset_id: input.contentAssetId,
    platform: input.platform,
    campaign_id: input.campaignId ?? null,
    week_number: input.weekNumber ?? null,
    day: input.day ?? null,
    metrics_json: input.metrics,
    captured_at: input.capturedAt,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('content_performance_metrics')
    .upsert(payload, { onConflict: 'content_asset_id,platform,captured_at' });
  if (error) {
    throw new Error(`Failed to ingest performance metrics: ${error.message}`);
  }
}

export async function listPerformanceMetrics(input: {
  campaignId?: string;
  contentAssetId?: string;
}): Promise<any[]> {
  let query = supabase.from('content_performance_metrics').select('*');
  if (input.campaignId) {
    query = query.eq('campaign_id', input.campaignId);
  }
  if (input.contentAssetId) {
    query = query.eq('content_asset_id', input.contentAssetId);
  }
  const { data, error } = await query.order('captured_at', { ascending: false });
  if (error || !data) return [];
  return data;
}

export async function saveAnalyticsReport(input: {
  companyId: string;
  campaignId?: string;
  report: any;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    report_json: input.report,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('analytics_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save analytics report: ${error.message}`);
  }
}

export async function saveLearningInsights(input: {
  companyId: string;
  campaignId?: string;
  insights: any;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId ?? null,
    insights_json: input.insights,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('learning_insights').insert(payload);
  if (error) {
    throw new Error(`Failed to save learning insights: ${error.message}`);
  }
}

export async function getLatestAnalyticsReport(companyId: string, campaignId?: string): Promise<any | null> {
  let query = supabase.from('analytics_reports').select('*').eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).single();
  if (error) return null;
  return data;
}

export async function getLatestLearningInsights(companyId: string, campaignId?: string): Promise<any | null> {
  let query = supabase.from('learning_insights').select('*').eq('company_id', companyId);
  if (campaignId) {
    query = query.eq('campaign_id', campaignId);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).single();
  if (error) return null;
  return data;
}
