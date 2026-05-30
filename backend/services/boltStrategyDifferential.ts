/**
 * Sibling strategy differential service.
 *
 * When a user launches multiple BOLT strategies against the same
 * recommendation / opportunity (e.g. trying several format mixes
 * before settling on one), each becomes its own `bolt_execution_runs`
 * row. The failure investigation flagged this case: "one strategy
 * fails while others may succeed" — the failing one needs immediate
 * rejection AND a precise explanation of what differs from the
 * succeeding sibling.
 *
 * This service:
 *
 *   1. Computes a snapshot of THIS strategy's key dimensions
 *      (campaign_mode, content_formats, selected_platforms, theme id).
 *   2. Pulls recent sibling runs for the same company/recommendation.
 *   3. Compares — populates `differs_from_succeeded_sibling` with the
 *      set of fields that differ.
 *
 * Pure observability — never mutates anything, never throws. The
 * caller (HTTP handler) merges the result into the persisted strategy
 * snapshot so it appears on `bolt_failure_summary.strategy_snapshot`
 * for the operator to see in the failure detail drawer.
 *
 * Sibling lookup is scoped tightly to avoid leaking across tenants:
 *   - same company_id
 *   - same source_recommendation_id (if present) OR same
 *     source_opportunity_id (fallback)
 *   - within the last 24 hours
 */

import { supabase } from '../db/supabaseClient';

export interface DifferentialInput {
  companyId: string;
  recommendationId: string | null;
  opportunityId: string | null;
  campaignMode: string | null;
  contentFormats: string[];
  selectedPlatforms: string[];
  themeTitle: string | null;
  generatedCampaignId: string | null;
}

export interface SiblingDifferential {
  /** True iff at least one sibling was found in the lookup window. */
  has_siblings: boolean;
  /** Total sibling rows examined. */
  sibling_count: number;
  /** Sibling that succeeded most recently, if any. */
  latest_succeeded_sibling_run_id: string | null;
  /** Fields that differ from the latest succeeded sibling. */
  differs_from_succeeded_sibling: string[];
  /** Fields that differ from a sibling that FAILED. */
  differs_from_failed_sibling: string[];
  /** Snapshot of THIS strategy's compared dimensions — useful for the diff display. */
  this_strategy: {
    campaign_mode: string | null;
    content_formats: string[];
    selected_platforms: string[];
    theme_title: string | null;
  };
}

interface SiblingRow {
  id: string;
  status: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function diffStringSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const sa = new Set(a.map((s) => s.toLowerCase()));
  for (const v of b) if (!sa.has(v.toLowerCase())) return true;
  return false;
}

function getSiblingDimensions(row: SiblingRow): {
  campaign_mode: string | null;
  content_formats: string[];
  selected_platforms: string[];
  theme_title: string | null;
} {
  const payload = row.payload ?? {};
  const ec = (payload as { executionConfig?: Record<string, unknown> }).executionConfig ?? null;
  const theme = (payload as { sourceStrategicTheme?: Record<string, unknown> }).sourceStrategicTheme ?? null;
  return {
    campaign_mode: ec && typeof ec.campaign_mode === 'string' ? ec.campaign_mode.toLowerCase() : null,
    content_formats: ec && Array.isArray(ec.content_formats)
      ? (ec.content_formats as unknown[]).map((v) => String(v)).filter(Boolean)
      : [],
    selected_platforms: ec && Array.isArray(ec.selected_platforms)
      ? (ec.selected_platforms as unknown[]).map((v) => String(v).toLowerCase()).filter(Boolean)
      : [],
    theme_title: theme && typeof theme === 'object'
      ? (typeof (theme as { title?: unknown }).title === 'string'
          ? ((theme as { title: string }).title)
          : (typeof (theme as { polished_title?: unknown }).polished_title === 'string'
              ? ((theme as { polished_title: string }).polished_title)
              : null))
      : null,
  };
}

function diffAgainst(
  input: DifferentialInput,
  sibling: SiblingRow
): string[] {
  const them = getSiblingDimensions(sibling);
  const diffs: string[] = [];
  if ((them.campaign_mode ?? null) !== (input.campaignMode ?? null)) diffs.push('campaign_mode');
  if (diffStringSets(them.content_formats, input.contentFormats)) diffs.push('content_formats');
  if (diffStringSets(them.selected_platforms, input.selectedPlatforms)) diffs.push('selected_platforms');
  if ((them.theme_title ?? null) !== (input.themeTitle ?? null)) diffs.push('strategic_theme');
  return diffs;
}

export async function computeSiblingDifferential(input: DifferentialInput): Promise<SiblingDifferential | null> {
  const baseline: SiblingDifferential = {
    has_siblings: false,
    sibling_count: 0,
    latest_succeeded_sibling_run_id: null,
    differs_from_succeeded_sibling: [],
    differs_from_failed_sibling: [],
    this_strategy: {
      campaign_mode: input.campaignMode ?? null,
      content_formats: input.contentFormats,
      selected_platforms: input.selectedPlatforms,
      theme_title: input.themeTitle ?? null,
    },
  };

  // Sibling lookup needs at least one shared identifier to scope to.
  // Without recId / opportunityId we can't distinguish "siblings"
  // from "any other run for this company".
  if (!input.recommendationId && !input.opportunityId && !input.generatedCampaignId) {
    return baseline;
  }

  try {
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let query = supabase
      .from('bolt_execution_runs')
      .select('id, status, payload, created_at')
      .eq('company_id', input.companyId)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(20);

    // Filter to runs that share recId OR opportunityId OR campaignId.
    // We can't compose three OR conditions cleanly via supabase-js
    // builder, so we pull and filter in-process.
    const { data, error } = await query;
    if (error || !data) return baseline;

    const siblings: SiblingRow[] = (data as SiblingRow[]).filter((r) => {
      const payload = r.payload ?? {};
      const rRec = (payload as { recId?: unknown }).recId;
      const rOpp = (payload as { sourceOpportunityId?: unknown }).sourceOpportunityId;
      const rCamp = (payload as { generatedCampaignId?: unknown }).generatedCampaignId;
      return (
        (input.recommendationId && rRec === input.recommendationId) ||
        (input.opportunityId && rOpp === input.opportunityId) ||
        (input.generatedCampaignId && rCamp === input.generatedCampaignId)
      );
    });

    if (siblings.length === 0) return baseline;

    baseline.has_siblings = true;
    baseline.sibling_count = siblings.length;

    const succeeded = siblings.find((s) => s.status === 'completed');
    if (succeeded) {
      baseline.latest_succeeded_sibling_run_id = succeeded.id;
      baseline.differs_from_succeeded_sibling = diffAgainst(input, succeeded);
    }
    const failed = siblings.find((s) => s.status === 'failed');
    if (failed) {
      baseline.differs_from_failed_sibling = diffAgainst(input, failed);
    }
    return baseline;
  } catch {
    return baseline;
  }
}
