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

function buildContextualFallbackReplies(args: {
  platform: string;
  targetMessage: string;
  authorName?: string | null;
}): GenerateReplySuggestionsResult {
  const platform = (args.platform || '').toLowerCase();
  const rawMessage = (args.targetMessage || '').trim();
  const normalized = rawMessage.toLowerCase();
  const firstName = (args.authorName || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `Thanks for reaching out, ${firstName}.` : 'Thanks for reaching out.';

  const suggested_replies: ReplySuggestion[] = [];

  if (platform === 'linkedin' && /\bopportunit(y|ies)\b/.test(normalized)) {
    suggested_replies.push(
      {
        text: `${greeting} Happy to understand the opportunity better. Could you share a bit more about the product and what kind of collaboration or discussion you have in mind?`,
        tone: 'professional',
      },
      {
        text: `${greeting} This sounds interesting. Please send a short overview of the opportunity and the expected fit, and I will take a proper look.`,
        tone: 'friendly',
      },
      {
        text: `${greeting} I would be open to learning more. If you share the objective and a few key details, I can respond more meaningfully.`,
        tone: 'educational',
      }
    );
  } else if (/\bcall|meeting|discuss|talk|connect\b/.test(normalized)) {
    suggested_replies.push(
      {
        text: `${greeting} Happy to continue the conversation. Please share a little more context first, and then we can decide the best next step for a discussion.`,
        tone: 'professional',
      },
      {
        text: `${greeting} I am open to a conversation. Could you send a quick summary of what you would like to discuss so I can come prepared?`,
        tone: 'friendly',
      },
      {
        text: `${greeting} Before we schedule time, please share the objective and a few relevant details so I can assess how best to move this forward.`,
        tone: 'educational',
      }
    );
  } else if (/\?$/.test(rawMessage) || /\bhow|what|why|when|where|can you|could you|would you\b/.test(normalized)) {
    suggested_replies.push(
      {
        text: `${greeting} Happy to help. Could you share a little more detail so I can give you a useful and accurate response?`,
        tone: 'professional',
      },
      {
        text: `${greeting} I would be glad to help with this. A bit more context from your side would help me respond properly.`,
        tone: 'friendly',
      },
      {
        text: `${greeting} Let us clarify the context first so I can give you a more specific answer.`,
        tone: 'educational',
      }
    );
  } else {
    suggested_replies.push(
      {
        text: `${greeting} Thanks for sharing this. Could you give me a little more context so I can respond in a way that is actually useful?`,
        tone: 'professional',
      },
      {
        text: `${greeting} I appreciate the note. Please share a little more detail on what you have in mind, and I will take it from there.`,
        tone: 'friendly',
      },
      {
        text: `${greeting} Understood. If you expand a bit on the context or objective, I can give you a more relevant response.`,
        tone: 'educational',
      }
    );
  }

  const tone_variants: Partial<Record<ToneVariant, string>> = {};
  for (const reply of suggested_replies) {
    if (reply.tone && reply.text) {
      tone_variants[reply.tone] = reply.text;
    }
  }

  return { suggested_replies, tone_variants };
}

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
  const matchedMessage =
    messages.find((entry) => entry.message_id === message_id) ??
    messages.find((entry) => (entry.content ?? '').trim() === (message.content ?? '').trim()) ??
    null;
  const threadContext = messages
    .map((entry) => `${entry.author?.display_name ?? entry.author?.username ?? 'User'}: ${entry.content ?? ''}`)
    .join('\n');

  const voice =
    brand_voice ??
    (await getProfile(organization_id, { autoRefine: false, languageRefine: true }).then((profile) => {
      const entry = Array.isArray(profile?.brand_voice_list) ? profile.brand_voice_list[0] : null;
      return (entry || profile?.brand_voice || 'professional').toString().trim();
    }));

  const fallback = () =>
    buildContextualFallbackReplies({
      platform: message.platform ?? '',
      targetMessage: message.content ?? '',
      authorName: matchedMessage?.author?.display_name ?? matchedMessage?.author?.username ?? null,
    });

  if (!isOmniVyraEnabled()) {
    return fallback();
  }

  try {
    const response = await evaluateCommunityAiEngagement({
      tenant_id: organization_id,
      organization_id,
      platform: message.platform ?? undefined,
      post_data: {
        thread_messages: messages.map((entry) => ({
          author: entry.author?.display_name ?? entry.author?.username,
          content: entry.content,
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
      (action: any) => action?.action_type === 'reply' && action?.suggested_text
    );

    const suggested_replies: ReplySuggestion[] = replyActions.slice(0, 4).map((action: any) => ({
      text: (action.suggested_text ?? '').toString().trim(),
      tone: (action.tone as ToneVariant) ?? 'professional',
    }));

    const tone_variants: Partial<Record<ToneVariant, string>> = {};
    for (const reply of suggested_replies) {
      if (reply.tone && reply.text) {
        tone_variants[reply.tone] = reply.text;
      }
    }
    if (suggested_replies.length > 0 && Object.keys(tone_variants).length === 0) {
      tone_variants.professional = suggested_replies[0].text;
    }

    if (suggested_replies.length === 0) {
      return fallback();
    }

    return { suggested_replies, tone_variants };
  } catch (err) {
    console.warn('[engagementAiAssistantService] OmniVyra error:', (err as Error)?.message);
    return fallback();
  }
}
