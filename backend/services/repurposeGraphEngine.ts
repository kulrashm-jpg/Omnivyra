/**
 * Repurpose Graph Engine
 * BOLT: expands a core slot into repurposed content across formats.
 * Rule-based, deterministic, no LLM. Platforms assigned by Platform Allocation Engine.
 */

import { computeContentAmplificationScore } from './contentAmplificationService';
import { recordRepurposeTransformation } from './repurposeLearningService';
import { isBoltExcludedContentType } from '../utils/boltTextContentConfig';

export type RepurposeSlotInput = {
  content_type?: string;
  day_index?: number;
  day_name?: string;
  day?: string;
  short_topic?: string;
  full_topic?: string;
  platform?: string;
  reasoning?: string;
  id?: string;
  repurpose_of?: string;
  /** When true, strategic anchor content (blog, article, long_video) amplifies more aggressively. Inferred from content_type if absent. */
  is_anchor_content?: boolean;
};

export type DensityLevel = 'low' | 'normal' | 'high';

const REPURPOSE_LIMIT: Record<DensityLevel, number> = {
  low: 1,
  normal: 2,
  high: 3,
};

/**
 * Repurpose graph: content_type → derivative content types.
 * Fallback when platform cascade does not apply.
 */
const REPURPOSE_GRAPH: Record<string, string[]> = {
  blog: ['linkedin_post', 'thread', 'carousel'],
  linkedin_post: ['carousel'],
  thread: ['carousel'],
  carousel: ['short_video'],
};

/** Platform-aware repurpose mapping: primary_platform → [(target_platform, target_content_type), ...] */
type RepurposeTarget = { platform: string; content_type: string };

const PLATFORM_REPURPOSE_CASCADE: Record<string, RepurposeTarget[]> = {
  linkedin: [
    { platform: 'x', content_type: 'thread' },
    { platform: 'instagram', content_type: 'carousel' },
    { platform: 'youtube', content_type: 'short_video' },
  ],
  youtube: [
    { platform: 'linkedin', content_type: 'article' },
    { platform: 'x', content_type: 'thread' },
    { platform: 'instagram', content_type: 'reel' },
  ],
  instagram: [
    { platform: 'linkedin', content_type: 'carousel' },
    { platform: 'x', content_type: 'thread' },
  ],
  x: [
    { platform: 'linkedin', content_type: 'article' },
    { platform: 'instagram', content_type: 'carousel' },
  ],
};

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Business days only; weekends skipped for B2B repurpose scheduling */
const BUSINESS_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const BUSINESS_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

const DAY_TO_INDEX = new Map<string, number>([
  ['mon', 0], ['monday', 0],
  ['tue', 1], ['tuesday', 1],
  ['wed', 2], ['wednesday', 2],
  ['thu', 3], ['thursday', 3],
  ['fri', 4], ['friday', 4],
  ['sat', 5], ['saturday', 5],
  ['sun', 6], ['sunday', 6],
]);

/** Maps any day to business-day index (0-4). Sat/Sun normalize to Mon (0). */
const DAY_TO_BUSINESS_INDEX = new Map<string, number>([
  ['mon', 0], ['monday', 0],
  ['tue', 1], ['tuesday', 1],
  ['wed', 2], ['wednesday', 2],
  ['thu', 3], ['thursday', 3],
  ['fri', 4], ['friday', 4],
  ['sat', 0], ['saturday', 0],
  ['sun', 0], ['sunday', 0],
]);

/**
 * Shift day by offset within business days (Mon–Fri). Weekends skipped.
 * Sat/Sun treated as Mon. Fri +1 → Mon.
 * @param originalDay Day name (Mon, Monday, etc.) or day_index (1-7)
 * @param offset Business days to add (e.g. 1 → next business day)
 */
export function shiftDay(originalDay: string | number, offset: number): { day: string; day_name: string; day_index: number } {
  let businessIdx: number;
  if (typeof originalDay === 'number') {
    const dayIdx = Math.max(1, Math.min(7, Math.floor(originalDay)));
    businessIdx = dayIdx <= 5 ? dayIdx - 1 : 0;
  } else {
    const key = String(originalDay ?? '').trim().toLowerCase();
    businessIdx = DAY_TO_BUSINESS_INDEX.get(key) ?? 0;
  }
  const newBusinessIdx = (businessIdx + offset) % BUSINESS_DAYS.length;
  const day = BUSINESS_DAYS[newBusinessIdx] ?? 'Mon';
  const day_name = BUSINESS_DAY_NAMES[newBusinessIdx] ?? 'Monday';
  const day_index = newBusinessIdx + 1;
  return { day, day_name, day_index };
}

