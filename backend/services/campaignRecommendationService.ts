import { CompanyProfile, getProfile, validateCompanyProfile } from './companyProfileService';
import {
  alignTrendsToPlans,
  buildTrendAssessments,
  getTrendAlerts,
} from './trends/trendAlignmentService';
import { getContentBlueprint, isOmniVyraEnabled } from './omnivyraClientV1';

export type ProfileGateResult = {
  status: 'ready' | 'blocked';
  missing_fields: string[];
};

export type CampaignObjective = 'awareness' | 'engagement' | 'leads' | 'conversions' | 'mixed';

export type ContentCapabilities = {
  can_generate_text: boolean;
  can_generate_image: boolean;
  can_generate_video: boolean;
  can_generate_audio: boolean;
};

export type PlatformRules = Record<
  string,
  {
    content_types?: string[];
  }
>;

export type ResourceConstraints = {
  max_posts_per_week?: number;
};

export type CampaignStrategy = {
  duration: number;
  objective: CampaignObjective;
  recommended_platforms: string[];
  campaign_types: string[];
  platform_frequency: Record<string, number>;
  status: 'draft';
};

export type WeeklyPlan = Array<{
  week_number: number;
  theme: string;
  campaign_objective: CampaignObjective;
  trend_influence: string[];
  platforms: string[];
  content_types: Record<string, string[]>;
  frequency_per_platform: Record<string, number>;
  existing_content_used: string[];
  new_content_needed: string[];
  ai_optimized: boolean;
  version: number;
}>;

export type DailyPlan = Array<{
  date: string;
  platform: string;
  content_type: string;
  topic: string;
  CTA: string;
  trend_alignment: boolean;
  scheduled_time: string;
  schedule_hint?: {
    best_day: string;
    best_time: string;
    confidence: number;
  };
  instruction?: string;
  source: 'existing' | 'new' | 'placeholder';
  status: 'planned';
}>;

export type TrendAlertResult = {
  emerging_trends: Array<{
    topic: string;
    platform: string;
    geography?: string;
    growth_rate?: number;
    velocity?: number;
    sentiment?: number;
    content_type_hint?: string;
    timestamp: string;
  }>;
  status: 'show' | 'silent';
};

export type ScheduleHint = {
  date: string;
  platform: string;
  best_day: string;
  best_time: string;
  confidence: number;
};

export type WeekOptimizationResult = {
  optimized_week_plan: WeeklyPlan[number];
  change_summary: string;
  confidence: number;
  status: 'proposal';
};

export const validateCompanyProfileGate = async (
  companyId?: string
): Promise<ProfileGateResult> => {
  const profile = await getProfile(companyId, { autoRefine: false });
  return validateCompanyProfile(profile);
};

/** Removed DEFAULT_DURATION_WEEKS - duration must come from input.durationWeeks or blueprint. No silent 12-week default. */

const normalizePlatform = (platform: string): string => {
  const lower = platform.trim().toLowerCase();
  if (lower === 'twitter' || lower === 'x') return 'x';
  if (lower === 'youtube') return 'youtube';
  if (lower === 'linkedin') return 'linkedin';
  if (lower === 'instagram') return 'instagram';
  if (lower === 'facebook') return 'facebook';
  if (lower === 'tiktok') return 'tiktok';
  if (lower === 'reddit') return 'reddit';
  if (lower === 'blog') return 'blog';
  if (lower === 'podcast') return 'podcast';
  return lower;
};

const getObjectiveCampaignTypes = (objective: CampaignObjective): string[] => {
  switch (objective) {
    case 'awareness':
      return ['awareness', 'brand_story'];
    case 'engagement':
      return ['community', 'conversation'];
    case 'leads':
      return ['lead_generation', 'conversion_nurture'];
    case 'conversions':
      return ['conversion', 'product_showcase'];
    case 'mixed':
    default:
      return ['awareness', 'engagement', 'lead_generation'];
  }
};

const defaultPlatformFrequency: Record<string, number> = {
  linkedin: 3,
  instagram: 4,
  x: 5,
  youtube: 1,
  tiktok: 3,
  reddit: 2,
  facebook: 3,
  blog: 1,
  podcast: 1,
};

