/**
 * Execution Momentum Tracker.
 * Detects when a campaign's narrative progression weakens or becomes inconsistent across weeks.
 * Signals: topic continuity, narrative escalation, content density rhythm.
 */

export type MomentumState = 'STRONG' | 'STABLE' | 'WEAK';

export type MomentumResult = {
  state: MomentumState;
  signals: {
    continuity: number;
    escalation: number;
    rhythm: number;
  };
  momentumScore: number;
  warnings?: string[];
};

/** Week plan shape from orchestrator (weeks array items). */
export type WeekPlanLike = {
  week?: number;
  week_number?: number;
  theme?: string;
  phase_label?: string;
  primary_objective?: string;
  topics_to_cover?: string[];
  execution_items?: any[];
  content_type_mix?: string[];
  [key: string]: unknown;
};

const STRONG_THRESHOLD = 0.75;
const STABLE_THRESHOLD = 0.45;
const MIN_KEYWORDS = 4;
const NEUTRAL_CONTINUITY = 0.6;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'that',
  'this',
  'these',
  'those',
  'your',
  'our',
  'their',
  'how',
  'why',
  'what',
  'when',
  'where',
  'using',
  'use',
  'via',
  'vs',
]);

/** Escalation level by keyword (progression toward depth/outcome). */
const ESCALATION_LEVELS: Record<string, number> = {
  awareness: 1,
  problem: 1,
  insight: 1,
  education: 1,
  framework: 2,
  application: 2,
  case_study: 3,
  'case study': 3,
  proof: 3,
  conversion: 4,
  cta: 4,
  demand: 4,
};

const RHYTHM_HEALTHY_MIN = 0.2;
const RHYTHM_HEALTHY_MAX = 0.6;
const MAX_WARNINGS = 3;

function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function extractTopicKeywords(week: WeekPlanLike): Set<string> {
  const out = new Set<string>();
  const theme = week.theme ?? week.phase_label ?? '';
  const objective = week.primary_objective ?? '';
  const topics = Array.isArray(week.topics_to_cover) ? week.topics_to_cover : [];
  [...tokenize(theme), ...tokenize(objective)].forEach((w) => out.add(w));
  topics.forEach((t) => tokenize(String(t)).forEach((w) => out.add(w)));
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  for (const exec of execItems) {
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    for (const slot of slots) {
      const title = (slot?.topic_title ?? slot?.theme ?? slot?.topic ?? '').trim();
      tokenize(title).forEach((w) => out.add(w));
    }
  }
  return out;
}

/**
 * Continuity: topic keyword overlap between consecutive weeks.
 * Score = average(sharedKeywords / totalKeywords) over pairs, 0–1.
 * If union size < MIN_KEYWORDS, use neutral 0.6 to avoid misleading scores.
 */
function continuityScore(weeks: WeekPlanLike[]): number {
  if (weeks.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < weeks.length - 1; i++) {
    const a = extractTopicKeywords(weeks[i]!);
    const b = extractTopicKeywords(weeks[i + 1]!);
    if (a.size === 0 && b.size === 0) {
      sum += 1;
    } else if (a.size === 0 || b.size === 0) {
      sum += 0;
    } else {
      const intersection = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      if (union.size < MIN_KEYWORDS) {
        sum += NEUTRAL_CONTINUITY;
      } else {
        sum += intersection.size / union.size;
      }
    }
    count += 1;
  }
  return count > 0 ? Math.min(1, sum / count) : 1;
}

/**
 * Returns the 0-based index of the consecutive week pair with the lowest keyword overlap.
 * Used by the recovery advisor to suggest specific weeks for bridging.
 */
export function getWeakestContinuityPairIndex(weeks: WeekPlanLike[]): number {
  if (weeks.length < 2) return 0;
  let minScore = 1;
  let minIndex = 0;
  for (let i = 0; i < weeks.length - 1; i++) {
    const a = extractTopicKeywords(weeks[i]!);
    const b = extractTopicKeywords(weeks[i + 1]!);
    let pairScore: number;
    if (a.size === 0 && b.size === 0) {
      pairScore = 1;
    } else if (a.size === 0 || b.size === 0) {
      pairScore = 0;
    } else {
      const intersection = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      pairScore = union.size < MIN_KEYWORDS ? NEUTRAL_CONTINUITY : intersection.size / union.size;
    }
    if (pairScore < minScore) {
      minScore = pairScore;
      minIndex = i;
    }
  }
  return minIndex;
}

/**
 * Escalation: detect progression (insight → framework → case study → conversion).
 * Allow one-step fallback (e.g. 3→2, 2→1 OK). Penalize only when levelDrop > 1.
 */
