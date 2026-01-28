import { supabase } from '../db/supabaseClient';

type StructuredDay = {
  day: string;
  objective: string;
  content: string;
  platforms: Record<string, string>;
};

type StructuredWeek = {
  week: number;
  theme: string;
  daily: StructuredDay[];
};

type StructuredPlan = {
  weeks: StructuredWeek[];
};

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const SUPPORTED_PLATFORMS = new Set(['linkedin', 'twitter', 'instagram', 'youtube', 'facebook']);

const normalizePlatform = (platform: string): string | null => {
  const normalized = platform.toLowerCase();
  if (normalized === 'x') return 'twitter';
  if (!SUPPORTED_PLATFORMS.has(normalized)) return null;
  return normalized;
};

const buildScheduledFor = (campaignStart: string, week: number, day: string): Date => {
  const startDate = new Date(campaignStart);
  const startUTC = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
      9,
      0,
      0
    )
  );

  const weekOffset = (week - 1) * 7;
  const targetIndex = DAY_INDEX[day.toLowerCase()];
  const startIndex = startUTC.getUTCDay() === 0 ? 6 : startUTC.getUTCDay() - 1;
  const dayOffset = (targetIndex - startIndex + 7) % 7;

  const scheduled = new Date(startUTC);
  scheduled.setUTCDate(startUTC.getUTCDate() + weekOffset + dayOffset);
  return scheduled;
};

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

  const scheduledPosts: any[] = [];
  const skippedPlatforms: string[] = [];

  plan.weeks.forEach((week) => {
    week.daily.forEach((day) => {
      Object.entries(day.platforms || {}).forEach(([platformKey, content]) => {
        const platform = normalizePlatform(platformKey);
        if (!platform) {
          skippedPlatforms.push(platformKey);
          return;
        }

        const socialAccountId = accountMap.get(platform);
        if (!socialAccountId) {
          skippedPlatforms.push(platformKey);
          return;
        }

        const scheduledFor = buildScheduledFor(campaign.start_date, week.week, day.day);
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
      });
    });
  });

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
