/**
 * BOLT pipeline error codes.
 *
 * Stable machine-readable identifiers for failure classes the pipeline
 * rejects deterministically. These are surfaced on:
 *
 *   - HTTP error responses from /api/bolt/execute (under `code`)
 *   - The `details.code` field of NormalizedPipelineError when persisted
 *     to bolt_execution_runs / bolt_execution_summary
 *   - Operator dashboards (filter by code to triage)
 *
 * Each code maps to one of the failure CATEGORIES from
 * classifyBoltFailure so the dashboard rollups stay clean.
 *
 * Adding a new code: append it to BOLT_ERROR_CODES, give it a category,
 * and add a friendly message in BOLT_ERROR_CODE_FRIENDLY_MESSAGES.
 */

import type { BoltFailureCategory } from './classifyBoltFailure';

export const BOLT_ERROR_CODES = {
  // ── Strategy validation (Part 1 + Part 3) ─────────────────────
  STRATEGY_MISSING_COMPANY_ID: 'STRATEGY_MISSING_COMPANY_ID',
  STRATEGY_INVALID_CAMPAIGN_MODE: 'STRATEGY_INVALID_CAMPAIGN_MODE',
  STRATEGY_MISSING_FORMATS: 'STRATEGY_MISSING_FORMATS',
  STRATEGY_INVALID_FREQUENCY: 'STRATEGY_INVALID_FREQUENCY',
  STRATEGY_TOO_MANY_TYPES: 'STRATEGY_TOO_MANY_TYPES',
  STRATEGY_FREQUENCY_EXCEEDED: 'STRATEGY_FREQUENCY_EXCEEDED',
  STRATEGY_INVALID_DURATION: 'STRATEGY_INVALID_DURATION',
  STRATEGY_MISSING_GOAL: 'STRATEGY_MISSING_GOAL',
  STRATEGY_MISSING_AUDIENCE: 'STRATEGY_MISSING_AUDIENCE',
  STRATEGY_MISSING_PLATFORMS: 'STRATEGY_MISSING_PLATFORMS',
  STRATEGY_INVALID_PLATFORMS: 'STRATEGY_INVALID_PLATFORMS',
  // ── Strategic theme (Part 3) ─────────────────────────────────
  THEME_MISSING: 'THEME_MISSING',
  THEME_INVALID_SHAPE: 'THEME_INVALID_SHAPE',
  THEME_MISSING_REQUIRED_FIELD: 'THEME_MISSING_REQUIRED_FIELD',
  THEME_SERIALIZATION_FAILED: 'THEME_SERIALIZATION_FAILED',
  // ── Format governance (Part 2) ───────────────────────────────
  UNSUPPORTED_CREATOR_FORMAT: 'UNSUPPORTED_CREATOR_FORMAT',
  UNSUPPORTED_TEXT_FORMAT: 'UNSUPPORTED_TEXT_FORMAT',
  FORMAT_PLATFORM_INCOMPATIBLE: 'FORMAT_PLATFORM_INCOMPATIBLE',
  // ── Campaign version (Part 4) ────────────────────────────────
  CAMPAIGN_VERSION_NOT_FOUND: 'CAMPAIGN_VERSION_NOT_FOUND',
  CAMPAIGN_VERSION_MISMATCH: 'CAMPAIGN_VERSION_MISMATCH',
  CAMPAIGN_VERSION_ACCESS_DENIED: 'CAMPAIGN_VERSION_ACCESS_DENIED',
  // ── Blueprint guards (Part 5) ────────────────────────────────
  BLUEPRINT_MISSING_WEEKS: 'BLUEPRINT_MISSING_WEEKS',
  BLUEPRINT_INVALID_WEEK_STRUCTURE: 'BLUEPRINT_INVALID_WEEK_STRUCTURE',
  BLUEPRINT_INVALID_ACTIVITY_COUNT: 'BLUEPRINT_INVALID_ACTIVITY_COUNT',
  BLUEPRINT_MISSING_PLATFORM_MAPPING: 'BLUEPRINT_MISSING_PLATFORM_MAPPING',
  BLUEPRINT_INVALID_CONTENT_TYPE: 'BLUEPRINT_INVALID_CONTENT_TYPE',
  BLUEPRINT_MISSING_CTA: 'BLUEPRINT_MISSING_CTA',
  // ── Persistence (Part 6 — original hardening pass) ──────────
  CAMPAIGN_INSERT_FAILED: 'CAMPAIGN_INSERT_FAILED',
  CAMPAIGN_VERSION_INSERT_FAILED: 'CAMPAIGN_VERSION_INSERT_FAILED',
  CAMPAIGN_VERSION_UPDATE_FAILED: 'CAMPAIGN_VERSION_UPDATE_FAILED',
  BLUEPRINT_SAVE_FAILED: 'BLUEPRINT_SAVE_FAILED',
  DAILY_PLAN_SAVE_FAILED: 'DAILY_PLAN_SAVE_FAILED',
  // ── Closure pass: pipeline / run lifecycle ───────────────────
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  RUN_UPDATE_FAILED: 'RUN_UPDATE_FAILED',
  STAGE_TIMEOUT: 'STAGE_TIMEOUT',
  // ── Closure pass: ai/plan (deterministic planner asserts) ────
  PLAN_STRUCTURE_INVALID: 'PLAN_STRUCTURE_INVALID',
  AI_PLAN_INVALID: 'AI_PLAN_INVALID',
  // ── Closure pass: generate-weekly-structure ──────────────────
  WEEK_STRUCTURE_GENERATION_FAILED: 'WEEK_STRUCTURE_GENERATION_FAILED',
  WEEK_STRUCTURE_PERSISTENCE_FAILED: 'WEEK_STRUCTURE_PERSISTENCE_FAILED',
  WEEK_STRUCTURE_VALIDATION_FAILED: 'WEEK_STRUCTURE_VALIDATION_FAILED',
  DAILY_PLAN_ROW_GENERATION_FAILED: 'DAILY_PLAN_ROW_GENERATION_FAILED',
  DAILY_PLAN_ROW_INVALID: 'DAILY_PLAN_ROW_INVALID',
  BLUEPRINT_NOT_FOUND: 'BLUEPRINT_NOT_FOUND',
  WEEK_NOT_FOUND: 'WEEK_NOT_FOUND',
  // ── Closure pass: daily-plan row-level validation ────────────
  DAILY_PLAN_INVALID_PLATFORM: 'DAILY_PLAN_INVALID_PLATFORM',
  DAILY_PLAN_INVALID_CONTENT_TYPE: 'DAILY_PLAN_INVALID_CONTENT_TYPE',
  DAILY_PLAN_INVALID_ACTIVITY: 'DAILY_PLAN_INVALID_ACTIVITY',
  DAILY_PLAN_INVALID_WEEK: 'DAILY_PLAN_INVALID_WEEK',
  DAILY_PLAN_INVALID_CTA: 'DAILY_PLAN_INVALID_CTA',
  DAILY_PLAN_UNSCHEDULABLE: 'DAILY_PLAN_UNSCHEDULABLE',
  // ── Closure pass: schedule-structured-plan ───────────────────
  SCHEDULING_PLAN_INVALID: 'SCHEDULING_PLAN_INVALID',
  SCHEDULING_CAMPAIGN_NOT_FOUND: 'SCHEDULING_CAMPAIGN_NOT_FOUND',
  SCHEDULING_CONFIG_INCOMPLETE: 'SCHEDULING_CONFIG_INCOMPLETE',
  SCHEDULING_NOT_ELIGIBLE: 'SCHEDULING_NOT_ELIGIBLE',
  SCHEDULING_STALE_PLAN_VERSION: 'SCHEDULING_STALE_PLAN_VERSION',
  SCHEDULING_CREATOR_OUTPUT_INVALID: 'SCHEDULING_CREATOR_OUTPUT_INVALID',
  SCHEDULING_USER_RESOLUTION_FAILED: 'SCHEDULING_USER_RESOLUTION_FAILED',
  SCHEDULING_SOCIAL_ACCOUNTS_FAILED: 'SCHEDULING_SOCIAL_ACCOUNTS_FAILED',
  SCHEDULING_PLATFORM_UNSUPPORTED: 'SCHEDULING_PLATFORM_UNSUPPORTED',
  SCHEDULING_CONTENT_TYPE_UNSUPPORTED: 'SCHEDULING_CONTENT_TYPE_UNSUPPORTED',
  SCHEDULING_INVALID_SCHEDULED_TIME: 'SCHEDULING_INVALID_SCHEDULED_TIME',
  SCHEDULING_ACCOUNT_PLATFORM_MISMATCH: 'SCHEDULING_ACCOUNT_PLATFORM_MISMATCH',
  SCHEDULING_NO_ACCOUNT_FOR_PLATFORM: 'SCHEDULING_NO_ACCOUNT_FOR_PLATFORM',
  SCHEDULED_POST_PERSISTENCE_FAILED: 'SCHEDULED_POST_PERSISTENCE_FAILED',
  // ── Closure pass: creator asset generation ───────────────────
  CREATOR_ASSET_TIMEOUT: 'CREATOR_ASSET_TIMEOUT',
  CREATOR_ASSET_PROVIDER_FAILURE: 'CREATOR_ASSET_PROVIDER_FAILURE',
  CREATOR_ASSET_RENDER_FAILED: 'CREATOR_ASSET_RENDER_FAILED',
  CREATOR_ASSET_SAVE_FAILED: 'CREATOR_ASSET_SAVE_FAILED',
  CREATOR_ASSET_QUEUE_FAILURE: 'CREATOR_ASSET_QUEUE_FAILURE',
  CREATOR_ASSET_INVALID_REQUEST: 'CREATOR_ASSET_INVALID_REQUEST',
  CREATOR_ASSET_CONTEXT_INCOMPLETE: 'CREATOR_ASSET_CONTEXT_INCOMPLETE',
  CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED: 'CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED',
} as const;

