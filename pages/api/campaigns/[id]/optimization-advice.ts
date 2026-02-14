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

const buildPlatformAccuracy = (clickRows: any[]) => {
  const platformClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      platformClicks[platform] = (platformClicks[platform] || 0) + 1;
    }
  });
  const totalClicks = Object.values(platformClicks).reduce((sum, value) => sum + value, 0);
  return Object.entries(platformClicks).reduce<Record<string, any>>((acc, [platform, clicks]) => {
    acc[platform] = {
      clicks,
      share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
    };
    return acc;
  }, {});
};

const buildContentTypeAccuracy = (clickRows: any[]) => {
  const contentTypeClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      contentTypeClicks[contentType] = (contentTypeClicks[contentType] || 0) + 1;
    }
  });
  const totalClicks = Object.values(contentTypeClicks).reduce((sum, value) => sum + value, 0);
  return Object.entries(contentTypeClicks).reduce<Record<string, any>>((acc, [contentType, clicks]) => {
    acc[contentType] = {
      clicks,
      share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
    };
    return acc;
  }, {});
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

  const lookbackWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: clickRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', lookbackWindow)
    .filter('metadata->>campaign_id', 'eq', id);

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const platformAccuracy = buildPlatformAccuracy(clickRows || []);
  const contentTypeAccuracy = buildContentTypeAccuracy(clickRows || []);

  const platformWeights =
    metrics.platform_weights ||
    metrics.platform_mix ||
    performance.platform_weights ||
    performance.platform_mix ||
    {};
  const platformFrequency =
    metrics.platform_frequency ||
    metrics.posts_per_week ||
    performance.platform_frequency ||
    performance.posts_per_week ||
    {};

  const platforms = Array.from(
    new Set([
      ...Object.keys(platformAccuracy || {}),
      ...Object.keys(platformWeights || {}),
      ...Object.keys(platformFrequency || {}),
    ])
  );

  const platform_reallocation = platforms.map((platform) => {
    const currentWeight = toNumber(platformWeights?.[platform]);
    const accuracyShare = toNumber(platformAccuracy?.[platform]?.share_pct);
    const recommendedWeight =
      typeof accuracyShare === 'number'
        ? accuracyShare
        : typeof currentWeight === 'number'
        ? currentWeight
        : 0;
    let reason = 'Maintain allocation based on current performance.';
    if (typeof accuracyShare === 'number' && typeof currentWeight === 'number') {
      if (accuracyShare > currentWeight + 5) {
        reason = 'Higher click share indicates stronger response.';
      } else if (accuracyShare < currentWeight - 5) {
        reason = 'Lower click share suggests reducing effort.';
      }
    } else if (typeof accuracyShare === 'number') {
      reason = 'Rebalance based on observed click distribution.';
    }
    return {
      platform,
      current_weight: typeof currentWeight === 'number' ? currentWeight : 0,
      recommended_weight: Math.max(0, Math.min(100, Number(recommendedWeight.toFixed(2)))),
      reason,
    };
  });

  const frequency_adjustment = platforms.map((platform) => {
    const currentPosts = toNumber(platformFrequency?.[platform]) ?? 0;
    const sharePct = toNumber(platformAccuracy?.[platform]?.share_pct) ?? 0;
    let recommendedPosts = currentPosts;
    if (sharePct >= 40) {
      recommendedPosts = currentPosts + 2;
    } else if (sharePct >= 25) {
      recommendedPosts = currentPosts + 1;
    } else if (sharePct <= 10 && currentPosts > 0) {
      recommendedPosts = Math.max(1, currentPosts - 1);
    }
    return {
      platform,
      current_posts_per_week: currentPosts,
      recommended_posts_per_week: recommendedPosts,
    };
  });

  const themePerformance =
    metrics.theme_performance ||
    metrics.topic_clusters ||
    performance.theme_performance ||
    performance.topic_clusters ||
    {};
  const themeEntries = Array.isArray(themePerformance)
    ? themePerformance
    : Object.entries(themePerformance).map(([theme, val]) => {
        const value = val as { trend?: string; performance_trend?: string; recommendation?: string | null } | undefined;
        return {
          theme_name: theme,
          performance_trend: value?.trend || value?.performance_trend || 'stable',
          recommendation: value?.recommendation ?? null,
        };
      });

  const topic_cluster_boost = (themeEntries || [])
    .map((entry: any) => ({
      theme_name: entry.theme_name || entry.theme || 'Theme',
      performance_trend: entry.performance_trend || entry.trend || 'stable',
      recommendation:
        entry.recommendation ||
        (entry.performance_trend === 'up'
          ? 'Boost high-performing theme cluster.'
          : 'Monitor and refine theme positioning.'),
    }))
    .slice(0, 4);

  return res.status(200).json({
    platform_reallocation,
    frequency_adjustment,
    topic_cluster_boost,
    learning_signals: {
      platform_accuracy: platformAccuracy,
      content_type_accuracy: contentTypeAccuracy,
    },
  });
}
