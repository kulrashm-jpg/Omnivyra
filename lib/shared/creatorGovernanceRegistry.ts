export type CreatorCanonicalAssetFamily =
  | 'image'
  | 'carousel'
  | 'video'
  | 'audio'
  | 'text'
  | 'unsupported';

export type CreatorOutcome = 'week_plan' | 'daily_plan' | 'schedule' | 'campaign_schedule' | 'repurpose';

export type CreatorGovernanceEntry = {
  format: string;
  canonical_asset_family: CreatorCanonicalAssetFamily;
  ai_renderable: boolean;
  guidance_only: boolean;
  schedulable: boolean;
  daily_plan_only: boolean;
  exportable: boolean;
  publishable: boolean;
  requires_human_production: boolean;
  allowed_outcomes: CreatorOutcome[];
  required_daily_guidance_fields: string[];
};

export const CREATOR_DAILY_GUIDANCE_FIELDS = [
  'theme',
  'hook',
  'visual_direction',
  'shot_guidance',
  'scene_direction',
  'CTA_direction',
  'platform_adaptation',
  'repurposing_guidance',
  'caption_direction',
  'posting_guidance',
  'production_notes',
  'production_checklist',
  'talking_points',
  'b_roll_ideas',
] as const;

const PLAN_ONLY_OUTCOMES: CreatorOutcome[] = ['week_plan', 'daily_plan'];
const AUTONOMOUS_OUTCOMES: CreatorOutcome[] = ['week_plan', 'daily_plan', 'schedule', 'campaign_schedule'];

function entry(input: Omit<CreatorGovernanceEntry, 'required_daily_guidance_fields'> & {
  required_daily_guidance_fields?: string[];
}): CreatorGovernanceEntry {
  return {
    ...input,
    required_daily_guidance_fields: input.required_daily_guidance_fields ?? [],
  };
}

