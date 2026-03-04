/**
 * Execution Pressure Auto-Balancer.
 * Prevents campaign overload by balancing weekly execution load across
 * creator workload, AI-generated content, and conditional automation.
 * Pressure is calculated per week: for each week, pressure = planned / capacity.
 * Never touches: strategic theme, weekly narrative, campaign objective.
 * Only adjusts: format, distribution timing, execution owner.
 */

export type PressureLevel = 'LOW' | 'NORMAL' | 'HIGH';

export type ExecutionPressureResult = {
  ratio: number;
  level: PressureLevel;
  plannedContent: number;
  totalCapacity: number;
};

export type BalanceReport = {
  pressureLevel: PressureLevel;
  /** Number of pieces converted to AI-assisted. */
  aiAssistAdded?: number;
  /** Number of format downgrades applied. */
  formatsAdjusted?: number;
  /** Number of posts redistributed across weeks. */
  postsRedistributed?: number;
  /** Whether platform staggering was suggested (not necessarily applied). */
  platformStaggeringSuggested?: boolean;
  /** When true, pressure remained HIGH and no adjustments were made — manual review recommended. */
  manualReviewRecommended?: boolean;
};

export type ExecutionConfigInput = {
  content_capacity?: number | Record<string, unknown>;
  campaign_duration?: number;
  content_depth?: string;
  communication_style?: string | string[];
  [key: string]: unknown;
};

const PRESSURE_LOW_MAX = 0.8;
const PRESSURE_NORMAL_MAX = 1.1;
const AI_RATIO = 0.6;
const CONDITIONAL_RATIO = 0.4;
/** Max fraction of a week's items that can be converted to AI-assisted (hard cap). */
const AI_CONVERSION_CAP_RATIO = 0.3;

/** Never convert these to AI-assisted (preserve creator ownership). */
const PROTECTED_FORMATS = new Set(['video', 'live', 'webinar', 'reel', 'long_video']);
/** Priority formats for AI assist expansion (convert creator → ai_assisted). */
const AI_ASSIST_PRIORITY_FORMATS = new Set(['text', 'post', 'carousel', 'short insight', 'insight', 'article']);
/** Format downgrade when content_depth is deep. Video left untouched. */
const FORMAT_DOWNGRADE: Record<string, string> = {
  article: 'post',
  'deep_dive': 'insight',
  'deep-dive': 'insight',
  long_post: 'short-post',
  'long-post': 'short-post',
};

function normalizeContentType(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Compute total safe capacity from execution_config.
 * creatorCapacity = content_capacity; AI = creator * 0.6; conditional = creator * 0.4.
 */
export function computeTotalCapacity(executionConfig: ExecutionConfigInput | null | undefined): number {
  if (!executionConfig || typeof executionConfig !== 'object') return 10;
  const raw = executionConfig.content_capacity;
  let creatorCapacity = 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    creatorCapacity = Math.max(0, Math.floor(raw));
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const perWeek = (raw as Record<string, { perWeek?: number }>).perWeek ?? (raw as Record<string, number>).perWeek;
    creatorCapacity = typeof perWeek === 'number' && Number.isFinite(perWeek) ? Math.max(0, Math.floor(perWeek)) : 0;
  }
  if (creatorCapacity <= 0) return 10;
  const aiCapacity = Math.floor(creatorCapacity * AI_RATIO);
  const conditionalCapacity = Math.floor(creatorCapacity * CONDITIONAL_RATIO);
  return creatorCapacity + aiCapacity + conditionalCapacity;
}

/**
 * Count planned content pieces for a single week (execution_items → topic_slots).
 */
export function countPlannedContentForWeek(week: any): number {
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  let sum = 0;
  for (const exec of execItems) {
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    sum += slots.length;
  }
  return sum;
}

/**
 * Get execution pressure tier from ratio (per week).
 * LOW < 0.8, NORMAL 0.8–1.1, HIGH > 1.1.
 */
