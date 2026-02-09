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

const pickNumber = (sources: any[], keys: string[]) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = (source as any)[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return null;
};

const pickObject = (sources: any[], keys: string[]) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = (source as any)[key];
      if (value && typeof value === 'object') {
        return value;
      }
    }
  }
  return {};
};

const buildDeltaPct = (predicted: number | null, actual: number | null) => {
  if (typeof predicted !== 'number' || predicted === 0 || typeof actual !== 'number') {
    return null;
  }
  return Number((((actual - predicted) / predicted) * 100).toFixed(2));
};

const extractContentType = (utmContent?: string | null) => {
  if (!utmContent) return null;
  const raw = String(utmContent);
  const [prefix] = raw.split('_');
  return prefix ? prefix.toLowerCase() : null;
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
  const sources = [performance, metrics];

  const predicted = {
    reach: pickNumber(sources, ['predicted_reach', 'forecast_reach', 'expected_reach', 'reach_forecast']),
    engagement: pickNumber(sources, [
      'predicted_engagement',
      'forecast_engagement',
      'expected_engagement',
      'engagement_forecast',
    ]),
    leads: pickNumber(sources, ['predicted_leads', 'forecast_leads', 'expected_leads', 'leads_forecast']),
    revenue: pickNumber(sources, ['predicted_revenue', 'forecast_revenue', 'expected_revenue', 'revenue_forecast']),
  };

  const actualReach = pickNumber(sources, ['actual_reach', 'reach', 'reach_actual']);
  const actualLeads = pickNumber(sources, ['actual_leads', 'leads', 'qualified_leads', 'conversions']);
  const actualRevenue = pickNumber(sources, ['actual_revenue', 'revenue', 'total_revenue']);

  const platformClicks: Record<string, number> = {};
  const contentTypeClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      platformClicks[platform] = (platformClicks[platform] || 0) + 1;
    }
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      contentTypeClicks[contentType] = (contentTypeClicks[contentType] || 0) + 1;
    }
  });
  const totalClicks = Object.values(platformClicks).reduce((sum, value) => sum + value, 0);
  const platformAccuracy = Object.entries(platformClicks).reduce<Record<string, any>>(
    (acc, [platform, clicks]) => {
      acc[platform] = {
        clicks,
        share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
      };
      return acc;
    },
    {}
  );
  const contentTypeAccuracy = Object.entries(contentTypeClicks).reduce<Record<string, any>>(
    (acc, [contentType, clicks]) => {
      acc[contentType] = {
        clicks,
        share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
      };
      return acc;
    },
    {}
  );

  const momentumAccuracy =
    pickObject(sources, ['momentum_accuracy', 'momentum_insights']) ||
    (typeof enhancementRow?.confidence_score === 'number'
      ? { overall_confidence: enhancementRow.confidence_score }
      : {});

  const actual = {
    clicks: totalClicks,
    sessions: pickNumber(sources, ['sessions', 'actual_sessions', 'web_sessions']),
    conversions: pickNumber(sources, ['conversions', 'actual_conversions', 'leads', 'qualified_leads']),
    revenue: actualRevenue,
  };

  return res.status(200).json({
    predicted,
    actual,
    variance: {
      reach_delta_pct: buildDeltaPct(predicted.reach, actualReach),
      lead_delta_pct: buildDeltaPct(predicted.leads, actualLeads),
      revenue_delta_pct: buildDeltaPct(predicted.revenue, actualRevenue),
    },
    learning_signals: {
      platform_accuracy: platformAccuracy,
      content_type_accuracy: contentTypeAccuracy,
      momentum_accuracy: momentumAccuracy,
    },
  });
}
