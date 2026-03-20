/**
 * Learning Decay Service — Step 5
 *
 * Applies time-based decay to campaign_learnings so recent wins are weighted
 * higher and stale patterns fade. Reinforcement re-lifts decayed patterns
 * when they prove effective again.
 *
 * Decay formula: decay_factor = e^(-λ × age_days)
 *   λ = 0.02 → half-life ≈ 35 days
 *   At 90 days: factor ≈ 0.16 (mostly decayed)
 *   At 180 days: factor ≈ 0.03 (nearly gone)
 *
 * Effective score = engagement_impact × confidence × decay_factor + reinforcement_score
 *
 * Run: daily cron or after each campaign distillation.
 */

import { supabase } from '../db/supabaseClient';

const DECAY_LAMBDA = 0.02;   // decay rate constant
const PRUNE_THRESHOLD = 0.05; // remove learnings with effective score below this

export type DecayRunResult = {
  updated: number;
  pruned: number;
  errors: string[];
};

/** Compute decay factor for a learning based on its age. */
function computeDecayFactor(updatedAt: string): number {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86400_000;
  return parseFloat(Math.exp(-DECAY_LAMBDA * ageDays).toFixed(4));
}

/** Effective score = abs(impact) × confidence × decay + reinforcement */
export function computeEffectiveScore(
  engagementImpact: number,
  confidence: number,
  decayFactor: number,
  reinforcementScore: number,
): number {
  return parseFloat((Math.abs(engagementImpact) * confidence * decayFactor + reinforcementScore).toFixed(4));
}

/**
 * Reinforce a learning pattern — called when a pattern proves effective again.
 * Lifts decay_factor back toward 1.0 and increments reinforcement_score.
 */
export async function reinforceLearning(learningId: string, impactBoost: number = 0.1): Promise<void> {
  const { data } = await supabase
    .from('campaign_learnings')
    .select('decay_factor, reinforcement_score, times_reinforced')
    .eq('id', learningId)
    .maybeSingle();

  if (!data) return;

  const d = data as { decay_factor: number; reinforcement_score: number; times_reinforced: number };
  const newDecay = Math.min(1.0, d.decay_factor + 0.3); // partial lift
  const newReinforcement = parseFloat(Math.min(1.0, d.reinforcement_score + impactBoost).toFixed(4));

  await supabase.from('campaign_learnings').update({
    decay_factor:         newDecay,
    reinforcement_score:  newReinforcement,
    times_reinforced:     d.times_reinforced + 1,
    last_reinforced_at:   new Date().toISOString(),
    updated_at:           new Date().toISOString(),
  }).eq('id', learningId);
}

/**
 * Run decay pass over all campaign_learnings.
 * Updates decay_factor for every row. Prunes entries with negligible effective score.
 * Called by daily cron.
 */
export async function runLearningDecay(companyId?: string): Promise<DecayRunResult> {
  const result: DecayRunResult = { updated: 0, pruned: 0, errors: [] };

  try {
    let query = supabase
      .from('campaign_learnings')
      .select('id, engagement_impact, confidence, updated_at, decay_factor, reinforcement_score');

    if (companyId) query = (query as any).eq('company_id', companyId);

    const { data: learnings } = await query;
    if (!learnings?.length) return result;

    for (const row of learnings as Array<{
      id: string;
      engagement_impact: number;
      confidence: number;
      updated_at: string;
      decay_factor: number;
      reinforcement_score: number;
    }>) {
      try {
        const newDecay = computeDecayFactor(row.updated_at);
        const effectiveScore = computeEffectiveScore(
          row.engagement_impact,
          row.confidence,
          newDecay,
          row.reinforcement_score,
        );

        if (effectiveScore < PRUNE_THRESHOLD && row.reinforcement_score < 0.1) {
          // Pattern too stale and never reinforced — remove
          await supabase.from('campaign_learnings').delete().eq('id', row.id);
          result.pruned++;
        } else {
          await supabase.from('campaign_learnings')
            .update({ decay_factor: newDecay })
            .eq('id', row.id);
          result.updated++;
        }
      } catch (err) {
        result.errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    result.errors.push(`Decay run failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Get learnings sorted by effective score (decay-adjusted).
 * Replaces simple confidence ordering for high-quality ranking.
 */
export async function getEffectiveLearnings(
  companyId: string,
  options: { limit?: number; learning_type?: string; platform?: string } = {}
): Promise<Array<{
  id: string;
  pattern: string;
  learning_type: string;
  platform: string | null;
  content_type: string | null;
  engagement_impact: number;
  effective_score: number;
  times_reinforced: number;
}>> {
  let query = supabase
    .from('campaign_learnings')
    .select('id, pattern, learning_type, platform, content_type, engagement_impact, confidence, decay_factor, reinforcement_score, times_reinforced')
    .eq('company_id', companyId);

  if (options.learning_type) query = query.eq('learning_type', options.learning_type);
  if (options.platform)      query = query.eq('platform', options.platform);

  const { data } = await query.limit((options.limit ?? 20) * 3); // fetch extra for sorting

  if (!data) return [];

  return (data as Array<{
    id: string;
    pattern: string;
    learning_type: string;
    platform: string | null;
    content_type: string | null;
    engagement_impact: number;
    confidence: number;
    decay_factor: number;
    reinforcement_score: number;
    times_reinforced: number;
  }>)
    .map(row => ({
      ...row,
      effective_score: computeEffectiveScore(row.engagement_impact, row.confidence, row.decay_factor, row.reinforcement_score),
    }))
    .sort((a, b) => b.effective_score - a.effective_score)
    .slice(0, options.limit ?? 20);
}
