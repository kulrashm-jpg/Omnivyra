export type CreatorCanonicalAssetFamily =
  | 'image'
  | 'carousel'
  | 'video'
  | 'audio'
  | 'text'
  | 'unsupported';

export type CreatorOutcome = 'week_plan' | 'daily_plan' | 'schedule' | 'campaign_schedule' | 'repurpose';

/**
 * Per-row lifecycle state for creator content. Source of truth for whether
 * a single row can be scheduled NOW. Stored in
 * `daily_content_plans.content.creator_lifecycle_state` (JSON field) so the
 * new vocabulary lands without a DB enum migration; `content_status` keeps
 * its legacy values for back-compat.
 *
 * Autonomous (Group A) rows transition through: `render_ready` (the runtime
 * already emits this on the legacy `content_status` field).
 *
 * Attachment-required (Group B) rows transition through:
 *   awaiting_media_upload → media_uploaded → ready_for_schedule
 *
 * The actual upload + transition logic is NOT implemented in this change.
 * Only the vocabulary and the runtime emission of `awaiting_media_upload`
 * are established here.
 */
export type CreatorLifecycleState =
  | 'awaiting_media_upload'
  | 'media_uploaded'
  | 'ready_for_schedule'
  | 'render_ready'        // mirror of legacy content_status for parity
  | 'render_failed'       // mirror of legacy content_status for parity
  | 'scheduled';

export const CREATOR_LIFECYCLE_STATES = {
  AWAITING_MEDIA_UPLOAD: 'awaiting_media_upload',
  MEDIA_UPLOADED: 'media_uploaded',
  READY_FOR_SCHEDULE: 'ready_for_schedule',
  RENDER_READY: 'render_ready',
  RENDER_FAILED: 'render_failed',
  SCHEDULED: 'scheduled',
} as const satisfies Record<string, CreatorLifecycleState>;

/**
 * Campaign-level aggregate. Used by the pipeline to summarize what the
 * collection of rows looks like, but NEVER used as a campaign-wide veto on
 * scheduling. Per-row eligibility decides each row's fate.
 */
export type CreatorCampaignAggregate =
  | 'fully_schedulable'      // every row is autonomous + render_ready (or expected to be)
  | 'partially_schedulable'  // some autonomous + some attachment-required
  | 'attachment_only'        // all rows attachment-required (no autonomous)
  | 'empty';                 // no creator formats

