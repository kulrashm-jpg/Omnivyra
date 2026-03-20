/**
 * Engagement Insight Service
 * Detects buyer intent, conversation clusters, and opportunity signals from engagement.
 * Stores insights in engagement_opportunities when applicable.
 */

import { supabase } from '../db/supabaseClient';

export interface EngagementSignal {
  id: string;
  campaign_id: string;
  activity_id: string;
  platform: string;
  author?: string | null;
  content?: string | null;
  signal_type: string;
  engagement_score: number;
  detected_at: string;
}

export interface BuyerIntentInsight {
  signal_ids: string[];
  summary: string;
  confidence: number;
  topics: string[];
}

export interface ConversationClusterInsight {
  signal_ids: string[];
  summary: string;
  topic: string;
  signal_count: number;
}

export interface OpportunitySignalInsight {
  signal_ids: string[];
  summary: string;
  opportunity_type: string;
  relevance_score: number;
}

const BUYER_KEYWORDS = [
  'price', 'pricing', 'cost', 'demo', 'trial', 'buy', 'purchase', 'quote', 'discount',
  'subscription', 'plan', 'enterprise', 'contact sales', 'schedule a call',
];

export async function detectBuyerIntent(signals: EngagementSignal[]): Promise<BuyerIntentInsight[]> {
  const insights: BuyerIntentInsight[] = [];
  const withContent = signals.filter((s) => s.content && String(s.content).trim().length > 5);
  const intentSignals = withContent.filter((s) => {
    const lower = (s.content || '').toLowerCase();
    return BUYER_KEYWORDS.some((k) => lower.includes(k));
  });

  if (intentSignals.length > 0) {
    const topics = new Set<string>();
    intentSignals.forEach((s) => {
      BUYER_KEYWORDS.forEach((k) => {
        if ((s.content || '').toLowerCase().includes(k)) topics.add(k);
      });
    });
    insights.push({
      signal_ids: intentSignals.map((x) => x.id),
      summary: `Multiple signals (${intentSignals.length}) mention pricing, demo, or purchase intent.`,
      confidence: Math.min(0.9, 0.5 + intentSignals.length * 0.1),
      topics: Array.from(topics),
    });
  }
  return insights;
}

export async function detectConversationClusters(signals: EngagementSignal[]): Promise<ConversationClusterInsight[]> {
  const clusters: ConversationClusterInsight[] = [];
  const byTopic = new Map<string, EngagementSignal[]>();

  for (const s of signals) {
    const content = (s.content || '').toLowerCase();
    let topic = 'general';
    if (content.includes('ai') || content.includes('artificial intelligence')) topic = 'AI productivity';
    else if (content.includes('pricing') || content.includes('cost')) topic = 'Pricing';
    else if (content.includes('feature') || content.includes('integration')) topic = 'Product features';
    else if (content.includes('support') || content.includes('help')) topic = 'Support';
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(s);
  }

  for (const [topic, list] of byTopic) {
    if (list.length >= 2) {
      clusters.push({
        signal_ids: list.map((x) => x.id),
        summary: `Community discussion emerging around ${topic}.`,
        topic,
        signal_count: list.length,
      });
    }
  }
  return clusters;
}

export async function detectOpportunitySignals(signals: EngagementSignal[]): Promise<OpportunitySignalInsight[]> {
  const insights: OpportunitySignalInsight[] = [];
  const highScore = signals.filter((s) => Number(s.engagement_score) >= 0.6);
  if (highScore.length > 0) {
    const buyer = await detectBuyerIntent(highScore);
    if (buyer.length > 0) {
      insights.push({
        signal_ids: buyer[0].signal_ids,
        summary: buyer[0].summary,
        opportunity_type: 'buyer_intent',
        relevance_score: buyer[0].confidence,
      });
    }
  }
  return insights;
}

// ── Planning-loop engagement insights ────────────────────────────────────────

export type PlanningEngagementInsights = {
  account_id: string;
  top_questions: string[];
  objections: string[];
  buying_signals: string[];
  sentiment_trend: 'positive' | 'neutral' | 'negative' | 'mixed';
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
  generated_at: string;
};