export function getExecutionPressure(
  plannedContent: number,
  totalCapacity: number
): ExecutionPressureResult {
  const capacity = totalCapacity > 0 ? totalCapacity : 1;
  const ratio = plannedContent / capacity;
  let level: PressureLevel = 'NORMAL';
  if (ratio < PRESSURE_LOW_MAX) level = 'LOW';
  else if (ratio > PRESSURE_NORMAL_MAX) level = 'HIGH';
  return { ratio, level, plannedContent, totalCapacity: capacity };
}

/**
 * Strategy 1: Convert some creator slots to AI-assisted (text, carousel, short insight only).
 * Hard cap: maxAIConversions = floor(weekItems * 0.3).
 */
function applyAiAssistExpansion(week: any, maxConvert: number, weekItemCount: number): number {
  const cap = Math.floor(weekItemCount * AI_CONVERSION_CAP_RATIO);
  const limit = Math.min(maxConvert, Math.max(0, cap));
  if (limit <= 0) return 0;
  let converted = 0;
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  for (const exec of execItems) {
    if (converted >= limit) break;
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    if (!AI_ASSIST_PRIORITY_FORMATS.has(ct) && !AI_ASSIST_PRIORITY_FORMATS.has(ct.replace(/_/g, ' '))) continue;
    if (PROTECTED_FORMATS.has(ct)) continue;
    const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
    for (const slot of slots) {
      if (converted >= limit) break;
      if (slot?.execution_owner === 'ai_assisted') continue;
      if (!slot) continue;
      (slot as any).execution_owner = 'ai_assisted';
      converted += 1;
    }
  }
  return converted;
}

/**
 * Format downgrade when content_depth is deep. Video is left untouched.
 * article → post, deep-dive → insight, long-post → short-post.
 */
function applyFormatDowngrade(week: any, contentDepth: string): number {
  const isDeep = String(contentDepth ?? '').toLowerCase().includes('deep');
  if (!isDeep) return 0;
  let adjusted = 0;
  const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
  for (const exec of execItems) {
    const ct = normalizeContentType(exec?.content_type ?? exec?.contentType ?? '');
    const downgrade = FORMAT_DOWNGRADE[ct] ?? FORMAT_DOWNGRADE[ct.replace(/_/g, '-')];
    if (!downgrade) continue;
    (exec as any).content_type = downgrade;
    if ((exec as any).contentType) (exec as any).contentType = downgrade;
    adjusted += 1;
  }
  return adjusted;
}

/**
 * Minimal overflow safeguard: if a week has more items than totalCapacity,
 * move excess slots to the next week so pressure does not remain HIGH forever.
 */
function redistributeOverflowToNextWeek(weeks: any[], totalCapacity: number): { weeks: any[]; moved: number } {
  const arr = weeks.map((w) =>
    typeof w === 'object' && w != null
      ? {
          ...w,
          execution_items: Array.isArray(w.execution_items)
            ? w.execution_items.map((e: any) =>
                Array.isArray(e?.topic_slots)
                  ? { ...e, topic_slots: [...e.topic_slots] }
                  : { ...e }
              )
            : [],
        }
      : w
  );
  let moved = 0;
  for (let i = 0; i < arr.length; i++) {
    const planned = countPlannedContentForWeek(arr[i]);
    if (planned <= totalCapacity) continue;
    const overflow = planned - totalCapacity;
    const execItems: any[] = Array.isArray(arr[i]?.execution_items) ? arr[i].execution_items : [];
    const slotsToMove: { execIdx: number; slotIdx: number }[] = [];
    for (let execIdx = 0; execIdx < execItems.length; execIdx++) {
      const slots: any[] = Array.isArray(execItems[execIdx]?.topic_slots) ? execItems[execIdx].topic_slots : [];
      for (let slotIdx = 0; slotIdx < slots.length && slotsToMove.length < overflow; slotIdx++) {
        slotsToMove.push({ execIdx, slotIdx });
      }
    }
    const targetWeekIdx = i + 1;
    if (targetWeekIdx >= arr.length || slotsToMove.length === 0) continue;
    const targetExecItems: any[] = Array.isArray(arr[targetWeekIdx].execution_items) ? arr[targetWeekIdx].execution_items : [];
    if (targetExecItems.length === 0) continue;
    const targetExec = targetExecItems[0];
    if (!targetExec) continue;
    if (!Array.isArray(targetExec.topic_slots)) targetExec.topic_slots = [];
    // Splice in reverse order so indices remain valid
    const toMove = [...slotsToMove].sort((a, b) => b.slotIdx - a.slotIdx || b.execIdx - a.execIdx);
    for (const { execIdx, slotIdx } of toMove) {
      const exec = execItems[execIdx];
      const slots = exec?.topic_slots;
      if (!Array.isArray(slots) || slotIdx >= slots.length) continue;
      const slot = slots[slotIdx];
      if (!slot) continue;
      targetExec.topic_slots.push(slot);
      slots.splice(slotIdx, 1);
      moved += 1;
    }
  }
  return { weeks: arr, moved };
}

