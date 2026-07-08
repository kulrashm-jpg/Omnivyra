/** Structured plan scheduler — types, capacity, slotting model — split from structuredPlanScheduler.ts (barrel preserved; importers unchanged). */
import { supabase } from '../db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { recordRowFailureBatch, type RowFailureRecord } from './boltRowFailureDiagnostics';
// `getCreatorGovernance` is already imported below from the creator
// governance registry — kept there to avoid duplicate identifier.

import { getPlatformRules, listPlatformCatalog } from './platformIntelligenceService';
import { generateContentForDailyPlans } from './boltContentGenerationForSchedule';
import { processBlockSchedule } from './boltScheduleBlockProcessor';
import { evaluateScheduleEligibility } from './campaignScheduleEligibilityService';
import { getExecutionEngine } from './executionEngines';
import { deriveCreatorAssetTypeFromIntent } from './creatorTemplateRegistryService';
import { validateCreatorExecutionOutput, validateCreatorSchedulingContract } from './creatorExecutionContracts';
import { validateAssetReadiness } from './creatorAssetValidationService';
import { logCreatorExecutionAudit } from './creatorExecutionAuditService';
import { acquireCreatorExecutionLock, CreatorExecutionLockError, extendCreatorExecutionLease, releaseCreatorExecutionLock } from './creatorExecutionLockService';
import { assertCreatorExecutionWithinRateLimits, CreatorExecutionRateLimitError } from './creatorExecutionRateLimitService';
import { recordCreatorExecutionMetric, upsertCreatorExecutionSummary, writeCreatorDeadLetter } from './creatorExecutionObservabilityService';
import { getContentQueue } from '../queue/contentGenerationQueues';
import type { BoltContentJobData } from '../queue/jobProcessors/boltContentJobProcessor';
import { enqueueScheduledPostAt } from '../scheduler/schedulerService';
import { isQueueOperational } from './queueHealth';
import { logPipelineEvent } from '../../lib/shared/observability';
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import type { CanonicalCreatorOutput, CreatorScheduleResult } from './executionEngines/types';
import { ownedDbTable } from '../db/writeOwner';
import {
  makeScheduledPostIdempotencyKey,
  isIdempotencyCollision,
} from './boltScheduleIdempotency';
import {
  assertCreatorFormatsSchedulable,
  assertNoUnschedulableCreatorDailyPlans,
  getCreatorFormatsFromStructuredPlanWeeks,
  getCreatorGovernance,
  getRowSchedulingEligibility,
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
  CREATOR_LIFECYCLE_STATES,
} from '../../lib/shared/creatorGovernanceRegistry';
import { applyTransition } from '../../lib/shared/creatorLifecycleStateMachine';
import { scheduleCreatorAttachmentPost } from './creator/creatorRowScheduler';
// Phase 2B — Intelligent Mix per-row routing (ACTIVE for combined ONLY).
import { partitionRowsByLane } from '../../lib/shared/bolt/rowSchedulingLane';
import { buildRoutingDiagnostics, emitRoutingDiagnostics } from '../../lib/shared/bolt/boltRoutingPreview';


const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export type PlatformNormalizer = (platform: string) => string | null;

export function buildPlatformAliasMap(allowed: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of allowed) map.set(key, key);
  if (allowed.has('x')) {
    map.set('twitter', 'x');
    map.set('twitter/x', 'x');
    map.set('twitter-x', 'x');
  }
  return map;
}

export function normalizePlatform(platform: string, aliasMap: Map<string, string>, allowed: Set<string>): string | null {
  const normalized = String(platform || '').toLowerCase().trim();
  const canonical = aliasMap.get(normalized) || normalized;
  if (!allowed.has(canonical)) return null;
  return canonical;
}

export function toDbPlatformKey(canonicalPlatform: string): string {
  // Keep DB compatibility with existing scheduled_posts.platform usage.
  return canonicalPlatform === 'x' ? 'twitter' : canonicalPlatform;
}

