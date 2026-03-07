/**
 * Theme Evolution Engine
 * Phase 6: Evolve themes from outcomes and feedback.
 * Safeguards: merge only if similarity >= 0.6; archive only if inactivity >= 30 days
 */

import { supabase } from '../db/supabaseClient';

export const MERGE_SIMILARITY_THRESHOLD = 0.6;
export const ARCHIVE_INACTIVITY_DAYS = 30;
export const OPTIMIZATION_FREQUENCY_MS = 6 * 60 * 60 * 1000;

export type ThemeEvolutionResult = {
  themes_updated: number;
  themes_merged: number;
  themes_archived: number;
  theme_updates: Array<{
    theme_id: string;
    theme_topic: string;
    action: 'strengthened' | 'weakened' | 'merged' | 'archived';
    new_strength?: number;
  }>;
};

/**
 * Simple word-based similarity (Jaccard-ish). Returns [0, 1].
 */
function topicSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

/**
 * Evolve themes: strengthen high-outcome, weaken low, merge similar, archive inactive.
 */
export async function evolveThemes(
  companyId: string
): Promise<ThemeEvolutionResult> {
  const result: ThemeEvolutionResult = {
    themes_updated: 0,
    themes_merged: 0,
    themes_archived: 0,
    theme_updates: [],
  };

  const { data: themes } = await supabase
    .from('company_strategic_themes')
    .select('id, theme_topic, theme_strength, created_at, archived_at')
    .eq('company_id', companyId)
    .is('archived_at', null);

  if (!themes || themes.length === 0) return result;

  const { data: outcomes } = await supabase
    .from('intelligence_outcomes')
    .select('success_score, created_at')
    .eq('company_id', companyId);

  const outcomeRate =
    outcomes && outcomes.length > 0
      ? (outcomes as Array<{ success_score: number | null }>).reduce((s, o) => s + (o.success_score ?? 0.5), 0) /
        outcomes.length
      : 0.5;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_INACTIVITY_DAYS);

  const rows = themes as Array<{
    id: string;
    theme_topic: string;
    theme_strength: number | null;
    created_at: string;
    archived_at: string | null;
  }>;

  const strengthDelta = (outcomeRate - 0.5) * 0.2;
  const clampedDelta = Math.max(-0.15, Math.min(0.15, strengthDelta));

  for (const t of rows) {
    const current = Math.max(0, Math.min(1, t.theme_strength ?? 0.5));
    const createdBeforeCutoff = new Date(t.created_at) < cutoff;

    if (createdBeforeCutoff && current < 0.25) {
      await supabase
        .from('company_strategic_themes')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', t.id);
      result.themes_archived++;
      result.theme_updates.push({ theme_id: t.id, theme_topic: t.theme_topic, action: 'archived' });
      continue;
    }

    const updated = Math.max(0, Math.min(1, current + clampedDelta));
    if (Math.abs(updated - current) > 0.001) {
      await supabase
        .from('company_strategic_themes')
        .update({ theme_strength: updated })
        .eq('id', t.id);
      result.themes_updated++;
      result.theme_updates.push({
        theme_id: t.id,
        theme_topic: t.theme_topic,
        action: clampedDelta > 0 ? 'strengthened' : 'weakened',
        new_strength: updated,
      });
    }
  }

  const activeThemes = rows.filter((t) => {
    const createdBeforeCutoff = new Date(t.created_at) < cutoff;
    const current = Math.max(0, Math.min(1, t.theme_strength ?? 0.5));
    return !(createdBeforeCutoff && current < 0.25);
  });

  for (let i = 0; i < activeThemes.length; i++) {
    for (let j = i + 1; j < activeThemes.length; j++) {
      const a = activeThemes[i];
      const b = activeThemes[j];
      const sim = topicSimilarity(a.theme_topic, b.theme_topic);
      if (sim >= MERGE_SIMILARITY_THRESHOLD) {
        const strengthA = a.theme_strength ?? 0.5;
        const strengthB = b.theme_strength ?? 0.5;
        const mergedStrength = Math.min(1, (strengthA + strengthB) / 2 + 0.1);
        await supabase
          .from('company_strategic_themes')
          .update({
            theme_topic: a.theme_topic.length >= b.theme_topic.length ? a.theme_topic : b.theme_topic,
            theme_strength: mergedStrength,
            supporting_signals: [],
          })
          .eq('id', a.id);
        await supabase
          .from('company_strategic_themes')
          .update({ archived_at: new Date().toISOString() })
          .eq('id', b.id);
        result.themes_merged++;
        result.theme_updates.push({
          theme_id: a.id,
          theme_topic: a.theme_topic,
          action: 'merged',
          new_strength: mergedStrength,
        });
        activeThemes.splice(j, 1);
        j--;
      }
    }
  }

  return result;
}
