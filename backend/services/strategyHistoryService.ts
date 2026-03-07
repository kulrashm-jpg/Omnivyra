import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';

export type StrategyMomentum = {
  dominant_streak_aspect: string | null;
  dominant_streak_count: number;
  diversification_score: number;
};

export type StrategyHistoryResult = {
  campaigns_count: number;
  aspect_counts: Record<string, number>;
  intent_tag_counts: Record<string, number>;
  dominant_aspects: string[];
  underused_aspects: string[];
  strategy_momentum: StrategyMomentum | null;
};

const EMPTY_MOMENTUM: StrategyMomentum = {
  dominant_streak_aspect: null,
  dominant_streak_count: 0,
  diversification_score: 0,
};

const EMPTY: StrategyHistoryResult = {
  campaigns_count: 0,
  aspect_counts: {},
  intent_tag_counts: {},
  dominant_aspects: [],
  underused_aspects: [],
  strategy_momentum: null,
};

/**
 * Load strategy history for a company (campaigns created from recommendations, aspect usage).
 * Used by strategy-history API and by generate flow to attach strategy_memory context.
 */
export async function getStrategyHistoryForCompany(
  companyId: string
): Promise<StrategyHistoryResult> {
  if (!companyId?.trim()) return EMPTY;

  const { data: versionRows, error: versionError } = await supabase
    .from('campaign_versions')
    .select('campaign_snapshot, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });

  if (versionError) return EMPTY;
  if (!versionRows?.length) return { ...EMPTY, campaigns_count: 0 };

  const campaigns_count = versionRows.length;
  const recommendationIdsInOrder: string[] = [];
  for (const row of versionRows as { campaign_snapshot?: unknown; created_at?: string }[]) {
    const snap = (row?.campaign_snapshot ?? {}) as {
      source_recommendation_id?: string | null;
      metadata?: { recommendation_id?: string | null };
    };
    const id =
      typeof snap.source_recommendation_id === 'string'
        ? snap.source_recommendation_id.trim()
        : typeof snap.metadata?.recommendation_id === 'string'
          ? snap.metadata.recommendation_id.trim()
          : '';
    recommendationIdsInOrder.push(id || '');
  }
  const uniqueIds = [...new Set(recommendationIdsInOrder)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return { ...EMPTY, campaigns_count, strategy_momentum: null };
  }

  const { data: snapshotRows, error: snapError } = await supabase
    .from('recommendation_snapshots')
    .select('id, trend_topic, category')
    .in('id', uniqueIds);

  if (snapError || !snapshotRows?.length) {
    return { ...EMPTY, campaigns_count, strategy_momentum: null };
  }

  const idToAspect = new Map<string, string>();
  for (const row of snapshotRows as { id?: string; trend_topic?: string | null; category?: string | null }[]) {
    const aspectKey =
      typeof row.category === 'string' && row.category.trim()
        ? row.category.trim()
        : typeof row.trend_topic === 'string' && row.trend_topic.trim()
          ? row.trend_topic.trim().slice(0, 80)
          : 'General';
    if (row.id) idToAspect.set(String(row.id), aspectKey);
  }

  const aspect_counts: Record<string, number> = {};
  const aspectsInOrder: string[] = [];
  for (const recId of recommendationIdsInOrder) {
    if (!recId) continue;
    const aspect = idToAspect.get(recId) ?? 'General';
    aspectsInOrder.push(aspect);
    aspect_counts[aspect] = (aspect_counts[aspect] ?? 0) + 1;
  }

  const sortedAspects = Object.entries(aspect_counts)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
  const dominant_aspects = sortedAspects.slice(0, 2);

  let strategic_aspects: string[] = [];
  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
    const inputs = (profile as { strategic_inputs?: { strategic_aspects?: string[] } })?.strategic_inputs;
    if (Array.isArray(inputs?.strategic_aspects) && inputs.strategic_aspects.length > 0) {
      strategic_aspects = inputs.strategic_aspects;
    }
  } catch {
    // optional
  }
  const underused_aspects = strategic_aspects.filter((a) => (aspect_counts[a] ?? 0) === 0);

  let strategy_momentum: StrategyMomentum | null = null;
  if (campaigns_count >= 2 && aspectsInOrder.length >= 2) {
    const uniqueAspectsUsed = new Set(aspectsInOrder).size;
    const diversification_score =
      campaigns_count > 0 ? Math.min(1, uniqueAspectsUsed / campaigns_count) : 0;
    const mostRecentAspect = aspectsInOrder[aspectsInOrder.length - 1];
    let dominant_streak_count = 0;
    for (let i = aspectsInOrder.length - 1; i >= 0 && aspectsInOrder[i] === mostRecentAspect; i--) {
      dominant_streak_count++;
    }
    strategy_momentum = {
      dominant_streak_aspect: mostRecentAspect || null,
      dominant_streak_count,
      diversification_score,
    };
  }

  return {
    campaigns_count,
    aspect_counts,
    intent_tag_counts: {},
    dominant_aspects,
    underused_aspects,
    strategy_momentum,
  };
}