export function toLegacyPlatformKey(dbPlatform: string): string {
  // Legacy UI and endpoints expect 'twitter' not 'x'.
  return dbPlatform === 'x' ? 'twitter' : dbPlatform;
}

/**
 * Hard, unbypassable scheduling floor. RULE: no activity may ever be
 * scheduled/posted in the past, and every item must be at least 1 hour
 * ahead of "now". Applied to the output of EVERY scheduled_for builder
 * below so there is no code path — stale start_date, bad slot math,
 * explicit ISO time, daily-plan date — that can produce past or
 * <1h-ahead activity. Earlier-intended items keep landing earlier
 * (we only lift up to the floor, never reorder).
 */
const SCHEDULE_MIN_LEAD_MS = 60 * 60 * 1000; // 1 hour
export function enforceScheduleFloor(d: Date): Date {
  const floor = Date.now() + SCHEDULE_MIN_LEAD_MS;
  if (Number.isNaN(d.getTime()) || d.getTime() < floor) {
    return new Date(floor);
  }
  return d;
}

const buildScheduledFor = (campaignStart: string, week: number, dayIndex: number, slotInDay = 0): Date => {
  const startDate = new Date(campaignStart);
  const startUTC = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
      9 + slotInDay,
      0,
      0
    )
  );
  const weekOffset = (week - 1) * 7;
  const scheduled = new Date(startUTC);
  scheduled.setUTCDate(startUTC.getUTCDate() + weekOffset + dayIndex);
  return enforceScheduleFloor(scheduled);
};

/** CTA text by type for inclusion in post content */
const CTA_BY_TYPE: Record<string, string> = {
  None: '',
  'Soft CTA': '\n\n— Learn more when you\'re ready.',
  'Engagement CTA': '\n\n💬 What do you think? Comment below.',
  'Authority CTA': '\n\n— Credibility through expertise.',
  'Direct Conversion CTA': '\n\n📌 Book your session now. Link in bio.',
};

/** Detect if plan uses legacy daily[] format (no allocation-driven data) */
export function isLegacyPlan(weeks: any[]): boolean {
  if (!weeks?.length) return false;
  const first = weeks[0];
  const hasDaily = Array.isArray(first.daily) && first.daily.length > 0;
  const hasAllocation =
    first.platform_allocation &&
    typeof first.platform_allocation === 'object' &&
    Object.keys(first.platform_allocation).length > 0;
  return hasDaily && !hasAllocation;
}

/** Expand platform_allocation into ordered array and distribute across 7 days evenly */
function buildAllocationSchedule(
  platform_allocation: Record<string, number>,
  contentTypeMix: string[],
  normalize: PlatformNormalizer
): { platform: string; contentType: string; dayIndex: number; slotInDay: number }[] {
  const total = Object.values(platform_allocation).reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const expanded: string[] = [];
  for (const [platform, count] of Object.entries(platform_allocation)) {
    const norm = normalize(platform);
    if (norm) {
      for (let i = 0; i < count; i++) expanded.push(norm);
    }
  }

  const days = 7;
  const posts: { platform: string; contentType: string; dayIndex: number; slotInDay: number }[] = [];
  const countPerDay = new Map<number, number>();

  for (let i = 0; i < expanded.length; i++) {
    const platform = expanded[i];
    const dayIndex = Math.min(Math.floor((i * days) / expanded.length), days - 1);
    const slotInDay = countPerDay.get(dayIndex) ?? 0;
    countPerDay.set(dayIndex, slotInDay + 1);
    const contentType = pickContentType(contentTypeMix, i);
    posts.push({ platform, contentType, dayIndex, slotInDay });
  }

  return posts;
}

