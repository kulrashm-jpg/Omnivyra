import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { supabase } from '../db/supabaseClient';
import { hashKey, safeNumber, todayIsoDate } from './ingestionUtils';

export interface AdsCampaignRow {
  externalCampaignKey?: string | null;
  name: string;
  platform?: string | null;
  channel?: string | null;
  budget?: number | string | null;
  spend?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  conversions?: number | string | null;
  revenueAmount?: number | string | null;
  currencyCode?: string | null;
  metricDate?: string | null;
  status?: string | null;
}

export interface AdsIngestionInput {
  companyId: string;
  endpointUrl?: string;
  accessToken?: string;
  rows?: AdsCampaignRow[];
}

export interface AdsIngestionResult {
  source: 'ads';
  campaignsProcessed: number;
  campaignsInserted: number;
  metricsInserted: number;
}

async function loadAdsRows(input: AdsIngestionInput): Promise<AdsCampaignRow[]> {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }
  if (!input.endpointUrl || !input.accessToken) {
    return [];
  }

  const response = await axios.get(input.endpointUrl, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
    timeout: 15000,
  });

  return Array.isArray(response.data?.rows) ? response.data.rows : [];
}

async function upsertCampaign(input: {
  companyId: string;
  row: AdsCampaignRow;
  externalCampaignKey: string;
  platform: string;
  channel: string;
}): Promise<string> {
  const payload = {
    company_id: input.companyId,
    external_campaign_key: input.externalCampaignKey,
    source_platform: input.platform,
    channel: input.channel,
    name: input.row.name,
    budget: safeNumber(input.row.budget, 0),
    status: input.row.status ?? 'active',
  };

  const { data: existing, error: existingError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('external_campaign_key', input.externalCampaignKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check ads campaign ${input.row.name}: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('campaigns').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update ads campaign ${input.row.name}: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('campaigns').insert({
    id: randomUUID(),
    ...payload,
  }).select('id').single();
  if (error) {
    throw new Error(`Failed to insert ads campaign ${input.row.name}: ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function upsertCampaignMetrics(input: {
  companyId: string;
  row: AdsCampaignRow;
  campaignId: string;
  externalCampaignKey: string;
  platform: string;
  channel: string;
}): Promise<void> {
  const payload = {
    company_id: input.companyId,
    campaign_id: input.campaignId,
    external_campaign_key: input.externalCampaignKey,
    platform: input.platform,
    metric_date: input.row.metricDate ?? todayIsoDate(),
    impressions: Math.round(safeNumber(input.row.impressions, 0)),
    clicks: Math.round(safeNumber(input.row.clicks, 0)),
    conversions: Math.round(safeNumber(input.row.conversions, 0)),
    spend: safeNumber(input.row.spend, 0),
    revenue_amount: input.row.revenueAmount != null ? safeNumber(input.row.revenueAmount, 0) : null,
    currency_code: (input.row.currencyCode ?? 'USD').toUpperCase(),
    metrics_metadata: {
      channel: input.channel,
      source_status: input.row.status ?? null,
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from('campaign_metrics')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('external_campaign_key', input.externalCampaignKey)
    .eq('platform', input.platform)
    .eq('metric_date', input.row.metricDate ?? todayIsoDate())
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check ads metrics for ${input.row.name}: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('campaign_metrics').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update ads metrics for ${input.row.name}: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase.from('campaign_metrics').insert(payload);
  if (error) {
    throw new Error(`Failed to insert ads metrics for ${input.row.name}: ${error.message}`);
  }
}

export async function ingestAdsData(input: AdsIngestionInput): Promise<AdsIngestionResult> {
  const rows = await loadAdsRows(input);
  let campaignsInserted = 0;
  let metricsInserted = 0;

  for (const row of rows) {
    const externalCampaignKey =
      row.externalCampaignKey?.trim() || hashKey('ads-campaign', input.companyId, row.name, row.platform, row.metricDate);
    const platform = row.platform?.trim() || 'ads';
    const channel = row.channel?.trim() || platform;

    const campaignId = await upsertCampaign({
      companyId: input.companyId,
      row,
      externalCampaignKey,
      platform,
      channel,
    });

    await upsertCampaignMetrics({
      companyId: input.companyId,
      row,
      campaignId,
      externalCampaignKey,
      platform,
      channel,
    });

    campaignsInserted += 1;
    metricsInserted += 1;
  }

  return {
    source: 'ads',
    campaignsProcessed: rows.length,
    campaignsInserted,
    metricsInserted,
  };
}

export function buildAdsRunKey(input: AdsIngestionInput): string {
  return hashKey('ads', input.companyId, input.endpointUrl, Array.isArray(input.rows) ? input.rows.length : 'api');
}
