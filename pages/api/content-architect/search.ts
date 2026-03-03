import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { isContentArchitectSession } from '../../../backend/services/contentArchitectService';

/**
 * GET /api/content-architect/search?q=
 * Content Architect only. Search companies (by ID, name, or URL), campaigns, and recommendations.
 * Every company is identified by company_id and can be accessed by ID, name, or website URL.
 * Returns { companies, campaigns, recommendations } so Content Architect can open by ID.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isContentArchitectSession(req)) {
    return res.status(403).json({ error: 'CONTENT_ARCHITECT_ONLY' });
  }

  const q = (req.query.q as string || '').trim();
  if (!q) {
    return res.status(200).json({ companies: [], campaigns: [], recommendations: [] });
  }

  const qLower = q.toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  try {
    const [companiesRes, campaignsRes, recommendationsRes] = await Promise.all([
      searchCompanies(supabase, q, qLower, limit, looksLikeUuid),
      searchCampaigns(supabase, q, qLower, limit, looksLikeUuid),
      searchRecommendations(supabase, q, limit, looksLikeUuid),
    ]);

    return res.status(200).json({
      companies: companiesRes,
      campaigns: campaignsRes,
      recommendations: recommendationsRes,
    });
  } catch (error: unknown) {
    console.error('Content architect search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
}

async function searchCompanies(
  supabaseClient: any,
  q: string,
  _qLower: string,
  limit: number,
  exactId?: boolean
): Promise<{ company_id: string; name: string }[]> {
  const seen = new Set<string>();
  const merged: { company_id: string; name: string }[] = [];

  const add = (company_id: string, name: string | null) => {
    const id = (company_id || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push({ company_id: id, name: name || id });
    }
  };

  if (exactId) {
    const { data: exactProfile } = await supabaseClient
      .from('company_profiles')
      .select('company_id, name')
      .eq('company_id', q)
      .limit(1)
      .maybeSingle();
    if (exactProfile) add(exactProfile.company_id, exactProfile.name ?? null);
    const { data: exactCompany } = await supabaseClient
      .from('companies')
      .select('id, name')
      .eq('id', q)
      .limit(1)
      .maybeSingle();
    if (exactCompany) add(String(exactCompany.id), (exactCompany as { name?: string }).name ?? null);
  }

  // 1. company_profiles: by company_id, name, or website_url (URL)
  const { data: byId } = await supabaseClient
    .from('company_profiles')
    .select('company_id, name')
    .ilike('company_id', `%${q}%`)
    .limit(limit);
  (byId || []).forEach((row: { company_id: string; name?: string }) => add(row.company_id, row.name ?? null));

  const { data: byName } = await supabaseClient
    .from('company_profiles')
    .select('company_id, name')
    .ilike('name', `%${q}%`)
    .limit(limit);
  (byName || []).forEach((row: { company_id: string; name?: string }) => add(row.company_id, row.name ?? null));

  const { data: byUrl } = await supabaseClient
    .from('company_profiles')
    .select('company_id, name')
    .ilike('website_url', `%${q}%`)
    .limit(limit);
  (byUrl || []).forEach((row: { company_id: string; name?: string }) => add(row.company_id, row.name ?? null));

  // 2. companies table (if present): by id, name, or website — every company has id; search by ID, name, or URL
  try {
    const { data: byCompaniesId } = await supabaseClient
      .from('companies')
      .select('id, name')
      .ilike('id', `%${q}%`)
      .limit(limit);
    (byCompaniesId || []).forEach((row: { id: string; name?: string }) => add(String(row.id), row.name ?? null));

    const { data: byCompaniesName } = await supabaseClient
      .from('companies')
      .select('id, name')
      .ilike('name', `%${q}%`)
      .limit(limit);
    (byCompaniesName || []).forEach((row: { id: string; name?: string }) => add(String(row.id), row.name ?? null));

    const { data: byCompaniesWebsite } = await supabaseClient
      .from('companies')
      .select('id, name')
      .ilike('website', `%${q}%`)
      .limit(limit);
    (byCompaniesWebsite || []).forEach((row: { id: string; name?: string }) => add(String(row.id), row.name ?? null));
  } catch {
    // companies table may not exist or have different schema; company_profiles is the main source
  }

  return merged.slice(0, limit);
}

async function searchCampaigns(
  supabaseClient: any,
  q: string,
  _qLower: string,
  limit: number,
  exactId?: boolean
): Promise<{ id: string; name: string; company_id: string }[]> {
  let campaigns: { id: string; name?: string }[] = [];
  if (exactId) {
    const { data: exact } = await supabaseClient
      .from('campaigns')
      .select('id, name')
      .eq('id', q)
      .limit(1)
      .maybeSingle();
    if (exact) campaigns = [exact];
  }
  if (campaigns.length === 0) {
    const { data: byIdCampaigns } = await supabaseClient
      .from('campaigns')
      .select('id, name')
      .ilike('id', `%${q}%`)
      .limit(limit);
    const { data: byNameCampaigns } = await supabaseClient
    .from('campaigns')
    .select('id, name')
    .ilike('name', `%${q}%`)
    .limit(limit);
    campaigns = [...(byIdCampaigns || []), ...(byNameCampaigns || [])];
  }
  const campaignIds = Array.from(new Set(campaigns.map((c) => c.id).filter(Boolean)));

  if (campaignIds.length === 0) {
    return [];
  }

  const { data: versions } = await supabaseClient
    .from('campaign_versions')
    .select('campaign_id, company_id')
    .in('campaign_id', campaignIds);

  const companyByCampaign = new Map<string, string>();
  (versions || []).forEach((v: { campaign_id: string; company_id: string }) => {
    if (v.campaign_id && v.company_id) companyByCampaign.set(v.campaign_id, v.company_id);
  });

  const results: { id: string; name: string; company_id: string }[] = [];
  const seenCampaign = new Set<string>();
  for (const c of campaigns.slice(0, limit)) {
    if (!c.id || seenCampaign.has(c.id)) continue;
    seenCampaign.add(c.id);
    results.push({
      id: c.id,
      name: c.name || `Campaign ${c.id.substring(0, 8)}`,
      company_id: companyByCampaign.get(c.id) || '',
    });
  }
  return results;
}

async function searchRecommendations(
  supabaseClient: any,
  q: string,
  limit: number,
  exactId?: boolean
): Promise<{ id: string; campaign_id: string | null; company_id: string; trend_topic: string }[]> {
  let byIdList: { id: string; company_id?: string; campaign_id?: string; trend_topic?: string }[] = [];
  if (exactId) {
    const { data: exact } = await supabaseClient
      .from('recommendation_snapshots')
      .select('id, company_id, campaign_id, trend_topic')
      .eq('id', q)
      .limit(1)
      .maybeSingle();
    if (exact) byIdList = [exact];
  }
  if (byIdList.length === 0) {
    const { data: byIdData } = await supabaseClient
      .from('recommendation_snapshots')
      .select('id, company_id, campaign_id, trend_topic')
      .ilike('id', `%${q}%`)
      .limit(limit);
    byIdList = byIdData ?? [];
  }

  const { data: byTopicData } = await supabaseClient
    .from('recommendation_snapshots')
    .select('id, company_id, campaign_id, trend_topic')
    .ilike('trend_topic', `%${q}%`)
    .limit(limit);
  const byTopicList = byTopicData ?? [];

  const seen = new Set<string>();
  const merged: { id: string; campaign_id: string | null; company_id: string; trend_topic: string }[] = [];
  for (const row of [...byIdList, ...byTopicList]) {
    const id = row?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push({
        id,
        campaign_id: row.campaign_id ?? null,
        company_id: row.company_id ?? '',
        trend_topic: row.trend_topic ?? '',
      });
    }
  }
  return merged.slice(0, limit);
}
