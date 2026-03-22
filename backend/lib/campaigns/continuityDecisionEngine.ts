/**
 * Continuity Decision Engine — deterministic, rule-based, no AI, no async, no external deps.
 *
 * Answers: What should the next campaign do, given this campaign's outcome?
 *
 * Decision hierarchy:
 *   1. Evaluation status → primary action (continue / optimize / pivot)
 *   2. Goal type + action → topic strategy (deepen / refine / adjacent)
 *   3. Knowledge graph input → primary topic + alternative path
 *   4. Build reason + strategic rationale
 *   5. Decision confidence (separate from data confidence)
 *   6. Decision stability signal (sensitive to threshold proximity + metric variance)
 *   7. Strategic trade-off (what was gained vs sacrificed)
 *   8. Counterfactual insight (underperformed only)
 */

import type { EvaluationResult, EvaluationStatus, GoalType, MetricBreakdown } from './outcomeEvaluator';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ContinuityAction = 'continue' | 'optimize' | 'pivot';

export interface DecisionConfidence {
  level: 'high' | 'medium' | 'low';
  reason: string;
}

/** How stable is the recommendation to small changes in the data? */
export interface StabilitySignal {
  /** stable = safe to scale; sensitive = monitor; volatile = more data first */
  signal: 'stable' | 'sensitive' | 'volatile';
  message: string;
}

/** A metric-level trade-off: what the campaign excelled at vs fell short on. */
export interface TradeOff {
  gained:    string;
  sacrificed: string;
  summary:   string;
}

/** The second-best strategic path, giving decision-makers an informed choice. */
export interface AlternativePath {
  next_topic:          string;
  suggested_goal_type: GoalType;
  rationale:           string;
}

export interface TopicContext {
  current_topic:    string;
  related_topics:   string[];
  related_blog_ids: string[];
  goal_type:        GoalType;
}

export interface ContinuityDecision {
  action:              ContinuityAction;
  next_topic:          string;
  suggested_blog_id:   string | null;
  reason:              string;
  strategic_rationale: string;
  topic_strategy:      'deepen' | 'refine' | 'adjacent';
  suggested_goal_type: GoalType;
  decision_confidence: DecisionConfidence;
  stability:           StabilitySignal;
  trade_off:           TradeOff | null;
  alternative_path:    AlternativePath | null;
  counterfactual:      string | null;
}

// ---------------------------------------------------------------------------
// Internal config
// ---------------------------------------------------------------------------

const ACTION_MAP: Record<EvaluationStatus, {
  action: ContinuityAction;
  topic_strategy: 'deepen' | 'refine' | 'adjacent';
}> = {
  exceeded:      { action: 'continue', topic_strategy: 'deepen'   },
  met:           { action: 'optimize', topic_strategy: 'refine'   },
  underperformed:{ action: 'pivot',    topic_strategy: 'adjacent' },
};

const GOAL_PROGRESSION: Record<GoalType, GoalType> = {
  awareness:  'engagement',
  engagement: 'authority',
  authority:  'lead_gen',
  lead_gen:   'conversion',
  conversion: 'conversion',
};

const GOAL_FALLBACK: Record<GoalType, GoalType> = {
  awareness:  'awareness',
  engagement: 'awareness',
  authority:  'engagement',
  lead_gen:   'authority',
  conversion: 'lead_gen',
};

// Scoring thresholds (mirrored from outcomeEvaluator)
const SCORE_EXCEEDED = 85;
const SCORE_MET      = 60;

// ---------------------------------------------------------------------------
// Topic utilities
// ---------------------------------------------------------------------------

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2)
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Returns ranked related topics from most to least similar to currentTopic.
 * Filters out the current topic itself.
 */
function rankRelatedTopics(
  currentTopic: string,
  relatedTopics: string[],
  ascending: boolean   // ascending = most different first
): Array<{ t: string; ov: number }> {
  const cur = tokenize(currentTopic);
  return relatedTopics
    .filter((t) => t.toLowerCase() !== currentTopic.toLowerCase())
    .map((t) => ({ t, ov: overlap(cur, tokenize(t)) }))
    .sort((a, b) => ascending ? a.ov - b.ov : b.ov - a.ov);
}

