/**
 * Engagement AI Assistant Service
 *
 * Generates reply suggestions for engagement messages using OmniVyra.
 * Returns suggested_replies and tone_variants (professional, friendly, educational, thought_leadership).
 */

import { evaluateCommunityAiEngagement, isOmniVyraEnabled } from './omnivyraClientV1';
import { getThreadMessages } from './engagementMessageService';
import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';

export type ToneVariant = 'professional' | 'friendly' | 'educational' | 'thought_leadership';

export type ReplySuggestion = {
  text: string;
  tone?: ToneVariant;
};

export type GenerateReplySuggestionsResult = {
  suggested_replies: ReplySuggestion[];
  tone_variants: Partial<Record<ToneVariant, string>>;
};

export async function generateReplySuggestions(
  message_id: string,
  organization_id: string,
  brand_voice?: string | null
): Promise<GenerateReplySuggestionsResult> {
  const { data: message, error: msgError } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform')
    .eq('id', message_id)
    .maybeSingle();

  if (msgError || !message) {
    throw new Error('Message not found');
  }

  const messages = await getThreadMessages(message.thread_id);
  const threadContext = messages
    .map((m) => `${m.author?.display_name ?? m.author?.username ?? 'User'}: ${m.content ?? ''}`)
    .join('\n');

  const voice =
    brand_voice ??
    (await getProfile(organization_id, { autoRefine: false, languageRefine: true }).then((p) => {
      const entry = Array.isArray(p?.brand_voice_list) ? p.brand_voice_list[0] : null;
      return (entry || p?.brand_voice || 'professional').toString().trim();
    }));

  if (!isOmniVyraEnabled()) {
    return {
      suggested_replies: [
        { text: 'Thank you for your message. We appreciate your feedback.', tone: 'professional' },
        { text: 'Thanks for reaching out! Happy to help.', tone: 'friendly' },
        { text: 'Great question. Here’s some context that might help.', tone: 'educational' },
        { text: 'We’ve been thinking about this too. Here’s our perspective.', tone: 'thought_leadership' },
      ],
      tone_variants: {
        professional: 'Thank you for your message. We appreciate your feedback.',
        friendly: 'Thanks for reaching out! Happy to help.',
        educational: 'Great question. Here’s some context that might help.',
        thought_leadership: 'We’ve been thinking about this too. Here’s our perspective.',
      },
    };
  }

  try {
    const response = await evaluateCommunityAiEngagement({
      tenant_id: organization_id,
      organization_id,
      platform: message.platform ?? undefined,
      post_data: {
        thread_messages: messages.map((m) => ({
          author: m.author?.display_name ?? m.author?.username,
          content: m.content,
        })),
        target_message: message.content,
      },
      engagement_metrics: {},
      brand_voice: voice || 'professional',
      context: { thread_context: threadContext.slice(0, 2000) },
    });

    const suggested_actions =
      (response?.status === 'ok' && response?.data?.suggested_actions) ?? [];
    const replyActions = suggested_actions.filter(
      (a: any) => a?.action_type === 'reply' && a?.suggested_text
    );

    const suggested_replies: ReplySuggestion[] = replyActions.slice(0, 4).map((a: any) => ({
      text: (a.suggested_text ?? '').toString().trim(),
      tone: (a.tone as ToneVariant) ?? 'professional',
    }));

    const tone_variants: Partial<Record<ToneVariant, string>> = {};
    for (const r of suggested_replies) {
      if (r.tone && r.text) tone_variants[r.tone] = r.text;
    }
    if (suggested_replies.length > 0 && Object.keys(tone_variants).length === 0) {
      tone_variants.professional = suggested_replies[0].text;
    }

    if (suggested_replies.length === 0) {
      return {
        suggested_replies: [
          { text: 'Thank you for your message. We appreciate your feedback.', tone: 'professional' },
        ],
        tone_variants: { professional: 'Thank you for your message. We appreciate your feedback.' },
      };
    }

    return { suggested_replies, tone_variants };
  } catch (err) {
    console.warn('[engagementAiAssistantService] OmniVyra error:', (err as Error)?.message);
    return {
      suggested_replies: [
        { text: 'Thank you for your message. We appreciate your feedback.', tone: 'professional' },
      ],
      tone_variants: { professional: 'Thank you for your message. We appreciate your feedback.' },
    };
  }
}
