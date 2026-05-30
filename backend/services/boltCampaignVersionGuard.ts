/**
 * Campaign version preflight guards.
 *
 * `runSourceRecommendation` will silently throw "Campaign version not
 * found for source-recommendation" deep in the pipeline when the
 * caller passed a `generatedCampaignId` that doesn't have a backing
 * `campaign_versions` row — or has one belonging to a different
 * company. This module fails the same checks BEFORE the pipeline
 * worker picks up the job, with classified error codes:
 *
 *   - CAMPAIGN_VERSION_NOT_FOUND
 *   - CAMPAIGN_VERSION_MISMATCH        (campaign_id ≠ supplied id)
 *   - CAMPAIGN_VERSION_ACCESS_DENIED   (company_id ≠ caller's company)
 *
 * The pipeline retains its own catch-side check; this is a fast-fail
 * preflight, not a replacement. Defense-in-depth.
 */

import { supabase } from '../db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CampaignVersionGuardInput {
  /** Optional — preflight is skipped when null/empty (new campaign flow). */
  generatedCampaignId: string | null | undefined;
  companyId: string;
}

export interface CampaignVersionGuardResult {
  /** True iff preflight passed OR was skipped (no campaign id supplied). */
  ok: boolean;
  /** Set when ok=false. */
  error?: BoltError;
  /** When ok=true and a campaign id was supplied, the latest version id. */
  latestVersionId?: string;
}

/**
 * Pure-ish preflight: one indexed lookup per call. Never throws on its
 * own — returns the error in the result. Caller decides whether to
 * surface it as HTTP 400 (synchronous validation) or as a thrown
 * BoltError (worker-side defense in depth).
 */
export async function preflightCampaignVersion(input: CampaignVersionGuardInput): Promise<CampaignVersionGuardResult> {
  const raw = typeof input.generatedCampaignId === 'string' ? input.generatedCampaignId.trim() : '';
  if (!raw) return { ok: true };

  if (!UUID_RE.test(raw)) {
    return {
      ok: false,
      error: new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
        `generatedCampaignId "${raw}" is not a valid UUID.`,
        { details: { generatedCampaignId: raw } }
      ),
    };
  }

  const { data, error } = await supabase
    .from('campaign_versions')
    .select('id, campaign_id, company_id')
    .eq('campaign_id', raw)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // The DB itself rejected the query. Return CAMPAIGN_VERSION_NOT_FOUND
    // (most likely cause) but include the underlying message in details
    // so operators can distinguish a hard DB error from a true miss.
    return {
      ok: false,
      error: new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
        `Failed to look up campaign version for ${raw}: ${error.message}`,
        { details: { generatedCampaignId: raw, db_error: error.message } }
      ),
    };
  }

  if (!data) {
    return {
      ok: false,
      error: new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
        `No campaign_versions row found for campaign ${raw}.`,
        { details: { generatedCampaignId: raw } }
      ),
    };
  }

  const row = data as { id: string; campaign_id: string; company_id: string | null };
  if (row.campaign_id !== raw) {
    return {
      ok: false,
      error: new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_MISMATCH,
        `campaign_versions.campaign_id "${row.campaign_id}" doesn't match supplied generatedCampaignId "${raw}".`,
        { details: { generatedCampaignId: raw, found_campaign_id: row.campaign_id } }
      ),
    };
  }
  if (row.company_id && row.company_id !== input.companyId) {
    return {
      ok: false,
      error: new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_ACCESS_DENIED,
        `Campaign ${raw} belongs to a different company.`,
        { details: { generatedCampaignId: raw, expected_company_id: input.companyId } }
      ),
    };
  }

  return { ok: true, latestVersionId: row.id };
}