/**
 * Run execution pressure analysis and auto-balance when pressure is HIGH.
 * Pressure is calculated per week; strategies are applied per week where that week's pressure is HIGH.
 * Returns balanced weeks and report for UI. Does not mutate strategic theme, narrative, or objective.
 */
export function runExecutionPressureBalancer(
  weeks: unknown,
  executionConfig: ExecutionConfigInput | null | undefined
): { weeks: any[]; pressureLevel: PressureLevel; balanceReport: BalanceReport } {
  const arr = Array.isArray(weeks) ? weeks.map((w) => (typeof w === 'object' && w !== null ? { ...w } : w)) : [];
  const totalCapacity = computeTotalCapacity(executionConfig);
  const contentDepth =
    executionConfig && typeof executionConfig.content_depth === 'string'
      ? executionConfig.content_depth
      : '';

  // Per-week pressure: for each week, pressure = planned / capacity
  let maxPressureRatio = 0;
  let maxPressureLevel: PressureLevel = 'NORMAL';
  for (let i = 0; i < arr.length; i++) {
    const planned = countPlannedContentForWeek(arr[i]);
    const { ratio, level } = getExecutionPressure(planned, totalCapacity);
    if (ratio > maxPressureRatio) {
      maxPressureRatio = ratio;
      maxPressureLevel = level;
    }
  }

  const balanceReport: BalanceReport = {
    pressureLevel: maxPressureLevel,
  };

  if (maxPressureLevel !== 'HIGH') {
    return { weeks: arr, pressureLevel: maxPressureLevel, balanceReport };
  }

  let aiAssistAdded = 0;
  let formatsAdjusted = 0;

  // Apply strategies per week where that week's pressure is HIGH
  for (let i = 0; i < arr.length; i++) {
    const planned = countPlannedContentForWeek(arr[i]);
    const { level } = getExecutionPressure(planned, totalCapacity);
    if (level !== 'HIGH') continue;

    const excess = Math.ceil(planned - totalCapacity);
    const weekItemCount = planned;
    const aiConvertLimit = Math.min(excess, 3);
    aiAssistAdded += applyAiAssistExpansion(arr[i], aiConvertLimit, weekItemCount);
    formatsAdjusted += applyFormatDowngrade(arr[i], contentDepth);
  }

  // Minimal safeguard: move overflow to next week so pressure does not stay HIGH forever
  const { weeks: afterOverflow, moved } = redistributeOverflowToNextWeek(arr, totalCapacity);
  if (moved > 0) {
    balanceReport.postsRedistributed = moved;
  }
  balanceReport.aiAssistAdded = aiAssistAdded;
  balanceReport.formatsAdjusted = formatsAdjusted;
  balanceReport.platformStaggeringSuggested = maxPressureLevel === 'HIGH';

  const stillHigh = afterOverflow.some((w) => getExecutionPressure(countPlannedContentForWeek(w), totalCapacity).level === 'HIGH');
  if (stillHigh && aiAssistAdded === 0 && formatsAdjusted === 0 && moved === 0) {
    balanceReport.manualReviewRecommended = true;
  }

  return {
    weeks: afterOverflow,
    pressureLevel: stillHigh ? 'HIGH' : 'NORMAL',
    balanceReport: {
      ...balanceReport,
      pressureLevel: 'HIGH',
    },
  };
}
