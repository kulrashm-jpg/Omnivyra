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

const buildPlatformClicks = (clickRows: any[]) => {
  const platformClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      platformClicks[platform] = (platformClicks[platform] || 0) + 1;
    }
  });
  return platformClicks;
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
  const platformClicks = buildPlatformClicks(clickRows || []);
  const contentTypeClicks = buildContentTypeClicks(clickRows || []);
  const totalClicks = Object.values(platformClicks).reduce((sum, value) => sum + value, 0);
  const conversions =
    toNumber(metrics.conversions) ??
    toNumber(metrics.leads) ??
    toNumber(performance.conversions) ??
    toNumber(performance.leads) ??
    0;
  const avgClickToInquiry =
    totalClicks > 0 ? Number(((conversions / totalClicks) * 100).toFixed(2)) : 0;

  const platformEntries = Object.entries(platformClicks);
  const top_converting_platforms = platformEntries
    .map(([platform, clicks]) => {
      const clickShare = totalClicks > 0 ? (clicks / totalClicks) * 100 : 0;
      const signalStrength = Math.min(
        100,
        Math.round(clickShare + (typeof enhancementRow?.confidence_score === 'number' ? enhancementRow.confidence_score : 0))
      );
      const recommendation =
        clickShare >= 40 ? 'increase' : clickShare >= 20 ? 'maintain' : 'reduce';
      return {
        platform,
        conversion_signal_strength: signalStrength,
        avg_click_to_inquiry_ratio: avgClickToInquiry,
        recommendation,
      };
    })
    .sort((a, b) => b.conversion_signal_strength - a.conversion_signal_strength)
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

  const high_intent_themes = (themeEntries || [])
    .map((entry: any) => {
      const inboundSignal =
        toNumber(entry.inbound_signal_score) ??
        toNumber(entry.intent_score) ??
        toNumber(entry.conversion_signal) ??
        null;
      const bestPlatforms =
        Array.isArray(entry.best_platforms) && entry.best_platforms.length > 0
          ? entry.best_platforms
          : Object.keys(platformClicks)
              .sort((a, b) => (platformClicks[b] || 0) - (platformClicks[a] || 0))
              .slice(0, 3);
      return {
        theme_name: entry.theme_name || entry.theme || 'Theme',
        inbound_signal_score: inboundSignal ?? 0,
        best_platforms: bestPlatforms,
      };
    })
    .sort((a, b) => (b.inbound_signal_score ?? 0) - (a.inbound_signal_score ?? 0))
    .slice(0, 5);

  const weak_conversion_areas = Object.entries(contentTypeClicks)
    .map(([theme, clicks]) => ({
      platform: top_converting_platforms[0]?.platform || 'mixed',
      theme_name: theme,
      issue_summary: clicks <= 3 ? 'Low inbound response; refresh angle or CTA.' : 'Monitor and test variants.',
    }))
    .slice(0, 4);

  return res.status(200).json({
    top_converting_platforms,
    high_intent_themes,
    weak_conversion_areas,
  });
}
