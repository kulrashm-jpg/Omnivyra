/**
 * Row-level failure diagnostic persistence.
 *
 * One row inserted per rejected daily-plan / scheduled-post / creator-
 * asset row. Never throws — best-effort write. Failure to write is
 * logged but never blocks the caller (the caller's catch path is
 * responsible for the row-rejection action itself).
 *
 * Two surfaces:
 *   - `recordRowFailure(...)` — single row insert; used by validators.
 *   - `recordRowFailureBatch(...)` — N inserts; used by row-validator
 *     services that produce multiple rejections in one pass.
 *
 * Dashboards read via `getRowFailuresForRun(runId)` (see
 * boltFailureDashboard.ts for the operator drawer wiring).
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  BOLT_ERROR_CODE_CATEGORY,
  type BoltErrorCode,
} from '../../lib/shared/bolt/boltErrorCodes';

export interface RowFailureRecord {
  runId: string;
  campaignId?: string | null;
  companyId?: string | null;
  dailyPlanId?: string | null;
  weekNumber?: number | null;
  activityId?: string | null;
  platform?: string | null;
  contentType?: string | null;
  stage?: string | null;
  code: BoltErrorCode;
  message: string;
  field?: string | null;
  details?: Record<string, unknown> | null;
}

function toDbRow(input: RowFailureRecord): Record<string, unknown> {
  return {
    run_id: input.runId,
    campaign_id: input.campaignId ?? null,
    company_id: input.companyId ?? null,
    daily_plan_id: input.dailyPlanId ?? null,
    week_number: input.weekNumber ?? null,
    activity_id: input.activityId ?? null,
    platform: input.platform ?? null,
    content_type: input.contentType ?? null,
    stage: input.stage ?? null,
    failure_code: input.code,
    failure_category: BOLT_ERROR_CODE_CATEGORY[input.code] ?? null,
    failure_message: input.message,
    failure_field: input.field ?? null,
    failure_details: input.details ?? null,
  };
}

export async function recordRowFailure(input: RowFailureRecord): Promise<void> {
  try {
    await ownedDbTable('bolt_row_failure_diagnostics').insert(toDbRow(input));
  } catch (err) {
    console.error('[bolt/row-failure-persist-failed]', {
      run_id: input.runId,
      code: input.code,
      insert_error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function recordRowFailureBatch(rows: RowFailureRecord[]): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    await ownedDbTable('bolt_row_failure_diagnostics').insert(rows.map(toDbRow));
  } catch (err) {
    console.error('[bolt/row-failure-persist-failed]', {
      batch_size: rows.length,
      sample_run_id: rows[0]?.runId,
      insert_error: err instanceof Error ? err.message : String(err),
    });
  }
}
