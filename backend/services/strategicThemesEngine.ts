/**
 * Strategic Themes Engine
 * Phase 4: Groups opportunities into persistent themes.
 * Example themes: AI adoption, creator economy growth, customer automation demand
 */

import { supabase } from '../db/supabaseClient';
import type { Opportunity } from './opportunityDetectionEngine';
import type { CompanyIntelligenceInsights } from './companyIntelligenceAggregator';

export type StrategicTheme = {
  theme_id: string;
  theme_topic: string;
  theme_strength: number;
  supporting_signals: Array<{ signal_id: string; topic: string | null }>;
};

function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 4)
    .join(' ');
}

/**
 * Group opportunities and clusters into themes.
 */
export function groupOpportunitiesIntoThemes(
  opportunities: Opportunity[],
  insights: CompanyIntelligenceInsights
): Array<{ theme_topic: string; theme_strength: number; supporting_signals: Array<{ signal_id: string; topic: string | null }> }> {
  const themeMap = new Map<
    string,
    { strength: number; signals: Array<{ signal_id: string; topic: string | null }> }
  >();

  for (const opp of opportunities) {
    const topic = (opp.summary ?? '').replace(/^(Emerging trend|Market shift|Customer pain|Competitor weakness).*:\s*/i, '').trim();
    if (!topic || topic.length < 3) continue;
    const key = normalizeTopic(topic);
    if (!key) continue;
    const existing = themeMap.get(key) ?? { strength: 0, signals: [] };
    existing.strength += opp.opportunity_score;
    for (const s of opp.supporting_signals) {
      if (!existing.signals.some((x) => x.signal_id === s.signal_id)) {
        existing.signals.push({ signal_id: s.signal_id, topic: s.topic ?? null });
      }
    }
    themeMap.set(key, existing);
  }

  for (const cluster of insights.trend_clusters) {
    const topic = (cluster.topic ?? '').trim();
    if (!topic || cluster.signal_count < 2) continue;
    const key = normalizeTopic(topic);
    if (!key) continue;
    const existing = themeMap.get(key) ?? { strength: 0, signals: [] };
    existing.strength += cluster.avg_relevance * cluster.signal_count * 0.1;
    for (const s of cluster.top_signals) {
      if (!existing.signals.some((x) => x.signal_id === s.signal_id)) {
        existing.signals.push({ signal_id: s.signal_id, topic: s.topic });
      }
    }
    themeMap.set(key, existing);
  }

  return Array.from(themeMap.entries()).map(([key, data]) => ({
    theme_topic: key,
    theme_strength: Math.min(1, data.strength / 3),
    supporting_signals: data.signals.slice(0, 10),
  }));
}

/**
 * Persist themes and return with theme_id.
 */
export async function persistThemes(
  companyId: string,
  themes: Array<{ theme_topic: string; theme_strength: number; supporting_signals: Array<{ signal_id: string; topic: string | null }> }>
): Promise<StrategicTheme[]> {
  if (themes.length === 0) return [];

  const rows = themes.map((t) => ({
    company_id: companyId,
    theme_topic: t.theme_topic,
    theme_strength: t.theme_strength,
    supporting_signals: t.supporting_signals,
  }));

  const { data, error } = await supabase
    .from('company_strategic_themes')
    .insert(rows)
    .select('id, theme_topic, theme_strength, supporting_signals');

  if (error) throw new Error(`company_strategic_themes insert failed: ${error.message}`);

  const raw = (data ?? []) as Array<{
    id: string;
    theme_topic: string;
    theme_strength: number | null;
    supporting_signals: Array<{ signal_id: string; topic: string | null }> | null;
  }>;

  return raw.map((r) => ({
    theme_id: r.id,
    theme_topic: r.theme_topic,
    theme_strength: r.theme_strength ?? 0,
    supporting_signals: (r.supporting_signals ?? []) as Array<{ signal_id: string; topic: string | null }>,
  }));
}
