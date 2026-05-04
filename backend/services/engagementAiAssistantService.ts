/**
 * Engagement AI Assistant Service
 *
 * Generates reply suggestions for engagement messages using OpenAI/Omnivyra.
 * Returns exactly three intent-based suggested replies: yes, no, and maybe.
 */

import { evaluateCommunityAiEngagement, isOmnivyraEnabled } from './omnivyraClientV1';
import { getThreadMessages } from './engagementMessageService';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getProfile } from './companyProfileService';
import { runCompletionWithOperation } from './aiGateway';
import { isDmMessageType, stripSenderColonPrefix } from '../../lib/engagement/messageRoles';
import { config } from '@/config';

export type ToneVariant =
  | 'accept'
  | 'decline'
  | 'clarify';

export type ReplySuggestion = {
  text: string;
  tone?: ToneVariant;
};

export type GenerateReplySuggestionsResult = {
  suggested_replies: ReplySuggestion[];
};

type ReplyIntentBucket = 'accept' | 'decline' | 'maybe';

const INTENT_BUCKET_ORDER: ReplyIntentBucket[] = ['accept', 'decline', 'maybe'];

function toneForBucket(bucket: ReplyIntentBucket): ToneVariant {
  if (bucket === 'accept') return 'accept';
  if (bucket === 'decline') return 'decline';
  return 'clarify';
}