/** Map internal content type to DB schema values (platform-specific constraints). Includes image, carousel, reel, short for activity alignment.
 *  Keys include both strategy-level formats and platform-native types (tweet/feed_post) so cross-platform requests
 *  like `{platform: 'instagram', content_type: 'tweet'}` remap to the platform's native type instead of falling
 *  through to a value the chk_content_type constraint rejects. */
const FALLBACK_CONTENT_TYPE_MAP: Record<string, Record<string, string>> = {
  linkedin:  { post: 'post', tweet: 'post', feed_post: 'post', video: 'video', article: 'article', newsletter: 'newsletter', short_story: 'post', white_paper: 'article', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'article' },
  x:         { post: 'tweet', tweet: 'tweet', feed_post: 'tweet', video: 'video', article: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', poll: 'tweet', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet', thread: 'thread', blog: 'tweet' },
  instagram: { post: 'feed_post', tweet: 'feed_post', feed_post: 'feed_post', video: 'reel', article: 'feed_post', newsletter: 'feed_post', short_story: 'feed_post', white_paper: 'feed_post', poll: 'feed_post', carousel: 'feed_post', image: 'feed_post', reel: 'reel', short: 'reel', story: 'story', thread: 'feed_post', blog: 'feed_post' },
  youtube:   { post: 'video', tweet: 'video', feed_post: 'video', video: 'video', article: 'video', newsletter: 'video', short_story: 'video', white_paper: 'video', poll: 'video', carousel: 'short', image: 'video', reel: 'short', short: 'short', story: 'video', thread: 'video', blog: 'video' },
  facebook:  { post: 'post', tweet: 'post', feed_post: 'post', video: 'video', article: 'post', newsletter: 'post', short_story: 'post', white_paper: 'post', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'post' },
  medium:    { post: 'post', tweet: 'post', feed_post: 'post', article: 'article', newsletter: 'newsletter', short_story: 'article', white_paper: 'article', blog: 'article', thread: 'post' },
  devto:     { post: 'post', tweet: 'post', feed_post: 'post', article: 'article', white_paper: 'article', blog: 'article', thread: 'post' },
};

export function extractTypeMapFromPlatformRules(bundle: any): Record<string, string> | null {
  const rules = bundle?.content_rules || [];
  for (const rule of rules) {
    const candidate = rule?.formatting_rules?.type_map;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, string>;
    }
  }
  return null;
}

export function toDbContentType(
  platform: string,
  contentType: string,
  typeMapByPlatform: Record<string, Record<string, string>>
): string {
  const normalizedType = String(contentType || '').toLowerCase().trim();
  const fromDb = typeMapByPlatform[platform];
  if (fromDb && fromDb[normalizedType]) return fromDb[normalizedType];
  const fallback = FALLBACK_CONTENT_TYPE_MAP[platform] || FALLBACK_CONTENT_TYPE_MAP.linkedin;
  return fallback[normalizedType] || 'post';
}

/** Assign content_type from content_type_mix, rotating deterministically. Aligns to planning choices (image, carousel, video, reel, short, post). */
function pickContentType(contentTypeMix: string[], index: number): string {
  if (!contentTypeMix?.length) return 'post';
  const normalized = contentTypeMix.map((s) => {
    const lower = String(s ?? '').toLowerCase().trim();
    if (lower.includes('image')) return 'image';
    if (lower.includes('carousel')) return 'carousel';
    if (lower.includes('reel')) return 'reel';
    if (lower.includes('short')) return 'short';
    if (lower.includes('video')) return 'video';
    if (lower.includes('article') || lower.includes('blog')) return 'article';
    if (lower.includes('poll')) return 'poll';
    if (lower.includes('story')) return 'story';
    if (lower.includes('thread')) return 'thread';
    return 'post';
  });
  return normalized[index % normalized.length] || 'post';
}

/** Build post content placeholder from CTA type and phase */
function buildContentPlaceholder(phaseLabel: string, ctaType: string, contentType: string): string {
  const cta = CTA_BY_TYPE[ctaType] || '';
  return `Content for ${phaseLabel} — ${contentType}${cta}`;
}

