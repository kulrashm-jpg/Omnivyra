/**
 * Reply Generation Service
 *
 * Generates a platform-tone-matched reply to a comment.
 * Input:  comment, platform, parent_post context, sentiment
 * Output: reply text + confidence score
 *
 * Uses few-shot prompting with platform-specific tone guidelines.
 * Model: Claude Haiku (cost-efficient for reply-scale volume).
 */

import OpenAI from 'openai';
import type { SentimentLabel } from './engagementIngestService';
import { deductCreditsAwaited as deductCredits } from './creditExecutionService';
import {
  formatContentForPlatform,
  getPlatformLimits,
} from '../utils/contentFormatter';

const getClient = (): OpenAI => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizePlatform(platform: string): string {
  const normalized = String(platform ?? '').toLowerCase().trim();
  return normalized === 'twitter' ? 'x' : normalized;
}

export type ReplyInput = {
  comment: string;
  platform: string;
  parent_post?: string | null;
  sentiment: SentimentLabel;
  brand_voice?: string | null;
  /** Company/org ID for credit deduction */
  company_id?: string | null;
};

export type ReplyOutput = {
  reply: string;
  confidence: number;
  tone_used: string;
  platform: string;
};

const PLATFORM_TONE: Record<string, string> = {
  linkedin:  'professional, thoughtful, first-person, no slang',
  instagram: 'warm, friendly, casual, emoji welcome, brief',
  tiktok:    'energetic, casual, Gen-Z aware, very brief, emoji ok',
  x:         'punchy, direct, under 140 chars, no filler',
  facebook:  'conversational, warm, community-first, slightly longer ok',
  reddit:    'honest, humble, no corporate speak, cite reasoning',
  youtube:   'appreciative, encouraging, reference the video',
  pinterest: 'aspirational, helpful, keyword-aware',
};

const PLATFORM_REPLY_RULES: Record<string, string> = {
  linkedin: 'Write 1-3 short sentences. Be useful, credible, and human. Avoid hashtags unless the comment itself clearly uses one that matters.',
  instagram: 'Write 1-2 short sentences. Warm and friendly is good. Light emoji is acceptable, but keep it natural.',
  tiktok: 'Write 1 short sentence or 2 very short lines. Keep it energetic and native, not corporate.',
  x: 'Keep it tight and punchy. Prefer one concise response under 220 characters. No hashtags unless absolutely necessary.',
  facebook: 'Write 1-3 conversational sentences. Sound approachable and community-minded, not scripted.',
  reddit: 'Be direct, grounded, and specific. No corporate language, no hashtags, no salesy CTA, and no unnecessary emoji.',
  youtube: 'Acknowledge the viewer and reference the video or takeaway when relevant. Keep it encouraging and concise.',
  pinterest: 'Keep it short, helpful, and idea-oriented. Focus on the practical takeaway or inspiration, not chatter.',
};

const PLATFORM_REPLY_BUDGET: Record<string, number> = {
  linkedin: 500,
  instagram: 240,
  tiktok: 180,
  x: 220,
  facebook: 500,
  reddit: 600,
  youtube: 350,
  pinterest: 300,
};

const SENTIMENT_STRATEGY: Record<SentimentLabel, string> = {
  positive: 'Acknowledge and amplify — thank them and add a related insight.',
  neutral:  'Add value — answer the implied question or extend the conversation.',
  negative: 'De-escalate — acknowledge concern sincerely, offer to help, no defensiveness.',
  intent:   'Convert gently — answer the buying question, provide next step, no hard sell.',
};

const FEW_SHOT: Record<SentimentLabel, { comment: string; reply: string }> = {
  positive: {
    comment: 'This was so helpful, thank you!',
    reply:   'So glad it landed well! If you want to go deeper on this, I share more on [topic] regularly — stay tuned.',
  },
  neutral: {
    comment: 'Interesting perspective.',
    reply:   'Appreciate you engaging! Curious — what part resonated most with you? Always good to hear different angles.',
  },
  negative: {
    comment: 'I tried this and it didn\'t work for me at all.',
    reply:   'Really sorry to hear that — that\'s not the experience we want for anyone. Would you mind sharing more details? Happy to help directly.',
  },
  intent: {
    comment: 'How much does this cost?',
    reply:   'Great question! Pricing depends on your setup — the best first step is [link/action]. Happy to walk you through options.',
  },
};

export async function generateReply(input: ReplyInput): Promise<ReplyOutput> {
  const platform   = normalizePlatform(input.platform ?? '');
  const toneGuide  = PLATFORM_TONE[platform] ?? 'professional and helpful';
  const replyRules = PLATFORM_REPLY_RULES[platform] ?? 'Keep it concise, helpful, and natural.';
  const strategy   = SENTIMENT_STRATEGY[input.sentiment] ?? SENTIMENT_STRATEGY.neutral;
  const example    = FEW_SHOT[input.sentiment] ?? FEW_SHOT.neutral;
  const brandVoice = input.brand_voice ? `\nBrand voice: ${input.brand_voice}` : '';
  const platformLimit = getPlatformLimits(platform).maxChars;
  const replyBudget = Math.min(
    platformLimit,
    PLATFORM_REPLY_BUDGET[platform] ?? 400,
  );

  const systemPrompt = `You are a community manager writing replies on ${platform}.
Tone: ${toneGuide}${brandVoice}
Strategy: ${strategy}
Platform rules: ${replyRules}
Reply length budget: stay under ${replyBudget} characters.
Keep replies concise and authentic. Never sound robotic or templated.`;

  const userPrompt = `Example:
Comment: "${example.comment}"
Reply: "${example.reply}"

Now reply to this comment${input.parent_post ? ` on this post:\n"${input.parent_post.slice(0, 300)}"` : ''}:
Comment: "${input.comment.slice(0, 500)}"

Respond with JSON: {"reply":"<text>","confidence":<0-1>}`;

  try {
    const response = await getClient().chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(raw);
    const formatted = formatContentForPlatform(String(parsed.reply ?? ''), platform, {
      hashtags: [],
      mentions: [],
      links: [],
    });
    const reply = formatted.text.trim().slice(0, replyBudget).trim();
    if (input.company_id) {
      await deductCredits(input.company_id, 'reply_generation', { note: `Reply on ${platform}` });
    }
    return {
      reply,
      confidence: Number(parsed.confidence) || 0.7,
      tone_used:  toneGuide,
      platform,
    };
  } catch {
    return {
      reply:      '',
      confidence: 0,
      tone_used:  toneGuide,
      platform,
    };
  }
}
