/**
 * Strategic Memory Service
 *
 * Temporal layer: week-indexed snapshots of metrics + insights for trend analysis.
 * Manual/safe-call only. No auto-run on publish. No planner or strategy mutation.
 */

import { supabase } from '../db/supabaseClient';
import { getLatestStrategicFeedback } from './strategicFeedbackService';
import { getWeeklyStrategyIntelligence } from './weeklyStrategyIntelligenceService';
import { getStrategyAwareness } from './strategyAwarenessService';
import { getUnifiedCampaignBlueprint } from './campaignBlueprintService';

export type StrategicMemorySnapshot = {
  id: string;
  campaign_id: string;
  week_index: number;
  metrics_summary: {
    avg_comments_per_post: number;
    total_comments: number;
    high_priority_actions: number;
    intelligence_level: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  insights_summary: {
    strategic_insights: string[];
    awareness_level: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  created_at: string;
};

export type StrategicMemoryTrend = {
  trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
  summary: string[];
};

const INTELLIGENCE_ORDINAL: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function resolveCurrentWeekIndex(campaignId: string, blueprint: { weeks?: { week_number: number }[] } | null): number {
  if (blueprint?.weeks?.length) {
    const numbers = blueprint.weeks.map((w) => w.week_number).filter((n) => typeof n === 'number');
    if (numbers.length > 0) return Math.max(...numbers);
  }
  return 1;
}

/**
 * Generate and store one strategic memory snapshot for the campaign.
 * week_index is derived from blueprint (last week number, or 1 if no blueprint).
 * Safe to call manually; do not auto-run on every publish.
 */
export async function generateStrategicMemorySnapshot(campaign_id: string): Promise<StrategicMemorySnapshot | null> {
  const [feedback, intelligence, awareness, blueprint] = await Promise.all([
    getLatestStrategicFeedback(campaign_id),
    getWeeklyStrategyIntelligence(campaign_id),
    getStrategyAwareness(campaign_id),
    getUnifiedCampaignBlueprint(campaign_id),
  ]);

  const week_index = resolveCurrentWeekIndex(campaign_id, blueprint);

  const metrics_summary = {
    avg_comments_per_post: feedback?.metrics?.avg_comments_per_post ?? intelligence.engagement_summary.avg_comments_per_post ?? 0,
    total_comments: feedback?.metrics?.total_comments ?? intelligence.engagement_summary.total_comments ?? 0,
    high_priority_actions: intelligence.ai_pressure.high_priority_actions ?? 0,
    intelligence_level: intelligence.intelligence_level,
  };

  const insights_summary = {
    strategic_insights: intelligence.strategic_insights ?? [],
    awareness_level: awareness.awareness_level,
  };

  const { data: row, error } = await supabase
    .from('strategic_memory_snapshots')
    .insert({
      campaign_id,
      week_index,
      metrics_summary,
      insights_summary,
      created_at: new Date().toISOString(),
    })
    .select('id, campaign_id, week_index, metrics_summary, insights_summary, created_at')
    .single();

  if (error) {
    console.warn('[strategicMemory] insert failed', error.message);
    return null;
  }

  return row as StrategicMemorySnapshot;
}

/**
 * Load last N snapshots for a campaign (newest first in DB; we reverse for trend).
 */
export async function getLastStrategicMemorySnapshots(
  campaign_id: string,
  limit: number = 3
): Promise<StrategicMemorySnapshot[]> {
  const { data, error } = await supabase
    .from('strategic_memory_snapshots')
    .select('id, campaign_id, week_index, metrics_summary, insights_summary, created_at')
    .eq('campaign_id', campaign_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  const list = (data ?? []) as StrategicMemorySnapshot[];
  return list.reverse();
}

/**
 * Compute trend from last 3 snapshots.
 * comments increasing 2 consecutive weeks → IMPROVING; decreasing → DECLINING; else STABLE.
 */
export async function getStrategicMemoryTrend(campaign_id: string): Promise<StrategicMemoryTrend> {
  const snapshots = await getLastStrategicMemorySnapshots(campaign_id, 3);
  const summary: string[] = [];

  if (snapshots.length < 2) {
    return { trend: 'STABLE', summary: ['Insufficient snapshots for trend.'] };
  }

  const comments = snapshots.map((s) => (s.metrics_summary?.total_comments ?? 0) as number);
  const pressure = snapshots.map((s) => (s.metrics_summary?.high_priority_actions ?? 0) as number);
  const levels = snapshots.map((s) => (s.metrics_summary?.intelligence_level ?? 'LOW') as string);

  let trend: 'IMPROVING' | 'DECLINING' | 'STABLE' = 'STABLE';

  const commentsIncreasing =
    comments.length >= 3 && comments[1] > comments[0] && comments[2] > comments[1];
  const commentsDecreasing =
    comments.length >= 3 && comments[1] < comments[0] && comments[2] < comments[1];

  if (commentsIncreasing) {
    trend = 'IMPROVING';
    summary.push('Comments increased over the last two periods.');
  } else if (commentsDecreasing) {
    trend = 'DECLINING';
    summary.push('Comments decreased over the last two periods.');
  } else {
    summary.push('Engagement trend stable.');
  }

  const commentsDelta = comments.length >= 2 ? comments[comments.length - 1] - comments[0] : 0;
  const pressureDelta = pressure.length >= 2 ? pressure[pressure.length - 1] - pressure[0] : 0;
  const lastOrd = INTELLIGENCE_ORDINAL[levels[levels.length - 1]] ?? 0;
  const firstOrd = INTELLIGENCE_ORDINAL[levels[0]] ?? 0;
  const intelligenceShift = lastOrd - firstOrd;

  if (commentsDelta !== 0) summary.push(`Comments delta: ${commentsDelta >= 0 ? '+' : ''}${commentsDelta}`);
  if (pressureDelta !== 0) summary.push(`Priority pressure delta: ${pressureDelta >= 0 ? '+' : ''}${pressureDelta}`);
  if (intelligenceShift !== 0) summary.push(`Intelligence shift: ${intelligenceShift >= 0 ? '+' : ''}${intelligenceShift}`);

  return { trend, summary };
}

/**
 * Get latest snapshot for campaign (by created_at).
 */
export async function getCurrentStrategicMemorySnapshot(
  campaign_id: string
): Promise<StrategicMemorySnapshot | null> {
  const { data, error } = await supabase
    .from('strategic_memory_snapshots')
    .select('id, campaign_id, week_index, metrics_summary, insights_summary, created_at')
    .eq('campaign_id', campaign_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as StrategicMemorySnapshot;
}