const platformContentMap: Record<string, string[]> = {
  linkedin: ['text', 'image', 'video'],
  instagram: ['image', 'video'],
  x: ['text', 'image'],
  youtube: ['video'],
  tiktok: ['video'],
  reddit: ['text'],
  facebook: ['text', 'image', 'video'],
  blog: ['text'],
  podcast: ['audio'],
};

const resolveSupportedContentTypes = (
  platform: string,
  platformRules?: PlatformRules
): string[] => {
  const ruleTypes = platformRules?.[platform]?.content_types;
  if (Array.isArray(ruleTypes) && ruleTypes.length > 0) return ruleTypes;
  return platformContentMap[platform] || ['text'];
};

const supportsCapabilities = (
  platform: string,
  capabilities: ContentCapabilities,
  platformRules?: PlatformRules
): boolean => {
  const supportedTypes = resolveSupportedContentTypes(platform, platformRules);
  return supportedTypes.some((type) => {
    if (type === 'text') return capabilities.can_generate_text;
    if (type === 'image') return capabilities.can_generate_image;
    if (type === 'video') return capabilities.can_generate_video;
    if (type === 'audio') return capabilities.can_generate_audio;
    return false;
  });
};

const selectPlatforms = (
  profile: CompanyProfile,
  objective: CampaignObjective,
  capabilities: ContentCapabilities,
  platformRules?: PlatformRules
): string[] => {
  const socialPlatforms = Array.isArray(profile.social_profiles)
    ? profile.social_profiles
        .map((entry) => normalizePlatform(entry.platform))
        .filter(Boolean)
    : [];
  const uniquePlatforms = Array.from(new Set(socialPlatforms));
  const orderedPriority = (() => {
    if (objective === 'awareness') return ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'linkedin'];
    if (objective === 'engagement') return ['instagram', 'x', 'reddit', 'facebook', 'linkedin'];
    if (objective === 'leads') return ['linkedin', 'facebook', 'x', 'blog'];
    if (objective === 'conversions') return ['linkedin', 'youtube', 'facebook', 'instagram'];
    return ['linkedin', 'instagram', 'x', 'youtube', 'facebook', 'tiktok'];
  })();

  const prioritized = uniquePlatforms.sort((a, b) => {
    const aIdx = orderedPriority.indexOf(a);
    const bIdx = orderedPriority.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  const filtered = prioritized.filter((platform) =>
    supportsCapabilities(platform, capabilities, platformRules)
  );
  return filtered.length > 0 ? filtered : prioritized;
};

const applyResourceConstraints = (
  platforms: string[],
  constraints?: ResourceConstraints
): Record<string, number> => {
  const frequency: Record<string, number> = {};
  platforms.forEach((platform) => {
    frequency[platform] = defaultPlatformFrequency[platform] || 2;
  });

  const maxPosts = constraints?.max_posts_per_week;
  if (!maxPosts) return frequency;

  const total = Object.values(frequency).reduce((sum, value) => sum + value, 0);
  if (total <= maxPosts) return frequency;

  const scale = maxPosts / total;
  const scaled: Record<string, number> = {};
  platforms.forEach((platform) => {
    scaled[platform] = Math.max(1, Math.floor(frequency[platform] * scale));
  });
  return scaled;
};

export const generateCampaignStrategy = async (input: {
  companyId?: string;
  objective?: CampaignObjective;
  durationWeeks?: number;
  contentCapabilities?: Partial<ContentCapabilities>;
  platformRules?: PlatformRules;
  resourceConstraints?: ResourceConstraints;
}): Promise<{
  status: 'ready' | 'blocked';
  missing_fields: string[];
  campaign?: CampaignStrategy;
  weekly_plan?: WeeklyPlan;
  daily_plan?: DailyPlan;
  trend_alerts?: TrendAlertResult;
  schedule_hints?: ScheduleHint[];
  plan_partial?: boolean;
  omnivyra?: {
    decision_id?: string;
    confidence?: number;
    placeholders?: string[];
    explanation?: string;
    contract_version?: string;
    partial?: boolean;
  };
}> => {
  const profile = await getProfile(input.companyId, { autoRefine: false });
  const gate = validateCompanyProfile(profile);
  if (gate.status === 'blocked' || !profile) {
    return gate;
  }

  const objective = input.objective ?? 'awareness';
  let duration = input.durationWeeks;
  if (duration == null) {
    console.warn('Campaign duration not explicitly set; inferring from weeks array.');
    duration = 12; /* fallback for backward compatibility when no blueprint/plan exists yet */
  }
  const capabilities: ContentCapabilities = {
    can_generate_text: input.contentCapabilities?.can_generate_text ?? true,
    can_generate_image: input.contentCapabilities?.can_generate_image ?? true,
    can_generate_video: input.contentCapabilities?.can_generate_video ?? false,
    can_generate_audio: input.contentCapabilities?.can_generate_audio ?? false,
  };

  const recommended_platforms = selectPlatforms(
    profile,
    objective,
    capabilities,
    input.platformRules
  );
  const platform_frequency = applyResourceConstraints(
    recommended_platforms,
    input.resourceConstraints
  );

  const campaign: CampaignStrategy = {
    duration,
    objective,
    recommended_platforms,
    campaign_types: getObjectiveCampaignTypes(objective),
    platform_frequency,
    status: 'draft',
  };

  const baseWeeklyPlan = generateWeeklyPlan({
    profile,
    campaign,
    platformRules: input.platformRules,
  });
  const baseDailyPlan = generateDailyPlan({
    profile,
    weekly_plan: baseWeeklyPlan,
    campaign,
    platformRules: input.platformRules,
    contentCapabilities: capabilities,
  });
  if (isOmniVyraEnabled()) {
    const response = await getContentBlueprint({
      companyProfile: profile,
      objective,
      durationWeeks: duration,
      contentCapabilities: capabilities,
      platformRules: input.platformRules,
    });
    if (response.status === 'ok') {
      const blueprint = response.data || {};
      const weekly_plan: WeeklyPlan = (blueprint.weekly_plan || []).map(
        (week: any, index: number) => ({
          week_number: week.week_number ?? week.weekNumber ?? index + 1,
          theme: week.theme ?? 'Campaign focus',
          campaign_objective: week.campaign_objective ?? week.campaignObjective ?? objective,
          trend_influence: week.trend_influence ?? week.trendInfluence ?? [],
          platforms: week.platforms ?? recommended_platforms,
          content_types: week.content_types ?? week.contentTypes ?? {},
          frequency_per_platform: week.frequency_per_platform ?? week.frequencyPerPlatform ?? platform_frequency,
          existing_content_used: week.existing_content_used ?? week.existingContentUsed ?? [],
          new_content_needed: week.new_content_needed ?? week.newContentNeeded ?? [],
          ai_optimized: week.ai_optimized ?? true,
          version: week.version ?? 1,
        })
      );
      const daily_plan: DailyPlan = (blueprint.daily_plan || []).map((day: any) => ({
        date: day.date ?? day.day ?? '',
        platform: normalizePlatform(day.platform ?? day.channel ?? ''),
        content_type: day.content_type ?? day.contentType ?? 'text',
        topic: day.topic ?? day.title ?? '',
        CTA: day.CTA ?? day.cta ?? 'Learn more',
        trend_alignment: day.trend_alignment ?? day.trendAlignment ?? false,
        scheduled_time: day.scheduled_time ?? day.scheduledTime ?? buildScheduledTime(0),
        schedule_hint: day.schedule_hint ?? day.scheduleHint,
        instruction: day.instruction,
        source: day.source ?? 'new',
        status: 'planned',
      }));

      const resolvedWeeklyPlan = weekly_plan.length > 0 ? weekly_plan : baseWeeklyPlan;
      const resolvedDailyPlan = daily_plan.length > 0 ? daily_plan : baseDailyPlan;
      const trend_alerts =
        blueprint.trend_alerts ||
        getTrendAlerts(
          await buildTrendAssessments({ profile, weekly_plan: resolvedWeeklyPlan })
        );
      const schedule_hints = blueprint.schedule_hints || generateScheduleHints(resolvedDailyPlan);

      const omnivyraMeta = {
        decision_id: response.decision_id,
        confidence: response.confidence,
        placeholders: response.placeholders,
        explanation: response.explanation,
        contract_version: response.contract_version,
        partial: response.partial,
      };

      return {
        status: 'ready',
        missing_fields: [],
        campaign: {
          ...(blueprint.campaign || campaign),
          omnivyra: omnivyraMeta,
        },
        weekly_plan: resolvedWeeklyPlan,
        daily_plan: resolvedDailyPlan,
        trend_alerts,
        schedule_hints,
        plan_partial: response.partial,
        omnivyra: omnivyraMeta,
      };
    }
    console.warn('OMNIVYRA_FALLBACK_BLUEPRINT', { reason: response.error?.message });
  }

  let weekly_plan = baseWeeklyPlan;
  let daily_plan = baseDailyPlan;
  const trendAssessments = await buildTrendAssessments({
    profile,
    weekly_plan,
  });
  const alignedPlans = await alignTrendsToPlans({
    profile,
    weekly_plan,
    daily_plan,
    trendAssessments,
  });
  weekly_plan = alignedPlans.weekly_plan;
  daily_plan = alignedPlans.daily_plan;
  const trend_alerts = getTrendAlerts(trendAssessments);
  const schedule_hints = generateScheduleHints(daily_plan);

  return {
    status: 'ready',
    missing_fields: [],
    campaign,
    weekly_plan,
    daily_plan,
    trend_alerts,
    schedule_hints,
  };
};

const buildThemeCandidates = (profile: CompanyProfile): string[] => {
  const themes = [
    ...(profile.content_themes_list || []),
    ...(profile.goals_list || []),
    ...(profile.industry_list || []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  if (themes.length > 0) {
    return Array.from(new Set(themes));
  }
  const fallback = [
    profile.content_themes,
    profile.goals,
    profile.industry,
    profile.category,
  ]
    .filter(Boolean)
    .map((value) => value!.trim());
  return fallback.length > 0 ? fallback : ['Brand story', 'Customer outcomes', 'Product education'];
};

const generateWeeklyPlan = (input: {
  profile: CompanyProfile;
  campaign: CampaignStrategy;
  platformRules?: PlatformRules;
}): WeeklyPlan => {
  const themeCandidates = buildThemeCandidates(input.profile);
  const weeks = input.campaign.duration;
  const platforms = input.campaign.recommended_platforms;
  const frequency = input.campaign.platform_frequency;

  return Array.from({ length: weeks }, (_, index) => {
    const theme = themeCandidates[index % themeCandidates.length] || 'Campaign focus';
    const content_types: Record<string, string[]> = {};
    platforms.forEach((platform) => {
      content_types[platform] = resolveSupportedContentTypes(platform, input.platformRules);
    });

    return {
      week_number: index + 1,
      theme,
      campaign_objective: input.campaign.objective,
      trend_influence: [],
      platforms,
      content_types,
      frequency_per_platform: frequency,
      existing_content_used: [],
      new_content_needed: platforms.map((platform) => `${platform}: ${theme}`),
      ai_optimized: false,
      version: 1,
    };
  });
};

const buildCtas = (objective: CampaignObjective): string[] => {
  switch (objective) {
    case 'awareness':
      return ['Learn more', 'Explore the brand', 'See the story'];
    case 'engagement':
      return ['Join the conversation', 'Share your thoughts', 'Comment below'];
    case 'leads':
      return ['Download the guide', 'Request a demo', 'Get the checklist'];
    case 'conversions':
      return ['Start your trial', 'Book a call', 'Get started'];
    case 'mixed':
    default:
      return ['Learn more', 'Join the conversation', 'Get started'];
  }
};

const buildScheduledTime = (index: number): string => {
  const hours = [9, 12, 15, 18];
  const hour = hours[index % hours.length];
  return `${hour.toString().padStart(2, '0')}:00`;
};

const pickContentType = (
  platform: string,
  platformRules?: PlatformRules,
  capabilities?: ContentCapabilities
): { content_type: string; source: 'existing' | 'new' | 'placeholder' } => {
  const contentTypes = resolveSupportedContentTypes(platform, platformRules);
  const preferred = contentTypes[0] || 'text';
  const canSupport =
    (preferred === 'text' && capabilities?.can_generate_text) ||
    (preferred === 'image' && capabilities?.can_generate_image) ||
    (preferred === 'video' && capabilities?.can_generate_video) ||
    (preferred === 'audio' && capabilities?.can_generate_audio);
  return {
    content_type: preferred,
    source: canSupport ? 'new' : 'placeholder',
  };
};

const buildPlaceholderInstruction = (contentType: string, topic: string): string => {
  if (contentType === 'video') return `Record a 60s video about "${topic}".`;
  if (contentType === 'audio') return `Record a short audio clip about "${topic}".`;
  if (contentType === 'image') return `Create a visual asset about "${topic}".`;
  return `Draft copy for "${topic}".`;
};

const generateDailyPlan = (input: {
  profile: CompanyProfile;
  weekly_plan: WeeklyPlan;
  campaign: CampaignStrategy;
  platformRules?: PlatformRules;
  contentCapabilities: ContentCapabilities;
}): DailyPlan => {
  const ctas = buildCtas(input.campaign.objective);
  const daily: DailyPlan = [];

  input.weekly_plan.forEach((week) => {
    const platforms = week.platforms;
    platforms.forEach((platform, platformIndex) => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset += 2) {
        const sequence = week.week_number * 100 + platformIndex * 10 + dayOffset;
        const { content_type, source } = pickContentType(
          platform,
          input.platformRules,
          input.contentCapabilities
        );
        const topic = `${week.theme} for ${platform}`;
        const schedule_hint = buildScheduleHint(platform, dayOffset);
        const instruction =
          source === 'placeholder' ? buildPlaceholderInstruction(content_type, topic) : undefined;
        daily.push({
          date: `Week ${week.week_number} Day ${dayOffset + 1}`,
          platform,
          content_type,
          topic,
          CTA: ctas[sequence % ctas.length],
          trend_alignment: false,
          scheduled_time: buildScheduledTime(sequence),
          schedule_hint,
          instruction,
          source,
          status: 'planned',
        });
      }
    });
  });

  return daily;
};

const buildScheduleHint = (platform: string, dayOffset: number) => {
  const platformHints: Record<string, { day: string; time: string; confidence: number }> = {
    linkedin: { day: 'Tuesday', time: '09:00', confidence: 72 },
    instagram: { day: 'Wednesday', time: '18:00', confidence: 68 },
    x: { day: 'Thursday', time: '12:00', confidence: 64 },
    youtube: { day: 'Friday', time: '17:00', confidence: 70 },
    tiktok: { day: 'Saturday', time: '19:00', confidence: 66 },
    reddit: { day: 'Monday', time: '08:00', confidence: 60 },
    facebook: { day: 'Wednesday', time: '13:00', confidence: 62 },
    blog: { day: 'Tuesday', time: '10:00', confidence: 58 },
    podcast: { day: 'Thursday', time: '07:00', confidence: 55 },
  };
  const fallback = { day: 'Wednesday', time: buildScheduledTime(dayOffset), confidence: 50 };
  const hint = platformHints[platform] ?? fallback;
  return {
    best_day: hint.day,
    best_time: hint.time,
    confidence: hint.confidence,
  };
};

const generateScheduleHints = (daily_plan: DailyPlan): ScheduleHint[] => {
  return daily_plan.map((entry) => ({
    date: entry.date,
    platform: entry.platform,
    best_day: entry.schedule_hint?.best_day ?? 'Wednesday',
    best_time: entry.schedule_hint?.best_time ?? entry.scheduled_time,
    confidence: entry.schedule_hint?.confidence ?? 50,
  }));
};