function selectNextTopic(
  strategy: 'deepen' | 'refine' | 'adjacent',
  currentTopic: string,
  relatedTopics: string[]
): string {
  if (strategy === 'refine' || relatedTopics.length === 0) return currentTopic;
  const ranked = rankRelatedTopics(currentTopic, relatedTopics, strategy === 'adjacent');
  return ranked[0]?.t ?? relatedTopics[0];
}

// ---------------------------------------------------------------------------
// Decision confidence
// ---------------------------------------------------------------------------

function computeDecisionConfidence(
  score: number,
  dataConfidenceLevel: 'high' | 'medium' | 'low',
  relatedTopics: string[],
  action: ContinuityAction
): DecisionConfidence {
  let points = 60;
  const reasons: string[] = [];

  const distFromMet      = Math.abs(score - SCORE_MET);
  const distFromExceeded = Math.abs(score - SCORE_EXCEEDED);
  const minDist = Math.min(distFromMet, distFromExceeded);

  if (minDist <= 5) {
    points -= 25;
    reasons.push('score is very close to a decision boundary — the recommendation could shift with more data');
  } else if (minDist <= 10) {
    points -= 12;
    reasons.push('score is near a decision threshold');
  } else if (minDist >= 20) {
    points += 15;
    reasons.push('score is well clear of decision boundaries');
  }

  if (action !== 'optimize') {
    if (relatedTopics.length === 0) {
      points -= 20;
      reasons.push('no related topics available to inform the next direction');
    } else if (relatedTopics.length >= 5) {
      points += 10;
      reasons.push('strong topic graph with diverse options');
    } else if (relatedTopics.length >= 3) {
      points += 5;
    }
  }

  if (dataConfidenceLevel === 'low') {
    points -= 20;
    reasons.push('underlying data quality is low');
  } else if (dataConfidenceLevel === 'high') {
    points += 10;
    reasons.push('high-quality metric data');
  }

  const level: DecisionConfidence['level'] =
    points >= 80 ? 'high' : points >= 50 ? 'medium' : 'low';

  return { level, reason: reasons.join('; ') };
}

// ---------------------------------------------------------------------------
// Stability signal
// ---------------------------------------------------------------------------

/**
 * How stable is this decision under small perturbations?
 *
 * Factors:
 *   1. Score distance from thresholds: close = volatile.
 *   2. Metric ratio variance: divergent metrics = less reliable verdict.
 *   3. Number of metrics: fewer contributing metrics = less stable.
 */
