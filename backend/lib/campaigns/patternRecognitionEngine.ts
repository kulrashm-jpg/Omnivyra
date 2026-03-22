/**
 * Pattern Recognition Engine — deterministic, rule-based, no AI, no async.
 *
 * Answers: Across multiple campaigns, what patterns emerge?
 *
 * Input: last N campaign performance records (5–20 campaigns).
 * Output: named patterns with recommendations + evidence counts.
 *
 * Pattern types detected:
 *   1. TOPIC_STRENGTH   — certain topic clusters consistently outperform
 *   2. GOAL_AFFINITY    — certain goal types outperform others for this company
 *   3. VOLATILITY       — performance varies wildly (signal: inconsistent strategy)
 *   4. MOMENTUM         — most recent campaigns trend upward or downward
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PatternType = 'topic_strength' | 'goal_affinity' | 'volatility' | 'momentum' | 'source_pattern';

export interface CampaignRecord {
  campaign_id:       string;
  campaign_name:     string;
  topic:             string | null;
  goal_type:         string | null;
  evaluation_status: 'exceeded' | 'met' | 'underperformed' | null;
  evaluation_score:  number | null;
  recorded_at:       string;
  /** Which blog source anchored this campaign — populated when source_blog_type is stored. */
  source_blog_type?: 'company' | 'public' | null;
}

export interface PatternSignal {
  type:            PatternType;
  /** Human-readable finding. */
  pattern:         string;
  /** What to do next based on this pattern. */
  recommendation:  string;
  /** Number of data points that support this pattern. */
  evidence_count:  number;
  confidence:      'high' | 'medium' | 'low';
}

export interface PatternMemory {
  patterns:               PatternSignal[];
  /** The topic cluster that shows the strongest consistent performance. */
  dominant_topic_cluster: string | null;
  /** The goal type that produced the best average score. */
  best_performing_goal:   string | null;
  campaigns_analyzed:     number;
  /** Average score across all analyzed campaigns. */
  portfolio_avg_score:    number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STATUS_SCORE: Record<string, number> = {
  exceeded:      1,
  met:           0,
  underperformed:-1,
};

/** Rough topic cluster from a topic string — first 2 meaningful words. */
function clusterKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .join(' ') || topic.toLowerCase().slice(0, 20);
}

// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

function detectTopicStrength(records: CampaignRecord[]): PatternSignal | null {
  const withTopic = records.filter((r) => r.topic && r.evaluation_status);
  if (withTopic.length < 3) return null;

  // Group by cluster
  const clusterMap = new Map<string, { scores: number[]; statuses: string[] }>();
  for (const r of withTopic) {
    const key = clusterKey(r.topic!);
    if (!clusterMap.has(key)) clusterMap.set(key, { scores: [], statuses: [] });
    const entry = clusterMap.get(key)!;
    entry.statuses.push(r.evaluation_status!);
    if (r.evaluation_score != null) entry.scores.push(r.evaluation_score);
  }

  // Find best and worst clusters (min 2 campaigns each)
  let bestCluster = '';
  let bestAvg = -Infinity;
  let worstCluster = '';
  let worstAvg = Infinity;

  for (const [key, { scores }] of clusterMap) {
    if (scores.length < 2) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > bestAvg) { bestAvg = avg; bestCluster = key; }
    if (avg < worstAvg) { worstAvg = avg; worstCluster = key; }
  }

  if (!bestCluster || bestCluster === worstCluster) return null;

  const bestCount = clusterMap.get(bestCluster)!.scores.length;
  const gap = bestAvg - worstAvg;
  if (gap < 10) return null; // not a meaningful difference

  const confidence: PatternSignal['confidence'] =
    bestCount >= 5 && gap >= 25 ? 'high' :
    bestCount >= 3 && gap >= 15 ? 'medium' : 'low';

  return {
    type: 'topic_strength',
    pattern: `"${bestCluster}" topics consistently outperform "${worstCluster}" topics (avg ${Math.round(bestAvg)} vs ${Math.round(worstAvg)}/100).`,
    recommendation: `Increase focus on "${bestCluster}" campaigns and reduce investment in "${worstCluster}" content.`,
    evidence_count: bestCount,
    confidence,
  };
}

