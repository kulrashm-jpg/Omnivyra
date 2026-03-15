/**
 * Engagement Score Service
 * Normalized scoring for engagement signals with modifiers.
 */

export type SignalType =
  | 'comment'
  | 'reply'
  | 'mention'
  | 'quote'
  | 'discussion'
  | 'buyer_intent_signal';

export interface SignalInput {
  signal_type: SignalType | string;
  sentiment?: 'positive' | 'neutral' | 'negative' | string | null;
  author_influence?: number; // 0-1
  thread_depth?: number; // reply depth in thread
}

const BASE_SCORES: Record<string, number> = {
  comment: 5,
  reply: 4,
  mention: 3,
  quote: 3,
  discussion: 2,
  buyer_intent_signal: 10,
};

const SENTIMENT_MODIFIER: Record<string, number> = {
  positive: 1.2,
  neutral: 1.0,
  negative: 0.8,
};

const MAX_SCORE = 100;
const NORMALIZED_SCALE = 100; // raw score mapped to 0-1 for engagement_score

/**
 * Calculate engagement score for a signal.
 * Base score by type + sentiment + author influence + thread depth.
 */
export function calculateEngagementScore(signal: SignalInput): number {
  const base = BASE_SCORES[signal.signal_type] ?? 2;
  let score = base;

  if (signal.sentiment && SENTIMENT_MODIFIER[signal.sentiment]) {
    score *= SENTIMENT_MODIFIER[signal.sentiment];
  }

  if (signal.author_influence != null && signal.author_influence > 0) {
    score *= 1 + signal.author_influence * 0.5; // up to +50%
  }

  if (signal.thread_depth != null && signal.thread_depth > 0) {
    score *= 1 + Math.min(signal.thread_depth * 0.1, 0.5); // up to +50%
  }

  const clamped = Math.min(MAX_SCORE, Math.max(0, score));
  return Math.round((clamped / NORMALIZED_SCALE) * 100) / 100;
}
