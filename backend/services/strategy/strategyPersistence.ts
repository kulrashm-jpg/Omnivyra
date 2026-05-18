/**
 * strategyPersistence — Phase-2 Step-5.
 *
 * Additive, no schema change, no hard migration: the canonical strategy is
 * stored inside the EXISTING campaign_versions.campaign_snapshot under the
 * `canonical_strategy` key. Each campaign_versions row is already an
 * immutable snapshot, so version history comes for free; the latest row's
 * canonical_strategy is the active strategy.
 *
 * Never throws — strategy is additive enrichment, never blocks a flow.
 */

import { supabase } from '../../db/supabaseClient';
import type { CampaignStrategy } from '../../types/strategy/CampaignStrategy';

interface VersionRow {
  id: string;
  campaign_id: string;
  campaign_snapshot: Record<string, unknown> | null;
  created_at: string;
}

async function fetchVersions(campaignId: string): Promise<VersionRow[]> {
  try {
    const { data } = await supabase
      .from('campaign_versions')
      .select('id, campaign_id, campaign_snapshot, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });
    return (data ?? []) as VersionRow[];
  } catch {
    return [];
  }
}

function readStrategy(snapshot: Record<string, unknown> | null): CampaignStrategy | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = (snapshot as Record<string, unknown>).canonical_strategy;
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as CampaignStrategy) : null;
}

/** Active = canonical_strategy on the most recent campaign_versions row. */
export async function loadActiveStrategy(campaignId: string): Promise<CampaignStrategy | null> {
  const rows = await fetchVersions(campaignId);
  for (const r of rows) {
    const s = readStrategy(r.campaign_snapshot);
    if (s) return s;
  }
  return null;
}

/** Immutable snapshots — every version row that carried a canonical strategy. */
export async function loadStrategyHistory(campaignId: string): Promise<CampaignStrategy[]> {
  const rows = await fetchVersions(campaignId);
  const out: CampaignStrategy[] = [];
  for (const r of rows) {
    const s = readStrategy(r.campaign_snapshot);
    if (s) out.push(s);
  }
  return out;
}

export async function countStrategyVersions(campaignId: string): Promise<number> {
  return (await loadStrategyHistory(campaignId)).length;
}

/**
 * Persist additively onto the LATEST campaign_versions row's snapshot under
 * `canonical_strategy` (merge — never clobbers other snapshot keys). If no
 * version row exists yet, returns {persisted:false} (caller still gets the
 * in-memory canonical object — compatibility-first).
 */
export async function saveStrategySnapshot(
  campaignId: string,
  strategy: CampaignStrategy,
): Promise<{ persisted: boolean; reason?: string }> {
  try {
    const rows = await fetchVersions(campaignId);
    const latest = rows[0];
    if (!latest) return { persisted: false, reason: 'no_version_row' };
    const snapshot = (latest.campaign_snapshot && typeof latest.campaign_snapshot === 'object'
      ? latest.campaign_snapshot
      : {}) as Record<string, unknown>;
    const merged = { ...snapshot, canonical_strategy: strategy };
    const { error } = await supabase
      .from('campaign_versions')
      .update({ campaign_snapshot: merged })
      .eq('id', latest.id);
    return error ? { persisted: false, reason: error.message } : { persisted: true };
  } catch (e) {
    return { persisted: false, reason: (e as Error)?.message ?? 'persist_exception' };
  }
}

/** Hydration fallback: planner planning_context inside campaign_versions snapshot. */
export async function loadPlanningContextSnapshot(
  campaignId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await fetchVersions(campaignId);
  for (const r of rows) {
    const snap = r.campaign_snapshot as Record<string, unknown> | null;
    const pc = snap?.planning_context;
    if (pc && typeof pc === 'object' && !Array.isArray(pc)) return pc as Record<string, unknown>;
  }
  return null;
}
