/**
 * Execution Drift Detector.
 * Detects when real publishing activity diverges from the planned campaign narrative or cadence.
 * Signals: schedule drift, topic drift, format drift.
 */

import type { WeekPlanLike } from './executionMomentumTracker';

export type DriftState = 'NONE' | 'MINOR' | 'MAJOR';

export type DriftResult = {
  state: DriftState;
  signals: {
    schedule: number;
    topic: number;
    format: number;
  };
  driftScore: number;
  warnings?: string[];
  /** Recovery suggestions when state is MINOR or MAJOR. */
  recoverySuggestions?: string[];
};

/** Published or scheduled content item used for drift comparison. */
export type PublishedContent = {
  title?: string | null;
  content?: string | null;
  content_type?: string | null;
  /** Week number (1-based) when known; derived from scheduled_for and campaign start. */
  week?: number | null;
};

const SCHEDULE_HEALTHY_MIN = 0.9;
const SCHEDULE_HEALTHY_MAX = 1.1;
const SCHEDULE_MINOR_MAX = 0.9;
const SCHEDULE_MAJOR_MAX = 0.6;
const TOPIC_HEALTHY_MIN = 0.6;
const TOPIC_MINOR_MIN = 0.4;
const MAX_WARNINGS = 3;

/** Same stopwords as executionMomentumTracker for consistent topic overlap. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'that', 'this', 'these', 'those',
  'your', 'our', 'their', 'how', 'why', 'what', 'when', 'where', 'using', 'use', 'via', 'vs',
]);

function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function countPlannedSlotsForWeek(week: WeekPlanLike): number {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  let n = 0;
  for (const exec of execItems) {
    n += Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0;
  }
  return n;
}

function plannedKeywordsFromWeeks(weeks: WeekPlanLike[]): Set<string> {
  const out = new Set<string>();
  for (const w of weeks) {
    const theme = w.theme ?? w.phase_label ?? '';
    const objective = w.primary_objective ?? '';
    const topics = Array.isArray(w.topics_to_cover) ? w.topics_to_cover : [];
    [...tokenize(theme), ...tokenize(objective)].forEach((x) => out.add(x));
    topics.forEach((t) => tokenize(String(t)).forEach((x) => out.add(x)));
    const execItems: any[] = Array.isArray(w?.execution_items) ? w.execution_items : [];
    for (const exec of execItems) {
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      for (const slot of slots) {
        const title = (slot?.topic_title ?? slot?.theme ?? slot?.topic ?? '').trim();
        tokenize(title).forEach((x) => out.add(x));
      }
    }
  }
  return out;
}

function keywordsFromPost(post: PublishedContent): Set<string> {
  const out = new Set<string>();
  const title = post.title ?? '';
  const content = post.content ?? '';
  tokenize(title).forEach((x) => out.add(x));
  tokenize(content).forEach((x) => out.add(x));
  return out;
}

/**
 * Schedule drift: compare planned slots vs actual posts per week.
 * ratio = actualCount / plannedCount; 0.9–1.1 healthy, 0.6–0.9 minor, <0.6 major.
 * Returns 0–1 (1 = no drift).
 */
function scheduleScore(plannedWeeks: WeekPlanLike[], actualPosts: PublishedContent[]): number {
  if (plannedWeeks.length === 0) return 1;
  const postsWithWeek = actualPosts.filter((p) => p.week != null && p.week > 0);
  if (postsWithWeek.length === 0) {
    const totalPlanned = plannedWeeks.reduce((s, w) => s + countPlannedSlotsForWeek(w), 0);
    if (totalPlanned === 0) return 1;
    const ratio = actualPosts.length / totalPlanned;
    if (ratio >= SCHEDULE_HEALTHY_MIN && ratio <= SCHEDULE_HEALTHY_MAX) return 1;
    if (ratio >= SCHEDULE_MAJOR_MAX && ratio < SCHEDULE_MINOR_MAX)
      return (ratio - SCHEDULE_MAJOR_MAX) / (SCHEDULE_MINOR_MAX - SCHEDULE_MAJOR_MAX);
    if (ratio < SCHEDULE_MAJOR_MAX) return Math.max(0, ratio / SCHEDULE_MAJOR_MAX);
    return Math.min(1, 1 - (ratio - SCHEDULE_HEALTHY_MAX) / 0.5);
  }
  const weekNumbers = new Set(plannedWeeks.map((w) => w.week_number ?? w.week).filter((n): n is number => typeof n === 'number' && n > 0));
  let sum = 0;
  let count = 0;
  for (const weekNum of weekNumbers) {
    const planned = countPlannedSlotsForWeek(plannedWeeks.find((w) => (w.week_number ?? w.week) === weekNum) ?? {});
    const actual = postsWithWeek.filter((p) => p.week === weekNum).length;
    if (planned === 0) {
      sum += actual === 0 ? 1 : 0;
    } else {
      const ratio = actual / planned;
      if (ratio >= SCHEDULE_HEALTHY_MIN && ratio <= SCHEDULE_HEALTHY_MAX) sum += 1;
      else if (ratio >= SCHEDULE_MAJOR_MAX && ratio < SCHEDULE_MINOR_MAX)
        sum += (ratio - SCHEDULE_MAJOR_MAX) / (SCHEDULE_MINOR_MAX - SCHEDULE_MAJOR_MAX);
      else if (ratio < SCHEDULE_MAJOR_MAX) sum += Math.max(0, ratio / SCHEDULE_MAJOR_MAX);
      else sum += Math.min(1, 1 - (ratio - SCHEDULE_HEALTHY_MAX) / 0.5);
    }
    count += 1;
  }
  return count > 0 ? sum / count : 1;
}

