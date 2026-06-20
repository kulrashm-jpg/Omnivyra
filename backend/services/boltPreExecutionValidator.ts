/**
 * BOLT pre-execution strategy validator.
 *
 * Single composed entry point that runs every cheap, deterministic
 * check BEFORE a row is inserted into `bolt_execution_runs`. The goal
 * is to make sure no strategy that can be rejected synchronously ever
 * reaches a worker — they end up as `bolt_failure_summary` rows that
 * collapse into the generic "technical glitch" experience.
 *
 * What this composes (no duplicated logic):
 *
 *   - validateStrategicTheme    (Part 3)
 *   - validateExecutionConfigFormats (Part 2 — text + creator)
 *   - preflightCampaignVersion  (Part 4 — async DB lookup)
 *   - inline checks for the remaining strategy fields that previously
 *     lived inside `validateExecutionConfig` in boltPipelineService.
 *
 * Returns a structured list of `{ code, message }` so the HTTP handler
 * can surface the first error precisely. The validator never throws;
 * the strict wrapper does.
 *
 * The async preflight (campaign-version lookup) is gated behind an
 * opt-in flag so a fully-synchronous caller (e.g. a test that only
 * cares about format validation) doesn't need a live DB.
 */

import { validateStrategicTheme } from '../../lib/shared/bolt/strategicThemeValidator';
import {
  MAX_CAMPAIGN_DURATION_WEEKS,
  MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
} from '../../lib/shared/campaignDuration';
import {
  validateExecutionConfigFormats,
  resolveCampaignMode,
  type BoltCampaignMode,
} from '../../lib/shared/bolt/formatGovernance';
import { preflightCampaignVersion } from './boltCampaignVersionGuard';
import {
  BoltError,
  BOLT_ERROR_CODES,
  type BoltErrorCode,
} from '../../lib/shared/bolt/boltErrorCodes';

export interface PreExecutionValidationInput {
  companyId: string | null | undefined;
  generatedCampaignId: string | null | undefined;
  sourceStrategicTheme: unknown;
  executionConfig: Record<string, unknown> | null | undefined;
  outcomeView?: string | null;
  /** Required platforms when the campaign mode wants scheduling. */
  selectedPlatforms?: unknown;
  /** When true, also runs the async campaign-version DB preflight. */
  checkCampaignVersion?: boolean;
}