function resolveOriginalDayInfo(slot: RepurposeSlotInput): { day: string; day_name: string; day_index: number } {
  if (slot.day_index != null && Number.isFinite(slot.day_index)) {
    const idx = Math.max(0, Math.min(6, Math.floor(slot.day_index) - 1));
    return { day: DAY_ORDER[idx] ?? 'Mon', day_name: DAY_NAMES_FULL[idx] ?? 'Monday', day_index: idx + 1 };
  }
  const dayStr = String(slot.day ?? slot.day_name ?? 'Mon').trim();
  const key = dayStr.toLowerCase();
  const idx = DAY_TO_INDEX.get(key) ?? 0;
  return { day: DAY_ORDER[idx] ?? 'Mon', day_name: DAY_NAMES_FULL[idx] ?? 'Monday', day_index: idx + 1 };
}

function generateSlotId(prefix: string, index: number): string {
  return `${prefix}_${index}`;
}

/** Campaign performance signals for Adaptive Repurpose Intelligence. */
export type RepurposePerformanceSignals = {
  high_performing_platforms?: string[];
  high_performing_content_types?: string[];
  low_performing_patterns?: string[];
};

export type ExpandRepurposeGraphOptions = {
  densityLevel?: DensityLevel;
  /** Content types that perform well; increase repurpose depth by +1 */
  highPerformingTypes?: string[];
  /** Content types that underperform; decrease repurpose depth by -1 */
  lowPerformingTypes?: string[];
  /** When set, only create repurpose targets whose platform is in this list. */
  eligiblePlatforms?: string[];
  /** Campaign performance signals (high/low platforms, content types, patterns). Optional; backward compatible. */
  signals?: RepurposePerformanceSignals;
  /** Company performance insights (e.g. from campaignLearningService). When present, cascade targets are reordered to prefer high-performing platforms. */
  companyPerformanceInsights?: {
    high_performing_platforms?: string[];
  };
  /** When true (BOLT), restrict repurpose targets to text-only: exclude carousel, reel, video, short_video, etc. */
  boltTextOnly?: boolean;
};

function normalizeContentType(ct: string): string {
  return String(ct ?? 'post').trim().toLowerCase();
}

function normalizePlatform(p: string): string {
  const s = String(p ?? '').trim().toLowerCase();
  if (s === 'twitter') return 'x';
  return s;
}

/**
 * Cap repurpose depth when campaign week has high content density.
 * High density → fewer repurpose variants to prevent explosion.
 */
function applyDensityGuard(
  effectiveDepth: number,
  densityLevel?: 'low' | 'normal' | 'high'
): number {
  if (!densityLevel) return effectiveDepth;
  if (densityLevel === 'high') {
    return Math.min(effectiveDepth, 1);
  }
  if (densityLevel === 'normal') {
    return Math.min(effectiveDepth, 2);
  }
  return effectiveDepth;
}

/**
 * Check if a transformation (baseType->candidateType) is marked as low-performing.
 * Skips repurpose generation for known underperforming formats.
 * Supports: full key "blog->carousel", or target-only "carousel" (any base→carousel).
 */
function isLowPerforming(
  transformationKey: string,
  signals?: RepurposePerformanceSignals
): boolean {
  if (!signals?.low_performing_patterns?.length) return false;
  const key = transformationKey.trim().toLowerCase();
  const normalizedPatterns = signals.low_performing_patterns.map((p) =>
    String(p ?? '').trim().toLowerCase()
  );
  const exactSet = new Set(normalizedPatterns);
  if (exactSet.has(key)) return true;
  const targetPart = key.includes('->') ? key.split('->')[1] : null;
  if (targetPart && exactSet.has(targetPart)) return true;
  return false;
}


/**
 * Prioritize repurpose candidates by high-performing content types.
 * When signals include high_performing_content_types, filter candidates to those types.
 * If none match, return original candidates (no reduction).
 */
