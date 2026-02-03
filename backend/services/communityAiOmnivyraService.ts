import {
  evaluateCommunityAiEngagement,
  isOmniVyraEnabled,
} from './omnivyraClientV1';

export type CommunityAiOmnivyraInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  post_data?: any;
  engagement_metrics?: any;
  goals?: any;
  brand_voice: string;
  context?: any;
};

export type CommunityAiOmnivyraOutput = {
  analysis: string;
  suggested_actions: any[];
  content_improvement: any;
  safety_classification: any;
  execution_links: any;
  source: 'omnivyra' | 'placeholder';
};

const normalizeBrandVoice = (value: string) => {
  const trimmed = (value || '').toString().trim();
  return trimmed.length > 0 ? trimmed : 'professional';
};

const normalizeSuggestedActions = (actions: any[], brandVoice: string) => {
  const tone = normalizeBrandVoice(brandVoice);
  return (actions || []).map((action) => ({
    ...action,
    tone,
  }));
};

export const evaluateEngagement = async (
  input: CommunityAiOmnivyraInput
): Promise<CommunityAiOmnivyraOutput> => {
  const brandVoice = normalizeBrandVoice(input.brand_voice);
  if (!isOmniVyraEnabled()) {
    return {
      analysis: 'OmniVyra disabled',
      suggested_actions: [],
      content_improvement: null,
      safety_classification: null,
      execution_links: null,
      source: 'placeholder',
    };
  }

  const response = await evaluateCommunityAiEngagement({
    ...input,
    brand_voice: brandVoice,
  });
  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_COMMUNITY_AI_FALLBACK', { reason: response.error?.message });
    return {
      analysis: 'OmniVyra unavailable',
      suggested_actions: [],
      content_improvement: null,
      safety_classification: null,
      execution_links: null,
      source: 'placeholder',
    };
  }

  const data = response.data || {};
  return {
    analysis: data.analysis ?? '',
    suggested_actions: normalizeSuggestedActions(data.suggested_actions ?? [], brandVoice),
    content_improvement: data.content_improvement ?? null,
    safety_classification: data.safety_classification ?? null,
    execution_links: data.execution_links ?? null,
    source: 'omnivyra',
  };
};

