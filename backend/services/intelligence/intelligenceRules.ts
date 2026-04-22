import type {
  PlatformActionStats,
  SuggestionStats,
  QueueStateSnapshot,
  TargetContext,
} from './intelligenceQueries';

/**
 * Rule-based intelligence derivations. Kept pure + deterministic so
 * the service layer stays thin and testable. All rules fail closed —
 * when signals are too sparse, the corresponding field returns null /
 * an empty list and the UI hides the widget.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type Confidence = {
  level: ConfidenceLevel;
  score: number; // 0..100
};

export type Recommendation = {
  type: 'dm_followup' | 'short_reply' | 'ask_question';
  label: string;
};

// ── Confidence ─────────────────────────────────────────────────────────────

const MIN_SAMPLES_FOR_CONFIDENCE = 5;

export function computeConfidence(input: {
  stats: PlatformActionStats | null;
  queue: QueueStateSnapshot;
}): Confidence {
  const stats = input.stats;
  const queue = input.queue;

  // Without enough samples, confidence is inherently low.
  if (!stats || stats.total_terminal < MIN_SAMPLES_FOR_CONFIDENCE) {
    return { level: 'low', score: 40 };
  }

  // Execution success rate (executed + sent_unverified counts as success,
  // matching the rollup view's convention).
  const success = stats.executed_count + stats.sent_unverified_count;
  const successRate = stats.total_terminal > 0 ? success / stats.total_terminal : 0;
  const successPart = successRate * 60; // 0..60

  // Platform reliability (RPA queue state snapshot). BLOCKED caps hard.
  let platformPart = 30; // 0..30 (assume healthy when unknown)
  if (queue.status === 'BLOCKED') platformPart = 0;
  else if (queue.status === 'DEGRADED') platformPart = 15;
  else if (queue.status === 'READY') platformPart = 30;

  // Recent-failure penalty. Each failure in the last hour shaves points.
  const recentPart = Math.max(0, 10 - Math.min(10, stats.recent_failure_count * 2)); // 0..10

  const score = Math.round(successPart + platformPart + recentPart);

  let level: ConfidenceLevel = 'low';
  if (score >= 85) level = 'high';
  else if (score >= 60) level = 'medium';

  return { level, score };
}

// ── Insight (single line) ──────────────────────────────────────────────────

const SHORT_REPLY_THRESHOLD = 160;      // chars
const HIGH_ACCEPT_THRESHOLD = 0.6;      // 60%+ suggestion acceptance

export function computeInsight(input: {
  platform: string;
  action_type: string;
  stats: PlatformActionStats | null;
  suggestions: SuggestionStats | null;
}): string | null {
  const platform = (input.platform || '').toLowerCase();
  const action = (input.action_type || '').toLowerCase();

  // Priority 1 — AI acceptance history is a strong human-confirmed signal.
  if (
    input.suggestions &&
    input.suggestions.shown_count >= 5 &&
    typeof input.suggestions.acceptance_rate === 'number' &&
    input.suggestions.acceptance_rate >= HIGH_ACCEPT_THRESHOLD
  ) {
    return 'AI suggestions work well here';
  }

  // Priority 2 — short-reply heuristic (only meaningful for reply-type actions).
  if (
    action === 'reply' &&
    input.stats &&
    typeof input.stats.avg_reply_length === 'number' &&
    input.stats.avg_reply_length > 0 &&
    input.stats.avg_reply_length <= SHORT_REPLY_THRESHOLD &&
    input.stats.executed_count >= 5
  ) {
    return 'Short replies perform better for this audience';
  }

  // Priority 3 — platform heuristic (Instagram / reply → questions).
  if (platform === 'instagram' && action === 'reply') {
    return 'Replies with questions increase engagement';
  }

  return null;
}

// ── Hints (max 2) ──────────────────────────────────────────────────────────

export function computeHints(input: {
  platform: string;
  action_type: string;
  stats: PlatformActionStats | null;
  targetContext: TargetContext | null;
}): string[] {
  const hints: string[] = [];
  const action = (input.action_type || '').toLowerCase();

  // Hint A — time-to-reply, for reply-type actions.
  if (action === 'reply') {
    hints.push('Reply within 5 min for higher response rate');
  }

  // Hint B — DM follow-up for active threads.
  if (
    input.targetContext &&
    input.targetContext.prior_action_count >= 1 &&
    input.targetContext.last_status === 'executed' &&
    action === 'reply'
  ) {
    hints.push('DM follow-ups increase conversions');
  }

  // Hint C — if execution is flaky, surface a trust hint instead.
  if (
    hints.length < 2 &&
    input.stats &&
    input.stats.total_terminal >= 5 &&
    input.stats.failed_count / Math.max(1, input.stats.total_terminal) > 0.3
  ) {
    hints.push('Recent failures detected — review wording');
  }

  return hints.slice(0, 2);
}

// ── Recommendation (optional, high-confidence only) ────────────────────────

export function computeRecommendation(input: {
  confidence: Confidence;
  platform: string;
  action_type: string;
  stats: PlatformActionStats | null;
  targetContext: TargetContext | null;
}): Recommendation | null {
  // Per spec: only emit when confidence is high — otherwise the UI
  // should not show the CTA block.
  if (input.confidence.level !== 'high') return null;

  const action = (input.action_type || '').toLowerCase();
  const platform = (input.platform || '').toLowerCase();

  // Active thread → DM follow-up.
  if (
    action === 'reply' &&
    input.targetContext &&
    input.targetContext.prior_action_count >= 1 &&
    input.targetContext.last_status === 'executed'
  ) {
    return { type: 'dm_followup', label: 'Send a DM follow-up to keep the thread warm' };
  }

  // Low engagement proxy: if avg reply length is long (>250) we suggest
  // shorter replies as the higher-performing pattern.
  if (
    action === 'reply' &&
    input.stats &&
    typeof input.stats.avg_reply_length === 'number' &&
    input.stats.avg_reply_length > 250 &&
    input.stats.executed_count >= 5
  ) {
    return { type: 'short_reply', label: 'Try a shorter reply (≤160 chars)' };
  }

  // Instagram reply → ask a question.
  if (platform === 'instagram' && action === 'reply') {
    return { type: 'ask_question', label: 'Ask a question to spark a reply' };
  }

  return null;
}