function detectGoalAffinity(records: CampaignRecord[]): PatternSignal | null {
  const withGoal = records.filter((r) => r.goal_type && r.evaluation_score != null);
  if (withGoal.length < 4) return null;

  const goalMap = new Map<string, number[]>();
  for (const r of withGoal) {
    if (!goalMap.has(r.goal_type!)) goalMap.set(r.goal_type!, []);
    goalMap.get(r.goal_type!)!.push(r.evaluation_score!);
  }

  let bestGoal = '';
  let bestAvg = -Infinity;
  let worstGoal = '';
  let worstAvg = Infinity;

  for (const [goal, scores] of goalMap) {
    if (scores.length < 2) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > bestAvg) { bestAvg = avg; bestGoal = goal; }
    if (avg < worstAvg) { worstAvg = avg; worstGoal = goal; }
  }

  if (!bestGoal || bestGoal === worstGoal || bestAvg - worstAvg < 12) return null;

  const GOAL_LABEL: Record<string, string> = {
    awareness: 'Awareness', engagement: 'Engagement', authority: 'Authority',
    lead_gen: 'Lead Generation', conversion: 'Conversion',
  };

  const evidenceCount = goalMap.get(bestGoal)!.length;

  return {
    type: 'goal_affinity',
    pattern: `${GOAL_LABEL[bestGoal] ?? bestGoal} campaigns score highest on average (${Math.round(bestAvg)}/100).`,
    recommendation: `Structure upcoming campaigns around ${GOAL_LABEL[bestGoal] ?? bestGoal} goals to maximise performance.`,
    evidence_count: evidenceCount,
    confidence: evidenceCount >= 4 ? 'high' : evidenceCount >= 2 ? 'medium' : 'low',
  };
}

function detectVolatility(records: CampaignRecord[]): PatternSignal | null {
  const scores = records.filter((r) => r.evaluation_score != null).map((r) => r.evaluation_score!);
  if (scores.length < 4) return null;

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 18) return null; // not volatile enough to flag

  return {
    type: 'volatility',
    pattern: `Campaign performance is highly variable (std dev: ${Math.round(stdDev)} pts). Results swing between strong and weak without a clear pattern.`,
    recommendation: 'Standardise your content process and stick to 1–2 goal types per quarter to build a consistent performance baseline.',
    evidence_count: scores.length,
    confidence: stdDev >= 30 ? 'high' : 'medium',
  };
}

