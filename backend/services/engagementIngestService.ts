/**
 * Engagement Ingest Service
 *
 * Classifies sentiment on every comment/reply as it is ingested.
 * Stores result in community_ai_actions.intent_classification.sentiment.
 * Aggregates campaign_sentiment_score into campaign_health_reports.
 *
 * Sentiment labels: positive | neutral | negative | intent
 * Uses Claude Haiku for cost-efficient real-time classification.
 */

import OpenAI from 'openai';
import { supabase } from '../db/supabaseClient';

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'intent';

export type SentimentResult = {
  label: SentimentLabel;
  confidence: number;
  reasoning: string;
};

const getClient = (): OpenAI => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Rule-based fast-path for obvious cases (avoids API cost). */
function fastClassify(text: string): SentimentLabel | null {
  const lower = text.toLowerCase();
  if (/\b(love|great|amazing|excellent|thank|awesome|perfect|brilliant)\b/.test(lower)) return 'positive';
  if (/\b(hate|terrible|awful|scam|fraud|useless|worst)\b/.test(lower)) return 'negative';
  if (/\b(price|cost|buy|purchase|demo|trial|how (do|can) I)\b/.test(lower)) return 'intent';
  return null;
}

/** Classify a single comment via LLM. Fast-path avoids API cost for obvious cases. */
export async function classifySentiment(comment: string): Promise<SentimentResult> {
  if (!comment?.trim()) return { label: 'neutral', confidence: 1, reasoning: 'empty' };

  const fast = fastClassify(comment);
  if (fast) return { label: fast, confidence: 0.85, reasoning: 'rule-based fast path' };

  try {
    const response = await getClient().chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `Classify the sentiment of this comment in one word: positive, neutral, negative, or intent (buying intent).\nComment: "${comment.slice(0, 500)}"\nRespond with JSON: {"label":"<label>","confidence":<0-1>,"reasoning":"<brief>"}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(raw);
    return {
      label: (['positive', 'neutral', 'negative', 'intent'].includes(parsed.label) ? parsed.label : 'neutral') as SentimentLabel,
      confidence: Number(parsed.confidence) || 0.7,
      reasoning: String(parsed.reasoning ?? ''),
    };
  } catch {
    return { label: 'neutral', confidence: 0.5, reasoning: 'classification failed' };
  }
}

/**
 * Ingest a comment: classify sentiment and persist to community_ai_actions.
 * Returns the action id.
 */
export async function ingestComment(input: {
  organization_id: string;
  platform: string;
  target_id: string;
  comment: string;
  author_id?: string | null;
}): Promise<{ action_id: string | null; sentiment: SentimentResult }> {
  const sentiment = await classifySentiment(input.comment);

  try {
    const { data, error } = await supabase
      .from('community_ai_actions')
      .insert({
        organization_id: input.organization_id,
        platform: input.platform,
        action_type: 'comment_ingest',
        target_id: input.target_id,
        suggested_text: input.comment,
        discovered_user_id: input.author_id ?? null,
        intent_classification: { sentiment: sentiment.label, confidence: sentiment.confidence },
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[engagementIngestService] insert failed', error.message);
      return { action_id: null, sentiment };
    }

    return { action_id: (data as { id: string }).id, sentiment };
  } catch {
    return { action_id: null, sentiment };
  }
}

/**
 * Compute aggregate campaign sentiment score (0–1, higher = more positive).
 * Score = (positive * 1 + neutral * 0.5 + intent * 0.7 + negative * 0) / total
 */
export async function computeCampaignSentimentScore(campaignId: string): Promise<number | null> {
  try {
    // Join via posts linked to campaign
    const { data } = await supabase
      .from('community_ai_actions')
      .select('intent_classification')
      .contains('intent_classification', { campaign_id: campaignId });

    if (!data?.length) return null;

    const rows = data as Array<{ intent_classification?: Record<string, unknown> | null }>;
    const weights: Record<string, number> = { positive: 1, intent: 0.7, neutral: 0.5, negative: 0 };

    const total = rows.length;
    const score = rows.reduce((sum, row) => {
      const label = String((row.intent_classification as any)?.sentiment ?? 'neutral');
      return sum + (weights[label] ?? 0.5);
    }, 0) / total;

    return Number(score.toFixed(3));
  } catch {
    return null;
  }
}