export type StructuredWeekBlueprint = {
  week: number;
  phase_label?: string;
  primary_objective?: string;
  platform_allocation?: Record<string, number>;
  content_type_mix?: string[];
  cta_type?: string;
  total_weekly_content_count?: number;
  weekly_kpi_focus?: string;
  theme?: string;
  daily?: Array<{
    day: string;
    objective: string;
    content: string;
    platforms: Record<string, string>;
  }>;
};

export type StructuredPlan = {
  weeks: StructuredWeekBlueprint[];
  format?: 'blueprint' | 'legacy';
};

type SchedulableExecutionJob = {
  execution_id: string;
  job_id: string;
  platform: string;
  content_type: string;
  variant_ref: string;
  scheduled_time?: string;
};

export function extractSchedulableJobsFromWeeks(weeks: any[]): SchedulableExecutionJob[] {
  const result: SchedulableExecutionJob[] = [];
  const seen = new Set<string>();
  const sourceWeeks = Array.isArray(weeks) ? weeks : [];
  for (const week of sourceWeeks) {
    const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
    for (const item of items) {
      const executionId = String(item?.execution_id || '').trim();
      const scheduledTime = String(item?.scheduled_time || '').trim() || undefined;
      const jobs = Array.isArray(item?.execution_jobs) ? item.execution_jobs : [];
      for (const job of jobs) {
        if (!job || job.ready_to_schedule !== true) continue;
        const jobId = String(job.job_id || '').trim();
        const platform = String(job.platform || '').trim().toLowerCase();
        const contentType = String(job.content_type || 'post').trim().toLowerCase();
        const variantRef = String(job.variant_ref || `${platform}::${contentType}`).trim();
        if (!jobId || !platform || seen.has(jobId)) continue;
        seen.add(jobId);
        result.push({
          execution_id: executionId || jobId,
          job_id: jobId,
          platform,
          content_type: contentType,
          variant_ref: variantRef,
          scheduled_time: scheduledTime,
        });
      }
    }
  }
  return result;
}

/** Daily plan row from DB, used as primary BOLT scheduling source */
export type DailyPlanRow = {
  id: string;
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  date: string;
  platform: string;
  content_type: string;
  title?: string | null;
  topic?: string | null;
  scheduled_time?: string | null;
  content?: string | null;
  content_status?: string | null;
  intent_type?: string | null;
  asset_type?: string | null;
  template_id?: string | null;
  plan_version?: number | null;
  locked_by?: string | null;
  lease_expires_at?: string | null;
  attempt_count?: number | null;
  retry_count?: number | null;
  max_retries?: number | null;
  failure_reason?: string | null;
  failure_type?: string | null;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toNumericValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getCurrentCampaignPlanVersion(campaignId: string): Promise<number> {
  const { data, error } = await ownedDbTable('campaign_versions')
    .select('version')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_PLAN_INVALID,
      `Failed to resolve current campaign plan version: ${error.message}`,
      { cause: error, details: { db_error: error.message } }
    );
  }
  return Math.max(1, toNumericValue((data as any)?.version, 1));
}

export function classifyCreatorFailure(error: unknown): 'transient' | 'permanent' {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('429') ||
    normalized.includes('failed to schedule creator output') ||
    normalized.includes('rate limit')
  ) {
    return 'transient';
  }
  return 'permanent';
}

export function assertNoUnschedulableCreatorPlanWeeks(weeks: StructuredWeekBlueprint[]): void {
  assertCreatorFormatsSchedulable(getCreatorFormatsFromStructuredPlanWeeks(weeks));
}

