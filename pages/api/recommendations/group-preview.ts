import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendation } from '../../../backend/services/aiGateway';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { supabase } from '../../../backend/db/supabaseClient';

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

const extractContentType = (utmContent?: string | null) => {
  if (!utmContent) return null;
  const raw = String(utmContent);
  const [prefix] = raw.split('_');
  return prefix ? prefix.toLowerCase() : null;
};

const loadLearningSignals = async (companyId: string) => {
  const { data: latestVersion } = await supabase
    .from('campaign_versions')
    .select('campaign_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestVersion?.campaign_id) {
    return null;
  }

  const campaignId = String(latestVersion.campaign_id);
  const { data: learningRow } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lookbackWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: clickRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', lookbackWindow)
    .filter('metadata->>campaign_id', 'eq', campaignId);

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const sources = [performance, metrics];

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

  return {
    platform_accuracy: platformAccuracy,
    content_type_accuracy: contentTypeAccuracy,
    momentum_accuracy: momentumAccuracy,
  };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { selected_recommendations, company_id } = req.body || {};
    if (!company_id || !Array.isArray(selected_recommendations) || selected_recommendations.length === 0) {
      return res.status(400).json({ error: 'company_id and selected_recommendations are required' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    let learningSignals: any = null;
    try {
      learningSignals = await loadLearningSignals(company_id);
    } catch {
      learningSignals = null;
    }
    const message =
      'Cluster the selected trends into groups for campaign strategy.\n' +
      'Return JSON only with fields:\n' +
      '{\n' +
      '  "groups": [\n' +
      '    {\n' +
      '      "group_id": "string",\n' +
      '      "theme_name": "string",\n' +
      '      "recommendations": ["snapshot_hash"],\n' +
      '      "rationale": "string",\n' +
      '      "expected_reach": "High | Medium | Low",\n' +
      '      "expected_engagement": "High | Medium | Low",\n' +
      '      "execution_complexity": "Low | Medium | High",\n' +
      '      "expected_lead_potential": "High | Medium | Low",\n' +
      '      "go_live_priority": 1,\n' +
      '      "priority_rationale": "string",\n' +
      '      "execution_window": {\n' +
      '        "recommended_start_within_days": 2,\n' +
      '        "urgency_level": "Immediate | This Week | Plan Next",\n' +
      '        "decay_risk": "High | Medium | Low",\n' +
      '        "timing_rationale": "string"\n' +
      '      },\n' +
      '      "growth_forecast": {\n' +
      '        "estimated_leads_30d": { "min": number, "max": number },\n' +
      '        "estimated_revenue_30d": { "min": number, "max": number, "currency": "INR" },\n' +
      '        "recommended_budget_allocation": [\n' +
      '          { "platform": "string", "percentage": number, "rationale": "string" }\n' +
      '        ],\n' +
      '        "confidence_level": "High | Medium | Low",\n' +
      '        "forecast_rationale": "string",\n' +
      '        "forecast_confidence_band": {\n' +
      '          "level": "High | Medium | Low",\n' +
      '          "confidence_percentage_range": { "min": number, "max": number },\n' +
      '          "drivers": ["string"]\n' +
      '        },\n' +
      '        "roi_estimate": {\n' +
      '          "best_case": number,\n' +
      '          "expected": number,\n' +
      '          "conservative": number\n' +
      '        }\n' +
      '      }\n' +
      '    }\n' +
      '  ],\n' +
      '  "suggested_platform_mix": ["string"],\n' +
      '  "suggested_frequency": { "platform": number }\n' +
      '}\n' +
      'Group into unified theme clusters, but separate streams when conflicts exist.\n' +
      'Base estimates on: priority_score, platform mix, momentum classification.\n' +
      'For lead potential, consider audience intent match, platform mix suitability for lead generation,\n' +
      'growth_opportunity_score, and category relevance.\n' +
      'Rank groups and assign go_live_priority (1..N) using:\n' +
      '- expected_lead_potential (highest weight)\n' +
      '- expected_reach\n' +
      '- execution_complexity (prefer lower)\n' +
      '- momentum classification\n' +
      'Include a one-sentence priority_rationale.\n' +
      'Execution window rules:\n' +
      '- Momentum + High reach → Immediate (0–2 days)\n' +
      '- Emerging + High lead potential → This Week (3–7 days)\n' +
      '- Wildcard or High complexity → Plan Next (7–21 days)\n' +
      'Also return decay_risk and a one-sentence timing_rationale.\n' +
      'Forecasting rules:\n' +
      '- Leads consider expected_lead_potential, growth_opportunity_score, audience intent, platform suitability.\n' +
      '- Revenue uses company_profile.avg_deal_size if present; otherwise conservative industry benchmarks.\n' +
      '- Budget allocation prefers high reach + engagement; reduce where execution_complexity is high.\n' +
      'Confidence band rules:\n' +
      '- Consider priority_score, confidence, number of supporting sources, trend_classification, platform reuse.\n' +
      '- High: 70–90%, Medium: 40–70%, Low: 10–40%.\n' +
      'ROI estimate rules:\n' +
      '- Base on estimated_revenue_30d max relative to execution_complexity.\n' +
      'Use learning_signals (if provided) to calibrate forecast confidence and ROI realism.\n' +
      'Use only provided snapshot_hash values when referencing recommendations.\n' +
      `Input:\n${JSON.stringify(
        { selected_recommendations, learning_signals: learningSignals },
        null,
        2
      )}`;

    const completion = await generateRecommendation({
      companyId: company_id,
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a campaign strategy clustering assistant.' },
        { role: 'user', content: message },
      ],
    });

    return res.status(200).json(completion.output || {});
  } catch (error) {
    console.error('Group preview failed', error);
    return res.status(500).json({ error: 'Failed to generate grouping preview' });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);
