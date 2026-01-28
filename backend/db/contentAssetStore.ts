import { supabase } from './supabaseClient';

export async function createContentAsset(input: {
  campaignId: string;
  weekNumber: number;
  day: string;
  platform: string;
}): Promise<any> {
  const payload = {
    campaign_id: input.campaignId,
    week_number: input.weekNumber,
    day: input.day,
    platform: input.platform,
    status: 'draft',
    current_version: 1,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('content_assets')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to create content asset: ${error.message}`);
  }
  return data;
}

export async function getContentAssetByKey(input: {
  campaignId: string;
  weekNumber: number;
  day: string;
  platform: string;
}): Promise<any | null> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('*')
    .eq('campaign_id', input.campaignId)
    .eq('week_number', input.weekNumber)
    .eq('day', input.day)
    .eq('platform', input.platform)
    .limit(1)
    .single();
  if (error) {
    return null;
  }
  return data;
}

export async function getContentAssetById(assetId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('*')
    .eq('asset_id', assetId)
    .single();
  if (error) return null;
  return data;
}

export async function listContentAssets(input: {
  campaignId: string;
  weekNumber?: number;
}): Promise<any[]> {
  let query = supabase.from('content_assets').select('*').eq('campaign_id', input.campaignId);
  if (input.weekNumber) {
    query = query.eq('week_number', input.weekNumber);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error || !data) return [];
  return data;
}

export async function createContentVersion(input: {
  assetId: string;
  version: number;
  content: any;
  reason?: string;
}): Promise<any> {
  const payload = {
    asset_id: input.assetId,
    version: input.version,
    content_json: input.content,
    reason: input.reason ?? null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('content_asset_versions')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to create content version: ${error.message}`);
  }
  return data;
}

export async function listContentVersions(assetId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('content_asset_versions')
    .select('*')
    .eq('asset_id', assetId)
    .order('version', { ascending: true });
  if (error || !data) return [];
  return data;
}

export async function listAssetsWithLatestContent(input: {
  campaignId: string;
  weekNumber?: number;
  status?: string;
}): Promise<any[]> {
  const assets = await listContentAssets({
    campaignId: input.campaignId,
    weekNumber: input.weekNumber,
  });
  const filtered = input.status ? assets.filter((asset) => asset.status === input.status) : assets;
  const enriched = await Promise.all(
    filtered.map(async (asset) => {
      const versions = await listContentVersions(asset.asset_id);
      const latest = versions[versions.length - 1];
      return {
        ...asset,
        latest_content: latest?.content_json ?? null,
        versions,
      };
    })
  );
  return enriched;
}

export async function updateContentAssetStatus(input: {
  assetId: string;
  status: string;
  currentVersion?: number;
}): Promise<any> {
  const payload: any = { status: input.status };
  if (input.currentVersion) {
    payload.current_version = input.currentVersion;
  }
  const { data, error } = await supabase
    .from('content_assets')
    .update(payload)
    .eq('asset_id', input.assetId)
    .select('*')
    .single();
  if (error) {
    throw new Error(`Failed to update content asset: ${error.message}`);
  }
  return data;
}

export async function createContentReview(input: {
  assetId: string;
  reviewer?: string;
  status: string;
  comment?: string;
}): Promise<void> {
  const payload = {
    asset_id: input.assetId,
    reviewer: input.reviewer ?? null,
    status: input.status,
    comment: input.comment ?? null,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('content_reviews').insert(payload);
  if (error) {
    throw new Error(`Failed to create content review: ${error.message}`);
  }
}