export function startCreatorLeaseHeartbeat(input: {
  dailyPlanId: string;
  lockOwner: string;
  leaseSeconds?: number;
}): { stop: () => Promise<void> } {
  const intervalMs = Math.max(15000, Math.floor((Number(input.leaseSeconds ?? 300) * 1000) / 2));
  const timer = setInterval(() => {
    void extendCreatorExecutionLease({
      dailyPlanId: input.dailyPlanId,
      lockOwner: input.lockOwner,
      leaseSeconds: input.leaseSeconds,
    }).catch((error) => {
      console.warn('[creatorExecutionLock] heartbeat failed', {
        dailyPlanId: input.dailyPlanId,
        error: (error as Error)?.message,
      });
    });
  }, intervalMs);

  return {
    async stop() {
      clearInterval(timer);
    },
  };
}

function tryParseDailyPlanContent(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isPlaceholderLikeScheduledContent(content: string | null | undefined): boolean {
  const text = String(content || '').trim();
  if (!text) return true;
  return (
    /^\s*content for\b/i.test(text) ||
    /^\s*content placeholder\b/i.test(text) ||
    /^\s*execution job content placeholder\b/i.test(text) ||
    text.startsWith('[PLATFORM ADAPTATION FAILED]') ||
    text.startsWith('[MASTER GENERATION FAILED') ||
    text.startsWith('[MASTER CONTENT PLACEHOLDER]') ||
    text.startsWith('[PLATFORM MEDIA BLUEPRINT]') ||
    text.startsWith('[MEDIA BLUEPRINT]')
  );
}

function extractResolvedContentFromDailyPlan(row: DailyPlanRow): string | null {
  const parsed = tryParseDailyPlanContent(row.content);
  if (!parsed) return null;

  const direct = String(parsed.generated_content ?? '').trim();
  if (direct && !isPlaceholderLikeScheduledContent(direct)) return direct;

  const variants = Array.isArray(parsed.platform_variants) ? parsed.platform_variants : [];
  const match = variants.find((variant) =>
    String((variant as any)?.platform || '').trim().toLowerCase() === String(row.platform || '').trim().toLowerCase() &&
    String((variant as any)?.content_type || '').trim().toLowerCase() === String(row.content_type || 'post').trim().toLowerCase()
  );
  const variantContent = String((match as any)?.generated_content || '').trim();
  if (variantContent && !isPlaceholderLikeScheduledContent(variantContent)) return variantContent;

  const master = parsed.master_content && typeof parsed.master_content === 'object'
    ? String((parsed.master_content as any).content || '').trim()
    : '';
  if (master && !isPlaceholderLikeScheduledContent(master)) return master;

  return null;
}

/**
 * Build scheduled_for Date from daily plan date + time.
 * date: YYYY-MM-DD; scheduled_time: HH:MM or HH:MM:SS or ISO string
 */
export function buildScheduledForFromDailyPlan(dateStr: string, timeStr: string | undefined): Date {
  const time = String(timeStr ?? '09:00').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})/);
  const hours = hhmm ? Math.min(23, Math.max(0, Number(hhmm[1]))) : 9;
  const minutes = hhmm ? Math.min(59, Math.max(0, Number(hhmm[2]))) : 0;
  const datePart = String(dateStr ?? '').slice(0, 10);
  if (!datePart) return enforceScheduleFloor(new Date(0));
  return enforceScheduleFloor(new Date(Date.UTC(
    parseInt(datePart.slice(0, 4), 10),
    parseInt(datePart.slice(5, 7), 10) - 1,
    parseInt(datePart.slice(8, 10), 10),
    hours,
    minutes,
    0
  )));
}

/**
 * Schedule from BOLT-generated daily_content_plans.
 * Preserves repurpose cascade platforms, posting times, and slot ordering.
 * When contentMap is provided (from master+repurpose generation), uses generated content instead of placeholders.
 */
