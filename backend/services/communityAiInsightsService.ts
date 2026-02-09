import { evaluateCommunityAiInsights, isOmniVyraEnabled } from './omnivyraClientV1';

export type CommunityAiInsightsInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  content_type?: string | null;
  kpis: any;
  trends: any;
  anomalies: any;
  brand_voice: string;
  recent_content_summary?: any;
};

export type CommunityAiInsightsOutput = {
  summary_insight: string;
  key_findings: any[];
  recommended_actions: any[];
  risks: any;
  confidence_level: number;
  source: 'omnivyra' | 'placeholder';
};

const normalizeBrandVoice = (value: string) => {
  const trimmed = (value || '').toString().trim();
  return trimmed.length > 0 ? trimmed : 'professional';
};

export const evaluateInsights = async (
  input: CommunityAiInsightsInput
): Promise<CommunityAiInsightsOutput> => {
  const brandVoice = normalizeBrandVoice(input.brand_voice);
  if (!isOmniVyraEnabled()) {
    return {
      summary_insight: 'OmniVyra disabled',
      key_findings: [],
      recommended_actions: [],
      risks: null,
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const response = await evaluateCommunityAiInsights({ ...input, brand_voice: brandVoice });
  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_COMMUNITY_AI_INSIGHTS_FALLBACK', {
      reason: response.error?.message,
    });
    return {
      summary_insight: 'OmniVyra unavailable',
      key_findings: [],
      recommended_actions: [],
      risks: null,
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const data = response.data || {};
  return {
    summary_insight: data.summary_insight ?? '',
    key_findings: data.key_findings ?? [],
    recommended_actions: data.recommended_actions ?? [],
    risks: data.risks ?? null,
    confidence_level: typeof data.confidence_level === 'number' ? data.confidence_level : 0,
    source: 'omnivyra',
  };
};
