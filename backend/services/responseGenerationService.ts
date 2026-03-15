/**
 * Response Generation Service
 * LLM-generated reply from template + context.
 */

import { runCompletionWithOperation } from './aiGateway';
import { parseTemplateStructure, blocksToPromptStructure } from './taggedResponseInterpreter';
import { getPlatformFormatRules } from './platformResponseFormatter';
import { getProfile } from './companyProfileService';
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

  let conversationContext = '';
  if (input.thread_id) {
    const summary = await getThreadMemory(input.thread_id);
    if (summary) {
      conversationContext = `Conversation context: ${summary}\n\n`;
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
  try {
    const profile = await getProfile(input.organization_id, { autoRefine: false, languageRefine: false });
    const voice = Array.isArray(profile?.brand_voice_list)
      ? profile.brand_voice_list[0]
      : profile?.brand_voice ?? 'professional';
    brandContext = `Brand voice: ${voice}. `;
  } catch {
    brandContext = 'Brand voice: professional. ';
  }

  const systemPrompt = `You are a social media engagement assistant. Generate a natural, authentic reply based on the template structure.
${brandContext}
Tone: ${input.tone}.
Platform: ${input.platform}.
Platform rules: ${platformRules.styleHint}
${input.emoji_policy === 'allowed' ? 'Emoji: Use sparingly when natural.' : 'Emoji: Avoid or minimal.'}

Output ONLY the reply text. No quotes, no preamble, no explanation.${strategyGuidance}${highPerformingStyles}${opportunitiesContext}`;

  const userPrompt = `${conversationContext}Original message from ${input.author_name ?? 'user'}:
"""
${(input.original_message ?? '').slice(0, 2000)}
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

    const text = (result.output ?? '').toString().trim();
    if (!text) {
      return { text: '', error: 'LLM returned empty response' };
    }
    return { text };
  } catch (err) {
    return {
      text: '',
      error: err instanceof Error ? err.message : 'Generation failed',
    };
  }
}
