import { supabase } from '../db/supabaseClient';
import { getPlatformRules, listPlatformCatalog } from './platformIntelligenceService';

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

/** Map internal content type to DB schema values (platform-specific constraints) */
const FALLBACK_CONTENT_TYPE_MAP: Record<string, Record<string, string>> = {
  linkedin: { post: 'post', video: 'video', article: 'article', poll: 'post', carousel: 'post' },
  x: { post: 'tweet', video: 'video', article: 'tweet', poll: 'tweet', carousel: 'tweet' },
  instagram: { post: 'feed_post', video: 'reel', article: 'feed_post', poll: 'feed_post', carousel: 'feed_post' },
  youtube: { post: 'video', video: 'video', article: 'video', poll: 'video', carousel: 'short' },
  facebook: { post: 'post', video: 'video', article: 'post', poll: 'post', carousel: 'post' },
  blog: { post: 'post', video: 'post', article: 'post', poll: 'post', carousel: 'post' },
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

/** Assign content_type from content_type_mix, rotating deterministically */
function pickContentType(contentTypeMix: string[], index: number): string {
  if (!contentTypeMix?.length) return 'post';
  const normalized = contentTypeMix.map((s) => {
    const lower = s.toLowerCase();
    if (lower.includes('video')) return 'video';
    if (lower.includes('article') || lower.includes('blog')) return 'article';
    if (lower.includes('poll')) return 'poll';
    if (lower.includes('carousel')) return 'carousel';
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
      timezone: 'UTC',
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
  typeMapByPlatform: Record<string, Record<string, string>>
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  for (const week of weeks) {
    const allocation = week.platform_allocation || {};
    const total = Object.values(allocation).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

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
        timezone: 'UTC',
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
          timezone: 'UTC',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return { scheduledPosts, skippedPlatforms };
}

export async function scheduleStructuredPlan(plan: StructuredPlan, campaignId: string): Promise<{
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
}> {
  if (!plan?.weeks || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw new Error('Structured plan is required');
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, user_id, start_date')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error('Campaign not found');
  }
  if (!campaign.start_date) {
    throw new Error('Campaign start date is required for scheduling');
  }

  const { data: accounts, error: accountError } = await supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('user_id', campaign.user_id)
    .eq('is_active', true);

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

  const schedulableJobs = extractSchedulableJobsFromWeeks(plan.weeks as any[]);
  const hasExecutionJobs = schedulableJobs.length > 0;
  const useLegacy = isLegacyPlan(plan.weeks);

  const { scheduledPosts, skippedPlatforms } = hasExecutionJobs
    ? scheduleFromExecutionJobs(
        plan.weeks,
        schedulableJobs,
        campaign,
        accountMap,
        campaignId,
        normalize,
        typeMapByPlatform
      )
    : useLegacy
    ? scheduleFromLegacy(plan.weeks, campaign, accountMap, campaignId, normalize)
    : scheduleFromAllocation(plan.weeks, campaign, accountMap, campaignId, normalize, typeMapByPlatform);

  if (scheduledPosts.length === 0) {
    return {
      scheduled_count: 0,
      skipped_count: skippedPlatforms.length,
      skipped_platforms: skippedPlatforms,
    };
  }

  const { error: insertError } = await supabase.from('scheduled_posts').insert(scheduledPosts);
  if (insertError) {
    throw new Error(`Failed to schedule posts: ${insertError.message}`);
  }

  return {
    scheduled_count: scheduledPosts.length,
    skipped_count: skippedPlatforms.length,
    skipped_platforms: skippedPlatforms,
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
    timezone: 'UTC',
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
    patch.content_type = String(input.patch.contentType).toLowerCase().trim();
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
