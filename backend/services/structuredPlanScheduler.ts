import { supabase } from '../db/supabaseClient';

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const SUPPORTED_PLATFORMS = new Set(['linkedin', 'twitter', 'instagram', 'youtube', 'facebook', 'blog']);

const normalizePlatform = (platform: string): string | null => {
  const normalized = platform.toLowerCase().trim();
  if (normalized === 'x') return 'twitter';
  if (!SUPPORTED_PLATFORMS.has(normalized)) return null;
  return normalized;
};

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
  contentTypeMix: string[]
): { platform: string; contentType: string; dayIndex: number; slotInDay: number }[] {
  const total = Object.values(platform_allocation).reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const expanded: string[] = [];
  for (const [platform, count] of Object.entries(platform_allocation)) {
    const norm = normalizePlatform(platform);
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
const CONTENT_TYPE_MAP: Record<string, Record<string, string>> = {
  linkedin: { post: 'post', video: 'video', article: 'article', poll: 'post', carousel: 'post' },
  twitter: { post: 'tweet', video: 'video', article: 'tweet', poll: 'tweet', carousel: 'tweet' },
  instagram: { post: 'feed_post', video: 'reel', article: 'feed_post', poll: 'feed_post', carousel: 'feed_post' },
  youtube: { post: 'video', video: 'video', article: 'video', poll: 'video', carousel: 'short' },
  facebook: { post: 'post', video: 'video', article: 'post', poll: 'post', carousel: 'post' },
  blog: { post: 'post', video: 'post', article: 'post', poll: 'post', carousel: 'post' },
};

function toDbContentType(platform: string, contentType: string): string {
  const map = CONTENT_TYPE_MAP[platform] || CONTENT_TYPE_MAP.linkedin;
  return map[contentType] || 'post';
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

/** Allocation-driven scheduling: use platform_allocation to determine post count and distribution */
function scheduleFromAllocation(
  weeks: StructuredWeekBlueprint[],
  campaign: { start_date: string; user_id: string },
  accountMap: Map<string, string>,
  campaignId: string
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

    const schedule = buildAllocationSchedule(allocation, contentTypeMix);

    for (const item of schedule) {
      const { platform, contentType, dayIndex, slotInDay } = item;
      const socialAccountId = accountMap.get(platform);
      if (!socialAccountId) {
        if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
        continue;
      }

      const content = buildContentPlaceholder(topicLabel, ctaType, contentType);
      const scheduledFor = buildScheduledFor(campaign.start_date, week.week, dayIndex, slotInDay);

      scheduledPosts.push({
          user_id: campaign.user_id,
          social_account_id: socialAccountId,
          campaign_id: campaignId,
          platform,
          content_type: toDbContentType(platform, contentType),
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
  campaignId: string
): { scheduledPosts: any[]; skippedPlatforms: string[] } {
  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  for (const week of weeks) {
    const daily = week.daily || [];
    for (const day of daily) {
      const targetIndex = DAY_INDEX[day.day.toLowerCase()];
      const dayIndex = targetIndex >= 0 ? targetIndex : 0;

      for (const [platformKey, content] of Object.entries(day.platforms || {})) {
        const platform = normalizePlatform(platformKey);
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

        scheduledPosts.push({
          user_id: campaign.user_id,
          social_account_id: socialAccountId,
          campaign_id: campaignId,
          platform,
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

  const accountMap = new Map<string, string>();
  accounts.forEach((account: any) => {
    const platform = normalizePlatform(account.platform);
    if (platform && !accountMap.has(platform)) {
      accountMap.set(platform, account.id);
    }
  });

  const useLegacy = isLegacyPlan(plan.weeks);

  const { scheduledPosts, skippedPlatforms } = useLegacy
    ? scheduleFromLegacy(plan.weeks, campaign, accountMap, campaignId)
    : scheduleFromAllocation(plan.weeks, campaign, accountMap, campaignId);

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