const QUESTION_PATTERNS  = [/\?$/, /\bhow\b/i, /\bwhy\b/i, /\bwhat\b/i, /\bwhen\b/i, /\bwhere\b/i];
const OBJECTION_PATTERNS = [/\btoo expensive\b/i, /\bnot sure\b/i, /\bconcern\b/i, /\bwon'?t work\b/i, /\bworried\b/i];
const BUYING_PATTERNS    = [/\bhow (do|can) I (buy|get|purchase|sign up|start)\b/i, /\bprice\b/i, /\bcost\b/i, /\binterested\b/i];

/**
 * Extract planning-loop signals from recent community engagement for an account.
 * Injects into PlanningInput.engagement_insights before the next campaign cycle.
 */
export async function generateEngagementInsights(accountId: string): Promise<PlanningEngagementInsights> {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();

  const { data } = await supabase
    .from('community_ai_actions')
    .select('suggested_text, intent_classification, tone')
    .eq('organization_id', accountId)
    .gte('created_at', since)
    .limit(500);

  const empty: PlanningEngagementInsights = {
    account_id: accountId, top_questions: [], objections: [], buying_signals: [],
    sentiment_trend: 'neutral', positive_pct: 0, negative_pct: 0, neutral_pct: 0, generated_at: now,
  };
  if (!data?.length) return empty;

  const questions: string[] = [], objections: string[] = [], buyingSignals: string[] = [];
  let pos = 0, neg = 0, neu = 0;

  for (const row of data as Array<{ suggested_text?: string | null; intent_classification?: Record<string, unknown> | null; tone?: string | null }>) {
    const text = String(row.suggested_text ?? '').trim();
    if (!text) continue;
    const sentiment = String((row.intent_classification as any)?.sentiment ?? row.tone ?? 'neutral').toLowerCase();
    if (sentiment === 'positive') pos++; else if (sentiment === 'negative') neg++; else neu++;
    if (QUESTION_PATTERNS.some((p) => p.test(text)) && questions.length < 10) questions.push(text);
    if (OBJECTION_PATTERNS.some((p) => p.test(text)) && objections.length < 10) objections.push(text);
    if (BUYING_PATTERNS.some((p) => p.test(text)) && buyingSignals.length < 10) buyingSignals.push(text);
  }

  const total = pos + neg + neu || 1;
  const posPct = Math.round((pos / total) * 100);
  const negPct = Math.round((neg / total) * 100);
  let trend: PlanningEngagementInsights['sentiment_trend'] = 'neutral';
  if (posPct >= 60) trend = 'positive';
  else if (negPct >= 40) trend = 'negative';
  else if (Math.abs(posPct - negPct) <= 20 && (pos + neg) > 5) trend = 'mixed';

  return {
    account_id: accountId,
    top_questions: questions.slice(0, 5),
    objections: objections.slice(0, 5),
    buying_signals: buyingSignals.slice(0, 5),
    sentiment_trend: trend,
    positive_pct: posPct,
    negative_pct: negPct,
    neutral_pct: 100 - posPct - negPct,
    generated_at: now,
  };
}

export async function storeInsightAsOpportunity(
  organizationId: string,
  insight: {
    summary: string;
    opportunity_type: string;
    platform: string;
    source_thread_id?: string;
    source_message_id?: string;
    author_id?: string;
  }
): Promise<string | null> {
  try {
    const { data: existingThread } = await supabase
      .from('engagement_threads')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    let threadId = insight.source_thread_id;
    if (!threadId && existingThread?.id) {
      const { data: firstMsg } = await supabase
        .from('engagement_messages')
        .select('id')
        .eq('thread_id', existingThread.id)
        .limit(1)
        .maybeSingle();
      threadId = existingThread.id;
      const msgId = insight.source_message_id || (firstMsg as { id?: string })?.id;
      if (msgId) {
        const { data: opp } = await supabase
          .from('engagement_opportunities')
          .insert({
            organization_id: organizationId,
            platform: insight.platform,
            source_thread_id: threadId,
            source_message_id: msgId,
            author_id: insight.author_id ?? null,
            opportunity_type: insight.opportunity_type,
            opportunity_text: insight.summary,
            confidence_score: 0.7,
            priority_score: 0.6,
          })
          .select('id')
          .single();
        return (opp as { id?: string })?.id ?? null;
      }
    }
  } catch (err) {
    console.warn('[engagementInsightService] storeInsightAsOpportunity:', (err as Error)?.message);
  }
  return null;
}
