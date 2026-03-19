/**
 * Campaign Context Service
 *
 * Single read/write path for per-campaign context + memory.
 * Table: campaign_context (upsert on campaign_id — never destructive).
 *
 * Two distinct write moments:
 *   1. saveCampaignContextSnapshot() — called at planner-finalize
 *      Stores: account_context, validation, paid_recommendation
 *
 *   2. updateCampaignMemory() — called after performance analysis
 *      Stores: performance_insights
 *
 * One read path:
 *   getLatestCampaignContextForCompany() — fetches most recent campaign's
 *   full context for injection into a NEW campaign's planning prompt.
 */

import { supabase } from '../db/supabaseClient';
import type { AccountContext } from '../types/accountContext';
import type { CampaignValidation } from '../lib/validation/campaignValidator';
import type { PaidRecommendation } from '../lib/ads/paidAmplificationEngine';
import type { PerformanceInsight } from '../lib/performance/performanceAnalyzer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CampaignContextSnapshot {
  account_context: AccountContext | null;
  validation: CampaignValidation | null;
  paid_recommendation: PaidRecommendation | null;
  context_created_at: string;
}

export interface CampaignMemory {
  performance_insights: PerformanceInsight | null;
  memory_updated_at: string;
}

/**
 * Full per-campaign context record as stored in DB.
 * All fields outside campaign_id / company_id are optional —
 * the record may exist with only a snapshot (no memory yet) or vice-versa.
 */
export interface CampaignContextRecord {
  campaign_id: string;
  company_id: string;
  account_context?: AccountContext | null;
  validation?: CampaignValidation | null;
  paid_recommendation?: PaidRecommendation | null;
  context_created_at?: string | null;
  performance_insights?: PerformanceInsight | null;
  memory_updated_at?: string | null;
}

/**
 * Shape returned to planning — combines snapshot + memory for full
 * "previous campaign intelligence" injection.
 */
export interface PreviousCampaignContext {
  validation: CampaignValidation | null;
  paid_recommendation: PaidRecommendation | null;
  performance_insights: PerformanceInsight | null;
  /** ISO date the snapshot was captured — useful for recency filtering. */
  captured_at: string | null;
}

// ---------------------------------------------------------------------------
// Write: context snapshot (at finalize time)
// ---------------------------------------------------------------------------

export interface SaveContextSnapshotInput {
  campaignId: string;
  companyId: string;
  account_context?: AccountContext | null;
  validation?: CampaignValidation | null;
  paid_recommendation?: PaidRecommendation | null;
}

/**
 * Upserts the context snapshot for a campaign.
 * Safe to call multiple times — later calls overwrite the snapshot fields only.
 * Non-fatal: logs warn on failure, never throws to the caller.
 */
export async function saveCampaignContextSnapshot(
  input: SaveContextSnapshotInput
): Promise<void> {
  const { campaignId, companyId } = input;

  if (!campaignId || !companyId) {
    console.warn('[PLANNER][CONTEXT][WARN] saveCampaignContextSnapshot: missing campaignId or companyId — skipping');
    return;
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from('campaign_context')
    .upsert(
      {
        campaign_id: campaignId,
        company_id: companyId,
        account_context: input.account_context ?? null,
        validation: input.validation ?? null,
        paid_recommendation: input.paid_recommendation ?? null,
        context_created_at: now,
        updated_at: now,
      },
      { onConflict: 'campaign_id' }
    );

  if (error) {
    console.warn('[PLANNER][CONTEXT][WARN] saveCampaignContextSnapshot failed (non-fatal):', error.message);
  } else {
    console.log(`[PLANNER][CONTEXT][INFO] Context snapshot saved for campaign ${campaignId}`);
  }
}

// ---------------------------------------------------------------------------
// Write: performance memory (after execution begins)
// ---------------------------------------------------------------------------

/**
 * Upserts the performance_insights memory field for a campaign.
 * Preserves any existing context_snapshot fields — only touches memory columns.
 * Non-fatal: logs warn on failure, never throws to the caller.
 */
export async function updateCampaignMemory(
  campaignId: string,
  companyId: string,
  insights: PerformanceInsight
): Promise<void> {
  if (!campaignId || !companyId) {
    console.warn('[PLANNER][CONTEXT][WARN] updateCampaignMemory: missing campaignId or companyId — skipping');
    return;
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from('campaign_context')
    .upsert(
      {
        campaign_id: campaignId,
        company_id: companyId,
        performance_insights: insights,
        memory_updated_at: now,
        updated_at: now,
      },
      { onConflict: 'campaign_id' }
    );

  if (error) {
    console.warn('[PLANNER][CONTEXT][WARN] updateCampaignMemory failed (non-fatal):', error.message);
  } else {
    console.log(`[PLANNER][CONTEXT][INFO] Performance memory updated for campaign ${campaignId}`);
  }
}

// ---------------------------------------------------------------------------
// Read: single campaign context
// ---------------------------------------------------------------------------

/**
 * Fetches the full context record for a specific campaign.
 * Returns null if no record exists yet (campaign too new or context not saved).
 */
export async function getCampaignContext(
  campaignId: string
): Promise<CampaignContextRecord | null> {
  if (!campaignId) return null;

  const { data, error } = await supabase
    .from('campaign_context')
    .select(
      'campaign_id, company_id, account_context, validation, paid_recommendation, context_created_at, performance_insights, memory_updated_at'
    )
    .eq('campaign_id', campaignId)
    .single();

  if (error) {
    // PGRST116 = no rows — expected for campaigns without context yet
    if (error.code !== 'PGRST116') {
      console.warn('[PLANNER][CONTEXT][WARN] getCampaignContext failed:', error.message);
    }
    return null;
  }

  return data as CampaignContextRecord;
}

// ---------------------------------------------------------------------------
// Read: previous campaign context for planning injection
// ---------------------------------------------------------------------------

/**
 * Fetches the most recently finalized campaign context for a company.
 * Used to seed a NEW campaign's planning prompt with learnings from the last.
 *
 * Excludes the campaign currently being planned (pass excludeCampaignId).
 * Returns null if no prior context exists — new company, first campaign.
 */
export async function getLatestCampaignContextForCompany(
  companyId: string,
  excludeCampaignId?: string | null
): Promise<PreviousCampaignContext | null> {
  if (!companyId) return null;

  let query = supabase
    .from('campaign_context')
    .select('validation, paid_recommendation, performance_insights, context_created_at')
    .eq('company_id', companyId)
    .not('context_created_at', 'is', null) // only rows with a proper snapshot
    .order('context_created_at', { ascending: false })
    .limit(1);

  if (excludeCampaignId) {
    query = query.neq('campaign_id', excludeCampaignId);
  }

  const { data, error } = await query.single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[PLANNER][CONTEXT][WARN] getLatestCampaignContextForCompany failed:', error.message);
    }
    return null;
  }

  if (!data) return null;

  return {
    validation: (data.validation as CampaignValidation | null) ?? null,
    paid_recommendation: (data.paid_recommendation as PaidRecommendation | null) ?? null,
    performance_insights: (data.performance_insights as PerformanceInsight | null) ?? null,
    captured_at: typeof data.context_created_at === 'string' ? data.context_created_at : null,
  };
}