function selectRepurposeTargets(
  baseType: string,
  candidates: string[],
  signals?: RepurposePerformanceSignals
): string[] {
  if (!signals?.high_performing_content_types?.length) {
    return candidates;
  }
  const preferred = new Set(
    signals.high_performing_content_types.map((t) => normalizeContentType(t))
  );
  const prioritized = candidates.filter((type) =>
    preferred.has(normalizeContentType(type))
  );
  if (prioritized.length > 0) {
    return prioritized;
  }
  return candidates;
}

/**
 * Get platform-aware repurpose targets. Returns (platform?, content_type) pairs.
 * When primary_platform has a cascade, uses platform-specific targets; reorders by high-performing platforms when insights exist; filters by eligiblePlatforms.
 * Falls back to content-type graph when no cascade applies or cascade filters to empty.
 * Uses selectRepurposeTargets to prioritize high-performing content types when signals are present.
 */
function getRepurposeTargets(
  slot: RepurposeSlotInput,
  contentType: string,
  adjustedDepth: number,
  eligiblePlatforms?: string[],
  highPerformingPlatforms?: string[],
  signals?: RepurposePerformanceSignals
): Array<{ platform?: string; content_type: string }> {
  const primaryPlatform = normalizePlatform(String(slot.platform ?? ''));
  const eligibleSet =
    eligiblePlatforms?.length
      ? new Set(eligiblePlatforms.map(normalizePlatform).filter(Boolean))
      : null;

  const cascade = primaryPlatform ? PLATFORM_REPURPOSE_CASCADE[primaryPlatform] : undefined;
  if (cascade?.length) {
    const cascadeTargets = [...cascade];
    const platformsForReorder =
      signals?.high_performing_platforms ?? highPerformingPlatforms ?? [];
    if (platformsForReorder?.length) {
      const preferred = new Set(
        platformsForReorder.map((p) => normalizePlatform(String(p ?? ''))).filter(Boolean)
      );
      cascadeTargets.sort((a, b) => {
        const aScore = preferred.has(normalizePlatform(a.platform)) ? 1 : 0;
        const bScore = preferred.has(normalizePlatform(b.platform)) ? 1 : 0;
        return bScore - aScore;
      });
    }
    const reordered = cascadeTargets;
    const filtered = eligibleSet
      ? reordered.filter((t) => eligibleSet.has(normalizePlatform(t.platform)))
      : reordered;
    if (filtered.length > 0) {
      const candidateTypes = filtered.map((t) => t.content_type);
      const prioritizedTypes = selectRepurposeTargets(
        contentType,
        candidateTypes,
        signals
      );
      const result: RepurposeTarget[] = [];
      for (const ct of prioritizedTypes) {
        const entry = filtered.find(
          (t) => normalizeContentType(t.content_type) === normalizeContentType(ct)
        );
        if (entry) result.push(entry);
      }
      const excludeLow = result.filter(
        (t) =>
          !isLowPerforming(`${contentType}->${t.content_type}`, signals)
      );
      return excludeLow
        .slice(0, adjustedDepth)
        .map((t) => ({ platform: t.platform, content_type: t.content_type }));
    }
  }

  const candidates = REPURPOSE_GRAPH[contentType];
  if (!candidates?.length) return [];
  const targets = selectRepurposeTargets(contentType, candidates, signals);
  const excludeLow = targets.filter(
    (content_type) =>
      !isLowPerforming(`${contentType}->${content_type}`, signals)
  );
  return excludeLow
    .slice(0, adjustedDepth)
    .map((content_type) => ({ content_type }));
}

/**
 * Compute adjusted repurpose depth per slot.
 * Base from densityLevel; +1 if high-performing, -1 if low-performing; clamp 1–3.
 */
function getAdjustedDepth(
  contentType: string,
  densityLevel: DensityLevel,
  highPerformingTypes?: string[],
  lowPerformingTypes?: string[]
): number {
  let depth = REPURPOSE_LIMIT[densityLevel];
  const norm = normalizeContentType(contentType);
  const highSet = new Set((highPerformingTypes ?? []).map(normalizeContentType));
  const lowSet = new Set((lowPerformingTypes ?? []).map(normalizeContentType));
  if (highSet.has(norm)) depth += 1;
  if (lowSet.has(norm)) depth -= 1;
  return Math.max(1, Math.min(3, depth));
}