function computeStabilitySignal(
  score: number,
  breakdown: MetricBreakdown[]
): StabilitySignal {
  const distFromMet      = Math.abs(score - SCORE_MET);
  const distFromExceeded = Math.abs(score - SCORE_EXCEEDED);
  const minDist = Math.min(distFromMet, distFromExceeded);

  // Metric ratio variance
  let stdDev = 0;
  if (breakdown.length >= 2) {
    const ratios = breakdown.map((m) => m.ratio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length;
    stdDev = Math.sqrt(variance);
  }

  const metricsOk = breakdown.length >= 3;

  // Classify
  if (minDist >= 20 && stdDev < 0.20 && metricsOk) {
    return {
      signal: 'stable',
      message: `Decision is stable across ${breakdown.length} metric${breakdown.length !== 1 ? 's' : ''} — safe to act with confidence.`,
    };
  }

  if (minDist <= 5 || (stdDev > 0.35 && minDist <= 15)) {
    return {
      signal: 'volatile',
      message: minDist <= 5
        ? 'Decision may shift with additional data — the score sits very close to a threshold. Collect more data before scaling.'
        : 'Metrics are sending mixed signals. The recommendation is directionally correct but may change — monitor before committing resources.',
    };
  }

  const detail =
    !metricsOk ? 'limited metric coverage'
    : stdDev > 0.20 ? 'some metric divergence'
    : 'moderate threshold distance';

  return {
    signal: 'sensitive',
    message: `Decision is moderately stable (${detail}). Consider a small test before a full commitment.`,
  };
}

// ---------------------------------------------------------------------------
// Strategic trade-off
// ---------------------------------------------------------------------------

const METRIC_LABEL: Record<string, string> = {
  total_reach:     'audience reach',
  engagement_rate: 'engagement rate',
  avg_likes:       'organic resonance',
  total_comments:  'conversation depth',
  total_clicks:    'click-through intent',
};

// Known structural tensions between metric pairs
const KNOWN_TENSION: Record<string, Record<string, string>> = {
  total_reach: {
    engagement_rate: 'Broad reach and deep engagement are often in tension — wider audiences typically engage at lower rates.',
    total_clicks:    'Wide visibility with limited conversion signal — distribution strategy likely drove reach without capturing intent.',
  },
  engagement_rate: {
    total_reach:  'Deep engagement from a focused audience, but breadth was sacrificed — consider amplification to extend reach.',
    total_clicks: 'High engagement without proportional click-through — content resonated but lacked a strong call to action.',
  },
  avg_likes: {
    total_clicks: 'Strong passive engagement (likes) without active conversion — emotional resonance is there, but intent isn\'t triggered.',
    total_reach:  'High resonance within existing audience — wider distribution could compound this organic signal.',
  },
  total_clicks: {
    avg_likes: 'High intent signal with lower organic resonance — action-oriented content at the cost of emotional connection.',
  },
};

function buildTradeOff(breakdown: MetricBreakdown[]): TradeOff | null {
  if (breakdown.length < 2) return null;

  const sorted = [...breakdown].sort((a, b) => b.ratio - a.ratio);
  const best  = sorted[0];
  const worst = sorted[sorted.length - 1];

  if (best.ratio - worst.ratio < 0.30) return null; // not a meaningful spread

  const gained    = METRIC_LABEL[best.metric]  ?? best.metric.replace(/_/g, ' ');
  const sacrificed = METRIC_LABEL[worst.metric] ?? worst.metric.replace(/_/g, ' ');

  const knownNote = KNOWN_TENSION[best.metric]?.[worst.metric] ?? null;

  const summary = knownNote
    ?? `${gained.charAt(0).toUpperCase() + gained.slice(1)} was strong (${Math.round(best.ratio * 100)}% of benchmark) while ${sacrificed} fell short (${Math.round(worst.ratio * 100)}%).`;

  return { gained, sacrificed, summary };
}

// ---------------------------------------------------------------------------
// Alternative path
// ---------------------------------------------------------------------------

function buildAlternativePath(
  strategy: 'deepen' | 'refine' | 'adjacent',
  currentTopic: string,
  relatedTopics: string[],
  primaryTopic: string,
  primaryGoal: GoalType,
  currentGoal: GoalType,
  status: EvaluationStatus
): AlternativePath | null {
  // For 'refine' (met): primary = same topic; alternative = lightest pivot possible
  if (strategy === 'refine') {
    const alt = relatedTopics.find((t) => t.toLowerCase() !== currentTopic.toLowerCase());
    if (!alt) return null;
    return {
      next_topic:          alt,
      suggested_goal_type: currentGoal,
      rationale: `Instead of refining the same topic, shift to "${alt}" with the same goal — a lighter pivot that introduces variety while staying close to what's already working.`,
    };
  }

  // For 'deepen' (exceeded): primary = most similar; alternative = second most similar
  if (strategy === 'deepen') {
    const ranked = rankRelatedTopics(currentTopic, relatedTopics, false);
    const alt = ranked[1]; // second-highest overlap
    if (!alt) {
      // Can't go deeper — alternative is to stay at current goal rather than progressing
      if (primaryGoal !== currentGoal) {
        return {
          next_topic:          currentTopic,
          suggested_goal_type: currentGoal,
          rationale: `Rather than advancing to a ${primaryGoal} goal, sustain the current ${currentGoal} campaign with a refined angle to consolidate the lead before progressing.`,
        };
      }
      return null;
    }
    return {
      next_topic:          alt.t,
      suggested_goal_type: primaryGoal,
      rationale: `"${alt.t}" is the next-closest topic to your current campaign. Less deep than the primary recommendation but more contextually familiar.`,
    };
  }

  // For 'adjacent' (underperformed): primary = most different; alternative = second most different
  const ranked = rankRelatedTopics(currentTopic, relatedTopics, true);
  if (ranked.length >= 2) {
    const alt = ranked[1]; // second-lowest overlap = still different but not a cold start
    return {
      next_topic:          alt.t,
      suggested_goal_type: status === 'underperformed' ? GOAL_FALLBACK[currentGoal] : primaryGoal,
      rationale: `"${alt.t}" is a slightly less radical pivot than the primary recommendation — a middle path if a full direction change feels too risky.`,
    };
  }

  // Fallback: suggest optimising the current topic instead of pivoting
  return {
    next_topic:          currentTopic,
    suggested_goal_type: GOAL_FALLBACK[currentGoal],
    rationale: `If a full topic pivot feels premature, optimise the current "${currentTopic}" campaign at a more achievable goal level before pivoting.`,
  };
}

// ---------------------------------------------------------------------------
// Counterfactual (underperformed only)
// ---------------------------------------------------------------------------

const GOAL_FALLBACK_REF = {
  awareness:  'awareness',
  engagement: 'awareness',
  authority:  'engagement',
  lead_gen:   'authority',
  conversion: 'lead_gen',
} satisfies Record<GoalType, GoalType>;

function buildCounterfactual(
  status: EvaluationStatus,
  goalType: GoalType,
  breakdown: MetricBreakdown[],
  relatedTopics: string[]
): string | null {
  if (status !== 'underperformed') return null;

  const parts: string[] = [];

  const sorted = [...breakdown].sort((a, b) => a.ratio - b.ratio);
  const worst  = sorted[0];

  if (worst) {
    const METRIC_ADVICE: Record<string, string> = {
      total_reach:
        'Broader distribution — amplification through partnerships, employee advocacy, or cross-channel re-posting — would likely have increased reach for this topic.',
      engagement_rate:
        'A storytelling-led format typically outperforms insight-heavy content for engagement. Personal narrative or concrete case-study framing could have driven more interaction.',
      avg_likes:
        'More emotionally resonant or opinion-led content tends to generate higher like volume. A provocative point of view or contrarian angle may have connected better with the audience.',
      total_comments:
        'Embedding conversation prompts and open questions drives comment volume. A debate-style or "hot take" framing is likely to have generated more discussion on this topic.',
      total_clicks:
        'Problem-focused headlines and explicit calls to action typically lift click-through. A/B testing headline angles and adding urgency cues would likely have improved this metric.',
    };
    const advice = METRIC_ADVICE[worst.metric];
    if (advice) parts.push(advice);
  }

  if (breakdown.length === 0) {
    const GOAL_ADVICE: Record<GoalType, string> = {
      awareness:  'More frequent posting or platform-native formats (carousels, polls) tend to expand reach for awareness campaigns.',
      engagement: 'Storytelling, behind-the-scenes content, and audience questions typically outperform polished insight posts for engagement.',
      authority:  'Deep-dive guides, data-backed claims, and strong opinions signal authority more effectively than surface-level commentary.',
      lead_gen:   'Lead-gen campaigns benefit from a clear value exchange — a checklist, template, or framework download tied to the content topic.',
      conversion: 'Conversion-focused content works best with tight audience targeting, social proof, and an explicit low-friction next step.',
    };
    parts.push(GOAL_ADVICE[goalType]);
  }

  if (relatedTopics.length <= 1 && worst && worst.ratio < 0.6) {
    parts.push(
      'The topic may also have been too niche for the current audience — a broader or more commercially relevant angle could improve performance.'
    );
  }

  if (sorted.length >= 2 && sorted[1].ratio < 0.7) {
    const SECONDARY_LABELS: Record<string, string> = {
      total_reach: 'reach', engagement_rate: 'engagement rate',
      avg_likes: 'like volume', total_comments: 'comment volume', total_clicks: 'click-through',
    };
    const secondLabel  = SECONDARY_LABELS[sorted[1].metric];
    const primaryLabel = SECONDARY_LABELS[worst?.metric ?? ''];
    if (secondLabel && secondLabel !== primaryLabel) {
      parts.push(
        `${secondLabel.charAt(0).toUpperCase() + secondLabel.slice(1)} also underperformed — consider whether the content format is well-matched to the platform and goal type.`
      );
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// Reason builder
// ---------------------------------------------------------------------------

function buildReason(
  status: EvaluationStatus,
  score: number,
  action: ContinuityAction,
  goalType: GoalType,
  nextGoal: GoalType,
  topicStrategy: string,
  nextTopic: string,
  currentTopic: string
): { reason: string; strategic_rationale: string } {
  const goalLabel: Record<GoalType, string> = {
    awareness: 'awareness', engagement: 'engagement', authority: 'authority',
    lead_gen: 'lead generation', conversion: 'conversion',
  };
  const actionVerb: Record<ContinuityAction, string> = {
    continue: 'Continue and expand', optimize: 'Refine and optimise', pivot: 'Pivot to',
  };
  const strategyLabel: Record<string, string> = {
    deepen: 'go deeper into the topic', refine: 'optimise the same angle', adjacent: 'explore an adjacent area',
  };

  const reason = status === 'exceeded'
    ? `Your campaign exceeded its ${goalLabel[goalType]} benchmarks (score: ${score}/100). The audience is engaged — ${actionVerb[action].toLowerCase()} to maximise momentum.`
    : status === 'met'
    ? `Campaign met its ${goalLabel[goalType]} benchmarks (score: ${score}/100). There is headroom to improve — ${strategyLabel[topicStrategy]} for better results.`
    : `Campaign fell short of ${goalLabel[goalType]} benchmarks (score: ${score}/100). A direction change is recommended — ${actionVerb[action].toLowerCase()} a fresh angle.`;

  const strategic_rationale =
    nextTopic !== currentTopic
      ? `Based on your performance on "${currentTopic}", the next campaign should ${
          topicStrategy === 'deepen' ? 'dive deeper into' : topicStrategy === 'refine' ? 'revisit and refine' : 'pivot toward'
        } "${nextTopic}" with a ${goalLabel[nextGoal]} focus.`
      : `Continue with "${currentTopic}" but optimise execution — adjust format, timing, or distribution for your ${goalLabel[nextGoal]} goal.`;

  return { reason, strategic_rationale };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function decideNextAction(
  evaluation: EvaluationResult,
  topicContext: TopicContext
): ContinuityDecision {
  const { action, topic_strategy } = ACTION_MAP[evaluation.status];

  const nextTopic = selectNextTopic(
    topic_strategy,
    topicContext.current_topic,
    topicContext.related_topics
  );

  const suggestedGoalType =
    evaluation.status === 'exceeded' ? GOAL_PROGRESSION[topicContext.goal_type] :
    evaluation.status === 'met'      ? topicContext.goal_type :
    GOAL_FALLBACK[topicContext.goal_type];

  const { reason, strategic_rationale } = buildReason(
    evaluation.status, evaluation.score, action,
    topicContext.goal_type, suggestedGoalType,
    topic_strategy, nextTopic, topicContext.current_topic
  );

  const decision_confidence = computeDecisionConfidence(
    evaluation.score,
    evaluation.confidence.level,
    topicContext.related_topics,
    action
  );

  const stability = computeStabilitySignal(
    evaluation.score,
    evaluation.metric_breakdown
  );

  const trade_off = buildTradeOff(evaluation.metric_breakdown);

  const alternative_path = buildAlternativePath(
    topic_strategy,
    topicContext.current_topic,
    topicContext.related_topics,
    nextTopic,
    suggestedGoalType,
    topicContext.goal_type,
    evaluation.status
  );

  const counterfactual = buildCounterfactual(
    evaluation.status,
    topicContext.goal_type,
    evaluation.metric_breakdown,
    topicContext.related_topics
  );

  return {
    action,
    next_topic:          nextTopic,
    suggested_blog_id:   topicContext.related_blog_ids[0] ?? null,
    reason,
    strategic_rationale,
    topic_strategy,
    suggested_goal_type: suggestedGoalType,
    decision_confidence,
    stability,
    trade_off,
    alternative_path,
    counterfactual,
  };
}