export type BoltErrorCode = typeof BOLT_ERROR_CODES[keyof typeof BOLT_ERROR_CODES];

export const BOLT_ERROR_CODE_CATEGORY: Record<BoltErrorCode, BoltFailureCategory> = {
  [BOLT_ERROR_CODES.STRATEGY_MISSING_COMPANY_ID]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_FORMATS]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_FREQUENCY]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_TOO_MANY_TYPES]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_FREQUENCY_EXCEEDED]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_GOAL]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_AUDIENCE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_PLATFORMS]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_PLATFORMS]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.THEME_MISSING]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.THEME_INVALID_SHAPE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.THEME_MISSING_REQUIRED_FIELD]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.THEME_SERIALIZATION_FAILED]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.UNSUPPORTED_CREATOR_FORMAT]: 'UNSUPPORTED_FORMAT',
  [BOLT_ERROR_CODES.UNSUPPORTED_TEXT_FORMAT]: 'UNSUPPORTED_FORMAT',
  [BOLT_ERROR_CODES.FORMAT_PLATFORM_INCOMPATIBLE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_MISMATCH]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_ACCESS_DENIED]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_PLATFORM_MAPPING]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_CTA]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.CAMPAIGN_INSERT_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_UPDATE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.BLUEPRINT_SAVE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.DAILY_PLAN_SAVE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.RUN_NOT_FOUND]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.RUN_UPDATE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.STAGE_TIMEOUT]: 'PROVIDER_TIMEOUT',
  [BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID]: 'PLAN_PARSE_FAILURE',
  [BOLT_ERROR_CODES.AI_PLAN_INVALID]: 'PLAN_PARSE_FAILURE',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_GENERATION_FAILED]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_PERSISTENCE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_ROW_GENERATION_FAILED]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.BLUEPRINT_NOT_FOUND]: 'BLUEPRINT_FAILURE',
  [BOLT_ERROR_CODES.WEEK_NOT_FOUND]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_ACTIVITY]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_PLAN_INVALID]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.SCHEDULING_CONFIG_INCOMPLETE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.SCHEDULING_NOT_ELIGIBLE]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_CREATOR_OUTPUT_INVALID]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_USER_RESOLUTION_FAILED]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_CONTENT_TYPE_UNSUPPORTED]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_INVALID_SCHEDULED_TIME]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_ACCOUNT_PLATFORM_MISMATCH]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULING_NO_ACCOUNT_FOR_PLATFORM]: 'SCHEDULING_FAILURE',
  [BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.CREATOR_ASSET_TIMEOUT]: 'PROVIDER_TIMEOUT',
  [BOLT_ERROR_CODES.CREATOR_ASSET_PROVIDER_FAILURE]: 'PROVIDER_RATE_LIMIT',
  [BOLT_ERROR_CODES.CREATOR_ASSET_RENDER_FAILED]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.CREATOR_ASSET_SAVE_FAILED]: 'SUPABASE_ERROR',
  [BOLT_ERROR_CODES.CREATOR_ASSET_QUEUE_FAILURE]: 'DAILY_PLAN_FAILURE',
  [BOLT_ERROR_CODES.CREATOR_ASSET_INVALID_REQUEST]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.CREATOR_ASSET_CONTEXT_INCOMPLETE]: 'VALIDATION_ERROR',
  [BOLT_ERROR_CODES.CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED]: 'SUPABASE_ERROR',
};