export type CreatorGovernanceEntry = {
  format: string;
  canonical_asset_family: CreatorCanonicalAssetFamily;
  ai_renderable: boolean;
  /**
   * @deprecated Group B no longer marks this true. Retained on the type so
   * existing call sites compile; for the four formats that used to set it
   * (video/reel/short/podcast) it is now `false` and `media_upload_required`
   * is the correct successor signal.
   */
  guidance_only: boolean;
  schedulable: boolean;
  /**
   * @deprecated Group B no longer marks this true. Use `media_upload_required`
   * + per-row eligibility instead.
   */
  daily_plan_only: boolean;
  exportable: boolean;
  publishable: boolean;
  requires_human_production: boolean;
  /** NEW: Group B formats cannot be rendered by Omnivyra; user uploads media. */
  media_upload_required: boolean;
  /** NEW: Group B formats become schedulable after media URL is uploaded. */
  schedulable_after_upload: boolean;
  /** NEW: True for Group A; false for Group B. Replaces the meaning of `ai_renderable` for routing. */
  autonomous_renderable: boolean;
  /**
   * NEW: Formats outside this set may exist in the standalone Creator
   * Content selector but are NOT first-class BOLT Creator formats (e.g.,
   * post/thread belong to BOLT Text). BOLT Creator validators filter on this.
   */
  bolt_creator_eligible: boolean;
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

const AUTONOMOUS_OUTCOMES: CreatorOutcome[] = ['week_plan', 'daily_plan', 'schedule', 'campaign_schedule'];

function entry(input: Omit<CreatorGovernanceEntry, 'required_daily_guidance_fields' | 'media_upload_required' | 'schedulable_after_upload' | 'autonomous_renderable' | 'bolt_creator_eligible'> & {
  required_daily_guidance_fields?: string[];
  media_upload_required?: boolean;
  schedulable_after_upload?: boolean;
  autonomous_renderable?: boolean;
  bolt_creator_eligible?: boolean;
}): CreatorGovernanceEntry {
  return {
    ...input,
    required_daily_guidance_fields: input.required_daily_guidance_fields ?? [],
    media_upload_required: input.media_upload_required ?? false,
    schedulable_after_upload: input.schedulable_after_upload ?? input.schedulable,
    autonomous_renderable: input.autonomous_renderable ?? input.ai_renderable,
    bolt_creator_eligible: input.bolt_creator_eligible ?? true,
  };
}

/**
 * Explicit format groups exposed for callers that want to enumerate without
 * having to filter the registry. Kept in sync with the entries below.
 */
export const GROUP_A_AUTONOMOUS_FORMATS = [
  'image',
  'banner',
  'infographic',
  'carousel',
  'pdf',
  'slider',
] as const;

export const GROUP_B_ATTACHMENT_REQUIRED_FORMATS = [
  'video',
  'reel',
  'short',
  'podcast',
] as const;

export const CREATOR_GOVERNANCE_REGISTRY: Record<string, CreatorGovernanceEntry> = {
  // ── Group A: autonomous renderable ──────────────────────────────────────
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
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
    autonomous_renderable: true,
    bolt_creator_eligible: true,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  // story remains in the registry as image-family autonomous, but is NOT a
  // first-class BOLT Creator format — it lives in standalone Creator Content.
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
    autonomous_renderable: true,
    bolt_creator_eligible: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  // post / thread: standalone Creator Content + BOLT Text only. NOT in
  // BOLT Creator scope. Kept in the registry so existing call sites that
  // call `getCreatorGovernance('post')` still return a usable record.
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
    autonomous_renderable: false,
    bolt_creator_eligible: false,
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
    autonomous_renderable: false,
    bolt_creator_eligible: false,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
  }),
  // ── Group B: attachment-required (human production, schedulable AFTER upload) ──
  video: entry({
    format: 'video',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: false,
    schedulable: false,
    daily_plan_only: false,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    media_upload_required: true,
    schedulable_after_upload: true,
    autonomous_renderable: false,
    bolt_creator_eligible: true,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  reel: entry({
    format: 'reel',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: false,
    schedulable: false,
    daily_plan_only: false,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    media_upload_required: true,
    schedulable_after_upload: true,
    autonomous_renderable: false,
    bolt_creator_eligible: true,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  short: entry({
    format: 'short',
    canonical_asset_family: 'video',
    ai_renderable: false,
    guidance_only: false,
    schedulable: false,
    daily_plan_only: false,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    media_upload_required: true,
    schedulable_after_upload: true,
    autonomous_renderable: false,
    bolt_creator_eligible: true,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
    required_daily_guidance_fields: [...CREATOR_DAILY_GUIDANCE_FIELDS],
  }),
  podcast: entry({
    format: 'podcast',
    canonical_asset_family: 'audio',
    ai_renderable: false,
    guidance_only: false,
    schedulable: false,
    daily_plan_only: false,
    exportable: false,
    publishable: false,
    requires_human_production: true,
    media_upload_required: true,
    schedulable_after_upload: true,
    autonomous_renderable: false,
    bolt_creator_eligible: true,
    allowed_outcomes: AUTONOMOUS_OUTCOMES,
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

/**
 * @deprecated Group B no longer sets `guidance_only`. This now returns false
 * for video/reel/short/podcast. Existing call sites should migrate to
 * {@link isAttachmentRequiredFormat} or {@link requiresMediaUpload}.
 */
export function isGuidanceOnlyFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.guidance_only === true;
}

export function isSchedulableFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.schedulable === true;
}

/**
 * @deprecated Group B no longer sets `daily_plan_only`. Always returns false
 * now for the four formats that used to set it.
 */
export function isDailyPlanOnlyFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.daily_plan_only === true;
}

export function getAllowedOutcomes(format: unknown): CreatorOutcome[] {
  return getCreatorGovernance(format)?.allowed_outcomes ?? AUTONOMOUS_OUTCOMES;
}

/**
 * True if the format can be rendered end-to-end by Omnivyra autonomously
 * (Group A). Replaces the old `supportsAutonomousExecution` check that
 * also required `schedulable: true` — separation of concerns.
 */
export function isAutonomousRenderableFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.autonomous_renderable === true;
}

/**
 * True if the format requires a user-uploaded media URL before it can be
 * scheduled (Group B).
 */
export function isAttachmentRequiredFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.media_upload_required === true;
}

/**
 * Semantic alias for {@link isAttachmentRequiredFormat}.
 */
export function requiresMediaUpload(format: unknown): boolean {
  return isAttachmentRequiredFormat(format);
}

/**
 * True if the format is part of the BOLT Creator product surface (Group A
 * autonomous + Group B attachment-required). Excludes post/thread (BOLT
 * Text) and story (standalone Creator Content only).
 */
export function isBoltCreatorEligibleFormat(format: unknown): boolean {
  return getCreatorGovernance(format)?.bolt_creator_eligible === true;
}

/**
 * @deprecated Prefer {@link isAutonomousRenderableFormat}. Retained so the
 * many callers compile while we migrate.
 */
export function supportsAutonomousExecution(format: unknown): boolean {
  const governance = getCreatorGovernance(format);
  if (!governance) return false;
  return governance.autonomous_renderable && governance.schedulable;
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

/**
 * Per-row scheduling eligibility input. Either pass the daily_content_plans
 * row shape OR a synthetic descriptor (e.g. for plan-time validation before
 * rows exist in the DB).
 */
export type CreatorRowSchedulingDescriptor = {
  content_type?: unknown;
  /** Legacy DB column. Optional. */
  content_status?: unknown;
  /**
   * New lifecycle state — preferred when present. Stored in the row's
   * `content` JSON under `creator_lifecycle_state`. Callers can also pass
   * a value derived from a previously parsed payload.
   */
  creator_lifecycle_state?: unknown;
  /** URL of user-uploaded media. Required for attachment-required rows to be schedulable. */
  uploaded_media_url?: unknown;
  /**
   * Result of the media-upload validation service. When `valid === true`,
   * the row is eligible to schedule. Pass-through from
   * `content.upload_validation` on the daily_content_plans row.
   */
  upload_validation?: unknown;
};

export type CreatorRowSchedulingEligibility = {
  format: string;
  lifecycle: 'autonomous' | 'attachment_required' | 'unsupported' | 'text_only';
  /** True iff this row can be scheduled NOW (without any further user action). */
  can_schedule_now: boolean;
  /** True iff this row will become schedulable after a media upload. */
  requires_upload: boolean;
  /** True iff the format itself is recognized AND in BOLT Creator scope. */
  bolt_creator_eligible: boolean;
  /** Human-readable reason explaining can_schedule_now. */
  reason: string;
  /** Current per-row lifecycle state, normalized. */
  current_state: CreatorLifecycleState | 'unknown';
};

function extractCurrentState(row: CreatorRowSchedulingDescriptor): CreatorLifecycleState | 'unknown' {
  const lifecycle = typeof row.creator_lifecycle_state === 'string'
    ? row.creator_lifecycle_state.trim().toLowerCase()
    : '';
  if (lifecycle === 'awaiting_media_upload' || lifecycle === 'media_uploaded' ||
      lifecycle === 'ready_for_schedule' || lifecycle === 'render_ready' ||
      lifecycle === 'render_failed' || lifecycle === 'scheduled') {
    return lifecycle as CreatorLifecycleState;
  }
  const status = typeof row.content_status === 'string' ? row.content_status.trim().toLowerCase() : '';
  if (status === 'render_ready') return 'render_ready';
  if (status === 'render_failed') return 'render_failed';
  if (status === 'scheduled') return 'scheduled';
  // Legacy `guidance_ready` predates the lifecycle vocabulary; for
  // attachment-required formats it is functionally equivalent to
  // `awaiting_media_upload`. We map it accordingly.
  if (status === 'guidance_ready') return 'awaiting_media_upload';
  return 'unknown';
}

export function getRowSchedulingEligibility(row: CreatorRowSchedulingDescriptor): CreatorRowSchedulingEligibility {
  const format = normalizeCreatorFormat(row.content_type);
  const governance = getCreatorGovernance(format);
  const currentState = extractCurrentState(row);
  const uploadedUrl = typeof row.uploaded_media_url === 'string' && row.uploaded_media_url.trim().length > 0;

  if (!governance) {
    return {
      format,
      lifecycle: 'unsupported',
      can_schedule_now: false,
      requires_upload: false,
      bolt_creator_eligible: false,
      reason: 'unsupported_creator_format',
      current_state: currentState,
    };
  }

  if (governance.canonical_asset_family === 'text') {
    return {
      format,
      lifecycle: 'text_only',
      can_schedule_now: governance.schedulable,
      requires_upload: false,
      bolt_creator_eligible: governance.bolt_creator_eligible,
      reason: governance.schedulable ? 'text_format_schedulable' : 'text_format_not_schedulable',
      current_state: currentState,
    };
  }

  if (governance.autonomous_renderable) {
    const ready = currentState === 'render_ready' || currentState === 'ready_for_schedule';
    return {
      format,
      lifecycle: 'autonomous',
      can_schedule_now: governance.schedulable && (ready || currentState === 'unknown'),
      requires_upload: false,
      bolt_creator_eligible: governance.bolt_creator_eligible,
      reason: ready
        ? 'autonomous_render_ready'
        : currentState === 'unknown'
          ? 'autonomous_pending_render'
          : `autonomous_blocked_by_state:${currentState}`,
      current_state: currentState,
    };
  }

  if (governance.media_upload_required) {
    // Attachment-required rows can schedule ONLY when:
    //   1. an `uploaded_media_url` exists on the row, AND
    //   2. the media upload validation marked it valid, AND
    //   3. the lifecycle is at `media_uploaded` or `ready_for_schedule`.
    // Each condition is its own diagnostic so callers can surface the
    // specific missing piece.
    const validationObj = row.upload_validation && typeof row.upload_validation === 'object' && !Array.isArray(row.upload_validation)
      ? row.upload_validation as Record<string, unknown>
      : null;
    const validationValid = validationObj?.valid === true;
    const lifecycleReady = currentState === 'media_uploaded' || currentState === 'ready_for_schedule';
    const canSchedule = Boolean(uploadedUrl) && validationValid && lifecycleReady && governance.schedulable_after_upload;
    let reason = 'attachment_uploaded_ready_for_schedule';
    if (!uploadedUrl) reason = 'awaiting_media_upload';
    else if (!validationValid) reason = 'media_upload_validation_pending_or_failed';
    else if (!lifecycleReady) reason = `attachment_lifecycle_not_ready:${currentState}`;
    return {
      format,
      lifecycle: 'attachment_required',
      can_schedule_now: canSchedule,
      requires_upload: !uploadedUrl,
      bolt_creator_eligible: governance.bolt_creator_eligible,
      reason,
      current_state: currentState,
    };
  }

  return {
    format,
    lifecycle: 'unsupported',
    can_schedule_now: false,
    requires_upload: false,
    bolt_creator_eligible: governance.bolt_creator_eligible,
    reason: 'unclassified_format',
    current_state: currentState,
  };
}

export function canScheduleRowNow(row: CreatorRowSchedulingDescriptor): boolean {
  return getRowSchedulingEligibility(row).can_schedule_now;
}

/**
 * @deprecated Replaced by per-row {@link getRowSchedulingEligibility}.
 * Retained for callers that still ask "which formats are unschedulable in
 * principle" — now only flags UNSUPPORTED formats. Attachment-required
 * formats are NOT returned here, because they ARE schedulable (after upload).
 */
export function getScheduleBlockingCreatorFormats(formats: unknown[]): string[] {
  return formats
    .map(normalizeCreatorFormat)
    .filter((format) => !getCreatorGovernance(format));
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

/**
 * Per-row violation diagnostic. Replaces the campaign-wide veto. Each row's
 * scheduling eligibility is computed independently; a campaign-wide block
 * is ONLY returned when a row's format is genuinely unsupported.
 *
 * Attachment-required formats (video/reel/short/podcast) are NOT
 * considered violations here — they have a valid lifecycle path
 * (awaiting_media_upload → media_uploaded → scheduled) and per-row
 * scheduling eligibility decides their fate at run time.
 */
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
  // Mixed-mode (autonomous + attachment-required) is now allowed. No
  // campaign-wide veto fires here; per-row eligibility is consulted at
  // schedule time via {@link canScheduleRowNow}.
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

/**
 * Aggregate the rows of a campaign into one of the four CreatorCampaignAggregate
 * states. Used for telemetry / UI hints only — never to veto scheduling.
 */
export function getCreatorCampaignAggregate(formats: unknown[]): CreatorCampaignAggregate {
  const normalized = [...new Set(formats.map(normalizeCreatorFormat).filter(Boolean))];
  if (normalized.length === 0) return 'empty';
  const groups = normalized.map((format) => {
    const governance = getCreatorGovernance(format);
    if (!governance) return 'unsupported' as const;
    if (governance.autonomous_renderable) return 'autonomous' as const;
    if (governance.media_upload_required) return 'attachment_required' as const;
    return 'other' as const;
  });
  const hasAutonomous = groups.includes('autonomous');
  const hasAttachment = groups.includes('attachment_required');
  if (hasAutonomous && hasAttachment) return 'partially_schedulable';
  if (hasAutonomous) return 'fully_schedulable';
  if (hasAttachment) return 'attachment_only';
  return 'empty';
}

export function validateCreatorScheduleRequest(input: {
  campaignMode?: unknown;
  outcomeView?: unknown;
  executionConfig?: unknown;
  contentFormats?: unknown[];
}): { ok: true } | { ok: false; blockedFormats: string[]; unsupportedFormats: string[]; message: string } {
  const campaignMode = String(input.campaignMode ?? (input.executionConfig as Record<string, unknown> | undefined)?.campaign_mode ?? '').trim().toLowerCase();
  if (campaignMode !== 'creator') return { ok: true };

  const formats = input.contentFormats?.length
    ? input.contentFormats.map(normalizeCreatorFormat)
    : getCreatorFormatsFromExecutionConfig(input.executionConfig);

  // Only flag UNSUPPORTED formats as a campaign-wide block. Attachment-
  // required formats (video/reel/short/podcast) and mixed-mode campaigns
  // are valid for every outcome — per-row eligibility decides actual
  // scheduling at run time.
  const violation = getCreatorScheduleGovernanceViolation(formats);
  if (violation) return {
    ok: false,
    blockedFormats: violation.blocked_formats,
    unsupportedFormats: violation.unsupported_formats,
    message: violation.error,
  };

  return { ok: true };
}
