/**
 * Response Generation Service
 * LLM-generated reply from template + context.
 */

import { runCompletionWithOperation } from './aiGateway';
// WAVE-1A-002/1B-001 §C6: canonical prompt-safety + outbound-moderation primitives (shared).
import { hardenText, hardenBlock, moderateBeforePersist } from './ai/safety';
import { parseTemplateStructure, blocksToPromptStructure } from './taggedResponseInterpreter';
import { getPlatformFormatRules } from './platformResponseFormatter';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { getThreadMemory } from './conversationMemoryService';
import {
  getTopReplyIntelligence,
  formatReplyIntelligenceForPrompt,
} from './replyIntelligenceService';
import {
  getActiveOpportunities,
  formatOpportunitiesForPrompt,
} from './engagementOpportunityService';
import {
  getTopStrategiesForContext,
  formatStrategiesForPrompt,
} from './responseStrategyIntelligenceService';
import { supabase } from '../db/supabaseClient';
import {
  buildStrategyInstructions,
  extractStrategyProfile,
  validateStrategicPerspective,
} from '../../lib/content/companyStrategyPerspective';
// WS-2A: Coordination Platform shadow adoption (dark by default; never alters replies).
import { observeEngagementSemanticShadow } from './intelligence/coordination/adoption/engagementSemanticShadow';

export type GenerateInput = {
  message_id: string;
  thread_id?: string | null;
  organization_id: string;
  platform: string;
  intent?: string | null;
  original_message: string;
  author_name?: string | null;
  thread_context?: string | null;
  template_structure: string;
  tone: string;
  emoji_policy?: string;
};

/**
 * Generate natural reply text from template and context.
 */
