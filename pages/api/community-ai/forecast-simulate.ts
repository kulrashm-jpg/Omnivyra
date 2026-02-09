import type { NextApiRequest, NextApiResponse } from 'next';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';
import forecastHandler from './forecast';

type ScenarioInput = {
  posting_frequency_change?: number;
  content_type_mix?: Record<string, number>;
  engagement_boost_factor?: number;
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
    throw new Error(res.data?.error || 'FAILED_TO_SIMULATE_FORECAST');
  }
  return res.data;
};

const round = (value: number) => Number(value.toFixed(2));

const computeRiskFlags = (baseline: any[], simulated: any[]) => {
  const riskMap = new Map<string, any>();
  baseline.forEach((item) => {
    const key = `${item.platform}::${item.content_type}`;
    const total =
      Number(item.predicted_likes || 0) +
      Number(item.predicted_comments || 0) +
      Number(item.predicted_shares || 0) +
      Number(item.predicted_views || 0);
    riskMap.set(key, { baseline: total });
  });
  simulated.forEach((item) => {
    const key = `${item.platform}::${item.content_type}`;
    const total =
      Number(item.predicted_likes || 0) +
      Number(item.predicted_comments || 0) +
      Number(item.predicted_shares || 0) +
      Number(item.predicted_views || 0);
    const entry = riskMap.get(key) || {};
    entry.simulated = total;
    riskMap.set(key, entry);
  });

  const flags: Array<{ platform: string; content_type: string; reason: string; severity: 'low' | 'medium' | 'high' }> =
    [];
  riskMap.forEach((entry, key) => {
    const [platform, content_type] = key.split('::');
    const baselineTotal = Number(entry.baseline || 0);
    const simulatedTotal = Number(entry.simulated || 0);
    if (baselineTotal === 0) return;
    const dropPercent = (baselineTotal - simulatedTotal) / baselineTotal;
    if (dropPercent > 0.4) {
      flags.push({
        platform,
        content_type,
        reason: 'Simulated engagement drop > 40%',
        severity: 'high',
      });
    } else if (dropPercent > 0.2) {
      flags.push({
        platform,
        content_type,
        reason: 'Simulated engagement drop > 20%',
        severity: 'medium',
      });
    }
  });
  return flags;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  const body = req.body || {};
  const platform = typeof body?.platform === 'string' ? body.platform : null;
  const contentType = typeof body?.content_type === 'string' ? body.content_type : null;
  const scenario: ScenarioInput = body?.scenario || {};

  const baseQuery = {
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    ...(platform ? { platform } : {}),
    ...(contentType ? { content_type: contentType } : {}),
  };

  const mixEntries = Object.entries(scenario.content_type_mix || {});
  const mixTotal = mixEntries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const mixValid =
    mixEntries.every(([, value]) => Number.isFinite(Number(value))) &&
    mixTotal >= -100 &&
    mixTotal <= 100;
  if (!mixValid) {
    return res.status(400).json({ error: 'INVALID_CONTENT_TYPE_MIX' });
  }

  const baseline = await runHandler(forecastHandler, { method: 'GET', query: baseQuery } as any);
  const baselineForecast = baseline?.forecast || [];

  const frequencyFactor = 1 + (Number(scenario.posting_frequency_change || 0) / 10);
  const engagementFactor = scenario.engagement_boost_factor
    ? 1 + Number(scenario.engagement_boost_factor) / 100
    : 1;
  const mix = scenario.content_type_mix || {};

  const simulatedForecast = baselineForecast.map((entry: any) => {
    const mixDelta = Number(mix?.[entry.content_type] || 0) / 100;
    const mixFactor = 1 + mixDelta;
    const factor = Math.max(0, mixFactor * frequencyFactor * engagementFactor);
    return {
      ...entry,
      predicted_likes: round(Number(entry.predicted_likes || 0) * factor),
      predicted_comments: round(Number(entry.predicted_comments || 0) * factor),
      predicted_shares: round(Number(entry.predicted_shares || 0) * factor),
      predicted_views: round(Number(entry.predicted_views || 0) * factor),
    };
  });

  const totals = (forecast: any[]) =>
    forecast.reduce(
      (acc, item) => ({
        likes: acc.likes + Number(item.predicted_likes || 0),
        comments: acc.comments + Number(item.predicted_comments || 0),
        shares: acc.shares + Number(item.predicted_shares || 0),
        views: acc.views + Number(item.predicted_views || 0),
      }),
      { likes: 0, comments: 0, shares: 0, views: 0 }
    );

  const baseTotals = totals(baselineForecast);
  const simTotals = totals(simulatedForecast);

  const delta = [
    { metric: 'likes', change_percent: baseTotals.likes ? round(((simTotals.likes - baseTotals.likes) / baseTotals.likes) * 100) : 0 },
    { metric: 'comments', change_percent: baseTotals.comments ? round(((simTotals.comments - baseTotals.comments) / baseTotals.comments) * 100) : 0 },
    { metric: 'shares', change_percent: baseTotals.shares ? round(((simTotals.shares - baseTotals.shares) / baseTotals.shares) * 100) : 0 },
    { metric: 'views', change_percent: baseTotals.views ? round(((simTotals.views - baseTotals.views) / baseTotals.views) * 100) : 0 },
  ];

  const risk_flags = computeRiskFlags(baselineForecast, simulatedForecast);

  return res.status(200).json({
    baseline_forecast: baselineForecast,
    simulated_forecast: simulatedForecast,
    delta,
    risk_flags,
  });
}
