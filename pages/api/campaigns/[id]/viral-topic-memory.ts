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

const extractContentType = (utmContent?: string | null) => {
  if (!utmContent) return null;
  const raw = String(utmContent);
  const [prefix] = raw.split('_');
  return prefix ? prefix.toLowerCase() : null;
};

const toNumber = (value: any) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const buildContentTypeClicks = (clickRows: any[]) => {
  const contentTypeClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      contentTypeClicks[contentType] = (contentTypeClicks[contentType] || 0) + 1;
    }
  });
  return contentTypeClicks;
};

const normalizeTrend = (value: any) => String(value || 'stable').toLowerCase();

const recommendReuseFrequency = (trend: string, engagement: number | null) => {
  if (['up', 'rising', 'improving', 'surging'].includes(trend)) {
    return '2-3x per month';
  }
  if (engagement !== null && engagement >= 60) {
    return '2x per month';
  }
  if (['stable', 'flat', 'steady'].includes(trend)) {
    return '1-2x per month';
  }
  return 'Refresh before reuse';
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

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lookbackWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: clickRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', lookbackWindow)
    .filter('metadata->>campaign_id', 'eq', id);

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const themePerformance =
    metrics.theme_performance ||
    metrics.topic_clusters ||
    performance.theme_performance ||
    performance.topic_clusters ||
    {};
  const themeEntries = Array.isArray(themePerformance)
    ? themePerformance
    : Object.entries(themePerformance).map(([theme, value]) => ({
        theme_name: theme,
        ...((value && typeof value === 'object') ? value : {}),
      }));

  const momentumAccuracy =
    normalizeObject(metrics.momentum_accuracy || performance.momentum_accuracy) ||
    (typeof enhancementRow?.confidence_score === 'number'
      ? { overall_confidence: enhancementRow.confidence_score }
      : {});

  const contentTypeClicks = buildContentTypeClicks(clickRows || []);
  const high_performing_clusters = (themeEntries || [])
    .map((entry: any) => {
      const trend = normalizeTrend(entry.performance_trend || entry.trend || entry.performance);
      const avgEngagement =
        toNumber(entry.avg_engagement) ??
        toNumber(entry.engagement_rate) ??
        toNumber(entry.engagement) ??
        null;
      const avgClicks =
        toNumber(entry.avg_clicks) ??
        toNumber(entry.clicks) ??
        toNumber(contentTypeClicks[String(entry.theme_name || '').toLowerCase()]) ??
        null;
      const repeatSuccessRate =
        toNumber(entry.repeat_success_rate) ??
        toNumber(entry.success_rate) ??
        (typeof momentumAccuracy?.overall_confidence === 'number'
          ? Math.round(momentumAccuracy.overall_confidence) / 100
          : null);
      return {
        theme_name: entry.theme_name || entry.theme || 'Theme',
        performance_trend: trend,
        avg_engagement: avgEngagement,
        avg_clicks: avgClicks,
        repeat_success_rate: repeatSuccessRate,
        recommended_reuse_frequency: recommendReuseFrequency(trend, avgEngagement),
      };
    })
    .filter((entry: any) => entry.performance_trend !== 'down')
    .slice(0, 6);

  const declining_clusters = (themeEntries || [])
    .map((entry: any) => {
      const trend = normalizeTrend(entry.performance_trend || entry.trend || entry.performance);
      return {
        theme_name: entry.theme_name || entry.theme || 'Theme',
        performance_trend: trend,
        suggested_action:
          trend === 'down'
            ? 'Refresh creative angle or pause short-term.'
            : 'Monitor and refine positioning.',
      };
    })
    .filter((entry: any) => entry.performance_trend === 'down')
    .slice(0, 6);

  return res.status(200).json({
    high_performing_clusters,
    declining_clusters,
  });
}
