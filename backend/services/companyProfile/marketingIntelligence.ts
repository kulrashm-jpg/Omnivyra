import { runCompletionWithOperation } from '../aiGateway';
import type { CompanyProfile, EntityArchetypeIntelligence } from './types';
import { buildArchetypePromptContext, isBusinessFirstOnlyArchetype } from './entityArchetype';
import {
  buildGroundedDifferentiationSignal,
  buildStructuredCompetitorDimensionBlock,
  hasBusinessFirstCommercialGrounding,
  hasCreatorContamination,
  shouldUseAudienceLedSynthesis,
  validateAudienceLedGrounding,
} from './competitorSynthesis';
import { buildUserGuidanceContextBlock } from './userGuidance';

export type MarketingIntelligenceDraft = {
  marketing_channels: string;
  content_strategy: string;
  campaign_focus: string;
  key_messages: string;
  brand_positioning: string;
  competitive_advantages: string;
  growth_priorities: string;
};

const EMPTY_DRAFT: MarketingIntelligenceDraft = {
  marketing_channels: '',
  content_strategy: '',
  campaign_focus: '',
  key_messages: '',
  brand_positioning: '',
  competitive_advantages: '',
  growth_priorities: '',
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function generateMarketingIntelligenceDraft(
  profile: CompanyProfile,
  archetype?: EntityArchetypeIntelligence | null,
): Promise<MarketingIntelligenceDraft> {
  const companyId = typeof profile.company_id === 'string' ? profile.company_id.trim() : '';
  if (!companyId) return EMPTY_DRAFT;
  const effectiveArchetype = archetype ?? profile.report_settings?.entity_archetype ?? null;
  const archetypeContext = buildArchetypePromptContext(effectiveArchetype);
  const useAudienceLedSynthesis = shouldUseAudienceLedSynthesis(effectiveArchetype, profile.report_settings?.competitor_intelligence ?? null);
  const competitorIntelligence = useAudienceLedSynthesis
    ? buildStructuredCompetitorDimensionBlock(profile.report_settings?.competitor_intelligence ?? null)
    : '';
  const userGuidanceContext = buildUserGuidanceContextBlock(profile);
  const audienceLedRules = useAudienceLedSynthesis
    ? '\nArchetype adaptation:\n' +
      '- Use audience/community/member/reader/learner/subscriber language when it fits the evidence.\n' +
      '- Treat worldview, trust, education, media cadence, community access, and authority as positioning assets.\n' +
      '- Use competitor intelligence as differentiation context only; do not copy competitor claims, audiences, monetization, worldview, or facts into the company profile unless company evidence also supports them.\n' +
      '- At least one of brand_positioning, competitive_advantages, campaign_focus, or key_messages must reflect a grounded distinction from the structured competitor dimensions.\n' +
      '- Do not force product-led SaaS messaging or transactional funnel assumptions unless evidence supports them.\n'
    : '';

  const systemPrompt =
    'You are a marketing intelligence analyst. Given a company profile, produce structured marketing intelligence.\n\n' +
    'Return JSON only with exactly these keys:\n' +
    '- marketing_channels: string (1-3 sentences, empty string if unclear)\n' +
    '- content_strategy: string (1-3 sentences, empty string if unclear)\n' +
    '- campaign_focus: string (1-3 sentences, empty string if unclear)\n' +
    '- key_messages: string (1-3 sentences, empty string if unclear)\n' +
    '- brand_positioning: string (1-3 sentences, empty string if unclear)\n' +
    '- competitive_advantages: string (1-3 sentences, empty string if unclear)\n' +
    '- growth_priorities: string (1-3 sentences, empty string if unclear)\n\n' +
    'Rules:\n' +
    '1. Prefer specific, practical phrasing over generic filler.\n' +
    '2. Do not hallucinate niche capabilities.\n' +
    '3. Do not generate or infer competitors here. Competitor discovery is handled only by the competitor engine.\n' +
    '4. Business-first SaaS/service/ecommerce profiles must stay commercially grounded; do not introduce creator, newsletter, publication, or audience-led positioning unless provided by company evidence.' +
    (archetypeContext ? `\n\nENTITY ARCHETYPE CONTEXT:\n${archetypeContext}` : '') +
    (competitorIntelligence ? `\n\nCOMPETITOR INTELLIGENCE CONTEXT:\n${competitorIntelligence}` : '') +
    (userGuidanceContext ? `\n\n${userGuidanceContext}` : '') +
    audienceLedRules;

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
        {
          role: 'user',
          content:
            `${archetypeContext ? `Entity archetype context:\n${archetypeContext}\n\n` : ''}` +
            `${competitorIntelligence ? `Structured competitor dimensions:\n${competitorIntelligence}\n\n` : ''}` +
            `${userGuidanceContext ? `${userGuidanceContext}\n\n` : ''}` +
            `Company profile and strategic context:\n${JSON.stringify(profile, null, 2)}`,
        },
      ],
    });

    const parsed = JSON.parse(result.output?.trim() || '{}') as Record<string, unknown>;

    const draft = {
      marketing_channels: cleanText(parsed.marketing_channels),
      content_strategy: cleanText(parsed.content_strategy),
      campaign_focus: cleanText(parsed.campaign_focus),
      key_messages: cleanText(parsed.key_messages),
      brand_positioning: cleanText(parsed.brand_positioning),
      competitive_advantages: cleanText(parsed.competitive_advantages),
      growth_priorities: cleanText(parsed.growth_priorities),
    };
    if (
      useAudienceLedSynthesis &&
      !validateAudienceLedGrounding(Object.values(draft), profile, effectiveArchetype)
    ) {
      const signal = buildGroundedDifferentiationSignal(profile.report_settings?.competitor_intelligence ?? null);
      if (signal) {
        draft.competitive_advantages = [draft.competitive_advantages, `Differentiation should stay grounded in ${signal}.`]
          .filter(Boolean)
          .join(' ');
      }
    }
    if (
      isBusinessFirstOnlyArchetype(effectiveArchetype) &&
      hasCreatorContamination(Object.values(draft)) &&
      !hasBusinessFirstCommercialGrounding(Object.values(draft))
    ) {
      return EMPTY_DRAFT;
    }
    return draft;
  } catch {
    return EMPTY_DRAFT;
  }
}
