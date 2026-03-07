/**
 * Theme Originality Guard
 *
 * Prevents campaigns from repeating themes used in recent company campaigns.
 * Loads last N themes from twelve_week_plan + campaign_versions, checks similarity.
 */

import { supabase } from '../db/supabaseClient';
import { computeTextSimilarity } from './themeDiversityGuard';

export const DEFAULT_RECENT_THEMES_LIMIT = 50;
export const DEFAULT_ORIGINALITY_THRESHOLD = 0.75;

/**
 * Load recent themes for a company from twelve_week_plan and campaign_versions.
 * Extracts phase_label, theme, topics from blueprint.weeks and campaign_snapshot.weekly_plan.
 */
export async function loadRecentCompanyThemes(
  companyId: string,
  limit = DEFAULT_RECENT_THEMES_LIMIT
): Promise<string[]> {
  const themes: string[] = [];
  const seen = new Set<string>();

  function addTheme(t: string) {
    const normalized = t?.trim();
    if (normalized && normalized.length > 2 && !seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      themes.push(normalized);
    }
  }

  try {
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId)
      .limit(200);

    const campaignIds = (campaigns ?? []).map((c: { id: string }) => c.id);
    if (campaignIds.length === 0) {
      const { data: cvRows } = await supabase
        .from('campaign_versions')
        .select('campaign_snapshot')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(30);
      (cvRows ?? []).forEach((row: { campaign_snapshot?: { weekly_plan?: Array<{ theme?: string; topics?: string[] }> } }) => {
        const wp = row.campaign_snapshot?.weekly_plan ?? [];
        wp.forEach((w: { theme?: string; topics?: string[] }) => {
          if (w.theme) addTheme(w.theme);
          (w.topics ?? []).forEach((t) => addTheme(t));
        });
      });
      return themes.slice(0, limit);
    }

    const { data: planRows } = await supabase
      .from('twelve_week_plan')
      .select('blueprint')
      .in('campaign_id', campaignIds)
      .order('created_at', { ascending: false })
      .limit(50);

    (planRows ?? []).forEach((row: { blueprint?: { weeks?: Array<{ phase_label?: string; primary_objective?: string; topics?: Array<{ topicTitle?: string }>; topics_to_cover?: string[] }> } }) => {
      const weeks = row.blueprint?.weeks ?? [];
      weeks.forEach((w) => {
        if (w.phase_label) addTheme(w.phase_label);
        if (w.primary_objective) addTheme(w.primary_objective);
        (w.topics ?? []).forEach((t) => addTheme(typeof t === 'object' ? (t as { topicTitle?: string }).topicTitle : String(t)));
        (w.topics_to_cover ?? []).forEach((t) => addTheme(String(t)));
      });
    });

    if (themes.length < limit) {
      const { data: cvRows } = await supabase
        .from('campaign_versions')
        .select('campaign_snapshot')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(30);
      (cvRows ?? []).forEach((row: { campaign_snapshot?: { weekly_plan?: Array<{ theme?: string; topics?: string[] }> } }) => {
        const wp = row.campaign_snapshot?.weekly_plan ?? [];
        wp.forEach((w: { theme?: string; topics?: string[] }) => {
          if (w.theme) addTheme(w.theme);
          (w.topics ?? []).forEach((t) => addTheme(t));
        });
      });
    }

    return themes.slice(0, limit);
  } catch (err) {
    console.warn('[themeOriginalityGuard] Failed to load recent themes:', err);
    return [];
  }
}

/**
 * Check proposed themes against recent company themes.
 * Returns { hasOverlap, overlappingPairs, maxScore }.
 */
export function checkThemeOriginality(
  proposedThemes: string[],
  recentThemes: string[],
  threshold = DEFAULT_ORIGINALITY_THRESHOLD
): { hasOverlap: boolean; overlappingPairs: Array<{ proposed: string; recent: string; score: number }>; maxScore: number } {
  let maxScore = 0;
  const overlappingPairs: Array<{ proposed: string; recent: string; score: number }> = [];

  for (const proposed of proposedThemes) {
    const p = String(proposed ?? '').trim();
    if (!p) continue;
    for (const recent of recentThemes) {
      const r = String(recent ?? '').trim();
      if (!r) continue;
      const score = computeTextSimilarity(p, r);
      if (score > threshold) {
        overlappingPairs.push({ proposed: p, recent: r, score });
      }
      maxScore = Math.max(maxScore, score);
    }
  }

  return {
    hasOverlap: maxScore > threshold,
    overlappingPairs,
    maxScore,
  };
}
