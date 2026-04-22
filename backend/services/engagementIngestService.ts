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
import { logUsageEvent, resolveLlmCost } from './usageLedgerService';

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

/**
 * Classify a single comment via LLM. Fast-path avoids API cost for obvious cases.
 *
 * Cost tracking: this is a background-ingest path (not user-triggered), so LLM
 * calls are logged with source_type='system' for cost visibility without user
 * billing. companyId is required for attribution (D4: best-effort user_id).
 */
export async function classifySentiment(
  comment: string,
  opts: { companyId: string; userId?: string | null },
): Promise<SentimentResult> {
  if (!comment?.trim()) return { label: 'neutral', confidence: 1, reasoning: 'empty' };

  const fast = fastClassify(comment);
  if (fast) return { label: fast, confidence: 0.85, reasoning: 'rule-based fast path' };

  if (!opts?.companyId) {
    throw new Error('classifySentiment requires opts.companyId for cost attribution');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  try {
    const response = await getClient().chat.completions.create({
      model,
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `Classify the sentiment of this comment in one word: positive, neutral, negative, or intent (buying intent).\nComment: "${comment.slice(0, 500)}"\nRespond with JSON: {"label":"<label>","confidence":<0-1>,"reasoning":"<brief>"}`,
        },
      ],
    });

    const promptTokens     = Number(response.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(response.usage?.completion_tokens ?? 0);
    const totalTokens      = Number(response.usage?.total_tokens ?? promptTokens + completionTokens);
    const cost = await resolveLlmCost({
      providerName: 'openai',
      modelName: model,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      processType: 'sentiment_classification',
      organizationId: opts.companyId,
    });
    void logUsageEvent({
      organization_id: opts.companyId,
      user_id:         opts.userId ?? null,
      source_type:     'system',
      provider_name:   'openai',
      model_name:      model,
      source_name:     'openai',
      process_type:    'sentiment_classification',
      feature_area:    'engagement_ingest',
      input_tokens:    promptTokens,
      output_tokens:   completionTokens,
      total_tokens:    totalTokens,
      latency_ms:      Date.now() - startedAt,
      unit_cost:       totalTokens > 0 ? cost.total_cost_usd / totalTokens : null,
      total_cost:      cost.total_cost_usd,
      total_cost_usd:  cost.total_cost_usd,
      final_price_usd: cost.final_price_usd,
      pricing_snapshot: cost.pricing_snapshot,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(raw);
    return {
      label: (['positive', 'neutral', 'negative', 'intent'].includes(parsed.label) ? parsed.label : 'neutral') as SentimentLabel,
      confidence: Number(parsed.confidence) || 0.7,
      reasoning: String(parsed.reasoning ?? ''),
    };
  } catch (err: any) {
    void logUsageEvent({
      organization_id: opts.companyId,
      user_id:         opts.userId ?? null,
      source_type:     'system',
      provider_name:   'openai',
      model_name:      model,
      source_name:     'openai',
      process_type:    'sentiment_classification',
      feature_area:    'engagement_ingest',
      latency_ms:      Date.now() - startedAt,
      error_flag:      true,
      error_type:      err?.message?.slice(0, 200) ?? 'unknown',
    });
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
  const sentiment = await classifySentiment(input.comment, {
    companyId: input.organization_id,
  });

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