export async function generateResponse(
  input: GenerateInput
): Promise<{ text: string; error?: string }> {
  const blocks = parseTemplateStructure(input.template_structure);
  const structurePrompt = blocksToPromptStructure(blocks);

  const platformRules = getPlatformFormatRules(input.platform);

  // WS-2A shadow adoption: observe semantic coordination for this reply intent.
  // Fire-and-forget, dark by default — it can never modify, block, or delay the reply.
  void observeEngagementSemanticShadow({
    companyId: input.organization_id,
    topic: input.original_message ?? '',
    platform: input.platform ?? null,
    surface: 'engagement.reply',
    correlationId: input.message_id,
  }).catch(() => {});

  let conversationContext = '';
  if (input.thread_id) {
    const summary = await getThreadMemory(input.thread_id);
    if (summary) {
      // WAVE-1A-002 §C6: conversation memory is untrusted DATA — escape before prompt.
      conversationContext = `Conversation context: ${hardenBlock('conversation_history', summary)}\n\n`;
    }
  }

  let classificationCategory = 'general_comment';
  let sentiment = 'neutral';
  if (input.thread_id && input.organization_id) {
    const { data: classification } = await supabase
      .from('engagement_thread_classification')
      .select('classification_category, sentiment')
      .eq('thread_id', input.thread_id)
      .eq('organization_id', input.organization_id)
      .maybeSingle();
    if (classification) {
      classificationCategory = (classification.classification_category ?? 'general_comment').toString();
      sentiment = (classification.sentiment ?? 'neutral').toString().toLowerCase();
    }
  }

  const strategies = await getTopStrategiesForContext(
    input.organization_id,
    classificationCategory,
    sentiment,
    3
  );
  const strategyGuidance =
    strategies.length > 0
      ? `\n\nAdaptive strategy guidance (high-performing for this conversation type):\n${formatStrategiesForPrompt(strategies)}`
      : '';

  const topIntelligence = await getTopReplyIntelligence(input.organization_id, 10);
  const highPerformingStyles =
    topIntelligence.length > 0
      ? `\n\nHigh-performing reply styles previously observed:\n${formatReplyIntelligenceForPrompt(topIntelligence)}`
      : '';

  const opportunities = await getActiveOpportunities(input.organization_id, 5);
  const opportunitiesContext =
    opportunities.length > 0
      ? `\n\nActive engagement opportunities detected in community discussions:\n${formatOpportunitiesForPrompt(opportunities)}`
      : '';

  let brandContext = '';
  let strategicPerspective = '';
  let strategicProfile = undefined;
  let uniqueValue = '';
  let competitiveAdvantages = '';
  let industry = '';
  let targetAudience = '';
  let idealCustomerProfile = '';
  let coreProblem = '';
  let painPoints: string[] = [];
  let productsServices = '';
  let authorityDomains: string[] = [];
  try {
    const profile = await getProfile(input.organization_id, { autoRefine: false, languageRefine: false });
    const voice = Array.isArray(profile?.brand_voice_list)
      ? profile.brand_voice_list[0]
      : profile?.brand_voice ?? 'professional';
    brandContext = `Brand voice: ${voice}. `;
    strategicProfile = extractStrategyProfile(profile);
    strategicPerspective = buildStrategyInstructions(strategicProfile);
    uniqueValue = profile?.unique_value ?? '';
    competitiveAdvantages = profile?.competitive_advantages ?? '';
    industry = profile?.industry ?? '';
    targetAudience = profile?.target_audience ?? '';
    idealCustomerProfile = profile?.ideal_customer_profile ?? '';
    coreProblem = profile?.core_problem_statement ?? '';
    painPoints = Array.isArray(profile?.pain_symptoms) ? profile.pain_symptoms.filter(Boolean) : [];
    productsServices = profile?.products_services ?? '';
    authorityDomains = Array.isArray(profile?.authority_domains) ? profile.authority_domains.filter(Boolean) : [];
  } catch {
    brandContext = 'Brand voice: professional. ';
  }

  const systemPrompt = `You are a social media engagement assistant. Generate a natural, authentic reply based on the template structure.
${brandContext}
Tone: ${input.tone}.
Platform: ${input.platform}.
Platform rules: ${platformRules.styleHint}
${input.emoji_policy === 'allowed' ? 'Emoji: Use sparingly when natural.' : 'Emoji: Avoid or minimal.'}
${strategicPerspective ? `\n${strategicPerspective}\n` : ''}

Output ONLY the reply text. No quotes, no preamble, no explanation.${strategyGuidance}${highPerformingStyles}${opportunitiesContext}`;

  const userPrompt = `${conversationContext}Original message from ${input.author_name ?? 'user'}:
"""
${hardenText('user_input', (input.original_message ?? '').slice(0, 2000)) ?? ''}
"""

Template structure to follow:
"""
${structurePrompt}
"""

Variables: {name} = ${input.author_name ?? 'the user'}. Use contextually when relevant.

Generate the reply:`;

  try {
    const result = await runCompletionWithOperation({
      companyId: input.organization_id,
      campaignId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.5,
      operation: 'responseGeneration',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    let text = (result.output ?? '').toString().trim();
    if (!text) {
      return { text: '', error: 'LLM returned empty response' };
    }
    const perspectiveCheck = validateStrategicPerspective(text, {
      strategyProfile: strategicProfile,
      uniqueValue,
      competitiveAdvantages,
      industry,
      targetAudience,
      idealCustomerProfile,
      coreProblem,
      painPoints,
      productsServices,
      authorityDomains,
    });
    if (perspectiveCheck.perspectiveMismatch && strategicPerspective) {
      const retry = await runCompletionWithOperation({
        companyId: input.organization_id,
        campaignId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.35,
        operation: 'responseGeneration',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              `The previous reply is invalid because it does not clearly reflect the company's strategic perspective.\n` +
              `${perspectiveCheck.issues.map((issue) => `- ${issue}`).join('\n')}\n\n` +
              `Rewrite the reply so it reflects the company's beliefs, differentiation, or unique angle without sounding generic.`,
          },
        ],
      });
      const retried = (retry.output ?? '').toString().trim();
      if (retried) text = retried;
    }
    // WAVE-1B-001 — outbound moderation before the reply is delivered. Shadow
    // (default) classifies + audits without blocking; enforce withholds unsafe replies.
    const moderation = await moderateBeforePersist(text, {
      surface: 'engagement.reply', platform: input.platform, correlationId: input.organization_id,
    });
    if (!moderation.allow) {
      return { text: '', error: `outbound moderation blocked reply (${moderation.categories.join(',')})` };
    }
    return { text };
  } catch (err) {
    return {
      text: '',
      error: err instanceof Error ? err.message : 'Generation failed',
    };
  }
}