export interface ValidationError {
  code: BoltErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface PreExecutionValidationResult {
  ok: boolean;
  errors: ValidationError[];
  campaignMode: BoltCampaignMode;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

function isPositiveIntegerInRange(value: unknown, min: number, max: number): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Run all synchronous + optional async pre-execution checks. Never throws.
 */
export async function validateBoltPreExecution(
  input: PreExecutionValidationInput
): Promise<PreExecutionValidationResult> {
  const errors: ValidationError[] = [];
  const campaignMode = resolveCampaignMode(input.executionConfig);

  // ── 1. Required identifiers ────────────────────────────────────
  if (!isNonEmptyString(input.companyId)) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_MISSING_COMPANY_ID,
      message: 'companyId is required.',
    });
  }

  // ── 2. Strategic theme structure (Part 3) ──────────────────────
  const themeResult = validateStrategicTheme(input.sourceStrategicTheme);
  if (!themeResult.ok) {
    for (const e of themeResult.errors) {
      errors.push({
        code: BOLT_ERROR_CODES[e.code],
        message: e.message,
        field: e.field,
      });
    }
  }

  // ── 3. Execution-config required fields ───────────────────────
  const ec = input.executionConfig ?? null;
  if (!ec || typeof ec !== 'object') {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE,
      message: 'executionConfig must be an object.',
      field: 'executionConfig',
    });
    return { ok: false, errors, campaignMode };
  }

  // campaign_mode must be one of: text, creator, combined — or empty
  // (defaults to text). We accept the same set the rest of the code
  // does, but reject explicit garbage.
  const rawMode = (ec as { campaign_mode?: unknown }).campaign_mode;
  if (rawMode != null && rawMode !== '') {
    const m = String(rawMode).toLowerCase().trim();
    if (m !== 'text' && m !== 'creator' && m !== 'combined') {
      errors.push({
        code: BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE,
        message: `campaign_mode "${rawMode}" is invalid. Expected one of: text, creator, combined.`,
        field: 'campaign_mode',
      });
    }
  }

  if (!isNonEmptyString(ec.target_audience)) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_MISSING_AUDIENCE,
      message: 'target_audience is required.',
      field: 'target_audience',
    });
  }
  if (!isNonEmptyString(ec.campaign_goal)) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_MISSING_GOAL,
      message: 'campaign_goal is required.',
      field: 'campaign_goal',
    });
  }
  // frequency_per_week — accept number or numeric string ≥ 1.
  if (!isPositiveFiniteNumber(ec.frequency_per_week)) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_INVALID_FREQUENCY,
      message: 'frequency_per_week must be a positive number.',
      field: 'frequency_per_week',
    });
  }
  // campaign_duration — Phase 6C-4A: Intelligent Mix (combined) accepts 1–12;
  // BOLT Text/Creator stay 1–4. Max derived from the shared duration authority.
  const maxDurationWeeks =
    campaignMode === 'combined' ? MAX_CAMPAIGN_DURATION_WEEKS : MAX_SHORT_CAMPAIGN_DURATION_WEEKS;
  if (ec.campaign_duration == null || ec.campaign_duration === '') {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION,
      message: 'campaign_duration is required.',
      field: 'campaign_duration',
    });
  } else if (!isPositiveIntegerInRange(ec.campaign_duration, 1, maxDurationWeeks)) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION,
      message: `campaign_duration must be an integer between 1 and ${maxDurationWeeks} (received ${ec.campaign_duration}).`,
      field: 'campaign_duration',
    });
  }

  // ── 4. Format governance (Part 2) ─────────────────────────────
  const formatResult = validateExecutionConfigFormats(ec, campaignMode);
  if (formatResult.noFormatsSelected) {
    errors.push({
      code: BOLT_ERROR_CODES.STRATEGY_MISSING_FORMATS,
      message: 'At least one content format must be selected.',
      field: 'content_formats',
    });
  }
  if (formatResult.unsupportedCreator.length > 0) {
    errors.push({
      code: BOLT_ERROR_CODES.UNSUPPORTED_CREATOR_FORMAT,
      message: `Unsupported creator format: ${formatResult.unsupportedCreator.join(', ')}.`,
      details: { unsupported_formats: formatResult.unsupportedCreator },
    });
  }
  if (formatResult.unsupportedText.length > 0) {
    errors.push({
      code: BOLT_ERROR_CODES.UNSUPPORTED_TEXT_FORMAT,
      message: `Unsupported text format: ${formatResult.unsupportedText.join(', ')}.`,
      details: { unsupported_formats: formatResult.unsupportedText },
    });
  }

  // ── 5. Selected platforms (when the caller supplies them) ─────
  // Note: the BOLT pipeline allows an empty selected_platforms when the
  // outcome is `week_plan` only. We only warn when scheduling is
  // requested AND the array is empty/missing.
  const wantsSchedule = input.outcomeView === 'schedule' || input.outcomeView === 'campaign_schedule';
  if (input.selectedPlatforms !== undefined) {
    if (!isNonEmptyArray(input.selectedPlatforms)) {
      if (wantsSchedule) {
        errors.push({
          code: BOLT_ERROR_CODES.STRATEGY_MISSING_PLATFORMS,
          message: 'At least one platform must be selected when scheduling.',
          field: 'selected_platforms',
        });
      }
    } else {
      // Type integrity — every entry must be a non-empty string.
      const badEntries = (input.selectedPlatforms as unknown[]).filter((p) => !isNonEmptyString(p));
      if (badEntries.length > 0) {
        errors.push({
          code: BOLT_ERROR_CODES.STRATEGY_INVALID_PLATFORMS,
          message: 'selected_platforms must be a non-empty array of strings.',
          field: 'selected_platforms',
          details: { bad_entries_count: badEntries.length },
        });
      }
    }
  }

  // ── 6. Campaign version preflight (Part 4) ─────────────────────
  // Only when caller asked AND we have a company id to gate access.
  if (input.checkCampaignVersion && isNonEmptyString(input.companyId)) {
    try {
      const guard = await preflightCampaignVersion({
        generatedCampaignId: input.generatedCampaignId ?? null,
        companyId: String(input.companyId),
      });
      if (!guard.ok && guard.error) {
        errors.push({
          code: guard.error.code,
          message: guard.error.message,
          details: guard.error.details,
        });
      }
    } catch (guardErr) {
      // Never let preflight blow up the whole validator. Surface as
      // CAMPAIGN_VERSION_NOT_FOUND with the underlying message for ops.
      errors.push({
        code: BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
        message: `Campaign-version preflight crashed: ${guardErr instanceof Error ? guardErr.message : String(guardErr)}`,
      });
    }
  }

  return { ok: errors.length === 0, errors, campaignMode };
}

/**
 * Strict variant — throws the first error as a BoltError.
 */
export async function assertValidBoltPreExecution(
  input: PreExecutionValidationInput
): Promise<void> {
  const result = await validateBoltPreExecution(input);
  if (result.ok) return;
  const first = result.errors[0];
  throw new BoltError(first.code, first.message, { details: first.details });
}
