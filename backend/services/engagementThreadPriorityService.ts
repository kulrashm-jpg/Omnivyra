/**
 * Engagement Thread Priority Service
 *
 * Computes priority_score for engagement threads.
 * Combines content-based signals with intelligence signals (Phase 3).
 * Used by inbox for sorting.
 */

export type ThreadPriorityInput = {
  content?: string | null;
  sentiment_score?: number | null;
  has_question?: boolean;
  /** Phase 3: from engagement_thread_intelligence */
  negative_feedback?: boolean;
  lead_detected?: boolean;
  customer_question?: boolean;
  influencer_signal?: boolean;
};

export type ThreadPriorityResult = {
  priority_score: number;
  priority_label: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string[];
};

const NEGATIVE_SENTIMENT_THRESHOLD = -0.3;
const MAX_SCORE = 100;

const INTELLIGENCE_BOOSTS = {
  negative_feedback: 40,
  lead_detected: 30,
  customer_question: 25,
  influencer_signal: 20,
};

export function scoreThreadPriority(input: ThreadPriorityInput): ThreadPriorityResult {
  const reasoning: string[] = [];
  let score = 0;

  const content = (input.content ?? '').toString().trim();
  const sentiment = input.sentiment_score != null ? Number(input.sentiment_score) : null;
  const hasQuestion = input.has_question ?? content.includes('?');

  if (input.negative_feedback) {
    score += INTELLIGENCE_BOOSTS.negative_feedback;
    reasoning.push('negative_feedback: +40');
  }
  if (input.lead_detected) {
    score += INTELLIGENCE_BOOSTS.lead_detected;
    reasoning.push('lead_detected: +30');
  }
  if (input.customer_question) {
    score += INTELLIGENCE_BOOSTS.customer_question;
    reasoning.push('customer_question: +25');
  }
  if (input.influencer_signal) {
    score += INTELLIGENCE_BOOSTS.influencer_signal;
    reasoning.push('influencer_signal: +20');
  }

  if (hasQuestion && !input.customer_question) {
    score += 25;
    reasoning.push('contains question: +25');
  }

  if (sentiment != null && sentiment < NEGATIVE_SENTIMENT_THRESHOLD && !input.negative_feedback) {
    score += 30;
    reasoning.push('negative sentiment: +30');
  }

  const lower = content.toLowerCase();
  const negativeWords = ['problem', 'bad', 'issue', 'not working', 'disappointed', 'frustrated'];
  if (negativeWords.some((w) => lower.includes(w)) && !input.negative_feedback) {
    score += 20;
    reasoning.push('negative signal in content: +20');
  }

  const leadWords = ['interested', 'contact', 'demo', 'pricing', 'schedule'];
  if (leadWords.some((w) => lower.includes(w)) && !input.lead_detected) {
    score += 15;
    reasoning.push('lead intent signal: +15');
  }

  const capped = Math.min(MAX_SCORE, Math.max(0, score));

  let priority_label: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (capped >= 50) priority_label = 'HIGH';
  else if (capped >= 25) priority_label = 'MEDIUM';

  return {
    priority_score: capped,
    priority_label,
    reasoning: reasoning.length > 0 ? reasoning : ['base score'],
  };
}
