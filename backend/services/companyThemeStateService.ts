/**
 * Company Theme State Service
 * Tracks strategic theme lifecycle per company.
 * AVAILABLE = may appear in recommendations
 * IN_USE = campaign created from theme
 * CONSUMED = campaign completed, never show again
 * DISMISSED = user dismissed
 */

import { supabase } from '../db/supabaseClient';
import { generateThemeKey } from './themeKeyService';

function normalizeThemeTopic(topic: string): string {
  return String(topic ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mark theme as CONSUMED when campaign completes successfully.
 * Call from campaign completion flow.
 */
export async function markThemeConsumedForCampaign(campaignId: string): Promise<void> {
  if (!campaignId?.trim()) return;
  try {
    const { data: existing, error: selectError } = await supabase
      .from('company_theme_state')
      .select('id, company_id, theme_topic')
      .eq('campaign_id', campaignId);

    if (selectError) {
      console.warn('companyThemeStateService: select failed', selectError);
      return;
    }

    const rows = (existing ?? []) as Array<{ id: string; company_id: string; theme_topic: string }>;
    const now = new Date().toISOString();

    if (rows.length > 0) {
      const { error: updateError } = await supabase
        .from('company_theme_state')
        .update({ state: 'CONSUMED', updated_at: now })
        .eq('campaign_id', campaignId);
      if (updateError) {
        console.warn('companyThemeStateService: update CONSUMED failed', updateError);
      }
      return;
    }

    const { data: cv, error: cvError } = await supabase
      .from('campaign_versions')
      .select('company_id, campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cvError || !cv) return;

    const companyId = (cv as { company_id?: string }).company_id;
    const snapshot = (cv as { campaign_snapshot?: Record<string, unknown> }).campaign_snapshot;
    const theme = snapshot?.source_strategic_theme as
      | { topic?: string; title?: string; polished_title?: string; themes?: string[] }
      | null
      | undefined;

    if (!companyId || !theme) return;

    const topic =
      (theme.topic ?? theme.title ?? theme.polished_title ?? '') ||
      (Array.isArray(theme.themes) && theme.themes[0] ? theme.themes[0] : '');
    const themeTopic = normalizeThemeTopic(topic);
    if (!themeTopic) return;

    const themeKey = generateThemeKey(themeTopic);
    const { error: upsertError } = await supabase
      .from('company_theme_state')
      .upsert(
        {
          company_id: companyId,
          theme_topic: themeTopic,
          theme_key: themeKey,
          campaign_id: campaignId,
          state: 'CONSUMED',
          updated_at: now,
        },
        { onConflict: 'company_id,theme_topic' }
      );

    if (upsertError) {
      console.warn('companyThemeStateService: upsert CONSUMED failed', upsertError);
    }
  } catch (err) {
    console.warn('companyThemeStateService: markThemeConsumedForCampaign failed', err);
  }
}

/**
 * Get theme keys that must be excluded from recommendations for a company.
 * Returns theme_key values where state is IN_USE, CONSUMED, or DISMISSED.
 */
export async function getExcludedThemeTopicsForCompany(companyId: string): Promise<Set<string>> {
  if (!companyId?.trim()) return new Set();
  try {
    const { data, error } = await supabase
      .from('company_theme_state')
      .select('theme_key')
      .eq('company_id', companyId)
      .in('state', ['IN_USE', 'CONSUMED', 'DISMISSED']);

    if (error) {
      console.warn('companyThemeStateService: getExcludedThemeTopics failed', error);
      return new Set();
    }

    const keys = (data ?? []).map((r: { theme_key: string }) => String(r.theme_key ?? '').trim()).filter(Boolean);
    return new Set(keys);
  } catch {
    return new Set();
  }
}

/**
 * Insert or update IN_USE when campaign is created from a strategic theme.
 * Call from campaign creation / source-recommendation flow.
 */
export async function markThemeInUse(
  companyId: string,
  campaignId: string,
  themeTopic: string
): Promise<void> {
  if (!companyId?.trim() || !campaignId?.trim() || !themeTopic?.trim()) return;
  const normalized = normalizeThemeTopic(themeTopic);
  if (!normalized) return;
  const themeKey = generateThemeKey(themeTopic);
  try {
    await supabase.from('company_theme_state').upsert(
      {
        company_id: companyId,
        theme_topic: normalized,
        theme_key: themeKey,
        campaign_id: campaignId,
        state: 'IN_USE',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,theme_topic' }
    );
  } catch (err) {
    console.warn('companyThemeStateService: markThemeInUse failed', err);
  }
}

/**
 * Release IN_USE when campaign is deleted (theme becomes AVAILABLE again).
 */
export async function releaseThemeFromCampaign(campaignId: string): Promise<void> {
  if (!campaignId?.trim()) return;
  try {
    const { error } = await supabase
      .from('company_theme_state')
      .update({ campaign_id: null, state: 'AVAILABLE', updated_at: new Date().toISOString() })
      .eq('campaign_id', campaignId);

    if (error) {
      console.warn('companyThemeStateService: releaseThemeFromCampaign failed', error);
    }
  } catch (err) {
    console.warn('companyThemeStateService: releaseThemeFromCampaign failed', err);
  }
}
