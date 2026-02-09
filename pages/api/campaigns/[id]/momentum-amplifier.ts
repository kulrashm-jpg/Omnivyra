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

const extractContentType = (utmContent?: string | null) => {
  if (!utmContent) return null;
  const raw = String(utmContent);
  const [prefix] = raw.split('_');
  return prefix ? prefix.toLowerCase() : null;
};

const computeUrgencyFromRatio = (ratio: number) => {
  if (ratio >= 2.5) return 'Act Immediately';
  if (ratio >= 1.8) return 'Act This Week';
  if (ratio >= 1.2) return 'Test Expansion';
  return 'Monitor';
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

  const baselineStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const baselineEnd = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const currentStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const currentEnd = new Date().toISOString();
  const { data: baselineRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', baselineStart)
    .lte('created_at', baselineEnd)
    .filter('metadata->>campaign_id', 'eq', id);
  const { data: currentRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', currentStart)
    .lte('created_at', currentEnd)
    .filter('metadata->>campaign_id', 'eq', id);

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);

  const predictedRevenue =
    toNumber(metrics.predicted_revenue) ??
    toNumber(metrics.forecast_revenue) ??
    toNumber(performance.predicted_revenue) ??
    toNumber(performance.forecast_revenue);
  const actualRevenue =
    toNumber(metrics.actual_revenue) ??
    toNumber(metrics.revenue) ??
    toNumber(performance.actual_revenue) ??
    toNumber(performance.revenue);
  const revenueDeltaPct =
    typeof predictedRevenue === 'number' && predictedRevenue !== 0 && typeof actualRevenue === 'number'
      ? ((actualRevenue - predictedRevenue) / predictedRevenue) * 100
      : null;

  const baselinePlatformClicks: Record<string, number> = {};
  const baselineContentTypeClicks: Record<string, number> = {};
  (baselineRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      baselinePlatformClicks[platform] = (baselinePlatformClicks[platform] || 0) + 1;
    }
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      baselineContentTypeClicks[contentType] = (baselineContentTypeClicks[contentType] || 0) + 1;
    }
  });
  const currentPlatformClicks: Record<string, number> = {};
  const currentContentTypeClicks: Record<string, number> = {};
  (currentRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      currentPlatformClicks[platform] = (currentPlatformClicks[platform] || 0) + 1;
    }
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      currentContentTypeClicks[contentType] = (currentContentTypeClicks[contentType] || 0) + 1;
    }
  });
  const totalClicks = Object.values(currentPlatformClicks).reduce((sum, value) => sum + value, 0);

  const scale_platforms = Object.entries(currentPlatformClicks)
    .map(([platform, clicks]) => ({
      platform,
      scale_factor: totalClicks > 0 ? Number((clicks / totalClicks).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.scale_factor - a.scale_factor)
    .slice(0, 5);

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

  const viralMemoryThemes = new Set(
    (themeEntries || [])
      .filter((entry: any) => {
        const trend = String(entry.performance_trend || entry.trend || entry.performance || 'stable')
          .toLowerCase();
        const repeatSuccess = toNumber(entry.repeat_success_rate) ?? toNumber(entry.success_rate) ?? 0;
        return trend !== 'down' && repeatSuccess >= 0.4;
      })
      .map((entry: any) => String(entry.theme_name || entry.theme || '').toLowerCase())
      .filter(Boolean)
  );
  const leadIntentThemes = new Set(
    (themeEntries || [])
      .filter((entry: any) => (toNumber(entry.inbound_signal_score) ?? toNumber(entry.intent_score) ?? 0) >= 0.6)
      .map((entry: any) => String(entry.theme_name || entry.theme || '').toLowerCase())
      .filter(Boolean)
  );

  const accelerating_topics = (themeEntries || [])
    .map((entry: any) => {
      const themeName = entry.theme_name || entry.theme || 'Theme';
      const themeKey = String(themeName).toLowerCase();
      const baselineClicks = toNumber(baselineContentTypeClicks[themeKey]) ?? 0;
      const currentClicks = toNumber(currentContentTypeClicks[themeKey]) ?? 0;
      const momentumRatio = currentClicks / Math.max(baselineClicks, 1);
      const themePerformance =
        toNumber(entry.repeat_success_rate) ??
        toNumber(entry.success_rate) ??
        (viralMemoryThemes.has(themeKey) ? 0.6 : 0.3);
      const intentSignal = leadIntentThemes.has(themeKey) ? 0.8 : 0.3;
      const momentumScore = Number(
        (momentumRatio * 0.5 + intentSignal * 0.25 + themePerformance * 0.25).toFixed(3)
      );
      const actions =
        momentumRatio >= 2.5
          ? [
              'Increase frequency on top performing platform',
              'Cross-post to secondary platform',
              'Convert to campaign if not active',
              'Boost budget allocation',
            ]
          : momentumRatio >= 1.8
          ? [
              'Increase frequency on top performing platform',
              'Cross-post to secondary platform',
              'Convert to campaign if not active',
            ]
          : momentumRatio >= 1.2
          ? ['Cross-post to secondary platform']
          : ['Monitor and test variants'];
      const accelerationStrength = (currentClicks - baselineClicks) / Math.max(baselineClicks, 1);
      console.debug('Momentum acceleration computed', {
        campaignId: id,
        theme_name: themeName,
        baseline_clicks: baselineClicks,
        current_clicks: currentClicks,
        momentum_ratio: momentumRatio,
      });
      const urgencyLevel = computeUrgencyFromRatio(momentumRatio);
      console.debug('Momentum action recommendation', {
        campaignId: id,
        theme_name: themeName,
        urgency_level: urgencyLevel,
        recommended_actions: actions,
      });
      return {
        theme_name: themeName,
        baseline_clicks: baselineClicks,
        current_clicks: currentClicks,
        momentum_ratio: Number(momentumRatio.toFixed(3)),
        acceleration_strength: Number(accelerationStrength.toFixed(3)),
        momentum_score: momentumScore,
        urgency_level: urgencyLevel,
        recommended_actions: actions,
      };
    })
    .sort((a, b) => b.momentum_score - a.momentum_score)
    .slice(0, 6);
  const declining_topics = (themeEntries || [])
    .map((entry: any) => {
      const themeName = entry.theme_name || entry.theme || 'Theme';
      const themeKey = String(themeName).toLowerCase();
      const baselineClicks = toNumber(baselineContentTypeClicks[themeKey]) ?? 0;
      const currentClicks = toNumber(currentContentTypeClicks[themeKey]) ?? 0;
      const decayRatio = baselineClicks / Math.max(currentClicks, 1);
      const declineSeverity = decayRatio >= 1.25 ? 'Hard' : decayRatio >= 1.1 ? 'Soft' : 'Stable';
      return {
        theme_name: themeName,
        decay_ratio: Number(decayRatio.toFixed(3)),
        decline_severity: declineSeverity === 'Stable' ? null : declineSeverity,
        suggested_action:
          decayRatio >= 1.25
            ? 'Refresh creative angle or pause short-term.'
            : decayRatio >= 1.1
            ? 'Adjust cadence and test variants.'
            : 'Monitor and test variants.',
      };
    })
    .filter((entry: any) => entry.decay_ratio >= 1.1)
    .sort((a, b) => b.decay_ratio - a.decay_ratio)
    .slice(0, 6);

  const stable_topics = (themeEntries || [])
    .map((entry: any) => {
      const themeName = entry.theme_name || entry.theme || 'Theme';
      const themeKey = String(themeName).toLowerCase();
      const baselineClicks = toNumber(baselineContentTypeClicks[themeKey]) ?? 0;
      const currentClicks = toNumber(currentContentTypeClicks[themeKey]) ?? 0;
      const momentumRatio = currentClicks / Math.max(baselineClicks, 1);
      const decayRatio = baselineClicks / Math.max(currentClicks, 1);
      const stabilityScore = Number((1 - Math.min(1, Math.abs(momentumRatio - 1))).toFixed(3));
      return {
        theme_name: themeName,
        baseline_clicks: baselineClicks,
        current_clicks: currentClicks,
        stability_score: stabilityScore,
        classification: 'Stable',
        recommended_actions: ['Monitor'],
        momentum_ratio: momentumRatio,
        decay_ratio: decayRatio,
      };
    })
    .filter(
      (entry: any) => entry.decay_ratio < 1.1 && entry.momentum_ratio < 1.2
    )
    .sort((a, b) => b.stability_score - a.stability_score)
    .slice(0, 6)
    .map(({ momentum_ratio, decay_ratio, ...rest }) => rest);
  console.debug('Stable topics surfaced', { count: stable_topics.length });

  return res.status(200).json({
    accelerating_topics,
    declining_topics,
    stable_topics,
    scale_platforms,
  });
}