function normalizeReplyForComparison(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyReplyIntent(reply: { text?: string | null; tone?: string | null }): ReplyIntentBucket | null {
  const rawTone = String(reply.tone || '').trim().toLowerCase();
  if (rawTone === 'accept') return 'accept';
  if (rawTone === 'decline') return 'decline';
  if (rawTone === 'clarify' || rawTone === 'maybe') return 'maybe';

  const text = normalizeReplyForComparison(reply.text);
  if (!text) return null;

  if (/\b(no|not|cannot|can't|wont|won't|unable|unavailable|do not have|don't have|cant take|can't take|won't be able|cannot take)\b/.test(text)) {
    return 'decline';
  }
  if (/\b(maybe|think|consider|let me check|come back|review|before i confirm|before confirming|can you|could you|would you|share|send|clarify|context|details|timeline|resume|role|location|notice period)\b/.test(text) || text.includes('?')) {
    return 'maybe';
  }
  if (/\b(yes|happy to|sure|available|glad to|can help|will check|i will|let's|lets|sounds good|works for me)\b/.test(text)) {
    return 'accept';
  }
  return null;
}

function enforceIntentCoverage(
  replies: ReplySuggestion[],
  fallbackReplies: ReplySuggestion[],
): ReplySuggestion[] {
  const candidates: ReplySuggestion[] = [];
  const seen = new Set<string>();

  for (const reply of [...replies, ...fallbackReplies]) {
    const text = String(reply?.text || '').trim();
    if (!text) continue;
    const key = normalizeReplyForComparison(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ text, tone: reply.tone });
  }

  const chosen: ReplySuggestion[] = [];
  const usedKeys = new Set<string>();

  for (const bucket of INTENT_BUCKET_ORDER) {
    const match = candidates.find((reply) => {
      const key = normalizeReplyForComparison(reply.text);
      return key && !usedKeys.has(key) && classifyReplyIntent(reply) === bucket;
    });
    if (!match) continue;
    usedKeys.add(normalizeReplyForComparison(match.text));
    chosen.push({ text: match.text, tone: toneForBucket(bucket) });
  }

  for (const bucket of INTENT_BUCKET_ORDER) {
    if (chosen.length >= 3) break;
    const fallback = fallbackReplies.find((reply) => classifyReplyIntent(reply) === bucket);
    if (!fallback) continue;
    const key = normalizeReplyForComparison(fallback.text);
    if (!key || usedKeys.has(key)) continue;
    usedKeys.add(key);
    chosen.push({ text: fallback.text, tone: toneForBucket(bucket) });
  }

  for (const reply of candidates) {
    if (chosen.length >= 3) break;
    const key = normalizeReplyForComparison(reply.text);
    if (!key || usedKeys.has(key)) continue;
    usedKeys.add(key);
    const bucket = classifyReplyIntent(reply) ?? 'maybe';
    chosen.push({ text: reply.text, tone: toneForBucket(bucket) });
  }

  return chosen.slice(0, 3);
}

// Last-resort templated fallback. Only fires when both Omnivyra AND the
// direct OpenAI path are unavailable. Kept short and natural — no verbatim
// quoting of the comment, no forced post-topic tie-in.
function buildContextualFallbackReplies(args: {
  platform: string;
  targetMessage: string;
  authorName?: string | null;
  originalPost?: string | null;
  isDm?: boolean;
}): GenerateReplySuggestionsResult {
  const platform = (args.platform || '').toLowerCase();
  const rawMessage = (args.targetMessage || '').trim();
  const normalized = rawMessage.toLowerCase();
  const firstName = (args.authorName || '').trim().split(/\s+/)[0] || '';
  const addr = firstName ? `${firstName}, ` : '';
  const isShort = rawMessage.length <= 12;
  const isDm = args.isDm === true;
  const isCareerHelpRequest =
    /\b(job|jobs|role|roles|opening|openings|opportunit(?:y|ies)|recruitment|recruiter|resume|cv|hiring|candidate|talent acquisition|network|referral|refer)\b/.test(normalized);
  const isAvailabilityAsk =
    /\b(available|availability|interested|immediate candidate|looking for immediate|are you available)\b/.test(normalized);

  const suggested_replies: ReplySuggestion[] = [];

  if (isDm) {
    // DM-specific templates — conversational, no public-facing branding.
    if (isCareerHelpRequest) {
      suggested_replies.push(
        { text: `${firstName ? `Hi ${firstName}, ` : ''}thanks for sharing this. Please send your resume and the roles, locations, and timelines you are targeting, and I will check if there is anything relevant in my network.`, tone: 'accept' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I do not have a relevant opening right now, but send your resume and target role details and I will keep it in mind if something suitable comes up.`, tone: 'decline' },
        { text: `${firstName ? `${firstName}, ` : ''}can you share your resume, target roles, preferred location, and notice period? That will help me route it properly if I see a fit.`, tone: 'clarify' }
      );
    } else if (isAvailabilityAsk) {
      suggested_replies.push(
        { text: `${firstName ? `Hi ${firstName}, ` : ''}yes, I am available to discuss. Please share the role details, timeline, and next steps.`, tone: 'accept' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I am not available for this right now, but thank you for checking.`, tone: 'decline' },
        { text: `${firstName ? `${firstName}, ` : ''}can you share more about the role, location, and expected timeline before I confirm?`, tone: 'clarify' }
      );
    } else if (isShort) {
      suggested_replies.push(
        { text: firstName ? `Hey ${firstName}, got it.` : `Hey, got it.`, tone: 'accept' },
        { text: firstName ? `${firstName}, I can't take this up from just this message, but send the context and I will review it.` : `I can't take this up from just this message, but send the context and I will review it.`, tone: 'decline' },
        { text: firstName ? `${firstName}, what should I look at next here?` : `What should I look at next here?`, tone: 'clarify' }
      );
    } else if (/\?$/.test(rawMessage) || /\bhow|what|why|when|where|can you|could you|would you\b/.test(normalized)) {
      suggested_replies.push(
        { text: `${firstName ? `Hi ${firstName}, ` : ''}happy to help with this. Here's what I can share based on what I know right now.`, tone: 'accept' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I don't want to give a half answer here, so I will not commit on this yet.`, tone: 'decline' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I don't want to guess on this. Let me check properly and come back with a cleaner answer.`, tone: 'clarify' }
      );
    } else if (/\bcall|meeting|chat|connect|catch up|sync\b/.test(normalized)) {
      suggested_replies.push(
        { text: `${firstName ? `Hi ${firstName}, ` : ''}happy to connect. Share a couple of times that work for you and I'll pick one.`, tone: 'accept' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I won't be able to take a call right now, but you can send the context here and I'll respond.`, tone: 'decline' },
        { text: `${firstName ? `${firstName}, ` : ''}before we lock a time, what would you like to focus on so I can come prepared?`, tone: 'clarify' }
      );
    } else {
      suggested_replies.push(
        { text: `${firstName ? `Hi ${firstName}, ` : ''}thanks for sharing this. I'll look into it and get back to you.`, tone: 'accept' },
        { text: `${firstName ? `Hi ${firstName}, ` : ''}I may not be able to take this up right now, but send the key details and I will review them when I can.`, tone: 'decline' },
        { text: `${firstName ? `${firstName}, ` : ''}what outcome are you hoping for here? That will help me respond in the right direction.`, tone: 'clarify' }
      );
    }

    return { suggested_replies };
  }

  if (isShort) {
    // Vague/short comments ("test", "nice", "👍") — match the energy.
    suggested_replies.push(
      { text: `${addr ? `Thanks, ${firstName}!` : 'Thanks!'}`, tone: 'accept' },
      { text: `${addr ? `${firstName}, I don't have enough context to add more here yet.` : `I don't have enough context to add more here yet.`}`, tone: 'decline' },
      { text: `${addr ? `${firstName}, anything specific you'd want me to dig into?` : `Anything specific you'd want me to dig into?`}`, tone: 'clarify' }
    );
  } else if (platform === 'linkedin' && isCareerHelpRequest) {
    suggested_replies.push(
      { text: `${firstName ? `Hi ${firstName}, ` : ''}thanks for sharing this. Please send your resume and the roles, locations, and timelines you are targeting, and I will check if there is anything relevant in my network.`, tone: 'accept' },
      { text: `${firstName ? `Hi ${firstName}, ` : ''}I do not have a relevant opening right now, but send your resume and target role details and I will keep it in mind if something suitable comes up.`, tone: 'decline' },
      { text: `${firstName ? `${firstName}, ` : ''}can you share your resume, target roles, preferred location, and notice period? That will help me route it properly if I see a fit.`, tone: 'clarify' }
    );
  } else if (/\bcall|meeting|discuss|talk|connect\b/.test(normalized)) {
    suggested_replies.push(
      { text: `${addr}happy to talk. Share a couple of times that work and I'll confirm one.`, tone: 'accept' },
      { text: `${addr}I can't take a call right now, but share the context here and I'll respond.`, tone: 'decline' },
      { text: `${addr}before we schedule time, what specific angle would you like to focus on?`, tone: 'clarify' }
    );
  } else if (/\?$/.test(rawMessage) || /\bhow|what|why|when|where|can you|could you|would you\b/.test(normalized)) {
    suggested_replies.push(
      { text: `Good question${firstName ? `, ${firstName}` : ''}. Here's the short version based on the context I have.`, tone: 'accept' },
      { text: `${addr}I don't want to give a generic answer here, so I won't pretend I have the full context yet.`, tone: 'decline' },
      { text: `${addr}I don't want to give you a generic answer. Let me check the details and come back with a sharper response.`, tone: 'clarify' }
    );
  } else {
    suggested_replies.push(
      { text: `${addr}fair point. I appreciate you weighing in.`, tone: 'accept' },
      { text: `${addr}I don't fully see it the same way, but I appreciate you sharing the perspective.`, tone: 'decline' },
      { text: `${addr}curious what prompted that on your side?`, tone: 'clarify' }
    );
  }

  return { suggested_replies };
}

type ConversationTurn = {
  author: string | null;
  content: string;
  self: boolean;
};

type LlmSuggestionInput = {
  organization_id: string;
  platform: string | null;
  kind: 'comment' | 'direct_message';
  originalPost: string | null;
  parentComment: { author: string | null; content: string } | null;
  targetAuthor: string | null;
  targetMessage: string;
  brandVoice: string;
  // Recent conversation turns — important for DMs where the latest message
  // alone is rarely enough context. Ordered oldest → newest.
  conversation: ConversationTurn[];
};

// Direct OpenAI path — used when Omnivyra is not enabled but an OpenAI key
// is configured. Produces grounded, human-sounding replies that read the
// post AND the specific commenter's words instead of templated stitching.
async function generateReplySuggestionsViaOpenAi(
  input: LlmSuggestionInput
): Promise<ReplySuggestion[] | null> {
  if (!config.OPENAI_API_KEY) {
    console.warn(
      '[engagementAiAssistantService] OPENAI_API_KEY missing at runtime — falling back to templates. Set it in .env.local and restart the dev server.'
    );
    return null;
  }

  const { originalPost, parentComment, targetAuthor, brandVoice, platform, kind, conversation } = input;
  // Clean the target message before the LLM sees it. Otherwise the model
  // ends up echoing the "Kuldeep: ..." prefix back and producing replies
  // that read like awkward template fills.
  const targetMessage = stripSenderColonPrefix(input.targetMessage || '');
  const isDm = kind === 'direct_message';

  const firstName = (targetAuthor || '').trim().split(/\s+/)[0] || '';
  const namedAddress = firstName ? ` Address them as "${firstName}" only if it reads naturally; otherwise skip the name.` : '';
  const messageLength = (targetMessage || '').trim().length;
  const lengthHint = isDm
    ? messageLength <= 20
      ? 'Their DM is very short — match it. Keep your reply to one or two sentences, conversational, no formal openers.'
      : messageLength <= 80
        ? 'Their DM is brief and casual — reply tight, one to three sentences. Match their tone.'
        : 'Match the depth of their DM — typically two to four sentences. Reply to what they actually asked or said, not a tangent.'
    : messageLength <= 12
      ? 'Their comment is very short, so keep your reply short too — one or two sentences. Do NOT pad with generic acknowledgements.'
      : messageLength <= 60
        ? 'Their comment is brief — keep your reply tight, two or three sentences max.'
        : 'Match the depth of their comment — usually two to four sentences is right.';

  const dmRules = [
    `You are drafting a reply in a 1:1 direct-message conversation on ${platform || 'social'}.`,
    `Brand voice: ${brandVoice || 'professional'}.`,
    'Hard rules:',
    '- This is a DM, not a public comment. Sound like a real person texting back — no "Thanks for reaching out", no public-facing branding language, no LinkedIn-style formality unless the conversation has been formal so far.',
    '- Read the conversation history first. If you have already greeted them earlier in the thread, do NOT greet again — pick up where the conversation left off.',
    '- Reply DIRECTLY to what they just said. If they asked a question, answer it (or ask the precise clarifying question that actually unblocks an answer). If they shared news, react to it like a human would.',
    '- Never repeat what they said back at them in quotation marks. Never start with "Sure!" or "Absolutely!" boilerplate.',
    '- Give exactly three materially different response paths: #1 YES/accept/help, #2 NO/decline/boundary, #3 MAYBE/clarify/need more details.',
    '- For job, referral, recruitment, resume, hiring, candidate, or opportunity messages, answer that specific career context. The three paths should usually be: help/check network, polite boundary/no current opening, and ask for resume/role/location/timeline details.',
    '- If accept/decline/clarify does not fit perfectly, still make each option a different useful action: answer directly, set a boundary, ask for context, close the loop, or move to the next step.',
    '- Intent labels must be only "accept", "decline", or "clarify".',
    '- Each reply must be self-contained, ready to paste, no placeholders, no surrounding quotes.',
    lengthHint,
    namedAddress,
    'Return ONLY a JSON object with exactly three replies in this order: {"replies":[{"text":"...","tone":"accept"},{"text":"...","tone":"decline"},{"text":"...","tone":"clarify"}]}',
  ];

  const commentRules = [
    `You are writing reply suggestions on behalf of a creator on ${platform || 'social'}.`,
    `Brand voice: ${brandVoice || 'professional'}.`,
    'Hard rules:',
    '- The reply MUST clearly engage with what THIS specific commenter said. If the comment is vague (e.g. "test", "nice"), respond like a real person would to a vague comment — short, warm, and human, not a generic AI acknowledgement.',
    '- The reply should feel grounded in the original post — but only weave in the post topic when the comment actually invites that, not as a forced tie-in.',
    '- Do NOT quote the comment back verbatim in quotation marks. Do NOT use phrases like "Glad this resonated" or "Thanks for reaching out". Sound like a human writing on their phone.',
    '- Give exactly three materially different response paths: #1 YES/accept/help, #2 NO/decline/boundary, #3 MAYBE/clarify/need more details.',
    '- For job, referral, recruitment, resume, hiring, candidate, or opportunity comments, address that career context directly. Do not return generic "happy to help with this" replies.',
    '- Each reply must be self-contained, ready to paste, no placeholders, no surrounding quotes.',
    lengthHint,
    namedAddress,
    'Return ONLY a JSON object with exactly three replies in this order: {"replies":[{"text":"...","tone":"accept"},{"text":"...","tone":"decline"},{"text":"...","tone":"clarify"}]}',
  ];

  const system = (isDm ? dmRules : commentRules).join('\n');

  const userParts: string[] = [];

  if (isDm) {
    // Surface the recent conversation so the model can pick up tone & context.
    // Cap at the last ~12 turns to keep prompt tight. Strip "Sender:" /
    // "You:" prefix from each turn for the same reason as targetMessage.
    const recent = conversation.slice(-12);
    if (recent.length > 0) {
      const lines = recent.map((turn) => {
        const who = turn.self ? 'YOU (the creator)' : (turn.author || 'Them');
        const cleanedTurn = stripSenderColonPrefix(turn.content);
        return `${who}: ${cleanedTurn}`;
      });
      userParts.push(`CONVERSATION SO FAR (oldest → newest):\n${lines.join('\n')}`);
    }
    userParts.push(
      `THEIR LATEST MESSAGE (${targetAuthor ?? 'them'}) — this is what you are replying to:\n${(targetMessage || '').trim()}`
    );
    userParts.push('Now write the three reply suggestions as JSON. Reply only to the LATEST message; the earlier turns are context.');
  } else {
    if (originalPost) userParts.push(`ORIGINAL POST:\n${originalPost.trim()}`);
    if (parentComment) {
      userParts.push(
        `PARENT COMMENT (${parentComment.author ?? 'someone'}):\n${parentComment.content.trim()}`
      );
    }
    userParts.push(
      `COMMENT TO REPLY TO (${targetAuthor ?? 'commenter'}):\n${(targetMessage || '').trim()}`
    );
    userParts.push('Now write the three reply suggestions as JSON.');
  }

  const model = config.OPENAI_RESPONSES_MODEL || 'gpt-4o-mini';
  console.info(
    `[engagementAiAssistantService] LLM path engaging via aiGateway — kind=${kind} platform=${platform ?? 'n/a'} targetLen=${targetMessage.length} model=${model} org=${input.organization_id} keyPresent=${config.OPENAI_API_KEY ? 'yes' : 'NO'}`
  );
  try {
    // Routed through aiGateway so the usage_events ledger captures token
    // consumption, cost attribution, cache hits, and per-operation
    // analytics. This is what feeds the cost dashboards and per-feature
    // token-consumption reports.
    const result = await runCompletionWithOperation({
      operation: 'engagement_reply_suggestions',
      model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      max_tokens: 700,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userParts.join('\n\n') },
      ],
      companyId: input.organization_id,
    });

    const raw = (typeof result?.output === 'string' ? result.output : '').trim();
    if (!raw) {
      console.warn(
        '[engagementAiAssistantService] aiGateway returned empty output — likely cache miss + provider error or PLAN_LIMIT_EXCEEDED. Check earlier [campaign-ai] log lines.'
      );
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        console.warn(
          '[engagementAiAssistantService] OpenAI body was not JSON; falling back. body=',
          raw.slice(0, 200)
        );
        return null;
      }
    }

    const replies = Array.isArray(parsed?.replies) ? parsed.replies : [];
    const out: ReplySuggestion[] = replies
      .map((r: any) => {
        const text = typeof r?.text === 'string' ? r.text.trim() : '';
        const bucket = classifyReplyIntent({
          text,
          tone: typeof r?.tone === 'string' ? r.tone : undefined,
        });
        return { text, tone: bucket ? toneForBucket(bucket) : undefined };
      })
      .filter((r: ReplySuggestion) => r.text.length > 0);

    if (out.length === 0) {
      console.warn(
        '[engagementAiAssistantService] OpenAI returned no usable replies; falling back. parsed=',
        JSON.stringify(parsed).slice(0, 200)
      );
      return null;
    }
    console.info(`[engagementAiAssistantService] OpenAI returned ${out.length} reply suggestion(s)`);
    return out.slice(0, 3);
  } catch (err) {
    console.warn(
      '[engagementAiAssistantService] OpenAI fallback failed:',
      (err as Error)?.message,
      '\n  stack:',
      (err as Error)?.stack?.split('\n').slice(0, 3).join(' | ')
    );
    return null;
  }
}

