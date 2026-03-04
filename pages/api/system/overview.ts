/**
 * System overview API — super admin only. Read-only projections over existing tables.
 * No schema changes. No writes. Missing table → zeros.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

const STRATEGIST_PROCESS_TYPES = new Set([
  'generateCampaignPlan',
  'generateRecommendation',
  'optimizeWeek',
  'generateDailyPlan',
  'generateDailyDistributionPlan',
]);

export interface SystemOverviewResponse {
  range_days: number;
  system_health: {
    jobs_completed_24h: number;
    jobs_failed_24h: number;
    failure_rate_percent: number;
    avg_processing_time_ms: number | null;
    publish_success_rate_percent: number;
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  };
  ai_consumption: {
    total_tokens: number;
    total_cost: number;
    llm_calls: number;
    llm_error_rate_percent: number;
    avg_latency_ms: number | null;
    external_api_calls: number;
    automation_executions: number;
    tokens_by_model: Record<string, number>;
    tokens_by_process_type: Record<string, number>;
  };
  tenant_growth: {
    total_companies: number;
    active_companies_last_7_days: number;
    total_campaigns: number;
    active_campaigns_last_7_days: number;
    posts_published_last_7_days: number;
    strategist_usage_rate_percent: number;
  };
  top_campaigns_by_cost: Array<{
    campaign_id: string;
    campaign_name: string;
    total_tokens: number;
    total_cost: number;
    percent_of_total_cost: number;
  }>;
}

async function requireSuperAdminAccess(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

function parseRange(range: string | string[] | undefined): number {
  const r = typeof range === 'string' ? range : Array.isArray(range) ? range[0] : undefined;
  const n = parseInt(r ?? '', 10);
  return [7, 30, 90].includes(n) ? n : 7;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdminAccess(req, res))) return;

  const rangeDays = parseRange(req.query.range);
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sinceRange = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const systemHealth = {
    jobs_completed_24h: 0,
    jobs_failed_24h: 0,
    failure_rate_percent: 0,
    avg_processing_time_ms: null as number | null,
    publish_success_rate_percent: 0,
    status: 'HEALTHY' as 'HEALTHY' | 'DEGRADED' | 'CRITICAL',
  };

  const aiConsumption = {
    total_tokens: 0,
    total_cost: 0,
    llm_calls: 0,
    llm_error_rate_percent: 0,
    avg_latency_ms: null as number | null,
    external_api_calls: 0,
    automation_executions: 0,
    tokens_by_model: {} as Record<string, number>,
    tokens_by_process_type: {} as Record<string, number>,
  };

  const tenantGrowth = {
    total_companies: 0,
    active_companies_last_7_days: 0,
    total_campaigns: 0,
    active_campaigns_last_7_days: 0,
    posts_published_last_7_days: 0,
    strategist_usage_rate_percent: 0,
  };

  let topCampaignsByCost: Array<{
    campaign_id: string;
    campaign_name: string;
    total_tokens: number;
    total_cost: number;
    percent_of_total_cost: number;
  }> = [];

  try {
    // --- Queue (24h) ---
    try {
      const { data: completedRows } = await supabase
        .from('queue_jobs')
        .select('id, created_at, updated_at')
        .eq('status', 'completed')
        .gte('updated_at', since24h);
      const { data: failedRows } = await supabase
        .from('queue_jobs')
        .select('id, created_at, updated_at')
        .eq('status', 'failed')
        .gte('updated_at', since24h);

      const completed = (completedRows ?? []).length;
      const failed = (failedRows ?? []).length;
      systemHealth.jobs_completed_24h = completed;
      systemHealth.jobs_failed_24h = failed;

      const total = completed + failed;
      if (total > 0) {
        systemHealth.failure_rate_percent = Math.round((failed / total) * 10000) / 100;
        const allRows = [...(completedRows ?? []), ...(failedRows ?? [])];
        const diffs = allRows
          .map((r: { created_at?: string; updated_at?: string }) => {
            const c = r.created_at ? new Date(r.created_at).getTime() : 0;
            const u = r.updated_at ? new Date(r.updated_at).getTime() : 0;
            return u && c ? u - c : 0;
          })
          .filter((d) => d > 0);
        if (diffs.length > 0) {
          systemHealth.avg_processing_time_ms =
            Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
        }
      }

      if (systemHealth.failure_rate_percent > 15) systemHealth.status = 'CRITICAL';
      else if (systemHealth.failure_rate_percent > 5) systemHealth.status = 'DEGRADED';
    } catch (_) {
      // table missing or query failed
    }

    // --- Publish success (last 7d from scheduled_posts) ---
    try {
      const { data: publishedRows } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('status', 'published')
        .gte('published_at', since7d);
      const { data: failedPosts } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('status', 'failed')
        .gte('updated_at', since7d);
      const pub = (publishedRows ?? []).length;
      const fail = (failedPosts ?? []).length;
      const denom = pub + fail;
      systemHealth.publish_success_rate_percent =
        denom > 0 ? Math.round((pub / denom) * 10000) / 100 : 0;
    } catch (_) {}

    // --- usage_events (range window) ---
    try {
      const { data: events } = await supabase
        .from('usage_events')
        .select(
          'source_type, process_type, model_name, total_tokens, total_cost, latency_ms, error_flag'
        )
        .gte('created_at', sinceRange);

      const list = events ?? [];
      let llmTotal = 0;
      let llmErrors = 0;
      let latencySum = 0;
      let latencyCount = 0;
      const byModel: Record<string, number> = {};
      const byProcess: Record<string, number> = {};

      for (const e of list) {
        const st = (e as any).source_type;
        const pt = (e as any).process_type ?? '';
        const model = (e as any).model_name ?? 'unknown';
        const tokens = Number((e as any).total_tokens ?? 0) || 0;
        const cost = Number((e as any).total_cost ?? 0) || 0;
        const lat = (e as any).latency_ms;
        const err = (e as any).error_flag === true;

        if (st === 'llm') {
          llmTotal += 1;
          if (err) llmErrors += 1;
          aiConsumption.total_tokens += tokens;
          aiConsumption.total_cost += cost;
          if (typeof lat === 'number' && Number.isFinite(lat)) {
            latencySum += lat;
            latencyCount += 1;
          }
          byModel[model] = (byModel[model] ?? 0) + tokens;
          byProcess[pt] = (byProcess[pt] ?? 0) + tokens;
        } else if (st === 'external_api') {
          aiConsumption.external_api_calls += 1;
        } else if (st === 'automation_execution') {
          aiConsumption.automation_executions += 1;
        }
      }

      aiConsumption.llm_calls = llmTotal;
      aiConsumption.llm_error_rate_percent =
        llmTotal > 0 ? Math.round((llmErrors / llmTotal) * 10000) / 100 : 0;
      aiConsumption.avg_latency_ms =
        latencyCount > 0 ? Math.round((latencySum / latencyCount) * 100) / 100 : null;
      aiConsumption.tokens_by_model = byModel;
      aiConsumption.tokens_by_process_type = byProcess;
    } catch (_) {}

    // --- Companies ---
    try {
      const { data: companyRows } = await supabase.from('companies').select('id');
      tenantGrowth.total_companies = (companyRows ?? []).length;
    } catch (_) {}

    // Active companies: usage_events (last 7d) OR published posts (last 7d) via campaign_versions
    try {
      const { data: usageOrgs } = await supabase
        .from('usage_events')
        .select('organization_id')
        .gte('created_at', since7d);
      const activeOrgIds = new Set<string>(
        (usageOrgs ?? []).map((r: any) => String(r.organization_id))
      );

      const { data: publishedPosts } = await supabase
        .from('scheduled_posts')
        .select('campaign_id')
        .eq('status', 'published')
        .gte('published_at', since7d)
        .not('campaign_id', 'is', null);
      const campaignIds = [...new Set((publishedPosts ?? []).map((p: any) => p.campaign_id).filter(Boolean))];
      if (campaignIds.length > 0) {
        const { data: cvRows } = await supabase
          .from('campaign_versions')
          .select('company_id')
          .in('campaign_id', campaignIds);
        (cvRows ?? []).forEach((r: any) => {
          const cid = r.company_id ? String(r.company_id).trim() : '';
          if (cid) activeOrgIds.add(cid);
        });
      }
      tenantGrowth.active_companies_last_7_days = activeOrgIds.size;
    } catch (_) {}

    // --- Campaigns ---
    try {
      const { data: campaignRows } = await supabase.from('campaigns').select('id');
      tenantGrowth.total_campaigns = (campaignRows ?? []).length;
    } catch (_) {}

    // Active campaigns (posts updated/published in last 7d)
    try {
      const { data: activeCampaignRows } = await supabase
        .from('scheduled_posts')
        .select('campaign_id')
        .not('campaign_id', 'is', null)
        .or(`published_at.gte.${since7d},updated_at.gte.${since7d}`);
      const activeCampaignIds = new Set(
        (activeCampaignRows ?? []).map((r: any) => r.campaign_id).filter(Boolean)
      );
      tenantGrowth.active_campaigns_last_7_days = activeCampaignIds.size;
    } catch (_) {}

    // Posts published last 7d
    try {
      const { data: pubRows } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('status', 'published')
        .gte('published_at', since7d);
      tenantGrowth.posts_published_last_7_days = (pubRows ?? []).length;
    } catch (_) {}

    // Strategist usage: distinct orgs with strategist process_type in range / total_companies * 100
    try {
      const { data: strategistEvents } = await supabase
        .from('usage_events')
        .select('organization_id, process_type')
        .eq('source_type', 'llm')
        .gte('created_at', sinceRange);
      const strategistOrgs = new Set<string>();
      (strategistEvents ?? []).forEach((e: any) => {
        if (STRATEGIST_PROCESS_TYPES.has(String(e.process_type ?? ''))) {
          strategistOrgs.add(String(e.organization_id));
        }
      });
      const totalCompanies = tenantGrowth.total_companies || 1;
      tenantGrowth.strategist_usage_rate_percent =
        Math.round((strategistOrgs.size / totalCompanies) * 10000) / 100;
    } catch (_) {}

    // Top 5 campaigns by AI cost (LLM, campaign_id not null, range window)
    try {
      const { data: campaignEvents } = await supabase
        .from('usage_events')
        .select('campaign_id, total_tokens, total_cost')
        .eq('source_type', 'llm')
        .not('campaign_id', 'is', null)
        .gte('created_at', sinceRange);

      const byCampaign: Record<string, { total_tokens: number; total_cost: number }> = {};
      (campaignEvents ?? []).forEach((e: any) => {
        const cid = e?.campaign_id ? String(e.campaign_id).trim() : '';
        if (!cid) return;
        if (!byCampaign[cid]) byCampaign[cid] = { total_tokens: 0, total_cost: 0 };
        byCampaign[cid].total_tokens += Number(e?.total_tokens ?? 0) || 0;
        byCampaign[cid].total_cost += Number(e?.total_cost ?? 0) || 0;
      });

      const sorted = Object.entries(byCampaign)
        .map(([campaign_id, agg]) => ({ campaign_id, ...agg }))
        .sort((a, b) => b.total_cost - a.total_cost)
        .slice(0, 5);

      if (sorted.length > 0) {
        const campaignIds = sorted.map((s) => s.campaign_id);
        const { data: campaignRows } = await supabase
          .from('campaigns')
          .select('id, name')
          .in('id', campaignIds);
        const nameById: Record<string, string> = {};
        (campaignRows ?? []).forEach((r: any) => {
          const id = r?.id ? String(r.id) : '';
          if (id) nameById[id] = (r?.name ?? 'Unknown').trim() || 'Unknown';
        });
        const totalCost = aiConsumption.total_cost || 1;
        topCampaignsByCost = sorted.map((s) => ({
          campaign_id: s.campaign_id,
          campaign_name: nameById[s.campaign_id] ?? s.campaign_id.slice(0, 8),
          total_tokens: s.total_tokens,
          total_cost: s.total_cost,
          percent_of_total_cost: Math.round((s.total_cost / totalCost) * 10000) / 100,
        }));
      }
    } catch (_) {
      // table missing or query failed → keep empty array
    }

  } catch (err) {
    console.error('[system/overview]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const body: SystemOverviewResponse = {
    range_days: rangeDays,
    system_health: systemHealth,
    ai_consumption: aiConsumption,
    tenant_growth: tenantGrowth,
    top_campaigns_by_cost: topCampaignsByCost,
  };

  return res.status(200).json(body);
}