export function scheduleFromDailyPlans(
  plans: DailyPlanRow[],
  campaign: { start_date: string; user_id: string },
  accountMap: Map<string, string>,
  campaignId: string,
  normalize: PlatformNormalizer,
  typeMapByPlatform: Record<string, Record<string, string>>,
  contentMap?: Map<string, string>
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  const sorted = [...plans].sort((a, b) => {
    const dA = new Date(a.date).getTime();
    const dB = new Date(b.date).getTime();
    if (dA !== dB) return dA - dB;
    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const idxA = dayOrder.indexOf(String(a.day_of_week || '').toLowerCase());
    const idxB = dayOrder.indexOf(String(b.day_of_week || '').toLowerCase());
    return (idxA >= 0 ? idxA : 0) - (idxB >= 0 ? idxB : 0);
  });

  // Compute repurpose_index/repurpose_total: group by (topic||title, week_number), assign 1..N within each group
  const repurposeByRowId = new Map<string, { index: number; total: number }>();
  const groupKey = (r: DailyPlanRow) =>
    `${String(r.topic || r.title || 'untitled').trim()}|${Number(r.week_number ?? 1) || 1}`;
  const groups = new Map<string, DailyPlanRow[]>();
  for (const r of sorted) {
    const key = groupKey(r);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const PLATFORM_ORDER = ['linkedin', 'facebook', 'instagram', 'x', 'twitter', 'youtube', 'tiktok', 'pinterest'];
  for (const [, list] of groups) {
    const total = list.length;
    const ordered = [...list].sort((a, b) => {
      const pa = String(a.platform || '').toLowerCase();
      const pb = String(b.platform || '').toLowerCase();
      const ia = PLATFORM_ORDER.indexOf(pa) >= 0 ? PLATFORM_ORDER.indexOf(pa) : 999;
      const ib = PLATFORM_ORDER.indexOf(pb) >= 0 ? PLATFORM_ORDER.indexOf(pb) : 999;
      return ia - ib || pa.localeCompare(pb);
    });
    ordered.forEach((r, i) => repurposeByRowId.set(r.id, { index: i + 1, total }));
  }

  for (const row of sorted) {
    const platform = normalize(String(row.platform || '').trim().toLowerCase());
    if (!platform) {
      if (!skippedPlatforms.includes(row.platform)) skippedPlatforms.push(row.platform);
      continue;
    }
    const socialAccountId = accountMap.get(platform);
    if (!socialAccountId) {
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      continue;
    }

    const contentType = String(row.content_type || 'post').trim().toLowerCase();
    const topic = String(row.topic || row.title || '').trim();
    const generatedContent = contentMap?.get(row.id);
    const persistedResolvedContent = extractResolvedContentFromDailyPlan(row);
    const content =
      (generatedContent && generatedContent.trim() && !isPlaceholderLikeScheduledContent(generatedContent) ? generatedContent : null) ||
      persistedResolvedContent;

    if (!content) {
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      continue;
    }

    const scheduledFor = buildScheduledForFromDailyPlan(row.date, row.scheduled_time ?? undefined);
    const platformForDb = toDbPlatformKey(platform);
    const repurpose = repurposeByRowId.get(row.id) ?? { index: 1, total: 1 };

    scheduledPosts.push({
      user_id: campaign.user_id,
      social_account_id: socialAccountId,
      campaign_id: campaignId,
      platform: platformForDb,
      content_type: toDbContentType(platform, contentType, typeMapByPlatform),
      title: topic || undefined,
      content,
      scheduled_for: scheduledFor.toISOString(),
      status: 'scheduled',
      repurpose_index: repurpose.index,
      repurpose_total: repurpose.total,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return { scheduledPosts, skippedPlatforms };
}

function buildScheduledForFromJob(campaignStart: string, scheduledTime: string | undefined, index: number): Date {
  if (scheduledTime) {
    const isoLike = new Date(scheduledTime);
    if (!Number.isNaN(isoLike.getTime()) && scheduledTime.includes('T')) {
      return enforceScheduleFloor(isoLike);
    }
    const hhmm = scheduledTime.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) {
      const hours = Math.min(23, Math.max(0, Number(hhmm[1])));
      const minutes = Math.min(59, Math.max(0, Number(hhmm[2])));
      const base = new Date(campaignStart);
      const withTime = new Date(
        Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth(),
          base.getUTCDate() + (index % 7),
          hours,
          minutes,
          0
        )
      );
      return enforceScheduleFloor(withTime);
    }
  }
  return buildScheduledFor(campaignStart, 1, index % 7, Math.floor(index / 7) % 3);
}

export function scheduleFromExecutionJobs(
  weeks: StructuredWeekBlueprint[],
  jobs: SchedulableExecutionJob[],
  campaign: { start_date: string; user_id: string },
  accountMap: Map<string, string>,
  campaignId: string,
  normalize: PlatformNormalizer,
  typeMapByPlatform: Record<string, Record<string, string>>
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  const variantContentMap = new Map<string, string>();
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
    for (const item of items) {
      const executionId = String(item?.execution_id || '').trim();
      const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
      for (const variant of variants) {
        const platform = String(variant?.platform || '').trim().toLowerCase();
        const contentType = String(variant?.content_type || 'post').trim().toLowerCase();
        const key = `${executionId}::${platform}::${contentType}`;
        const content = String(variant?.generated_content || '').trim();
        if (key && content) variantContentMap.set(key, content);
      }
    }
  }

  jobs.forEach((job, idx) => {
    const platform = normalize(job.platform);
    if (!platform) {
      if (!skippedPlatforms.includes(job.platform)) skippedPlatforms.push(job.platform);
      return;
    }
    const socialAccountId = accountMap.get(platform);
    if (!socialAccountId) {
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      return;
    }
    const scheduledFor = buildScheduledForFromJob(campaign.start_date, job.scheduled_time, idx);
    const platformForDb = toDbPlatformKey(platform);
    const variantKey = `${job.execution_id}::${platform}::${job.content_type}`;
    const content =
      variantContentMap.get(variantKey) ||
      `Execution job content placeholder — ${job.variant_ref}`;

    scheduledPosts.push({
      user_id: campaign.user_id,
      social_account_id: socialAccountId,
      campaign_id: campaignId,
      platform: platformForDb,
      content_type: toDbContentType(platform, job.content_type, typeMapByPlatform),
      content,
      scheduled_for: scheduledFor.toISOString(),
      status: 'scheduled',
      repurpose_index: 1,
      repurpose_total: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  return { scheduledPosts, skippedPlatforms };
}

/** Allocation-driven scheduling: use platform_allocation to determine post count and distribution */
export function scheduleFromAllocation(
  weeks: StructuredWeekBlueprint[],
  campaign: { start_date: string; user_id: string },
  accountMap: Map<string, string>,
  campaignId: string,
  normalize: PlatformNormalizer,
  typeMapByPlatform: Record<string, Record<string, string>>,
  fallbackPlatforms?: string[],
  fallbackFrequency?: number
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  for (const week of weeks) {
    let allocation: Record<string, number> = week.platform_allocation || {};
    const total = Object.values(allocation).reduce((a, b) => a + b, 0);
    if (total === 0) {
      // Build fallback allocation from eligiblePlatforms + frequencyPerWeek so
      // weeks with no AI-generated platform_allocation still get scheduled.
      const platforms = fallbackPlatforms?.length ? fallbackPlatforms : Array.from(accountMap.keys());
      if (!platforms.length) continue;
      const freq = fallbackFrequency ?? 3;
      const perPlatform = Math.max(1, Math.round(freq / platforms.length));
      allocation = {};
      for (const p of platforms) allocation[p] = perPlatform;
    }

    const contentTypeMix = week.content_type_mix || ['post'];
    const ctaType = week.cta_type || 'None';
    const topicLabel = week.theme || week.phase_label || `Week ${week.week}`;
    const kpiFocus = week.weekly_kpi_focus || 'Reach growth';

    const schedule = buildAllocationSchedule(allocation, contentTypeMix, normalize);

    for (const item of schedule) {
      const { platform, contentType, dayIndex, slotInDay } = item;
      const socialAccountId = accountMap.get(platform);
      if (!socialAccountId) {
        if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
        continue;
      }

      const content = buildContentPlaceholder(topicLabel, ctaType, contentType);
      const scheduledFor = buildScheduledFor(campaign.start_date, week.week, dayIndex, slotInDay);
      const platformForDb = toDbPlatformKey(platform);

      scheduledPosts.push({
          user_id: campaign.user_id,
          social_account_id: socialAccountId,
          campaign_id: campaignId,
          platform: platformForDb,
          content_type: toDbContentType(platform, contentType, typeMapByPlatform),
        content: `${content}\n\n[KPI Focus: ${kpiFocus}]`,
        scheduled_for: scheduledFor.toISOString(),
        status: 'scheduled',
        repurpose_index: 1,
        repurpose_total: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return { scheduledPosts, skippedPlatforms };
}

/** Legacy scheduling: use daily[].platforms Record */
export function scheduleFromLegacy(
  weeks: StructuredWeekBlueprint[],
  campaign: { start_date: string; user_id: string },
  accountMap: Map<string, string>,
  campaignId: string,
  normalize: PlatformNormalizer
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  for (const week of weeks) {
    const daily = week.daily || [];
    for (const day of daily) {
      const targetIndex = DAY_INDEX[day.day.toLowerCase()];
      const dayIndex = targetIndex >= 0 ? targetIndex : 0;

      for (const [platformKey, content] of Object.entries(day.platforms || {})) {
        const platform = normalize(platformKey);
        if (!platform) {
          skippedPlatforms.push(platformKey);
          continue;
        }
        const socialAccountId = accountMap.get(platform);
        if (!socialAccountId) {
          skippedPlatforms.push(platformKey);
          continue;
        }

        const scheduledFor = buildScheduledFor(campaign.start_date, week.week, dayIndex, 0);
        const platformForDb = toDbPlatformKey(platform);

        scheduledPosts.push({
          user_id: campaign.user_id,
          social_account_id: socialAccountId,
          campaign_id: campaignId,
          platform: platformForDb,
          content_type: 'post',
          content,
          scheduled_for: scheduledFor.toISOString(),
          status: 'scheduled',
          repurpose_index: 1,
          repurpose_total: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return { scheduledPosts, skippedPlatforms };
}

export type ScheduleStructuredPlanOptions = {
  /** When true (BOLT schedule outcome), generate master content + repurpose variants before scheduling. */
  generateContent?: boolean;
  /** Called when transitioning between schedule sub-stages (BOLT progress). */
  onProgress?: (stage: string) => void;
  /** When true, skip (platform, date) combinations that are already scheduled for this campaign. */
  skipExisting?: boolean;
  /** Total posts per week to use as fallback when platform_allocation is empty. */
  frequencyPerWeek?: number;
  /** Platform keys to use as fallback when platform_allocation is empty. */
  eligiblePlatforms?: string[];
  /**
   * BOLT execution run ID. When provided with generateContent=true, jobs are queued
   * to BullMQ instead of processed inline — required for large campaigns (10+ platforms).
   */
  run_id?: string;
  executionProfile?: string;
};

export function tryParseExecutionContent(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// ---------------------------------------------------------------------------
// Queue-based BOLT content job creation
// ---------------------------------------------------------------------------

export const CONTENT_TYPE_PRIORITY_MAP: Record<string, number> = {
  blog: 1, article: 2, white_paper: 2, newsletter: 3,
  short_story: 3, thread: 4, post: 5, carousel: 5,
  image: 5, story: 5, reel: 5, short: 5, video: 5, poll: 5,
};

