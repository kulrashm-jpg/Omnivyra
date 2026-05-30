/**
 * Thin wrappers that translate Supabase persistence failures into
 * classified BoltError instances. The pipeline previously surfaced
 * these as bare `Error('Campaign creation failed: …')` strings that
 * normalized to `SUPABASE_ERROR` only via message-pattern matching.
 *
 * After this:
 *   - Every persistence site that uses a wrapper produces a stable
 *     code (CAMPAIGN_INSERT_FAILED, CAMPAIGN_VERSION_INSERT_FAILED,
 *     CAMPAIGN_VERSION_UPDATE_FAILED, BLUEPRINT_SAVE_FAILED,
 *     DAILY_PLAN_SAVE_FAILED).
 *   - The raw Postgres error message is preserved in `details.db_error`
 *     so operators investigating a row in `bolt_failure_summary` can
 *     see the underlying message (RLS, NOT NULL, FK, …) without
 *     joining to a separate log.
 *   - The classifier (classifyBoltFailure) already routes BoltError
 *     codes to SUPABASE_ERROR via BOLT_ERROR_CODE_CATEGORY, so the
 *     dashboard groups stay consistent.
 *
 * Each helper is a TINY async wrapper around a single Supabase call —
 * the caller still owns the query construction. We do NOT introduce a
 * repository layer.
 */

import { ownedDbTable } from '../db/writeOwner';
import { BoltError, BOLT_ERROR_CODES, type BoltErrorCode } from '../../lib/shared/bolt/boltErrorCodes';

interface SupabaseError { message: string; code?: string | null; details?: string | null; hint?: string | null; }

function wrapSupabaseError(
  err: SupabaseError | null | undefined,
  code: BoltErrorCode,
  context: Record<string, unknown>
): BoltError | null {
  if (!err) return null;
  return new BoltError(code, `${code}: ${err.message}`, {
    cause: err,
    details: {
      ...context,
      db_error: err.message,
      db_code: err.code ?? null,
      db_details: err.details ?? null,
      db_hint: err.hint ?? null,
    },
  });
}

// ── Campaign insert ────────────────────────────────────────────────
export async function insertCampaignOrThrow(row: Record<string, unknown>): Promise<void> {
  const { error } = await ownedDbTable('campaigns').insert(row);
  const wrapped = wrapSupabaseError(
    error,
    BOLT_ERROR_CODES.CAMPAIGN_INSERT_FAILED,
    { campaign_id: row.id, company_id: row.company_id },
  );
  if (wrapped) throw wrapped;
}

// ── Campaign version insert ────────────────────────────────────────
export async function insertCampaignVersionOrThrow(row: Record<string, unknown>): Promise<void> {
  const { error } = await ownedDbTable('campaign_versions').insert(row);
  const wrapped = wrapSupabaseError(
    error,
    BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED,
    { campaign_id: row.campaign_id, company_id: row.company_id },
  );
  if (wrapped) throw wrapped;
}

// ── Campaign version update ────────────────────────────────────────
export async function updateCampaignVersionOrThrow(versionId: string, updates: Record<string, unknown>): Promise<void> {
  const { error } = await ownedDbTable('campaign_versions').update(updates).eq('id', versionId);
  const wrapped = wrapSupabaseError(
    error,
    BOLT_ERROR_CODES.CAMPAIGN_VERSION_UPDATE_FAILED,
    { version_id: versionId },
  );
  if (wrapped) throw wrapped;
}

/**
 * Generic wrapper for arbitrary blueprint persistence operations
 * (saveStructuredCampaignPlan, commitDraftBlueprint, etc.). Pass
 * the original async call as `fn` — any throw is re-wrapped with
 * the BLUEPRINT_SAVE_FAILED code.
 */
export async function withBlueprintSaveGuard<T>(
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BoltError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new BoltError(BOLT_ERROR_CODES.BLUEPRINT_SAVE_FAILED, `BLUEPRINT_SAVE_FAILED: ${msg}`, {
      cause: err,
      details: { ...context, db_error: msg },
    });
  }
}

/**
 * Wrapper for daily-plan persistence (insert into daily_content_plans).
 * Used by generate-weekly-structure.
 */
export async function withDailyPlanSaveGuard<T>(
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BoltError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new BoltError(BOLT_ERROR_CODES.DAILY_PLAN_SAVE_FAILED, `DAILY_PLAN_SAVE_FAILED: ${msg}`, {
      cause: err,
      details: { ...context, db_error: msg },
    });
  }
}
