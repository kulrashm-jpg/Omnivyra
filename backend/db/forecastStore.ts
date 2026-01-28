import { supabase } from './supabaseClient';

export async function saveCampaignForecast(input: {
  campaignId: string;
  forecast: any;
  confidence: number;
}): Promise<void> {
  const payload = {
    campaign_id: input.campaignId,
    forecast_json: input.forecast,
    confidence: input.confidence,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('campaign_forecasts').insert(payload);
  if (error) {
    throw new Error(`Failed to save forecast: ${error.message}`);
  }
}

export async function saveRoiReport(input: {
  campaignId: string;
  roi: any;
}): Promise<void> {
  const payload = {
    campaign_id: input.campaignId,
    roi_json: input.roi,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('roi_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save ROI report: ${error.message}`);
  }
}

export async function saveBusinessReport(input: {
  campaignId: string;
  report: any;
}): Promise<void> {
  const payload = {
    campaign_id: input.campaignId,
    report_json: input.report,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('business_intelligence_reports').insert(payload);
  if (error) {
    throw new Error(`Failed to save business report: ${error.message}`);
  }
}

export async function getLatestForecast(campaignId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('campaign_forecasts')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function getLatestRoi(campaignId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('roi_reports')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function getLatestBusinessReport(campaignId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('business_intelligence_reports')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}