/**
 * Expand slots into repurposed content. Each slot with a graph entry
 * gets additional slots for derived content types.
 *
 * Density controls max additional slots: low=1, normal=2, high=3.
 * highPerformingTypes increases depth by +1; lowPerformingTypes decreases by -1 (clamped 1–3).
 * Repurposed slots shift to next day (Mon→Tue→Wed).
 * Sets repurpose_of on derived slots for lineage tracking.
 */
export function expandRepurposeGraph<T extends RepurposeSlotInput>(
  slots: T[],
  options?: ExpandRepurposeGraphOptions
): T[] {
  const densityLevel = options?.densityLevel ?? 'normal';
  const highPerformingTypes =
    options?.signals?.high_performing_content_types ?? options?.highPerformingTypes;
  const lowPerformingTypes =
    options?.signals?.low_performing_patterns ?? options?.lowPerformingTypes;
  const eligiblePlatforms = options?.eligiblePlatforms;
  const highPerformingPlatforms =
    options?.companyPerformanceInsights?.high_performing_platforms ??
    options?.signals?.high_performing_platforms;
  const boltTextOnly = Boolean(options?.boltTextOnly);

  const result: T[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as T;
    const slotId = (slot.id as string) ?? generateSlotId('slot', i);
    const slotWithId = { ...slot, id: slotId } as T;
    result.push(slotWithId);

    const contentType = normalizeContentType(String(slot.content_type ?? 'post'));
    const adjustedDepth = getAdjustedDepth(
      contentType,
      densityLevel,
      highPerformingTypes,
      lowPerformingTypes
    );
    const ct = (slot.content_type ?? 'post').trim().toLowerCase();
    const isAnchor =
      slot.is_anchor_content ?? (ct === 'blog' || ct === 'article' || ct === 'long_video');
    const amplificationScore = computeContentAmplificationScore(
      slot.content_type ?? 'post',
      slot.platform,
      options?.signals,
      { strategic_importance: isAnchor ? 'high' : 'normal' }
    );
    if (amplificationScore < 0.35) {
      if (process.env.DEBUG_REPURPOSE === 'true') {
        console.info('Repurpose skipped due to low amplification score', {
          slotId: slot.id ?? slotId,
          contentType: slot.content_type,
          amplificationScore,
        });
      }
      continue;
    }
    let maxDepth = 1;
    if (amplificationScore >= 0.8) {
      maxDepth = 3;
    } else if (amplificationScore >= 0.6) {
      maxDepth = 2;
    } else {
      maxDepth = 1;
    }
    const effectiveDepth = Math.min(adjustedDepth, maxDepth);
    const guardedDepth = applyDensityGuard(effectiveDepth, options?.densityLevel);

    let targets = getRepurposeTargets(
      slot,
      contentType,
      guardedDepth,
      eligiblePlatforms,
      highPerformingPlatforms,
      options?.signals
    );
    if (boltTextOnly) {
      targets = targets.filter((t) => !isBoltExcludedContentType(t.content_type));
    }

    if (process.env.DEBUG_REPURPOSE === 'true') {
      console.info('Repurpose amplification', {
        slotId: slot.id ?? slotId,
        contentType: slot.content_type,
        platform: slot.platform,
        amplificationScore,
        guardedDepth,
        signals: options?.signals,
        cascadeTargets: targets,
      });
    }

    if (!targets.length) continue;

    const originalDayInfo = resolveOriginalDayInfo(slot);

    for (let j = 0; j < targets.length; j++) {
      const target = targets[j]!;
      const offset = j + 1;
      const shifted = shiftDay(originalDayInfo.day_index, offset);
      const repurposed = {
        ...slot,
        content_type: target.content_type,
        ...(target.platform ? { platform: target.platform } : {}),
        id: undefined,
        repurpose_of: slotId,
        day: shifted.day,
        day_name: shifted.day_name,
        day_index: shifted.day_index,
      } as T;
      recordRepurposeTransformation({
        sourceType: contentType,
        targetType: target.content_type,
        sourcePlatform: slot.platform,
        targetPlatform: target.platform,
      });
      result.push(repurposed);
    }
  }

  return result;
}