export const BOLT_ERROR_CODE_FRIENDLY_MESSAGES: Record<BoltErrorCode, string> = {
  [BOLT_ERROR_CODES.STRATEGY_MISSING_COMPANY_ID]: 'A company must be selected before launching a campaign.',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE]: 'Please choose a valid campaign mode (text, creator, or combined).',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_FORMATS]: 'Please pick at least one content format before launching.',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_FREQUENCY]: 'Posting frequency must be a positive number.',
  [BOLT_ERROR_CODES.STRATEGY_TOO_MANY_TYPES]: 'You can select at most 2 writer content types and 2 creator content types.',
  [BOLT_ERROR_CODES.STRATEGY_FREQUENCY_EXCEEDED]: 'Each content type may run at most 3×/week, and Intelligent Mix allows at most 5 writer and 5 creator posts per week.',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION]: 'Campaign duration must be between 1 and 4 weeks.',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_GOAL]: 'Please specify a campaign goal before launching.',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_AUDIENCE]: 'Please specify the target audience for this campaign.',
  [BOLT_ERROR_CODES.STRATEGY_MISSING_PLATFORMS]: 'Please select at least one platform for this campaign.',
  [BOLT_ERROR_CODES.STRATEGY_INVALID_PLATFORMS]: 'One or more selected platforms aren\'t valid for this format.',
  [BOLT_ERROR_CODES.THEME_MISSING]: 'A strategic theme is required to launch this campaign.',
  [BOLT_ERROR_CODES.THEME_INVALID_SHAPE]: 'The strategic theme payload is in an unexpected shape. Please regenerate the recommendation and try again.',
  [BOLT_ERROR_CODES.THEME_MISSING_REQUIRED_FIELD]: 'The strategic theme is missing required information. Please regenerate the recommendation.',
  [BOLT_ERROR_CODES.THEME_SERIALIZATION_FAILED]: 'The strategic theme could not be serialized. Please regenerate the recommendation.',
  [BOLT_ERROR_CODES.UNSUPPORTED_CREATOR_FORMAT]: 'One of the selected creator formats isn\'t supported. Remove the unsupported format and try again.',
  [BOLT_ERROR_CODES.UNSUPPORTED_TEXT_FORMAT]: 'One of the selected text formats isn\'t supported by BOLT. Choose from Post, Tweet, Short Story, Article, or Poll.',
  [BOLT_ERROR_CODES.FORMAT_PLATFORM_INCOMPATIBLE]: 'One of the selected formats can\'t be posted to any of the chosen platforms.',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND]: 'We couldn\'t find the saved campaign draft. Please re-open the recommendation and try again.',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_MISMATCH]: 'The selected campaign draft doesn\'t match the recommendation. Please reload the recommendation.',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_ACCESS_DENIED]: 'You don\'t have access to that campaign draft.',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS]: 'The generated campaign blueprint had no weekly plan. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE]: 'The generated weekly plan was incomplete. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT]: 'The blueprint contained an unexpected number of activities. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_PLATFORM_MAPPING]: 'The blueprint is missing platform assignments. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE]: 'The blueprint included content types that aren\'t supported. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_MISSING_CTA]: 'The blueprint is missing call-to-action guidance. Please try again.',
  [BOLT_ERROR_CODES.CAMPAIGN_INSERT_FAILED]: 'We couldn\'t save the new campaign. Please try again.',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED]: 'We couldn\'t save the campaign draft. Please try again.',
  [BOLT_ERROR_CODES.CAMPAIGN_VERSION_UPDATE_FAILED]: 'We couldn\'t update the campaign draft. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_SAVE_FAILED]: 'We couldn\'t save the campaign blueprint. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_SAVE_FAILED]: 'We couldn\'t save the daily plan. Please try again.',
  [BOLT_ERROR_CODES.RUN_NOT_FOUND]: 'This campaign run could not be located. Please refresh and try again.',
  [BOLT_ERROR_CODES.RUN_UPDATE_FAILED]: 'We couldn\'t update the campaign run state. Please try again.',
  [BOLT_ERROR_CODES.STAGE_TIMEOUT]: 'A campaign stage took too long and was cancelled. Please try again.',
  [BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID]: 'The generated campaign plan structure was invalid. Please try again.',
  [BOLT_ERROR_CODES.AI_PLAN_INVALID]: 'The AI returned an invalid campaign plan. Please try again.',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_GENERATION_FAILED]: 'We couldn\'t generate the weekly content structure. Please try again.',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_PERSISTENCE_FAILED]: 'We couldn\'t save the weekly content structure. Please try again.',
  [BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED]: 'The generated weekly content structure failed validation. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_ROW_GENERATION_FAILED]: 'We couldn\'t generate one or more daily content rows. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID]: 'A generated daily content row failed validation. Please try again.',
  [BOLT_ERROR_CODES.BLUEPRINT_NOT_FOUND]: 'The campaign blueprint could not be loaded. Please try again.',
  [BOLT_ERROR_CODES.WEEK_NOT_FOUND]: 'The requested week was not found in the blueprint. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM]: 'A generated content row is targeting an invalid platform. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE]: 'A generated content row has an invalid content type. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_ACTIVITY]: 'A generated content row has invalid activity data. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK]: 'A generated content row is linked to an invalid week. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA]: 'A generated content row has invalid CTA data. Please try again.',
  [BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE]: 'A generated content row could not be scheduled. Please review and try again.',
  [BOLT_ERROR_CODES.SCHEDULING_PLAN_INVALID]: 'The structured plan could not be used for scheduling. Please try again.',
  [BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND]: 'The campaign being scheduled was not found. Please refresh and try again.',
  [BOLT_ERROR_CODES.SCHEDULING_CONFIG_INCOMPLETE]: 'The campaign is missing scheduling configuration. Please review and try again.',
  [BOLT_ERROR_CODES.SCHEDULING_NOT_ELIGIBLE]: 'This campaign is not yet eligible for scheduling. Please review the strategy.',
  [BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION]: 'The plan version has changed since scheduling started. Please retry.',
  [BOLT_ERROR_CODES.SCHEDULING_CREATOR_OUTPUT_INVALID]: 'A creator content output failed validation during scheduling.',
  [BOLT_ERROR_CODES.SCHEDULING_USER_RESOLUTION_FAILED]: 'We could not resolve the user account for scheduling.',
  [BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED]: 'We couldn\'t load your social accounts. Please try again.',
  [BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED]: 'One of the platforms is not supported for scheduling.',
  [BOLT_ERROR_CODES.SCHEDULING_CONTENT_TYPE_UNSUPPORTED]: 'One of the content types is not supported for scheduling.',
  [BOLT_ERROR_CODES.SCHEDULING_INVALID_SCHEDULED_TIME]: 'A scheduled time is invalid. Please try again.',
  [BOLT_ERROR_CODES.SCHEDULING_ACCOUNT_PLATFORM_MISMATCH]: 'A selected account does not match its target platform.',
  [BOLT_ERROR_CODES.SCHEDULING_NO_ACCOUNT_FOR_PLATFORM]: 'No connected account was found for one of the platforms.',
  [BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED]: 'We couldn\'t save one or more scheduled posts. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_TIMEOUT]: 'A creator asset took too long to render and was cancelled. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_PROVIDER_FAILURE]: 'The creator asset provider failed. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_RENDER_FAILED]: 'A creator asset failed to render. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_SAVE_FAILED]: 'We couldn\'t save a rendered creator asset. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_QUEUE_FAILURE]: 'The creator asset queue failed. Please try again.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_INVALID_REQUEST]: 'A creator asset request was invalid. Please review the strategy.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_CONTEXT_INCOMPLETE]: 'The creator asset generation context was incomplete.',
  [BOLT_ERROR_CODES.CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED]: 'We couldn\'t load daily plans for creator asset generation. Please try again.',
};

/**
 * Error subclass that carries a stable BOLT code.
 *
 * Thrown by validators / persistence wrappers; caught by the failure-
 * persistence layer which serializes `code` onto bolt_execution_runs
 * + the failure summary row so dashboards can filter by it.
 */
export class BoltError extends Error {
  readonly code: BoltErrorCode;
  readonly category: BoltFailureCategory;
  readonly details: Record<string, unknown> | undefined;
  readonly cause?: unknown;

  constructor(
    code: BoltErrorCode,
    message?: string,
    options?: { details?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message ?? BOLT_ERROR_CODE_FRIENDLY_MESSAGES[code]);
    this.name = 'BoltError';
    this.code = code;
    this.category = BOLT_ERROR_CODE_CATEGORY[code];
    this.details = options?.details;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export function isBoltError(value: unknown): value is BoltError {
  return value instanceof BoltError;
}
