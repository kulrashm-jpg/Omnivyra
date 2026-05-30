/**
 * Per-row daily-plan validator.
 *
 * Runs against an in-memory daily-plan row (the shape inserted into
 * daily_content_plans) BEFORE persistence. Produces a list of
 * row-level failures classified by BOLT_ERROR_CODES.DAILY_PLAN_INVALID_*.
 *
 * Pure function — never throws, never touches the DB. Callers in
 * generate-weekly-structure / schedule-structured-plan should:
 *
 *   1. Build the candidate row.
 *   2. Pass it through `validateDailyPlanRow(...)`.
 *   3. If invalid: record via `recordRowFailure(...)` and SKIP the row
 *      (partial-success path) OR throw `assertDailyPlanRowValid(...)`
 *      to abort the stage (strict path).
 *
 * Validation rules:
 *   - platform present + non-empty                → DAILY_PLAN_INVALID_PLATFORM
 *   - content_type present + recognised           → DAILY_PLAN_INVALID_CONTENT_TYPE
 *   - week_number integer ≥ 1                     → DAILY_PLAN_INVALID_WEEK
 *   - activity_id present (when expected)         → DAILY_PLAN_INVALID_ACTIVITY
 *   - cta present (warning-class)                 → DAILY_PLAN_INVALID_CTA
 *   - scheduled_for parsable + ≥ now (when set)   → DAILY_PLAN_UNSCHEDULABLE
 */

import {
  BoltError,
  BOLT_ERROR_CODES,
  type BoltErrorCode,
} from './boltErrorCodes';
import { isSupportedTextFormat } from './formatGovernance';
import {
  isAutonomousRenderableFormat,
  isAttachmentRequiredFormat,
} from '../creatorGovernanceRegistry';

export interface CandidateDailyPlanRow {
  daily_plan_id?: string | null;
  campaign_id?: string | null;
  week_number?: number | null;
  activity_id?: string | null;
  platform?: string | null;
  content_type?: string | null;
  cta?: string | null;
  scheduled_for?: string | null;
  /** When true, scheduled_for is REQUIRED to be in the future. */
  requires_schedule?: boolean;
  /** When true, activity_id is REQUIRED. */
  requires_activity?: boolean;
}

export interface RowValidationError {
  code: BoltErrorCode;
  message: string;
  field?: string;
}

export interface RowValidationResult {
  ok: boolean;
  errors: RowValidationError[];
}

function isKnownContentType(value: unknown): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return false;
  if (isSupportedTextFormat(s)) return true;
  if (isAutonomousRenderableFormat(s)) return true;
  if (isAttachmentRequiredFormat(s)) return true;
  return false;
}

export function validateDailyPlanRow(row: CandidateDailyPlanRow): RowValidationResult {
  const errors: RowValidationError[] = [];

  if (typeof row.platform !== 'string' || !row.platform.trim()) {
    errors.push({
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM,
      message: 'Row is missing a platform.',
      field: 'platform',
    });
  }

  if (!isKnownContentType(row.content_type)) {
    errors.push({
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE,
      message: `Row content_type "${String(row.content_type ?? '')}" is not in any format registry.`,
      field: 'content_type',
    });
  }

  if (row.week_number != null) {
    const n = Number(row.week_number);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({
        code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK,
        message: `Row week_number "${row.week_number}" is not a positive integer.`,
        field: 'week_number',
      });
    }
  } else {
    errors.push({
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK,
      message: 'Row is missing a week_number.',
      field: 'week_number',
    });
  }

  if (row.requires_activity && (typeof row.activity_id !== 'string' || !row.activity_id.trim())) {
    errors.push({
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_ACTIVITY,
      message: 'Row is missing an activity_id.',
      field: 'activity_id',
    });
  }

  // CTA is warning-class — surface it but don't fail the row. We still
  // emit an error record so operators can see the count, but the strict
  // assertion path (assertDailyPlanRowValid) is configured to ignore it.
  if (typeof row.cta !== 'string' || !row.cta.trim()) {
    errors.push({
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA,
      message: 'Row is missing a CTA.',
      field: 'cta',
    });
  }

  if (row.requires_schedule) {
    const raw = typeof row.scheduled_for === 'string' ? row.scheduled_for.trim() : '';
    if (!raw) {
      errors.push({
        code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
        message: 'Row is missing scheduled_for.',
        field: 'scheduled_for',
      });
    } else {
      const ts = Date.parse(raw);
      if (!Number.isFinite(ts)) {
        errors.push({
          code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
          message: `Row scheduled_for "${raw}" is not a valid ISO timestamp.`,
          field: 'scheduled_for',
        });
      } else if (ts < Date.now()) {
        errors.push({
          code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
          message: `Row scheduled_for "${raw}" is in the past.`,
          field: 'scheduled_for',
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Strict variant — throws the first error as BoltError. CTA-only failures
 *  are treated as warnings and DO NOT throw. */
export function assertDailyPlanRowValid(row: CandidateDailyPlanRow): void {
  const r = validateDailyPlanRow(row);
  const hardErrors = r.errors.filter((e) => e.code !== BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA);
  if (hardErrors.length === 0) return;
  const first = hardErrors[0];
  throw new BoltError(first.code, first.message);
}