export const CREATOR_GOVERNANCE_REGISTRY: Record<string, CreatorGovernanceEntry> = {
  image: entry({
    format: 'image',
    canonical_asset_family: 'image',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  carousel: entry({
    format: 'carousel',
    canonical_asset_family: 'carousel',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  banner: entry({
    format: 'banner',
    canonical_asset_family: 'image',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  infographic: entry({
    format: 'infographic',
    canonical_asset_family: 'image',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  pdf: entry({
    format: 'pdf',
    canonical_asset_family: 'carousel',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  slider: entry({
    format: 'slider',
    canonical_asset_family: 'carousel',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  story: entry({
    format: 'story',
    canonical_asset_family: 'image',
    ai_renderable: true,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  post: entry({
    format: 'post',
    canonical_asset_family: 'text',
    ai_renderable: false,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  thread: entry({
    format: 'thread',
    canonical_asset_family: 'text',
    ai_renderable: false,
    guidance_only: false,
    schedulable: true,
    daily_plan_only: false,
    exportable: true,
    publishable: true,
    requires_human_production: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  video: entry({
    format: 'video',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: true,
    schedulable: false,
    daily_plan_only: true,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    allowed_outcomes: PLAN_ONLY_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  reel: entry({
    format: 'reel',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: true,
    schedulable: false,
    daily_plan_only: true,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    allowed_outcomes: PLAN_ONLY_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  short: entry({
    format: 'short',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: true,
    schedulable: false,
    daily_plan_only: true,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    allowed_outcomes: PLAN_ONLY_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  podcast: entry({
    format: 'podcast',
    canonical_asset_family: 'audio',
    ai_renderable: false,
    guidance_only: true,
    schedulable: false,
    daily_plan_only: true,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    allowed_outcomes: PLAN_ONLY_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
};

const FORMAT_ALIASES: Record<string, string> = {
  reels: 'reel',
  shorts: 'short',
  youtube_short: 'short',
  youtube_shorts: 'short',
  tiktok: 'short',
  slides: 'carousel',
  slide: 'carousel',
  deck: 'slider',
  presentation: 'slider',
  graphic: 'image',
  visual: 'image',
  photo: 'image',
};

export function normalizeCreatorFormat(format: unknown): string {
  const value = String(format ?? '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
  return FORMAT_ALIASES[value] ?? value;
}

export function getCreatorGovernance(format: unknown): CreatorGovernanceEntry | null {
  const normalized = normalizeCreatorFormat(format);
  return CREATOR_GOVERNANCE_REGISTRY[normalized] ?? null;
}

export function isGuidanceOnlyFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.guidance_only === true;
}

export function isSchedulableFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.schedulable === true;
}

export function isDailyPlanOnlyFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.daily_plan_only === true;
}

export function getAllowedOutcomes(format: unknown): CreatorOutcome[] {
  return getCreatorGovernance(format)?.allowed_outcomes ?? PLAN_ONLY_OUTCOMES;
}

export function supportsAutonomousExecution(format: unknown): boolean {
  const governance = getCreatorGovernance(format);
  return Boolean(governance?.ai_renderable && governance.schedulable && !governance.guidance_only);
}

export function getCreatorFormatsFromExecutionConfig(config: unknown): string[] {
  const obj = config && typeof config === 'object' ? config as Record<string, unknown> : {};
  const fromFormats = Array.isArray(obj.content_formats) ? obj.content_formats : [];
  const fromFrequency = obj.format_frequency && typeof obj.format_frequency === 'object' && !Array.isArray(obj.format_frequency)
    ? Object.keys(obj.format_frequency as Record<string, unknown>)
    : [];
  return [...new Set([...fromFormats, ...fromFrequency].map(normalizeCreatorFormat).filter(Boolean))];
}

export function getUnsupportedCreatorFormats(formats: unknown[]): string[] {
  return formats.map(normalizeCreatorFormat).filter((format) => !getCreatorGovernance(format));
}

export function getScheduleBlockingCreatorFormats(formats: unknown[]): string[] {
  return formats
    .map(normalizeCreatorFormat)
    .filter((format) => {
      const governance = getCreatorGovernance(format);
      return !governance || governance.guidance_only || governance.daily_plan_only || !governance.schedulable;
    });
}

export type CreatorScheduleGovernancePayload = {
  success: false;
  code: 'CREATOR_SCHEDULE_BLOCKED_BY_GOVERNANCE' | 'UNSUPPORTED_CREATOR_FORMAT';
  error: string;
  blocked_formats: string[];
  unsupported_formats: string[];
};

export class CreatorScheduleGovernanceError extends Error {
  readonly statusCode = 409;
  readonly payload: CreatorScheduleGovernancePayload;

  constructor(payload: CreatorScheduleGovernancePayload) {
    super(payload.error);
    this.name = 'CreatorScheduleGovernanceError';
    this.payload = payload;
  }
}

export function getCreatorScheduleGovernanceViolation(formats: unknown[]): CreatorScheduleGovernancePayload | null {
  const normalizedFormats = [...new Set(formats.map(normalizeCreatorFormat).filter(Boolean))];
  const unsupportedFormats = normalizedFormats.filter((format) => !getCreatorGovernance(format));
  if (unsupportedFormats.length > 0) {
    return {
      success: false,
      code: 'UNSUPPORTED_CREATOR_FORMAT',
      error: `Unsupported creator format: ${unsupportedFormats.join(', ')}.`,
      blocked_formats: unsupportedFormats,
      unsupported_formats: unsupportedFormats,
    };
  }

  const blockedFormats = normalizedFormats.filter((format) => {
    const governance = getCreatorGovernance(format);
    return Boolean(
      governance &&
      (
        governance.guidance_only ||
        governance.daily_plan_only ||
        !governance.schedulable ||
        !supportsAutonomousExecution(format)
      )
    );
  });
  if (blockedFormats.length > 0) {
    return {
      success: false,
      code: 'CREATOR_SCHEDULE_BLOCKED_BY_GOVERNANCE',
      error: `Creator schedule blocked. These formats are daily-plan-only or unsupported for autonomous scheduling: ${blockedFormats.join(', ')}.`,
      blocked_formats: blockedFormats,
      unsupported_formats: [],
    };
  }

  return null;
}

export function assertCreatorFormatsSchedulable(formats: unknown[]): void {
  const violation = getCreatorScheduleGovernanceViolation(formats);
  if (violation) throw new CreatorScheduleGovernanceError(violation);
}

export function assertNoUnschedulableCreatorDailyPlans(plans: Array<{ content_type?: unknown }>): void {
  assertCreatorFormatsSchedulable(plans.map((row) => row.content_type));
}

export function getCreatorFormatsFromStructuredPlanWeeks(weeks: unknown[]): string[] {
  const formats: string[] = [];
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const weekObj = week && typeof week === 'object' ? week as Record<string, unknown> : {};
    if (Array.isArray(weekObj.content_type_mix)) {
      formats.push(...weekObj.content_type_mix.map(String));
    }
    if (Array.isArray(weekObj.daily_execution_items)) {
      for (const item of weekObj.daily_execution_items) {
        const itemObj = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        if (itemObj.content_type) formats.push(String(itemObj.content_type));
        if (Array.isArray(itemObj.platform_variants)) {
          for (const variant of itemObj.platform_variants) {
            const variantObj = variant && typeof variant === 'object' ? variant as Record<string, unknown> : {};
            if (variantObj.content_type) formats.push(String(variantObj.content_type));
          }
        }
      }
    }
  }
  return [...new Set(formats.map(normalizeCreatorFormat).filter(Boolean))];
}

export function validateCreatorScheduleRequest(input: {
  campaignMode?: unknown;
  outcomeView?: unknown;
  executionConfig?: unknown;
  contentFormats?: unknown[];
}): { ok: true } | { ok: false; blockedFormats: string[]; unsupportedFormats: string[]; message: string } {
  const campaignMode = String(input.campaignMode ?? (input.executionConfig as Record<string, unknown> | undefined)?.campaign_mode ?? '').trim().toLowerCase();
  const outcomeView = String(input.outcomeView ?? '').trim().toLowerCase();
  const wantsSchedule = outcomeView === 'schedule' || outcomeView === 'campaign_schedule';
  if (campaignMode !== 'creator') return { ok: true };

  const formats = input.contentFormats?.length
    ? input.contentFormats.map(normalizeCreatorFormat)
    : getCreatorFormatsFromExecutionConfig(input.executionConfig);
  const unsupportedViolation = getCreatorScheduleGovernanceViolation(
    formats.filter((format) => !getCreatorGovernance(format))
  );
  if (unsupportedViolation) return {
    ok: false,
    blockedFormats: unsupportedViolation.blocked_formats,
    unsupportedFormats: unsupportedViolation.unsupported_formats,
    message: unsupportedViolation.error,
  };
  if (!wantsSchedule) return { ok: true };

  const violation = getCreatorScheduleGovernanceViolation(formats);
  if (violation) return {
    ok: false,
    blockedFormats: violation.blocked_formats,
    unsupportedFormats: violation.unsupported_formats,
    message: violation.error,
  };

  return { ok: true };
}