export async function generateReplySuggestions(
  message_id: string,
  organization_id: string,
  brand_voice?: string | null
): Promise<GenerateReplySuggestionsResult> {
  const { data: message, error: msgError } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform, message_type, parent_message_id')
    .eq('id', message_id)
    .maybeSingle();

  if (msgError || !message) {
    throw new Error('Message not found');
  }

  // Original post text — for People-Reaction threads, the comment itself is
  // a response to a post whose body lives on engagement_threads.raw_payload.
  // Without this, the model has no idea what the conversation is *about* and
  // produces generic "thanks for reaching out" replies.
  let originalPostText: string | null = null;
  if (message.message_type === 'comment') {
    const { data: threadRow } = await supabase
      .from('engagement_threads')
      .select('raw_payload')
      .eq('id', message.thread_id)
      .maybeSingle();
    const rp = (threadRow?.raw_payload || {}) as Record<string, unknown>;
    if (typeof rp.post_text_preview === 'string') originalPostText = rp.post_text_preview;
  }

  // Parent comment text — when replying to a sub-thread reply, the AI needs
  // to know the comment that sparked the reply, not just the leaf message.
  let parentCommentText: string | null = null;
  let parentCommentAuthor: string | null = null;
  if (message.parent_message_id) {
    const { data: parentRow } = await supabase
      .from('engagement_messages')
      .select('content, raw_payload')
      .eq('id', message.parent_message_id)
      .maybeSingle();
    parentCommentText = parentRow?.content ?? null;
    const prp = (parentRow?.raw_payload || {}) as Record<string, unknown>;
    parentCommentAuthor =
      typeof prp.author_name === 'string' ? prp.author_name :
      typeof prp.sender_name === 'string' ? prp.sender_name : null;
  }

  const messages = await getThreadMessages(message.thread_id);
  const matchedMessage =
    messages.find((entry) => entry.message_id === message_id) ??
    messages.find((entry) => (entry.content ?? '').trim() === (message.content ?? '').trim()) ??
    null;

  // For DMs we need to know which side each message came from so the model
  // can read the back-and-forth correctly. ThreadMessage doesn't expose
  // direction, so we pull it in a single side query keyed by id.
  const isDmContext = isDmMessageType(message.message_type);
  const directionByMessageId = new Map<string, 'incoming' | 'outgoing'>();
  if (isDmContext && messages.length > 0) {
    const ids = messages.map((m) => m.message_id);
    const { data: dirRows } = await supabase
      .from('engagement_messages')
      .select('id, direction')
      .in('id', ids);
    for (const row of dirRows ?? []) {
      const dir = (row as any).direction;
      if (dir === 'incoming' || dir === 'outgoing') {
        directionByMessageId.set((row as any).id, dir);
      }
    }
  }

  const conversationTurns: ConversationTurn[] = isDmContext
    ? messages.map((entry) => ({
        author: entry.author?.display_name ?? entry.author?.username ?? null,
        content: entry.content ?? '',
        self: directionByMessageId.get(entry.message_id) === 'outgoing',
      }))
    : [];

  const targetAuthorName =
    matchedMessage?.author?.display_name ?? matchedMessage?.author?.username ?? null;

  // Build thread context with explicit framing so the model writes a reply
  // anchored to the right surface — for comments, both the post AND the
  // commenter's words; for DMs, the conversation history AND the latest
  // message from the other side.
  const threadContextLines: string[] = [];
  if (isDmContext) {
    threadContextLines.push(
      'TASK: Draft a reply in a private 1:1 direct-message conversation. Read the back-and-forth, pick up where it left off, and reply directly to the LATEST message from the other side. Do NOT re-greet if you have already greeted. Sound like a real person texting back.'
    );
    threadContextLines.push('CONVERSATION HISTORY (oldest → newest):');
    for (const entry of messages) {
      const isSelfTurn = directionByMessageId.get(entry.message_id) === 'outgoing';
      const who = isSelfTurn
        ? 'YOU (the creator)'
        : (entry.author?.display_name ?? entry.author?.username ?? 'Them');
      threadContextLines.push(`- ${who}: ${entry.content ?? ''}`);
    }
    threadContextLines.push(
      `LATEST MESSAGE TO REPLY TO (${targetAuthorName ?? 'them'}): ${message.content ?? ''}`
    );
  } else {
    threadContextLines.push(
      'TASK: Write a reply that is aligned to BOTH the original post AND the specific comment being replied to. Address the commenter by name when natural. Do not produce a generic acknowledgement.'
    );
    if (originalPostText) {
      threadContextLines.push(`ORIGINAL POST: ${originalPostText}`);
    }
    if (parentCommentText) {
      threadContextLines.push(
        `PARENT COMMENT (${parentCommentAuthor ?? 'someone'}): ${parentCommentText}`
      );
    }
    threadContextLines.push(
      `COMMENT YOU ARE REPLYING TO (${targetAuthorName ?? 'commenter'}): ${message.content ?? ''}`
    );
    if (messages.length > 1) {
      threadContextLines.push('OTHER COMMENTS IN THREAD (for context only — do NOT reply to these):');
      for (const entry of messages) {
        if (entry.message_id === message_id) continue;
        const who = entry.author?.display_name ?? entry.author?.username ?? 'User';
        threadContextLines.push(`- ${who}: ${entry.content ?? ''}`);
      }
    }
  }
  const threadContext = threadContextLines.join('\n');

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
      authorName: targetAuthorName,
      originalPost: originalPostText,
      isDm: isDmContext,
    });

  // Build the input shape used by the direct-OpenAI path. This path runs
  // when Omnivyra is disabled (USE_OMNIVYRA not set) but an OPENAI_API_KEY
  // is present, so suggestions are still LLM-generated and grounded in the
  // actual post + comment (or DM conversation) instead of falling back to
  // templates.
  const llmInput: LlmSuggestionInput = {
    organization_id,
    platform: message.platform ?? null,
    kind: isDmContext ? 'direct_message' : 'comment',
    originalPost: originalPostText,
    parentComment: parentCommentText
      ? { author: parentCommentAuthor, content: parentCommentText }
      : null,
    targetAuthor: targetAuthorName,
    targetMessage: message.content ?? '',
    brandVoice: voice || 'professional',
    conversation: conversationTurns,
  };

  const wrapAsResult = (replies: ReplySuggestion[]): GenerateReplySuggestionsResult => {
    const fallbackReplies = fallback().suggested_replies;
    const suggested_replies = enforceIntentCoverage(replies, fallbackReplies);
    return {
      suggested_replies,
    };
  };

  const preferDirectOpenAi = Boolean(config.OPENAI_API_KEY);
  if (preferDirectOpenAi) {
    const llmReplies = await generateReplySuggestionsViaOpenAi(llmInput);
    if (llmReplies && llmReplies.length > 0) {
      return wrapAsResult(llmReplies);
    }
  }

  if (!isOmnivyraEnabled()) {
    return wrapAsResult(fallback().suggested_replies);
  }

  try {
    const response = await evaluateCommunityAiEngagement({
      tenant_id: organization_id,
      organization_id,
      platform: message.platform ?? undefined,
      post_data: {
        // Differentiate so the model knows whether it's drafting a public
        // comment reply or a private 1:1 DM — the rules are different.
        message_kind: isDmContext ? 'direct_message' : 'comment',
        // Top-level post body — only meaningful for comment threads.
        original_post: !isDmContext ? originalPostText ?? undefined : undefined,
        // When the user is replying to a sub-thread reply, pass the parent
        // comment too so the AI sees the conversational context.
        parent_comment: parentCommentText
          ? { author: parentCommentAuthor ?? null, content: parentCommentText }
          : undefined,
        thread_messages: messages.map((entry) => ({
          author: entry.author?.display_name ?? entry.author?.username,
          content: entry.content,
          // For DMs, expose direction so the model can read the back-and-forth.
          self: isDmContext ? directionByMessageId.get(entry.message_id) === 'outgoing' : undefined,
        })),
        // Pass the target commenter's identity alongside the message so the
        // model can address them by name and produce a reply that is clearly
        // a response to *their* comment, not a generic acknowledgement.
        target_message: message.content,
        target_author: targetAuthorName ?? undefined,
        reply_suggestion_directive:
          'Return exactly three materially different response paths in this order: YES/accept/help, NO/decline/boundary, MAYBE/clarify/ask for missing details.',
        alignment_directive: isDmContext
          ? 'This is a 1:1 direct message — read the conversation history first, do NOT re-greet, reply directly to the latest message. Sound like a human texting back, not a public-facing brand statement. Suggestions must be different response choices, not restyled duplicates.'
          : 'The reply MUST reference both the original post topic and the specific comment text. Address the commenter by first name when available. Avoid generic acknowledgements. Suggestions must be different response choices, not restyled duplicates.',
      },
      engagement_metrics: {},
      brand_voice: voice || 'professional',
      context: { thread_context: threadContext.slice(0, 4000) },
    });

    const suggested_actions =
      (response?.status === 'ok' && response?.data?.suggested_actions) ?? [];
    const replyActions = suggested_actions.filter(
      (action: any) => action?.action_type === 'reply' && action?.suggested_text
    );

    const suggested_replies: ReplySuggestion[] = replyActions.slice(0, 3).map((action: any) => {
      const text = (action.suggested_text ?? '').toString().trim();
      const bucket = classifyReplyIntent({
        text,
        tone: typeof action?.tone === 'string' ? action.tone : undefined,
      });
      return { text, tone: bucket ? toneForBucket(bucket) : undefined };
    });

    if (suggested_replies.length === 0) {
      const llmReplies = await generateReplySuggestionsViaOpenAi(llmInput);
      if (llmReplies && llmReplies.length > 0) return wrapAsResult(llmReplies);
      return wrapAsResult(fallback().suggested_replies);
    }

    return wrapAsResult(suggested_replies);
  } catch (err) {
    console.warn('[engagementAiAssistantService] Omnivyra error:', (err as Error)?.message);
    const llmReplies = await generateReplySuggestionsViaOpenAi(llmInput);
    if (llmReplies && llmReplies.length > 0) return wrapAsResult(llmReplies);
    return wrapAsResult(fallback().suggested_replies);
  }
}