function escalationScore(weeks: WeekPlanLike[]): number {
  if (weeks.length === 0) return 1;
  const levels: number[] = [];
  for (const w of weeks) {
    const text = [
      w.theme,
      w.phase_label,
      w.primary_objective,
      ...(Array.isArray(w.topics_to_cover) ? w.topics_to_cover : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    let maxLevel = 1;
    for (const [keyword, level] of Object.entries(ESCALATION_LEVELS)) {
      if (text.includes(keyword.replace(/_/g, ' ')) || text.includes(keyword)) {
        maxLevel = Math.max(maxLevel, level);
      }
    }
    levels.push(maxLevel);
  }
  if (levels.length < 2) return 1;
  let progressCount = 0;
  let penaltyCount = 0;
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1]!;
    const curr = levels[i]!;
    if (curr > prev) progressCount += 1;
    else {
      const levelDrop = prev - curr;
      if (levelDrop > 1) penaltyCount += 1;
    }
  }
  const total = levels.length - 1;
  const progressRatio = total > 0 ? progressCount / total : 0;
  const penalty = total > 0 ? (penaltyCount / total) * 0.5 : 0;
  return Math.max(0, Math.min(1, progressRatio + (1 - penalty) * 0.5));
}

/**
 * Rhythm: normalized variance (stddev / mean) of weekly slot counts.
 * Healthy 0.2–0.6; <0.2 stagnant; >0.6 chaotic.
 */
function rhythmScore(weeks: WeekPlanLike[]): number {
  if (weeks.length < 2) return 1;
  const counts: number[] = [];
  for (const w of weeks) {
    const execItems: any[] = Array.isArray(w?.execution_items) ? w.execution_items : [];
    let n = 0;
    for (const exec of execItems) {
      n += Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0;
    }
    counts.push(n);
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const safeMean = Math.max(mean, 1);
  const variance =
    counts.reduce((acc, c) => acc + (c - mean) ** 2, 0) / counts.length;
  const stddev = Math.sqrt(variance);
  const normalizedVariance = stddev / safeMean;
  if (normalizedVariance >= RHYTHM_HEALTHY_MIN && normalizedVariance <= RHYTHM_HEALTHY_MAX) return 1;
  if (normalizedVariance < RHYTHM_HEALTHY_MIN) return Math.max(0, normalizedVariance / RHYTHM_HEALTHY_MIN);
  return Math.max(0, 1 - (normalizedVariance - RHYTHM_HEALTHY_MAX) / (RHYTHM_HEALTHY_MAX + 0.4));
}

function countSlotsForWeek(week: WeekPlanLike): number {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  let n = 0;
  for (const exec of execItems) {
    n += Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0;
  }
  return n;
}

/**
 * Analyze execution momentum across weeks.
 * momentumScore = continuity*0.4 + escalation*0.4 + rhythm*0.2.
 * >0.75 STRONG, 0.45–0.75 STABLE, <0.45 WEAK.
 * Short campaigns (weeks < 3) default to STABLE.
 */
export function analyzeExecutionMomentum(weeks: WeekPlanLike[]): MomentumResult {
  const arr = Array.isArray(weeks) ? weeks : [];
  if (arr.length < 3) {
    return {
      state: 'STABLE',
      momentumScore: 0.65,
      signals: { continuity: 0.65, escalation: 0.65, rhythm: 0.65 },
    };
  }

  const continuity = continuityScore(arr);
  const escalation = escalationScore(arr);
  const rhythm = rhythmScore(arr);

  const momentumScore = continuity * 0.4 + escalation * 0.4 + rhythm * 0.2;
  let state: MomentumState = 'STABLE';
  if (momentumScore > STRONG_THRESHOLD) state = 'STRONG';
  else if (momentumScore < STABLE_THRESHOLD) state = 'WEAK';

  const warnings: string[] = [];

  if (continuity < 0.4 && arr.length >= 2) {
    const weakIdx = arr.findIndex((_, i) => {
      if (i >= arr.length - 1) return false;
      const a = extractTopicKeywords(arr[i]!);
      const b = extractTopicKeywords(arr[i + 1]!);
      const inter = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      return union.size > 0 && inter.size / union.size < 0.3;
    });
    if (weakIdx >= 0) {
      warnings.push(`Week ${weakIdx + 2} narrative diverges from campaign theme`);
    }
  }

  if (escalation < 0.5 && arr.length >= 4) {
    warnings.push('Campaign escalation plateau detected in mid-campaign weeks');
  }

  const counts = arr.map((w) => countSlotsForWeek(w));
  const sparseFrom = counts.findIndex((c, i) => i >= arr.length / 2 && c < 2);
  if (sparseFrom >= 0 && arr.length >= 6) {
    warnings.push(`Posting rhythm too sparse after week ${sparseFrom + 1}`);
  }

  return {
    state,
    signals: { continuity, escalation, rhythm },
    momentumScore,
    warnings: warnings.length > 0 ? warnings.slice(0, MAX_WARNINGS) : undefined,
  };
}
