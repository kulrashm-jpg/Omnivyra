import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';

const normalizeObject = (value: any) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const toNumber = (value: any) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const buildPlatformClicks = (rows: any[]) => {
  const clicks: Record<string, number> = {};
  (rows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      clicks[platform] = (clicks[platform] || 0) + 1;
    }
  });
  return clicks;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = String(campaignRow.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const { data: learningRow } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const rejectionSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rejectedVersion } = await supabase
    .from('campaign_versions')
    .select('id, campaign_snapshot, created_at')
    .eq('campaign_id', id)
    .eq('status', 'rebalance_rejected')
    .gte('created_at', rejectionSince)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rejectedPlatforms = new Set(
    (rejectedVersion?.campaign_snapshot?.proposed_changes || [])
      .map((change: any) => String(change.platform || '').toLowerCase())
      .filter(Boolean)
  );

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);

  const previousStart = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const previousEnd = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const currentStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const currentEnd = new Date().toISOString();

  const { data: previousRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', previousStart)
    .lte('created_at', previousEnd)
    .filter('metadata->>campaign_id', 'eq', id);

  const { data: currentRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .gte('created_at', currentStart)
    .lte('created_at', currentEnd)
    .eq('action', 'TRACKING_LINK_CLICK')
    .filter('metadata->>campaign_id', 'eq', id);

  const previousClicks = buildPlatformClicks(previousRows || []);
  const currentClicks = buildPlatformClicks(currentRows || []);
  const totalCurrentClicks = Object.values(currentClicks).reduce((sum, value) => sum + value, 0);
  const totalPreviousClicks = Object.values(previousClicks).reduce((sum, value) => sum + value, 0);

  const conversions =
    toNumber(metrics.conversions) ??
    toNumber(metrics.leads) ??
    toNumber(performance.conversions) ??
    toNumber(performance.leads) ??
    0;
  const overallConversionRate =
    totalCurrentClicks > 0 ? conversions / totalCurrentClicks : 0;

  const forecastDelta =
    toNumber(metrics.revenue_delta_pct) ??
    toNumber(metrics.lead_delta_pct) ??
    toNumber(performance.revenue_delta_pct) ??
    toNumber(performance.lead_delta_pct) ??
    0;
  const forecastAccuracy = clamp01(1 - Math.abs(forecastDelta) / 100);

  const clusterStrength =
    Array.isArray(metrics.high_performing_clusters)
      ? clamp01(metrics.high_performing_clusters.length / 6)
      : Array.isArray(performance.high_performing_clusters)
      ? clamp01(performance.high_performing_clusters.length / 6)
      : 0.3;

  const platforms = Array.from(
    new Set([...Object.keys(previousClicks), ...Object.keys(currentClicks)])
  );

  const platform_advice = platforms.map((platform) => {
    const prev = previousClicks[platform] || 0;
    const curr = currentClicks[platform] || 0;
    const clickGrowth =
      totalPreviousClicks > 0 ? (curr - prev) / Math.max(prev, 1) : 0;
    const clickGrowthScore = clamp01((clickGrowth + 1) / 2);
    const clickShare = totalCurrentClicks > 0 ? curr / totalCurrentClicks : 0;

    const conversionWeight =
      toNumber(metrics.platform_conversion?.[platform]) ??
      toNumber(performance.platform_conversion?.[platform]) ??
      clickShare * overallConversionRate;
    const leadConversionWeight = clamp01(conversionWeight ?? 0);

    const momentumAlignment =
      curr > prev ? 0.7 : curr === prev ? 0.5 : 0.3;

    let allocationScore = Number(
      (
        clickGrowthScore * 0.3 +
        leadConversionWeight * 0.25 +
        momentumAlignment * 0.2 +
        forecastAccuracy * 0.15 +
        clusterStrength * 0.1
      ).toFixed(3)
    );
    if (rejectedVersion) {
      allocationScore = Number((allocationScore * 0.85).toFixed(3));
      if (rejectedPlatforms.has(platform)) {
        allocationScore = Number(Math.max(0, allocationScore - 0.1).toFixed(3));
      }
    }

    const recommendation =
      allocationScore >= 0.7
        ? 'Increase'
        : allocationScore >= 0.45
        ? 'Maintain'
        : 'Reduce';

    const suggestedFrequencyDelta =
      recommendation === 'Increase' ? 1 : recommendation === 'Reduce' ? -1 : 0;

    const rationale =
      recommendation === 'Increase'
        ? 'Click momentum and lead signals justify higher investment.'
        : recommendation === 'Reduce'
        ? 'Lower relative impact suggests reallocating effort.'
        : 'Balanced performance across signals.';

    return {
      platform,
      allocation_score: allocationScore,
      recommendation,
      rationale,
      suggested_frequency_delta: suggestedFrequencyDelta,
    };
  });

  const reallocation_summary = {
    increase: platform_advice.filter((item) => item.recommendation === 'Increase').map((item) => item.platform),
    maintain: platform_advice.filter((item) => item.recommendation === 'Maintain').map((item) => item.platform),
    reduce: platform_advice.filter((item) => item.recommendation === 'Reduce').map((item) => item.platform),
  };

  console.debug('Platform allocation computed', { campaignId: id });

  return res.status(200).json({
    platform_advice,
    reallocation_summary,
  });
}