/**
 * Topic drift: overlap between planned topics and actual post titles/content.
 * >0.6 healthy, 0.4–0.6 minor, <0.4 major. Returns 0–1.
 */
function topicScore(plannedWeeks: WeekPlanLike[], actualPosts: PublishedContent[]): number {
  const planned = plannedKeywordsFromWeeks(plannedWeeks);
  if (actualPosts.length === 0) return planned.size > 0 ? 0 : 1;
  const actual = new Set<string>();
  for (const p of actualPosts) {
    keywordsFromPost(p).forEach((x) => actual.add(x));
  }
  if (planned.size === 0 && actual.size === 0) return 1;
  if (planned.size === 0 || actual.size === 0) return 0;
  const intersection = new Set([...planned].filter((x) => actual.has(x)));
  const union = new Set([...planned, ...actual]);
  const overlap = union.size > 0 ? intersection.size / union.size : 0;
  return Math.min(1, Math.max(0, overlap));
}

/**
 * Format drift: planned content_type_mix diversity vs actual content_type diversity.
 * If actual diversity drops too much vs planned, drift. Returns 0–1.
 */
function formatScore(plannedWeeks: WeekPlanLike[], actualPosts: PublishedContent[]): number {
  const plannedTypes = new Set<string>();
  for (const w of plannedWeeks) {
    const mix = Array.isArray(w.content_type_mix) ? w.content_type_mix : [];
    mix.forEach((t) => plannedTypes.add(String(t).toLowerCase().trim()));
  }
  const actualTypes = new Set<string>();
  for (const p of actualPosts) {
    const t = p.content_type ?? '';
    if (t) actualTypes.add(String(t).toLowerCase().trim());
  }
  if (plannedTypes.size === 0) return actualTypes.size > 0 ? 1 : 1;
  if (actualTypes.size === 0) return 0;
  const formatDiversityRatio = actualTypes.size / plannedTypes.size;
  const overlap = [...actualTypes].filter((t) => plannedTypes.has(t)).length / plannedTypes.size;
  return Math.min(1, (formatDiversityRatio + overlap) / 2);
}

/**
 * Detect execution drift: planned vs actual publishing.
 * Runs when actual execution data exists (e.g. in get-weekly-plans with published posts).
 */
export function detectExecutionDrift(
  plannedWeeks: WeekPlanLike[],
  actualPosts: PublishedContent[]
): DriftResult {
  const schedule = scheduleScore(plannedWeeks, actualPosts);
  const topic = topicScore(plannedWeeks, actualPosts);
  const format = formatScore(plannedWeeks, actualPosts);
  const driftScore = schedule * 0.4 + topic * 0.4 + format * 0.2;

  let state: DriftState = 'NONE';
  if (driftScore > 0.75) state = 'NONE';
  else if (driftScore >= 0.45) state = 'MINOR';
  else state = 'MAJOR';

  const warnings: string[] = [];
  if (schedule < SCHEDULE_MINOR_MAX)
    warnings.push('Publishing frequency is significantly below the planned campaign cadence.');
  if (topic < TOPIC_HEALTHY_MIN)
    warnings.push('Recent posts diverge from the campaign narrative topics.');
  if (format < TOPIC_MINOR_MIN)
    warnings.push("Content formats differ from the campaign's planned mix.");
  const limited = warnings.slice(0, MAX_WARNINGS);

  const recoverySuggestions: string[] = [];
  if (state !== 'NONE') {
    if (schedule < SCHEDULE_MINOR_MAX) recoverySuggestions.push('Increase posting cadence to match campaign schedule.');
    if (topic < TOPIC_HEALTHY_MIN) recoverySuggestions.push('Reintroduce planned narrative themes in upcoming posts.');
    if (format < TOPIC_MINOR_MIN) recoverySuggestions.push('Restore planned content format mix.');
  }

  return {
    state,
    signals: { schedule, topic, format },
    driftScore,
    warnings: limited.length > 0 ? limited : undefined,
    recoverySuggestions: recoverySuggestions.length > 0 ? recoverySuggestions.slice(0, MAX_WARNINGS) : undefined,
  };
}
