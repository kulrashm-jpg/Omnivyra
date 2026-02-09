import type { NextApiRequest } from 'next';
import { supabase } from '../db/supabaseClient';
import { evaluateCommunityAiForecastInsights, isOmniVyraEnabled } from './omnivyraClientV1';
import forecastHandler from '../../pages/api/community-ai/forecast';
import trendsHandler from '../../pages/api/community-ai/trends';
import contentKpisHandler from '../../pages/api/community-ai/content-kpis';

type ForecastInsightsInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  content_type?: string | null;
  brand_voice: string;
};

type ForecastInsightsOutput = {
  explanation_summary: string;
  key_drivers: any[];
  risks: any[];
  recommended_actions: any[];
  confidence_level: number;
  source: 'omnivyra' | 'placeholder';
};

const normalizeBrandVoice = (value: string) => {
  const trimmed = (value || '').toString().trim();
  return trimmed.length > 0 ? trimmed : 'professional';
};

const createMockRes = () => {
  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      jsonBody = payload;
      return res;
    },
    get data() {
      return jsonBody;
    },
    get statusCode() {
      return statusCode;
    },
  };
  return res;
};

const runHandler = async (handler: any, req: NextApiRequest) => {
  const res = createMockRes();
  await handler(req, res);
  if (res.statusCode >= 400) {
    throw new Error(res.data?.error || 'FAILED_TO_BUILD_FORECAST_INSIGHTS');
  }
  return res.data;
};

const toDateString = (date: Date) => date.toISOString().slice(0, 10);

const getRecentContentSummary = async (input: {
  organizationId: string;
  platform?: string | null;
  contentType?: string | null;
}) => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);

  let query = supabase
    .from('content_analytics')
    .select(
      'scheduled_post_id, platform, content_type, likes, comments, shares, views, date, scheduled_posts(content, users(company_id))'
    )
    .eq('scheduled_posts.users.company_id', input.organizationId)
    .gte('date', toDateString(cutoff))
    .order('date', { ascending: false })
    .limit(5);

  if (input.platform) {
    query = query.eq('platform', input.platform);
  }
  if (input.contentType) {
    query = query.eq('content_type', input.contentType);
  }

  const { data } = await query;
  return (data || []).map((row: any) => ({
    post_id: row.scheduled_post_id,
    platform: row.platform,
    content_type: row.content_type,
    content: row.scheduled_posts?.content ?? null,
    date: row.date,
    metrics: {
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      shares: Number(row.shares || 0),
      views: Number(row.views || 0),
    },
  }));
};

export const evaluateForecastInsights = async (
  input: ForecastInsightsInput
): Promise<ForecastInsightsOutput> => {
  const brandVoice = normalizeBrandVoice(input.brand_voice);
  if (!isOmniVyraEnabled()) {
    return {
      explanation_summary: 'OmniVyra disabled',
      key_drivers: [],
      risks: [],
      recommended_actions: [],
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const query = {
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.content_type ? { content_type: input.content_type } : {}),
  };

  const [forecast, trendData, kpis, recent_content_summary] = await Promise.all([
    runHandler(forecastHandler, { method: 'GET', query } as any),
    runHandler(trendsHandler, { method: 'GET', query } as any),
    runHandler(contentKpisHandler, { method: 'GET', query } as any),
    getRecentContentSummary({
      organizationId: input.organization_id,
      platform: input.platform || null,
      contentType: input.content_type || null,
    }),
  ]);

  const response = await evaluateCommunityAiForecastInsights({
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    platform: input.platform ?? null,
    content_type: input.content_type ?? null,
    forecast: forecast?.forecast || [],
    trends: trendData?.trends || [],
    anomalies: trendData?.anomalies || [],
    kpis,
    brand_voice: brandVoice,
    recent_content_summary,
  });

  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_FORECAST_INSIGHTS_FALLBACK', {
      reason: response.error?.message,
    });
    return {
      explanation_summary: 'OmniVyra unavailable',
      key_drivers: [],
      risks: [],
      recommended_actions: [],
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const data = response.data || {};
  return {
    explanation_summary: data.explanation_summary ?? '',
    key_drivers: data.key_drivers ?? [],
    risks: data.risks ?? [],
    recommended_actions: data.recommended_actions ?? [],
    confidence_level: typeof data.confidence_level === 'number' ? data.confidence_level : 0,
    source: 'omnivyra',
  };
};