function detectMomentum(records: CampaignRecord[]): PatternSignal | null {
  // Sort by recorded_at ascending, take last 5
  const sorted = [...records]
    .filter((r) => r.evaluation_score != null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
    .slice(-5);

  if (sorted.length < 3) return null;

  // Linear regression slope (simple: compare first half vs second half average)
  const mid = Math.floor(sorted.length / 2);
  const firstHalf  = sorted.slice(0, mid).map((r) => r.evaluation_score!);
  const secondHalf = sorted.slice(mid).map((r) => r.evaluation_score!);

  const firstAvg  = firstHalf.reduce((a, b) => a + b, 0)  / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const delta = secondAvg - firstAvg;

  if (Math.abs(delta) < 8) return null; // not a meaningful trend

  const upward = delta > 0;

  return {
    type: 'momentum',
    pattern: upward
      ? `Performance is trending upward (+${Math.round(delta)} pts across recent campaigns).`
      : `Performance is trending downward (${Math.round(delta)} pts across recent campaigns).`,
    recommendation: upward
      ? 'Momentum is building — maintain your current content rhythm and consider increasing frequency.'
      : 'Performance is declining — reassess topic selection and consider a fresh angle to reverse the trend.',
    evidence_count: sorted.length,
    confidence: Math.abs(delta) >= 20 ? 'high' : 'medium',
  };
}

function detectSourcePattern(records: CampaignRecord[]): PatternSignal | null {
  const withSource = records.filter((r) => r.source_blog_type && r.evaluation_score != null);
  if (withSource.length < 3) return null;

  const company = withSource.filter((r) => r.source_blog_type === 'company').map((r) => r.evaluation_score!);
  const omnivyra = withSource.filter((r) => r.source_blog_type === 'public').map((r) => r.evaluation_score!);

  if (company.length < 1 || omnivyra.length < 1) return null;

  const companyAvg  = company.reduce((a, b) => a + b, 0) / company.length;
  const omnivyraAvg = omnivyra.reduce((a, b) => a + b, 0) / omnivyra.length;
  const delta = companyAvg - omnivyraAvg;

  if (Math.abs(delta) < 8) return null;

  const companyWins = delta > 0;
  const winner  = companyWins ? 'company content' : 'Omnivyra library';
  const loser   = companyWins ? 'Omnivyra library' : 'company content';
  const winAvg  = companyWins ? companyAvg  : omnivyraAvg;
  const loseAvg = companyWins ? omnivyraAvg : companyAvg;
  const evidence = Math.min(company.length, omnivyra.length);

  return {
    type: 'source_pattern',
    pattern: `Campaigns anchored to ${winner} score higher on average (${Math.round(winAvg)} vs ${Math.round(loseAvg)}/100) than those using ${loser}.`,
    recommendation: companyWins
      ? 'Prioritise your own published blog posts as campaign anchors — your proprietary content drives better results than curated library content.'
      : 'Use Omnivyra library content as your campaign starting point — it is currently outperforming company-authored blogs for this account.',
    evidence_count: evidence,
    confidence: evidence >= 3 && Math.abs(delta) >= 20 ? 'high' : 'medium',
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function recognizePatterns(records: CampaignRecord[]): PatternMemory {
  if (records.length === 0) {
    return {
      patterns: [],
      dominant_topic_cluster: null,
      best_performing_goal: null,
      campaigns_analyzed: 0,
      portfolio_avg_score: 0,
    };
  }

  const patterns: PatternSignal[] = [];

  const topicStrength = detectTopicStrength(records);
  if (topicStrength) patterns.push(topicStrength);

  const goalAffinity = detectGoalAffinity(records);
  if (goalAffinity) patterns.push(goalAffinity);

  const volatility = detectVolatility(records);
  if (volatility) patterns.push(volatility);

  const momentum = detectMomentum(records);
  if (momentum) patterns.push(momentum);

  const sourcePattern = detectSourcePattern(records);
  if (sourcePattern) patterns.push(sourcePattern);

  // Portfolio summary metrics
  const allScores = records.filter((r) => r.evaluation_score != null).map((r) => r.evaluation_score!);
  const portfolioAvg = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;

  // Dominant topic cluster (highest average scoring)
  const clusterMap = new Map<string, number[]>();
  for (const r of records) {
    if (!r.topic || r.evaluation_score == null) continue;
    const key = clusterKey(r.topic);
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key)!.push(r.evaluation_score);
  }
  let dominantCluster: string | null = null;
  let dominantAvg = -Infinity;
  for (const [key, scores] of clusterMap) {
    if (scores.length < 2) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > dominantAvg) { dominantAvg = avg; dominantCluster = key; }
  }

  // Best performing goal
  const goalMap = new Map<string, number[]>();
  for (const r of records) {
    if (!r.goal_type || r.evaluation_score == null) continue;
    if (!goalMap.has(r.goal_type)) goalMap.set(r.goal_type, []);
    goalMap.get(r.goal_type)!.push(r.evaluation_score);
  }
  let bestGoal: string | null = null;
  let bestGoalAvg = -Infinity;
  for (const [goal, scores] of goalMap) {
    if (scores.length < 2) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg > bestGoalAvg) { bestGoalAvg = avg; bestGoal = goal; }
  }

  return {
    patterns,
    dominant_topic_cluster: dominantCluster,
    best_performing_goal:   bestGoal,
    campaigns_analyzed:     records.length,
    portfolio_avg_score:    portfolioAvg,
  };
}
