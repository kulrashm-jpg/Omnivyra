import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
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
import type { CanonicalCreatorOutput, CreatorScheduleResult } from './executionEngines/types';
import { createHash } from 'crypto';
import { getJobRegistryEntry } from '../jobs/jobRegistry';
import { claimIdempotencyKey } from '../jobs/idempotencyService';

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

type PlatformNormalizer = (platform: string) => string | null;

function buildPlatformAliasMap(allowed: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of allowed) map.set(key, key);
  if (allowed.has('x')) {
    map.set('twitter', 'x');
    map.set('twitter/x', 'x');
    map.set('twitter-x', 'x');
  }
  return map;
}

function normalizePlatform(platform: string, aliasMap: Map<string, string>, allowed: Set<string>): string | null {
  const normalized = String(platform || '').toLowerCase().trim();
  const canonical = aliasMap.get(normalized) || normalized;
  if (!allowed.has(canonical)) return null;
  return canonical;
}

function toDbPlatformKey(canonicalPlatform: string): string {
  // Keep DB compatibility with existing scheduled_posts.platform usage.
  return canonicalPlatform === 'x' ? 'twitter' : canonicalPlatform;
}

function toLegacyPlatformKey(dbPlatform: string): string {
  // Legacy UI and endpoints expect 'twitter' not 'x'.
  return dbPlatform === 'x' ? 'twitter' : dbPlatform;
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
  return scheduled;
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
function isLegacyPlan(weeks: any[]): boolean {
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

function extractTypeMapFromPlatformRules(bundle: any): Record<string, string> | null {
  const rules = bundle?.content_rules || [];
  for (const rule of rules) {
    const candidate = rule?.formatting_rules?.type_map;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, string>;
    }
  }
  return null;
}

function toDbContentType(
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

type StructuredWeekBlueprint = {
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

type StructuredPlan = {
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
type DailyPlanRow = {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumericValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getCurrentCampaignPlanVersion(campaignId: string): Promise<number> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('version')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to resolve current campaign plan version: ${error.message}`);
  }
  return Math.max(1, toNumericValue((data as any)?.version, 1));
}

function classifyCreatorFailure(error: unknown): 'transient' | 'permanent' {
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

function startCreatorLeaseHeartbeat(input: {
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
function buildScheduledForFromDailyPlan(dateStr: string, timeStr: string | undefined): Date {
  const time = String(timeStr ?? '09:00').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})/);
  const hours = hhmm ? Math.min(23, Math.max(0, Number(hhmm[1]))) : 9;
  const minutes = hhmm ? Math.min(59, Math.max(0, Number(hhmm[2]))) : 0;
  const datePart = String(dateStr ?? '').slice(0, 10);
  if (!datePart) return new Date();
  return new Date(Date.UTC(
    parseInt(datePart.slice(0, 4), 10),
    parseInt(datePart.slice(5, 7), 10) - 1,
    parseInt(datePart.slice(8, 10), 10),
    hours,
    minutes,
    0
  ));
}

/**
 * Schedule from BOLT-generated daily_content_plans.
 * Preserves repurpose cascade platforms, posting times, and slot ordering.
 * When contentMap is provided (from master+repurpose generation), uses generated content instead of placeholders.
 */
function scheduleFromDailyPlans(
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
      return isoLike;
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
      return withTime;
    }
  }
  return buildScheduledFor(campaignStart, 1, index % 7, Math.floor(index / 7) % 3);
}

function scheduleFromExecutionJobs(
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
function scheduleFromAllocation(
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
function scheduleFromLegacy(
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
  campaignMode?: string;
};

function tryParseExecutionContent(value: unknown): Record<string, unknown> {
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

const CONTENT_TYPE_PRIORITY_MAP: Record<string, number> = {
  blog: 1, article: 2, white_paper: 2, newsletter: 3,
  short_story: 3, thread: 4, post: 5, carousel: 5,
  image: 5, story: 5, reel: 5, short: 5, video: 5, poll: 5,
};

function topicGroupKeyForQueue(row: DailyPlanRow): string {
  let parsed: Record<string, unknown> = {};
  if (row.content && typeof row.content === 'string') {
    try { parsed = JSON.parse(row.content); } catch { /* ok */ }
  } else if (row.content && typeof row.content === 'object') {
    parsed = row.content as Record<string, unknown>;
  }
  const src  = String((parsed as any).source_execution_id ?? '').trim();
  const mid  = String((parsed as any).master_content_id    ?? '').trim();
  const eid  = String((parsed as any).execution_id         ?? '').trim();
  const topic = String(row.topic || row.title || (parsed as any).topicTitle || '').trim() || 'untitled';
  const week  = Number(row.week_number) || 1;
  if (src) return `shared::${src}::${week}`;
  if (mid) return `master::${mid}::${week}`;
  if (eid) return `unique::${eid}::${week}`;
  return `topic::${topic}::${week}`;
}

/**
 * Group daily_content_plans rows into topic groups, create bolt_content_jobs rows
 * in DB, create platform_content_slots rows, then push to the bolt-content-jobs
 * BullMQ queue. Returns the number of jobs queued.
 *
 * IMPORTANT: `normalize` converts raw platform values from daily_content_plans
 * (e.g. 'LinkedIn', 'twitter') to canonical keys (e.g. 'linkedin', 'x') that
 * match the accountMap keys. Without this, all platforms are silently dropped.
 */
async function queueBoltContentJobs(
  runId: string,
  campaignId: string,
  dailyPlans: DailyPlanRow[],
  campaign: { start_date: string; user_id: string; company_id?: string | null },
  accountMap: Map<string, string>,
  typeMapByPlatform: Record<string, Record<string, string>>,
  normalize: PlatformNormalizer,
): Promise<number> {
  const companyId = campaign.company_id ?? null;

  // Group rows by content_type × topic
  const contentTypeGroups = new Map<string, Map<string, DailyPlanRow[]>>();
  for (const row of dailyPlans) {
    const ct  = String(row.content_type || 'post').toLowerCase().trim();
    const key = topicGroupKeyForQueue(row);
    if (!contentTypeGroups.has(ct)) contentTypeGroups.set(ct, new Map());
    const topicMap = contentTypeGroups.get(ct)!;
    const list = topicMap.get(key) ?? [];
    list.push(row);
    topicMap.set(key, list);
  }

  // Flatten into job descriptors
  type JobDescriptor = {
    contentType: string;
    topic: string;
    rows: DailyPlanRow[];
    priority: number;
    platformTargets: Array<{ platform: string; content_type: string; raw_platform: string }>;
    enriched: Record<string, unknown>;
  };

  const jobs: JobDescriptor[] = [];
  for (const [ct, topicMap] of contentTypeGroups.entries()) {
    for (const rows of topicMap.values()) {
      const first  = rows[0]!;
      let parsed: Record<string, unknown> = {};
      if (first.content && typeof first.content === 'string') {
        try { parsed = JSON.parse(first.content); } catch { /* ok */ }
      } else if (first.content && typeof first.content === 'object') {
        parsed = first.content as Record<string, unknown>;
      }
      const topic = String(
        first.topic || first.title || (parsed as any).topicTitle || ''
      ).trim() || 'Untitled';

      // CRITICAL: normalize raw platform values before checking accountMap.
      // daily_content_plans stores raw values like 'LinkedIn', 'twitter', 'Instagram'.
      // accountMap keys are canonical: 'linkedin', 'x', 'instagram'.
      const platformTargets = rows.map((r) => {
        const rawPlatform = String(r.platform || '').trim().toLowerCase();
        const canonical   = normalize(rawPlatform);
        if (!canonical || !accountMap.has(canonical)) return null;
        return {
          platform:     canonical,           // normalized — used for accountMap lookup
          raw_platform: rawPlatform,         // original — stored for debugging
          content_type: String(r.content_type || 'post').trim().toLowerCase(),
        };
      }).filter((t): t is NonNullable<typeof t> => t !== null);

      if (platformTargets.length === 0) {
        console.warn('[schedule] queueBoltContentJobs: no valid platforms for topic', {
          topic, ct,
          rawPlatforms: rows.map((r) => r.platform),
          accountMapKeys: Array.from(accountMap.keys()),
        });
        continue;
      }

      jobs.push({
        contentType: ct,
        topic,
        rows,
        priority: CONTENT_TYPE_PRIORITY_MAP[ct] ?? 5,
        platformTargets,
        enriched: {
          topic: first.topic || first.title || '',
          title: first.title || first.topic || '',
          ...parsed,
        },
      });
    }
  }

  if (jobs.length === 0) {
    console.warn('[schedule] queueBoltContentJobs: 0 jobs after platform normalization', {
      dailyPlansCount: dailyPlans.length,
      accountMapKeys: Array.from(accountMap.keys()),
      rawPlatforms: [...new Set(dailyPlans.map((r) => r.platform))],
    });
    return 0;
  }

  // Serialize accountMap for job payload (Map isn't JSON-serialisable).
  // Keys are canonical platform names — processor must use canonical name for lookup.
  const accountMapObj: Record<string, string> = {};
  accountMap.forEach((v, k) => { accountMapObj[k] = v; });

  const queue = getContentQueue('bolt-content-jobs');
  let queued = 0;

  for (const jd of jobs) {
    // 1. Insert bolt_content_jobs row
    const { data: jobRow, error: jobInsertErr } = await supabase
      .from('bolt_content_jobs')
      .insert({
        run_id:         runId,
        campaign_id:    campaignId,
        daily_plan_ids: jd.rows.map((r) => r.id),
        content_type:   jd.contentType,
        topic:          jd.topic,
        priority:       jd.priority,
        status:         'pending',
      })
      .select('id')
      .maybeSingle();

    if (jobInsertErr || !jobRow) {
      console.warn('[schedule] bolt_content_jobs insert failed:', jobInsertErr?.message, { topic: jd.topic });
      continue;
    }

    const boltJobId = (jobRow as any).id as string;

    // 2. Insert platform_content_slots (one per daily_plan row)
    const slotRows = jd.rows.map((r) => ({
      campaign_id:   campaignId,
      daily_plan_id: r.id,
      bolt_job_id:   boltJobId,
      platform:      String(r.platform || '').toLowerCase(),
      content_type:  String(r.content_type || 'post').toLowerCase(),
      scheduled_for: r.date ? new Date(`${String(r.date).slice(0, 10)}T09:00:00Z`).toISOString() : null,
      status:        'empty',
    }));

    // Insert in batches of 50 to avoid Supabase payload limits
    for (let i = 0; i < slotRows.length; i += 50) {
      const batch = slotRows.slice(i, i + 50);
      const { error: slotErr } = await supabase.from('platform_content_slots').insert(batch);
      if (slotErr) console.warn('[schedule] platform_content_slots insert error:', slotErr.message);
    }

    // 3. Mark job as queued and push to BullMQ
    await supabase
      .from('bolt_content_jobs')
      .update({ status: 'queued' })
      .eq('id', boltJobId);

    const jobData: BoltContentJobData = {
      run_id:               runId,
      campaign_id:          campaignId,
      bolt_job_id:          boltJobId,
      topic:                jd.topic,
      content_type:         jd.contentType,
      daily_plan_ids:       jd.rows.map((r) => r.id),
      enriched:             jd.enriched,
      platform_targets:     jd.platformTargets,
      campaign: {
        start_date: campaign.start_date,
        user_id:    campaign.user_id,
        company_id: companyId,
      },
      account_map:          accountMapObj,
      type_map_by_platform: typeMapByPlatform,
    };

    await queue.add(`bolt-topic-${boltJobId}`, jobData, {
      priority: jd.priority,
      attempts: 3,
      backoff:  { type: 'exponential', delay: 3000 },
    });

    queued++;
  }

  console.log('[schedule] queueBoltContentJobs done', { runId, queued, totalJobs: jobs.length });
  return queued;
}

async function processCreatorStructuredSchedule(input: {
  campaignId: string;
  companyId: string | null;
  userId: string;
  dailyPlans: DailyPlanRow[];
  accountMap: Map<string, string>;
  normalize: PlatformNormalizer;
  typeMapByPlatform: Record<string, Record<string, string>>;
  currentPlanVersion: number;
  onProgress?: (stage: string) => void;
}): Promise<{
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
}> {
  const {
    campaignId,
    companyId,
    userId,
    dailyPlans,
    accountMap,
    normalize,
    typeMapByPlatform,
    currentPlanVersion,
    onProgress,
  } = input;
  const engine = getExecutionEngine('creator');
  const skippedPlatforms: string[] = [];
  let scheduledCount = 0;
  let skippedCount = 0;

  for (const row of dailyPlans) {
    if (row.failure_type === 'permanent' && toNumericValue(row.plan_version, 1) === currentPlanVersion) {
      if (!skippedPlatforms.includes(String(row.platform || '').toLowerCase())) {
        skippedPlatforms.push(String(row.platform || '').toLowerCase());
      }
      skippedCount++;
      continue;
    }
    const platform = normalize(String(row.platform || '').trim().toLowerCase());
    if (!platform) {
      skippedCount++;
      continue;
    }

    const socialAccountId = accountMap.get(platform);
    if (!socialAccountId) {
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      skippedCount++;
      continue;
    }

    const parsed = tryParseExecutionContent(row.content);
    const topic = String(row.topic || row.title || parsed.topicTitle || 'Untitled').trim();
    const targetPlatforms = [platform];
    const creatorCard = parsed.creator_card && typeof parsed.creator_card === 'object'
      ? parsed.creator_card as Record<string, unknown>
      : null;
    const templateId = typeof parsed.template_id === 'string' ? parsed.template_id : row.template_id ?? null;
    const assetType = deriveCreatorAssetTypeFromIntent({
      contentType: String(row.content_type || 'video'),
      targetPlatforms: [platform],
    });
    const planVersion = Math.max(1, toNumericValue(row.plan_version, 1));
    const lockOwner = `creator:${campaignId}:${row.id}:${Date.now()}`;
    let lockState: Awaited<ReturnType<typeof acquireCreatorExecutionLock>> | null = null;
    let leaseHeartbeat: { stop: () => Promise<void> } | null = null;
    const executionStartedAt = Date.now();

    try {
      lockState = await acquireCreatorExecutionLock({
        dailyPlanId: row.id,
        lockOwner,
        expectedPlanVersion: currentPlanVersion,
      });
      leaseHeartbeat = startCreatorLeaseHeartbeat({
        dailyPlanId: row.id,
        lockOwner,
      });
      const maxRetries = Math.max(1, lockState.max_retries);
      let retryCount = Math.max(0, lockState.retry_count);
      let lastError: Error | null = null;
      let finalOutput: CanonicalCreatorOutput | null = null;
      let finalScheduling: CreatorScheduleResult | null = null;
      let readinessFailure: string | null = null;
      let failureType: 'transient' | 'permanent' | 'stale' | null = null;

      await assertCreatorExecutionWithinRateLimits({
        campaignId,
        userId,
      });
      await logCreatorExecutionAudit({
        campaignId,
        companyId,
        userId,
        dailyPlanId: row.id,
        platform,
        assetType,
        stage: 'intent',
        attemptCount: lockState.attempt_count,
        retryCount,
        planVersion,
        status: 'started',
        payload: {
          topic,
          content_type: row.content_type,
          template_id: templateId,
          target_platforms: targetPlatforms,
          content_status: row.content_status ?? null,
        },
      });

      for (let attempt = retryCount; attempt < maxRetries; attempt++) {
        onProgress?.(`schedule-creator-${platform}`);
        retryCount = attempt;
        try {
          const planVersionAtGenerate = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtGenerate !== planVersion) {
            failureType = 'stale';
            throw new Error(`Stale creator plan version ${planVersion}; current version is ${planVersionAtGenerate}`);
          }
          const generated = await (engine as any).generateFromIntent({
            campaignId,
            companyId,
            userId,
            topic,
            contentType: String(row.content_type || 'video'),
            targetPlatforms,
            audience: String((parsed.whoAreWeWritingFor ?? parsed.target_audience ?? creatorCard?.target_audience ?? '') || ''),
            objective: String((parsed.dailyObjective ?? parsed.objective ?? creatorCard?.objective ?? '') || ''),
            summary: String((parsed.summary ?? parsed.whatProblemAreWeAddressing ?? creatorCard?.summary ?? '') || ''),
            creatorCard,
            enrichedIntent: parsed,
            templateId,
            existingContent: parsed,
          }, { companyId }, {
            assetOverride:
              parsed.asset_payload && typeof parsed.asset_payload === 'object'
                ? parsed.asset_payload as Record<string, unknown>
                : parsed.creator_asset && typeof parsed.creator_asset === 'object'
                  ? parsed.creator_asset as Record<string, unknown>
                  : null,
          });

          const generatedValidation = validateCreatorExecutionOutput(generated);
          if (!generatedValidation.ok) {
            throw new Error(`Generated creator output failed validation: ${generatedValidation.issues.join('; ')}`);
          }
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'generated',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: 'ok',
            payload: {
              output: generated,
            },
          });

          const planVersionAtAdapt = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtAdapt !== planVersion) {
            failureType = 'stale';
            throw new Error(`Stale creator plan version ${planVersion}; current version is ${planVersionAtAdapt}`);
          }
          const adapted = await (engine as any).adaptForPlatform(generated, platform) as CanonicalCreatorOutput;
          const schedulingValidation = validateCreatorSchedulingContract({
            output: adapted,
            platform,
          });
          if (!schedulingValidation.ok) {
            throw new Error(`Adapted creator output failed validation: ${schedulingValidation.issues.join('; ')}`);
          }
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'adapted',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: 'ok',
            payload: {
              output: adapted,
            },
          });

          const readiness = await validateAssetReadiness({
            output: adapted,
            platform,
          });
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'asset_validation',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: readiness.ready ? 'ready' : 'blocked',
            payload: {
              validation: readiness,
            },
          });
          if (!readiness.ready) {
            readinessFailure = readiness.failure_reason;
            failureType = 'permanent';
            finalOutput = adapted;
            break;
          }

          const planVersionAtSchedule = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtSchedule !== planVersion) {
            failureType = 'stale';
            throw new Error(`Stale creator plan version ${planVersion}; current version is ${planVersionAtSchedule}`);
          }
          const scheduledFor = buildScheduledForFromDailyPlan(row.date, row.scheduled_time);
          const scheduled = await (engine as any).schedule(adapted, {
            dailyPlanId: row.id,
            userId,
            platform,
            contentType: String(row.content_type || 'video'),
            topic,
            scheduledForIso: scheduledFor.toISOString(),
            socialAccountId,
            dbPlatform: toDbPlatformKey(platform),
            dbContentType: toDbContentType(platform, String(row.content_type || 'video'), typeMapByPlatform),
            status: 'scheduled',
            templateId: adapted.asset_instruction?.template_id ?? templateId,
          }) as CreatorScheduleResult;

          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'schedule',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: scheduled.status,
            failureType: scheduled.failure_reason ? classifyCreatorFailure(scheduled.failure_reason) : null,
            payload: {
              scheduling: scheduled,
            },
          });
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'confirmation',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: scheduled.published ? 'published' : scheduled.verified ? 'verified' : scheduled.status,
            payload: {
              confirmation: scheduled,
            },
          });

          if (scheduled.status === 'failed') {
            throw new Error(scheduled.failure_reason || 'Creator scheduling failed');
          }

          finalOutput = adapted;
          finalScheduling = scheduled;
          lastError = null;
          break;
        } catch (attemptError) {
          lastError = attemptError as Error;
          const classifiedFailure =
            failureType === 'stale'
              ? 'permanent'
              : classifyCreatorFailure(lastError);
          failureType = failureType === 'stale' ? 'stale' : classifiedFailure;
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'failure',
            attemptCount: lockState.attempt_count,
            retryCount: attempt + 1,
            planVersion,
            status: classifiedFailure === 'transient' ? 'retrying' : 'failed',
            failureType,
            payload: {
              message: lastError.message,
            },
          });
          if (classifiedFailure !== 'transient' || failureType === 'stale') {
            break;
          }
          if (attempt + 1 < maxRetries) {
            await sleep(Math.min(4000, 500 * Math.pow(2, attempt)));
          }
        }
      }

      const nextRetryCount =
        finalScheduling || readinessFailure || failureType === 'permanent' || failureType === 'stale'
          ? retryCount
          : Math.min(maxRetries, retryCount + 1);

      const persisted = {
        ...parsed,
        ...(finalOutput || {}),
        intent_type: 'creator',
        asset_type: assetType,
        template_id: finalOutput?.asset_instruction?.template_id ?? templateId,
        scheduled_post_status: finalScheduling?.status ?? null,
        scheduled_post_id: finalScheduling?.scheduledPostId ?? null,
        schedule_confirmation: finalScheduling
          ? {
              status: finalScheduling.status,
              publish_source: finalScheduling.publish_source,
              platform_id: finalScheduling.platform_id,
              verified: finalScheduling.verified,
              published: finalScheduling.published,
              idempotency_key: finalScheduling.idempotency_key ?? null,
            }
          : null,
        content_status: finalScheduling ? 'scheduled' : failureType === 'stale' ? 'stale' : readinessFailure ? 'generated' : 'failed',
        failure_reason: readinessFailure ?? finalScheduling?.failure_reason ?? lastError?.message ?? null,
        failure_type: failureType,
        finalized_at: new Date().toISOString(),
      };
      const finalStatus =
        finalScheduling
          ? finalScheduling.status
          : readinessFailure
            ? 'generated'
            : persisted.content_status;

      const currentVersionBeforePersist = await getCurrentCampaignPlanVersion(campaignId);
      if (currentVersionBeforePersist !== planVersion) {
        persisted.content_status = 'stale';
        persisted.failure_reason = `Stale creator plan version ${planVersion}; current version is ${currentVersionBeforePersist}`;
        persisted.failure_type = 'stale';
      }
      await supabase
        .from('daily_content_plans')
        .update({
          content: JSON.stringify(persisted),
          intent_type: 'creator',
          asset_type: assetType,
          template_id: finalOutput?.asset_instruction?.template_id ?? templateId,
          plan_version: planVersion,
          retry_count: nextRetryCount,
          max_retries: maxRetries,
          failure_reason: persisted.failure_reason,
          failure_type: persisted.failure_type,
          content_status: persisted.content_status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      await upsertCreatorExecutionSummary({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        totalAttempts: lockState.attempt_count,
        retryCount: nextRetryCount,
        finalStatus,
        failureReason: persisted.failure_reason,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: finalScheduling ? 'execution_success_count' : 'execution_failure_count',
        metricValue: 1,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'retry_count',
        metricValue: nextRetryCount,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'avg_execution_latency',
        metricValue: Date.now() - executionStartedAt,
      });
      if (readinessFailure) {
        await recordCreatorExecutionMetric({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          metricName: 'validation_failure_count',
          metricValue: 1,
        });
      }

      if (finalScheduling) {
        scheduledCount++;
      } else {
        if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
        skippedCount++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLockConflict =
        error instanceof CreatorExecutionLockError &&
        /already locked/i.test(message);
      await logCreatorExecutionAudit({
        campaignId,
        companyId,
        userId,
        dailyPlanId: row.id,
        platform,
        assetType,
        stage: 'failure',
        attemptCount: lockState?.attempt_count ?? Math.max(1, toNumericValue(row.attempt_count, 0) + 1),
        retryCount: Math.min(
          Math.max(1, toNumericValue(row.max_retries, 3)),
          Math.max(0, toNumericValue(row.retry_count, 0) + 1)
        ),
        planVersion,
        status: error instanceof CreatorExecutionLockError ? 'locked' : 'failed',
        failureType:
          error instanceof CreatorExecutionLockError
            ? 'transient'
            : error instanceof CreatorExecutionRateLimitError
              ? 'transient'
              : classifyCreatorFailure(error),
        payload: {
          message,
        },
      });
      if (!isLockConflict) {
        await supabase
          .from('daily_content_plans')
          .update({
            plan_version: planVersion,
            retry_count: Math.min(
              Math.max(1, toNumericValue(row.max_retries, 3)),
              Math.max(0, toNumericValue(row.retry_count, 0) + 1)
            ),
            max_retries: Math.max(1, toNumericValue(row.max_retries, 3)),
            failure_reason: message,
            failure_type:
              message.toLowerCase().includes('stale creator plan version')
                ? 'stale'
                : classifyCreatorFailure(error),
            content_status: message.toLowerCase().includes('stale creator plan version') ? 'stale' : 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
      await upsertCreatorExecutionSummary({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        totalAttempts: lockState?.attempt_count ?? Math.max(1, toNumericValue(row.attempt_count, 0) + 1),
        retryCount: Math.min(
          Math.max(1, toNumericValue(row.max_retries, 3)),
          Math.max(0, toNumericValue(row.retry_count, 0) + 1)
        ),
        finalStatus: message.toLowerCase().includes('stale creator plan version') ? 'stale' : 'failed',
        failureReason: message,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'execution_failure_count',
        metricValue: 1,
      });
      if (classifyCreatorFailure(error) === 'permanent') {
        await recordCreatorExecutionMetric({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          metricName: 'validation_failure_count',
          metricValue: 1,
        });
      }
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'avg_execution_latency',
        metricValue: Date.now() - executionStartedAt,
      });
      if (classifyCreatorFailure(error) === 'permanent') {
        await writeCreatorDeadLetter({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          failureReason: message,
          payloadSnapshot: {
            content: parsed,
            row,
          },
        });
      }
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      skippedCount++;
      console.warn('[schedule][creator] failed to process row', {
        rowId: row.id,
        platform,
        topic,
        error: message,
      });
    } finally {
      if (leaseHeartbeat) {
        await leaseHeartbeat.stop().catch(() => undefined);
      }
      if (lockState) {
        await releaseCreatorExecutionLock({
          dailyPlanId: row.id,
          lockOwner,
        }).catch((releaseError) => {
          console.warn('[schedule][creator] failed to release lock', {
            rowId: row.id,
            error: (releaseError as Error)?.message,
          });
        });
      }
    }
  }

  return {
    scheduled_count: scheduledCount,
    skipped_count: skippedCount,
    skipped_platforms: skippedPlatforms,
  };
}

export class ScheduleEligibilityError extends Error {
  code = 'SCHEDULE_NOT_READY';
  details: ReturnType<typeof evaluateScheduleEligibility>;

  constructor(details: ReturnType<typeof evaluateScheduleEligibility>) {
    super('Campaign has creator-dependent activities that are not ready for scheduling');
    this.name = 'ScheduleEligibilityError';
    this.details = details;
  }
}

export async function scheduleStructuredPlan(
  plan: StructuredPlan,
  campaignId: string,
  options?: ScheduleStructuredPlanOptions
): Promise<{
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
  already_scheduled_count?: number;
}> {
  if (!plan?.weeks || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw new Error('Structured plan is required');
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, user_id, company_id, start_date')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    console.error('[scheduleStructuredPlan] Campaign lookup failed', {
      campaignId,
      error: campaignError?.message,
      errorCode: campaignError?.code,
      errorDetails: campaignError?.details,
      hasData: !!campaign,
    });
    throw new Error(`Campaign not found (id=${campaignId}, err=${campaignError?.message ?? 'no data'})`);
  }
  if (!campaign.start_date) {
    throw new Error('Campaign start date is required for scheduling');
  }

  // Reject scheduling for campaigns whose start_date is in the past.
  // Compare on date-only basis (YYYY-MM-DD) so "today" is always valid,
  // regardless of current UTC hour vs campaign midnight-UTC parsing.
  {
    const startDateStr = String(campaign.start_date).slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (startDateStr && startDateStr < todayStr) {
      throw new Error(
        `Campaign start date (${startDateStr}) is in the past. ` +
        `Scheduling only supports dates from today onwards — update the campaign start date before rescheduling.`
      );
    }
  }

  // G2.1: Resolve company_id for tenant-scoped account lookup
  const { data: versionRow } = await supabase
    .from('campaign_versions')
    .select('company_id, campaign_snapshot, version')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const companyId = (versionRow as { company_id?: string } | null)?.company_id
    ?? (campaign as any).company_id
    ?? null;
  const executionConfig = (((versionRow as any)?.campaign_snapshot ?? {})?.execution_config ?? {}) as Record<string, unknown>;
  const campaignMode = String(options?.campaignMode || executionConfig.campaign_mode || 'text');
  const isUnifiedCreatorMode = campaignMode === 'creator';
  const currentPlanVersion = Math.max(1, toNumericValue((versionRow as any)?.version, 1));

  // Resolve user_id: campaign.user_id may be null if auth fell back to dev context.
  // In that case, look up the first user in the company's role table.
  let effectiveUserId: string | null = (campaign as any).user_id ?? null;
  if (!effectiveUserId && companyId) {
    const { data: companyUser } = await supabase
      .from('user_company_' + 'roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    effectiveUserId = (companyUser as any)?.user_id ?? null;
    if (effectiveUserId) {
      // Backfill the campaign's user_id so future queries work
      await supabase.from('campaigns').update({ user_id: effectiveUserId }).eq('id', campaignId);
    }
  }
  if (!effectiveUserId) {
    throw new Error('Campaign has no user_id and no company members found — cannot resolve social accounts');
  }

  let accountsQuery = supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('user_id', effectiveUserId)
    .eq('is_active', true);
  if (companyId) {
    accountsQuery = accountsQuery.or(`company_id.eq.${companyId},company_id.is.null`);
  } else {
    accountsQuery = accountsQuery.is('company_id', null);
  }
  const { data: accounts, error: accountError } = await accountsQuery;

  if (accountError || !accounts) {
    throw new Error('Failed to load social accounts');
  }

  const catalog = await listPlatformCatalog({ activeOnly: true });
  const allowedPlatforms = new Set<string>(
    (catalog.platforms || [])
      .map((p) => String((p as any).canonical_key || '').toLowerCase().trim())
      .filter(Boolean)
  );
  const aliasMap = buildPlatformAliasMap(allowedPlatforms);
  const normalize: PlatformNormalizer = (p: string) => normalizePlatform(p, aliasMap, allowedPlatforms);

  const accountMap = new Map<string, string>();
  accounts.forEach((account: any) => {
    const platform = normalize(account.platform);
    if (platform && !accountMap.has(platform)) {
      accountMap.set(platform, account.id);
    }
  });

  const typeMapByPlatform: Record<string, Record<string, string>> = {};
  for (const platform of accountMap.keys()) {
    try {
      const bundle = await getPlatformRules(platform);
      const fromDb = extractTypeMapFromPlatformRules(bundle);
      if (fromDb) typeMapByPlatform[platform] = fromDb;
    } catch {
      // ignore; fallback mapping will be used
    }
  }

  // STEP 1: Prefer BOLT-generated daily_content_plans when they exist.
  // NOTE: execution_mode and creator_asset are optional columns — if they don't exist in the
  // DB schema, Supabase returns an error and hasDailyPlans becomes false, causing placeholder
  // content. We select only guaranteed-to-exist core columns and handle optional ones gracefully.
  const { data: dailyPlans, error: dailyPlansError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, week_number, day_of_week, date, platform, content_type, title, topic, scheduled_time, content, content_status, intent_type, asset_type, template_id, plan_version, locked_by, lease_expires_at, attempt_count, retry_count, max_retries, failure_reason, failure_type')
    .eq('campaign_id', campaignId)
    .order('date', { ascending: true })
    .order('week_number', { ascending: true });

  if (dailyPlansError) {
    console.warn('[schedule] daily_content_plans query failed — falling back to allocation scheduling', dailyPlansError.message);
  }

  const hasDailyPlans = !dailyPlansError && Array.isArray(dailyPlans) && dailyPlans.length > 0;

  if (hasDailyPlans && Array.isArray(dailyPlans)) {
    // execution_mode and creator_asset are optional columns not always selected —
    // pass them as undefined so eligibility check treats all rows as text-schedulable.
    if (!isUnifiedCreatorMode) {
      const eligibility = evaluateScheduleEligibility(dailyPlans.map((r: any) => ({
        id: r.id ?? null,
        title: r.title ?? null,
        platform: r.platform ?? null,
        content_type: r.content_type ?? null,
        execution_mode: r.execution_mode ?? null,
        creator_asset: r.creator_asset ?? null,
      })));
      if (!eligibility.eligible) {
        throw new ScheduleEligibilityError(eligibility);
      }
    }
  }

  // ── CONTENT SCHEDULING PATH (BOLT schedule outcome with daily plans) ─────────
  console.log('[schedule] routing decision', {
    hasDailyPlans,
    dailyPlansCount: Array.isArray(dailyPlans) ? dailyPlans.length : 0,
    generateContent: options?.generateContent,
    run_id: options?.run_id ?? null,
    companyId,
    accountMapSize: accountMap.size,
    firstPlanPlatform: Array.isArray(dailyPlans) && dailyPlans.length > 0 ? (dailyPlans[0] as any)?.platform : null,
  });

  if (hasDailyPlans && options?.generateContent && dailyPlans) {
    if (isUnifiedCreatorMode) {
      options?.onProgress?.('schedule-creating-assets');
      const creatorResult = await processCreatorStructuredSchedule({
        campaignId,
        companyId,
        userId: effectiveUserId,
        dailyPlans: dailyPlans as DailyPlanRow[],
        accountMap,
        normalize,
        typeMapByPlatform,
        currentPlanVersion,
        onProgress: options?.onProgress,
      });
      return {
        scheduled_count: creatorResult.scheduled_count,
        skipped_count: creatorResult.skipped_count,
        skipped_platforms: creatorResult.skipped_platforms,
        already_scheduled_count: 0,
      };
    }
    if (!options?.run_id) {
      throw new Error('execution_intent_id is required for campaign scheduling');
    }
    // ── QUEUE PATH: run_id present → queue jobs for async processing ────────
    // Required for large campaigns (10+ platforms × 5+ content types × 3+/week)
    // where in-process generation would exceed HTTP timeout limits.
    if (options?.run_id) {
      try {
        options?.onProgress?.('schedule-queuing-jobs');
        const jobCount = await queueBoltContentJobs(
          options.run_id,
          campaignId,
          dailyPlans as DailyPlanRow[],
          { ...campaign, company_id: companyId },
          accountMap,
          typeMapByPlatform,
          normalize,
        );
        console.log('[schedule] Queued bolt content jobs', { run_id: options.run_id, jobCount });
        if (jobCount > 0) {
          options?.onProgress?.('schedule-writing-posts');
          return {
            scheduled_count:         0,    // jobs run async — count comes from workers
            skipped_count:           0,
            skipped_platforms:       [],
            already_scheduled_count: 0,
            queued_job_count:        jobCount,
          } as any;
        }
        // jobCount === 0 means all inserts failed — fall through to inline block processor
        console.warn('[schedule] Queue path produced 0 jobs, falling back to inline block processor');
      } catch (err) {
        console.warn('[schedule] Queue path failed, falling back to inline block processor:', (err as Error)?.message);
        // Fall through to inline block processor
      }
    }

    // ── INLINE BLOCK PROCESSOR: no run_id → process synchronously ───────────
    throw new Error('Campaign execution jobs were not queued');
    // Used for small campaigns or when BullMQ is unavailable.
    try {
      options?.onProgress?.('schedule-creating-content');
      const blockResult = await processBlockSchedule(
        campaignId,
        dailyPlans as DailyPlanRow[],
        { ...campaign, user_id: effectiveUserId, company_id: companyId },
        accountMap,
        normalize,
        typeMapByPlatform,
        {
          onProgress: (event) => {
            if (event.phase === 'block-start') {
              options?.onProgress?.(`schedule-block-${event.contentType}`);
            } else if (event.phase === 'topic-master') {
              options?.onProgress?.('schedule-creating-content');
            } else if (event.phase === 'platform-done') {
              options?.onProgress?.('schedule-repurposing-content');
            } else if (event.phase === 'block-complete') {
              options?.onProgress?.('schedule-writing-posts');
            }
          },
        }
      );
      return {
        scheduled_count:         blockResult.scheduled_count,
        skipped_count:           blockResult.skipped_count,
        skipped_platforms:       blockResult.skipped_platforms,
        already_scheduled_count: 0,
      };
    } catch (err) {
      console.warn('[schedule] Block processor failed, falling back to legacy path:', (err as Error)?.message);
      // Fall through to legacy path below
    }
  }

  // ── LEGACY / FALLBACK PATH ─────────────────────────────────────────────────
  // Used when: no daily plans, generateContent is false, or block processor threw.
  let contentMap: Map<string, string> | undefined;
  if (hasDailyPlans && !options?.generateContent && dailyPlans) {
    // No-generate path: try to use any already-finalized content stored in daily plans
    // (no LLM calls; if content is placeholder, post will be skipped)
  }

  // STEP 2–4: Fallback chain when no daily plans
  const schedulableJobs = extractSchedulableJobsFromWeeks(plan.weeks as any[]);
  const hasExecutionJobs = schedulableJobs.length > 0;
  const useLegacy = isLegacyPlan(plan.weeks);

  // Use effectiveUserId so legacy paths don't fail on null user_id
  const campaignWithUser = { ...campaign, user_id: effectiveUserId };

  const { scheduledPosts, skippedPlatforms } = hasDailyPlans
    ? scheduleFromDailyPlans(
        dailyPlans as DailyPlanRow[],
        campaignWithUser,
        accountMap,
        campaignId,
        normalize,
        typeMapByPlatform,
        contentMap
      )
    : hasExecutionJobs
    ? scheduleFromExecutionJobs(
        plan.weeks,
        schedulableJobs,
        campaignWithUser,
        accountMap,
        campaignId,
        normalize,
        typeMapByPlatform
      )
    : useLegacy
    ? scheduleFromLegacy(plan.weeks, campaignWithUser, accountMap, campaignId, normalize)
    : scheduleFromAllocation(plan.weeks, campaignWithUser, accountMap, campaignId, normalize, typeMapByPlatform, options?.eligiblePlatforms, options?.frequencyPerWeek);

  if (scheduledPosts.length === 0) {
    return {
      scheduled_count: 0,
      skipped_count: skippedPlatforms.length,
      skipped_platforms: skippedPlatforms,
      already_scheduled_count: 0,
    };
  }

  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 24);
  const executionIntentId = options?.run_id ?? `intent_${campaignId}_${planHash}`;
  const registry = getJobRegistryEntry('campaign_schedule');
  const idempotencyKey = registry.idempotency_key_builder({
    campaignId,
    execution_intent_id: executionIntentId,
    plan_hash: planHash,
  });
  const claimed = await claimIdempotencyKey(idempotencyKey, 30 * 24 * 3600, {
    job_id: 'campaign_schedule',
    campaignId,
    execution_intent_id: executionIntentId,
    plan_hash: planHash,
  });
  if (!claimed) {
    console.info(JSON.stringify({ event: 'job_skipped_locked', job_id: 'campaign_schedule', campaign_id: campaignId }));
    return {
      scheduled_count: 0,
      skipped_count: scheduledPosts.length,
      skipped_platforms: skippedPlatforms,
      already_scheduled_count: scheduledPosts.length,
    };
  }

  // Skip posts whose (platform, date) are already scheduled for this campaign
  let postsToInsert = scheduledPosts;
  let alreadyScheduledCount = 0;
  if (options?.skipExisting) {
    const { data: existingPosts } = await supabase
      .from('scheduled_posts')
      .select('platform, scheduled_for')
      .eq('campaign_id', campaignId)
      .in('status', ['scheduled', 'draft', 'publishing', 'published']);
    if (existingPosts && existingPosts.length > 0) {
      const existingKeys = new Set(
        existingPosts.map((p: any) => `${String(p.platform).toLowerCase()}_${String(p.scheduled_for || '').slice(0, 10)}`)
      );
      postsToInsert = scheduledPosts.filter((p: any) => {
        const key = `${String(p.platform).toLowerCase()}_${String(p.scheduled_for || '').slice(0, 10)}`;
        return !existingKeys.has(key);
      });
      alreadyScheduledCount = scheduledPosts.length - postsToInsert.length;
    }
  }

  if (postsToInsert.length === 0) {
    return {
      scheduled_count: 0,
      skipped_count: skippedPlatforms.length,
      skipped_platforms: skippedPlatforms,
      already_scheduled_count: alreadyScheduledCount,
    };
  }

  postsToInsert = postsToInsert.map((post: any) => ({
    ...post,
    execution_intent_id: executionIntentId,
    idempotency_key: idempotencyKey,
  }));

  const { data: insertedPosts, error: insertError } = await supabase
    .from('scheduled_posts')
    .insert(postsToInsert)
    .select('id, user_id, social_account_id, scheduled_for');
  if (insertError) {
    throw new Error(`Failed to schedule posts: ${insertError.message}`);
  }

  for (const row of insertedPosts || []) {
    if (!row?.id || !row?.social_account_id || !row?.scheduled_for) continue;
    try {
      await enqueueScheduledPostAt(
        String(row.id),
        String(row.user_id),
        String(row.social_account_id),
        String(row.scheduled_for),
      );
    } catch (enqueueError: any) {
      console.warn('[structuredPlanScheduler] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
    }
  }

  return {
    scheduled_count: postsToInsert.length,
    skipped_count: skippedPlatforms.length,
    skipped_platforms: skippedPlatforms,
    already_scheduled_count: alreadyScheduledCount,
  };
}

// ==========================================================
// Legacy API adapters (DB-backed, platform-intelligence-first)
// ==========================================================

export type LegacyScheduledPost = {
  id: string;
  platform: string;
  contentType: string;
  content: string;
  mediaUrls?: string[];
  hashtags?: string[];
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  publishedAt?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  repurpose_index?: number;
  repurpose_total?: number;
};

function mapDbRowToLegacyScheduledPost(row: any): LegacyScheduledPost {
  return {
    id: String(row.id),
    platform: toLegacyPlatformKey(String(row.platform || '')),
    contentType: String(row.content_type || 'post'),
    content: String(row.content || ''),
    mediaUrls: Array.isArray(row.media_urls) ? row.media_urls : [],
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : new Date().toISOString(),
    status: String(row.status || 'draft') as any,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    errorMessage: row.error_message ?? undefined,
    retryCount: Number(row.retry_count ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    repurpose_index: row.repurpose_index != null ? Number(row.repurpose_index) : 1,
    repurpose_total: row.repurpose_total != null ? Number(row.repurpose_total) : 1,
  };
}

async function validatePlatformAndType(input: { platform: string; contentType: string }): Promise<{
  canonicalPlatform: string;
  dbPlatform: string;
  normalizedContentType: string;
}> {
  const bundle = await getPlatformRules(input.platform);
  if (!bundle) {
    throw new Error(`Unsupported platform: ${String(input.platform)}`);
  }

  const canonicalPlatform = String(bundle.platform.canonical_key || '').toLowerCase().trim();
  if (!canonicalPlatform) {
    throw new Error(`Unsupported platform: ${String(input.platform)}`);
  }

  const normalizedContentType = String(input.contentType || 'post').toLowerCase().trim();
  const supportedTypes = new Set(
    (bundle.content_rules || [])
      .map((r: any) => String(r.content_type || '').toLowerCase().trim())
      .filter(Boolean)
  );
  if (supportedTypes.size > 0 && !supportedTypes.has(normalizedContentType)) {
    throw new Error(`Unsupported contentType "${normalizedContentType}" for platform "${canonicalPlatform}"`);
  }

  return {
    canonicalPlatform,
    dbPlatform: toDbPlatformKey(canonicalPlatform),
    normalizedContentType,
  };
}

async function resolveActiveSocialAccountId(userId: string, canonicalPlatform: string): Promise<string | null> {
  const candidates = new Set<string>([canonicalPlatform, toDbPlatformKey(canonicalPlatform)]);
  if (canonicalPlatform === 'x') candidates.add('twitter');

  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('platform', Array.from(candidates))
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`Failed to load social accounts: ${error.message}`);
  const row = (data || [])[0];
  return row?.id ? String(row.id) : null;
}

export async function listLegacyScheduledPosts(input: {
  userId: string;
  platform?: string;
  status?: string;
  limit: number;
  offset: number;
}): Promise<{ posts: LegacyScheduledPost[]; total: number }> {
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const offset = Math.max(0, Number(input.offset || 0));

  let q: any = supabase
    .from('scheduled_posts')
    .select('*', { count: 'exact' })
    .eq('user_id', input.userId)
    .order('scheduled_for', { ascending: false });

  const platform = String(input.platform || '').trim().toLowerCase();
  if (platform && platform !== 'all') {
    const { dbPlatform } = await validatePlatformAndType({ platform, contentType: 'post' });
    q = q.eq('platform', dbPlatform);
  }

  const status = String(input.status || '').trim().toLowerCase();
  if (status && status !== 'all') {
    q = q.eq('status', status);
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to list scheduled posts: ${error.message}`);

  return {
    posts: (data || []).map(mapDbRowToLegacyScheduledPost),
    total: Number(count ?? 0),
  };
}

export async function createLegacyScheduledPost(input: {
  userId: string;
  socialAccountId?: string;
  platform: string;
  contentType: string;
  content: string;
  scheduledFor: string | Date;
  mediaUrls?: string[];
  hashtags?: string[];
  title?: string;
}): Promise<LegacyScheduledPost> {
  const { canonicalPlatform, dbPlatform, normalizedContentType } = await validatePlatformAndType({
    platform: input.platform,
    contentType: input.contentType,
  });

  let socialAccountId: string | null = null;
  if (input.socialAccountId) {
    const candidates = new Set<string>([canonicalPlatform, toDbPlatformKey(canonicalPlatform)]);
    if (canonicalPlatform === 'x') candidates.add('twitter');

    const { data, error } = await supabase
      .from('social_accounts')
      .select('id, platform')
      .eq('id', input.socialAccountId)
      .eq('user_id', input.userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new Error(`Failed to load social account: ${error.message}`);
    if (!data?.id) {
      throw new Error('Invalid accountId');
    }
    const acctPlatform = String((data as any).platform || '').toLowerCase().trim();
    if (!candidates.has(acctPlatform)) {
      throw new Error(`accountId is not connected for platform "${canonicalPlatform}"`);
    }
    socialAccountId = String(data.id);
  } else {
    socialAccountId = await resolveActiveSocialAccountId(input.userId, canonicalPlatform);
  }

  if (!socialAccountId) {
    throw new Error(`No active social account connected for platform "${canonicalPlatform}"`);
  }

  const scheduledFor = new Date(input.scheduledFor as any);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new Error('Invalid scheduledFor');
  }

  const now = new Date().toISOString();
  const payload: any = {
    user_id: input.userId,
    social_account_id: socialAccountId,
    platform: dbPlatform,
    content_type: normalizedContentType,
    title: input.title ? String(input.title).slice(0, 500) : null,
    content: String(input.content || ''),
    hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
    media_urls: Array.isArray(input.mediaUrls) ? input.mediaUrls : [],
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled',
    repurpose_index: 1,
    repurpose_total: 1,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase.from('scheduled_posts').insert(payload).select('*').single();
  if (error) throw new Error(`Failed to schedule post: ${error.message}`);
  return mapDbRowToLegacyScheduledPost(data);
}

export async function getLegacyScheduledPostById(input: {
  userId: string;
  id: string;
}): Promise<LegacyScheduledPost | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get scheduled post: ${error.message}`);
  if (!data) return null;
  return mapDbRowToLegacyScheduledPost(data);
}

export async function updateLegacyScheduledPost(input: {
  userId: string;
  id: string;
  patch: Partial<{
    content: string;
    contentType: string;
    scheduledFor: string;
    status: string;
    hashtags: string[];
    mediaUrls: string[];
    title: string;
  }>;
}): Promise<void> {
  const patch: any = {};
  if (typeof input.patch.content === 'string') patch.content = input.patch.content;
  if (typeof input.patch.title === 'string') patch.title = input.patch.title.slice(0, 500);
  if (Array.isArray(input.patch.hashtags)) patch.hashtags = input.patch.hashtags;
  if (Array.isArray(input.patch.mediaUrls)) patch.media_urls = input.patch.mediaUrls;
  if (typeof input.patch.status === 'string') patch.status = input.patch.status;
  if (typeof input.patch.scheduledFor === 'string') {
    const scheduledFor = new Date(input.patch.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) throw new Error('Invalid scheduledFor');
    patch.scheduled_for = scheduledFor.toISOString();
  }
  if (typeof input.patch.contentType === 'string') {
    let normalizedContentType = String(input.patch.contentType).toLowerCase().trim();
    // The chk_content_type constraint rejects {platform=twitter, content_type=post}
    // and {platform=instagram, content_type=post}. The app surfaces 'post' as the
    // generic source content type; remap it to the platform-native value before
    // writing so the update doesn't blow up on the constraint.
    if (normalizedContentType === 'post') {
      const { data: existing } = await supabase
        .from('scheduled_posts')
        .select('platform')
        .eq('id', input.id)
        .eq('user_id', input.userId)
        .maybeSingle();
      const existingPlatform = String((existing as any)?.platform || '').toLowerCase().trim();
      if (existingPlatform === 'twitter') normalizedContentType = 'tweet';
      else if (existingPlatform === 'instagram') normalizedContentType = 'feed_post';
    }
    patch.content_type = normalizedContentType;
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('scheduled_posts')
    .update(patch)
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new Error(`Failed to update post: ${error.message}`);
}

export async function cancelLegacyScheduledPost(input: { userId: string; id: string }): Promise<void> {
  const { error } = await supabase
    .from('scheduled_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new Error(`Failed to cancel post: ${error.message}`);
}

export async function publishLegacyScheduledPostNow(input: { userId: string; id: string }): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('scheduled_posts')
    .update({ status: 'scheduled', scheduled_for: now, updated_at: now })
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new Error(`Failed to queue post: ${error.message}`);
}
