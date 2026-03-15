/**
 * Engagement Opportunity Engine
 * Scans signals for demand spikes, repeated questions, competitive mentions, emerging topics.
 */

export type EngagementSignalInput = {
  id: string;
  campaign_id: string;
  activity_id: string;
  platform: string;
  content?: string | null;
  signal_type?: string | null;
  engagement_score?: number;
  detected_at?: string | null;
};

export type DetectedOpportunity = {
  opportunity_type: 'buyer_intent' | 'topic_trend' | 'community_discussion' | 'competitor_mention' | 'product_question';
  source: string;
  title: string;
  description: string;
  confidence_score: number;
  signal_count: number;
  engagement_score_avg: number;
  signal_ids: string[];
  topic_keywords: string[];
  related_campaign_id?: string | null;
};

const DEMAND_KEYWORDS = [
  'price', 'pricing', 'cost', 'demo', 'trial', 'buy', 'purchase', 'quote', 'enterprise',
  'subscription', 'integration', 'api', 'sdk', 'roi', 'implement',
];
const QUESTION_PATTERNS = /\?|how (do|can|does)|what (is|are)|why |when |where |which |who /i;
const COMPETITOR_PATTERNS = /\b(competitor|vs | versus |compared to|alternative to|better than|instead of)\b/i;

export async function scanSignalsForOpportunities(signals: EngagementSignalInput[]): Promise<DetectedOpportunity[]> {
  const opportunities: DetectedOpportunity[] = [];

  const demand = await detectDemandSpikes(signals);
  opportunities.push(...demand);

  const questions = await detectRepeatedQuestions(signals);
  opportunities.push(...questions);

  const competitive = await detectCompetitiveMentions(signals);
  opportunities.push(...competitive);

  const emerging = await detectEmergingTopics(signals);
  opportunities.push(...emerging);

  return opportunities;
}

export async function detectDemandSpikes(signals: EngagementSignalInput[]): Promise<DetectedOpportunity[]> {
  const withContent = signals.filter((s) => s.content && String(s.content).trim().length > 5);
  const keywordCounts = new Map<string, { count: number; signalIds: string[]; scores: number[] }>();

  for (const s of withContent) {
    const lower = (s.content || '').toLowerCase();
    for (const kw of DEMAND_KEYWORDS) {
      if (lower.includes(kw)) {
        const entry = keywordCounts.get(kw) || { count: 0, signalIds: [], scores: [] };
        entry.count++;
        entry.signalIds.push(s.id);
        entry.scores.push(Number(s.engagement_score) || 0);
        keywordCounts.set(kw, entry);
      }
    }
  }

  const opportunities: DetectedOpportunity[] = [];
  for (const [keyword, { count, signalIds, scores }] of keywordCounts) {
    if (count >= 10) {
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      opportunities.push({
        opportunity_type: 'buyer_intent',
        source: 'campaign_engagement',
        title: `Demand spike: ${keyword}`,
        description: `${count} signals mention ${keyword} in the last 24 hours.`,
        confidence_score: Math.min(0.95, 0.6 + count * 0.02),
        signal_count: count,
        engagement_score_avg: avgScore,
        signal_ids: signalIds,
        topic_keywords: [keyword],
        related_campaign_id: signals[0]?.campaign_id,
      });
    }
  }
  return opportunities;
}

export async function detectRepeatedQuestions(signals: EngagementSignalInput[]): Promise<DetectedOpportunity[]> {
  const withContent = signals.filter((s) => s.content && String(s.content).trim().length > 3);
  const questionSignals = withContent.filter((s) => QUESTION_PATTERNS.test(s.content || ''));

  if (questionSignals.length >= 5) {
    const avgScore =
      questionSignals.length > 0
        ? questionSignals.reduce((a, s) => a + (Number(s.engagement_score) || 0), 0) / questionSignals.length
        : 0;
    return [
      {
        opportunity_type: 'product_question',
        source: 'campaign_engagement',
        title: 'Repeated product questions',
        description: `${questionSignals.length} signals contain question intent. Community seeking clarification.`,
        confidence_score: Math.min(0.9, 0.5 + questionSignals.length * 0.05),
        signal_count: questionSignals.length,
        engagement_score_avg: avgScore,
        signal_ids: questionSignals.map((s) => s.id),
        topic_keywords: ['questions', 'support'],
        related_campaign_id: questionSignals[0]?.campaign_id,
      },
    ];
  }
  return [];
}

export async function detectCompetitiveMentions(signals: EngagementSignalInput[]): Promise<DetectedOpportunity[]> {
  const withContent = signals.filter((s) => s.content && String(s.content).trim().length > 5);
  const competitiveSignals = withContent.filter((s) => COMPETITOR_PATTERNS.test(s.content || ''));

  if (competitiveSignals.length >= 2) {
    const avgScore =
      competitiveSignals.length > 0
        ? competitiveSignals.reduce((a, s) => a + (Number(s.engagement_score) || 0), 0) / competitiveSignals.length
        : 0;
    return [
      {
        opportunity_type: 'competitor_mention',
        source: 'campaign_engagement',
        title: 'Competitive mentions detected',
        description: `${competitiveSignals.length} signals mention competitors or product comparisons.`,
        confidence_score: Math.min(0.85, 0.5 + competitiveSignals.length * 0.1),
        signal_count: competitiveSignals.length,
        engagement_score_avg: avgScore,
        signal_ids: competitiveSignals.map((s) => s.id),
        topic_keywords: ['competitor', 'comparison'],
        related_campaign_id: competitiveSignals[0]?.campaign_id,
      },
    ];
  }
  return [];
}

export async function detectEmergingTopics(signals: EngagementSignalInput[]): Promise<DetectedOpportunity[]> {
  const topicCounts = new Map<string, { count: number; signalIds: string[]; scores: number[] }>();
  const topics = ['ai', 'integration', 'pricing', 'productivity', 'automation', 'api', 'security'];

  for (const s of signals) {
    const content = (s.content || '').toLowerCase();
    for (const t of topics) {
      if (content.includes(t)) {
        const entry = topicCounts.get(t) || { count: 0, signalIds: [], scores: [] };
        entry.count++;
        entry.signalIds.push(s.id);
        entry.scores.push(Number(s.engagement_score) || 0);
        topicCounts.set(t, entry);
      }
    }
  }

  const opportunities: DetectedOpportunity[] = [];
  for (const [topic, { count, signalIds, scores }] of topicCounts) {
    if (count >= 5) {
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      opportunities.push({
        opportunity_type: 'topic_trend',
        source: 'campaign_engagement',
        title: `Emerging topic: ${topic}`,
        description: `${count} signals discuss ${topic}. Consider dedicated content.`,
        confidence_score: 0.7,
        signal_count: count,
        engagement_score_avg: avgScore,
        signal_ids: signalIds,
        topic_keywords: [topic],
        related_campaign_id: signals[0]?.campaign_id,
      });
    }
  }
  return opportunities;
}
