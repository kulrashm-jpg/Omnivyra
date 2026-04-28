import { runCompletionWithOperation } from '../aiGateway';
import type { CompanyProfile } from './types';

export type MarketingIntelligenceDraft = {
  marketing_channels: string;
  content_strategy: string;
  campaign_focus: string;
  key_messages: string;
  brand_positioning: string;
  competitive_advantages: string;
  growth_priorities: string;
  competitors: string[];
};

const EMPTY_DRAFT: MarketingIntelligenceDraft = {
  marketing_channels: '',
  content_strategy: '',
  campaign_focus: '',
  key_messages: '',
  brand_positioning: '',
  competitive_advantages: '',
  growth_priorities: '',
  competitors: [],
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCompetitorList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => cleanText(item))
          .filter(Boolean),
      ),
    ).slice(0, 8);
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(/[\n,;]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 8);
  }

  return [];
}

export async function generateMarketingIntelligenceDraft(
  profile: CompanyProfile,
): Promise<MarketingIntelligenceDraft> {
  const companyId = typeof profile.company_id === 'string' ? profile.company_id.trim() : '';
  if (!companyId) return EMPTY_DRAFT;

  const systemPrompt =
    'You are a marketing intelligence analyst. Given a company profile, produce structured marketing intelligence and competitor suggestions.\n\n' +
    'Return JSON only with exactly these keys:\n' +
    '- marketing_channels: string (1-3 sentences, empty string if unclear)\n' +
    '- content_strategy: string (1-3 sentences, empty string if unclear)\n' +
    '- campaign_focus: string (1-3 sentences, empty string if unclear)\n' +
    '- key_messages: string (1-3 sentences, empty string if unclear)\n' +
    '- brand_positioning: string (1-3 sentences, empty string if unclear)\n' +
    '- competitive_advantages: string (1-3 sentences, empty string if unclear)\n' +
    '- growth_priorities: string (1-3 sentences, empty string if unclear)\n' +
    '- competitors: string[] (up to 5 realistic competitor names, empty array if unclear)\n\n' +
    'Rules:\n' +
    '1. Prefer specific, practical phrasing over generic filler.\n' +
    '2. Do not hallucinate niche capabilities.\n' +
    '3. Competitors should be realistic alternatives a buyer might evaluate.\n' +
    '4. If confidence is weak, return fewer competitors rather than weak guesses.';

  try {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      operation: 'profileExtraction',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Company profile and strategic context:\n${JSON.stringify(profile, null, 2)}` },
      ],
    });

    const parsed = JSON.parse(result.output?.trim() || '{}') as Record<string, unknown>;

    return {
      marketing_channels: cleanText(parsed.marketing_channels),
      content_strategy: cleanText(parsed.content_strategy),
      campaign_focus: cleanText(parsed.campaign_focus),
      key_messages: cleanText(parsed.key_messages),
      brand_positioning: cleanText(parsed.brand_positioning),
      competitive_advantages: cleanText(parsed.competitive_advantages),
      growth_priorities: cleanText(parsed.growth_priorities),
      competitors: normalizeCompetitorList(parsed.competitors),
    };
  } catch {
    return EMPTY_DRAFT;
  }
}
