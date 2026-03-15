/**
 * Insight Intelligence Service
 *
 * Generates engagement insights by comparing opportunity counts:
 * last 7 days vs previous 7 days. Stores evidence from real discussions.
 */

import { supabase } from '../db/supabaseClient';

const INSIGHT_TYPES = [
  { type: 'competitor_complaints_increase', oppType: 'competitor_complaint', label: 'Competitor complaints' },
  { type: 'buying_intent_detected', oppType: 'buying_intent', label: 'Buying intent' },
  { type: 'recommendation_trend', oppType: 'recommendation_request', label: 'Recommendation requests' },
  { type: 'problem_discussion_spike', oppType: 'problem_discussion', label: 'Problem discussions' },
] as const;

export type InsightWithEvidence = {
  id: string;
  insight_type: string;
  insight_title: string;
  insight_summary: string;
  metric_value: number;
  previous_value: number;
  change_percentage: number | null;
  evidence_count: number;
  evidence: Array<{
    thread_id: string;
    message_id: string;
    author_name: string | null;
    platform: string;
    text_snippet: string | null;
  }>;
  created_at: string | null;
};

async function countOpportunities(
  organizationId: string,
  oppType: string,
  start: string,
  end: string
): Promise<number> {
  const { count, error } = await supabase
    .from('engagement_opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('opportunity_type', oppType)
    .gte('detected_at', start)
    .lt('detected_at', end);

  if (error) return 0;
  return count ?? 0;
}

function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Generate insights for an organization. Compare last 7 vs previous 7 days.
 */
export async function generateInsights(organizationId: string): Promise<{
  created: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let created = 0;
  const now = new Date();
  const last7End = new Date(now);
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7End = last7Start;
  const prev7Start = new Date(prev7End.getTime() - 7 * 24 * 60 * 60 * 1000);

  const last7StartIso = last7Start.toISOString();
  const last7EndIso = last7End.toISOString();
  const prev7StartIso = prev7Start.toISOString();
  const prev7EndIso = prev7End.toISOString();

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('engagement_insights')
    .delete()
    .eq('organization_id', organizationId)
    .lt('created_at', sevenDaysAgo);

  for (const { type, oppType, label } of INSIGHT_TYPES) {
    try {
      const current = await countOpportunities(
        organizationId,
        oppType,
        last7StartIso,
        last7EndIso
      );
      const previous = await countOpportunities(
        organizationId,
        oppType,
        prev7StartIso,
        prev7EndIso
      );

      const change = changePercent(current, previous);
      const title =
        type === 'competitor_complaints_increase'
          ? `${label} ↑ ${change ?? 0}% this week`
          : type === 'buying_intent_detected'
            ? `${label} detected in ${current} discussions`
            : `${label} ↑ ${change ?? 0}% this week`;
      const summary = `Last 7 days: ${current}. Previous 7 days: ${previous}.`;

      const { data: opps } = await supabase
        .from('engagement_opportunities')
        .select('id, source_thread_id, source_message_id, platform')
        .eq('organization_id', organizationId)
        .eq('opportunity_type', oppType)
        .gte('detected_at', last7StartIso)
        .lt('detected_at', last7EndIso)
        .limit(10);

      const evidenceRows = (opps ?? []) as Array<{
        id: string;
        source_thread_id: string;
        source_message_id: string;
        platform?: string;
      }>;
      const messageIds = evidenceRows.map((o) => o.source_message_id);
      const threadIds = [...new Set(evidenceRows.map((o) => o.source_thread_id))];

      const { data: messages } = await supabase
        .from('engagement_messages')
        .select('id, thread_id, content, author_id')
        .in('id', messageIds);

      const authorIds = [...new Set((messages ?? []).map((m: { author_id?: string }) => m.author_id).filter(Boolean))];
      const { data: authors } = await supabase
        .from('engagement_authors')
        .select('id, username, display_name')
        .in('id', authorIds);
      const authorMap = new Map(
        (authors ?? []).map((a: { id: string; username?: string; display_name?: string }) => [
          a.id,
          (a as { display_name?: string }).display_name ?? (a as { username?: string }).username ?? 'Unknown',
        ])
      );

      const { data: insightRow, error: insError } = await supabase
        .from('engagement_insights')
        .insert({
          organization_id: organizationId,
          insight_type: type,
          insight_title: title,
          insight_summary: summary,
          metric_value: current,
          previous_value: previous,
          change_percentage: change,
          evidence_count: evidenceRows.length,
        })
        .select('id')
        .single();

      if (insError) {
        errors.push(insError.message);
        continue;
      }
      const insightId = (insightRow as { id: string })?.id;
      if (!insightId) continue;

      for (const msg of messages ?? []) {
        const m = msg as { id: string; thread_id: string; content?: string; author_id?: string };
        const authorName = m.author_id ? authorMap.get(m.author_id) ?? null : null;
        const oppRow = evidenceRows.find((e) => e.source_message_id === m.id);
        const platform = oppRow?.platform ?? (await getPlatformForThread(m.thread_id)) ?? 'unknown';
        await supabase.from('engagement_insight_evidence').insert({
          insight_id: insightId,
          thread_id: m.thread_id,
          message_id: m.id,
          author_name: authorName,
          platform,
          text_snippet: (m.content ?? '').toString().slice(0, 200),
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { created, errors };
}

async function getPlatformForThread(threadId: string): Promise<string | null> {
  const { data } = await supabase
    .from('engagement_threads')
    .select('platform')
    .eq('id', threadId)
    .maybeSingle();
  return (data as { platform?: string })?.platform ?? null;
}

/**
 * Get insights for organization with evidence.
 */
export async function getInsights(organizationId: string): Promise<InsightWithEvidence[]> {
  const { data: insights, error } = await supabase
    .from('engagement_insights')
    .select('id, insight_type, insight_title, insight_summary, metric_value, previous_value, change_percentage, evidence_count, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('[insightIntelligence] getInsights error', error.message);
    return [];
  }

  const result: InsightWithEvidence[] = [];
  for (const ins of insights ?? []) {
    const { data: evRows } = await supabase
      .from('engagement_insight_evidence')
      .select('thread_id, message_id, author_name, platform, text_snippet')
      .eq('insight_id', (ins as { id: string }).id);

    result.push({
      id: (ins as { id: string }).id,
      insight_type: (ins as { insight_type: string }).insight_type,
      insight_title: (ins as { insight_title: string }).insight_title,
      insight_summary: (ins as { insight_summary?: string }).insight_summary ?? '',
      metric_value: Number((ins as { metric_value: number }).metric_value ?? 0),
      previous_value: Number((ins as { previous_value: number }).previous_value ?? 0),
      change_percentage: (ins as { change_percentage?: number }).change_percentage ?? null,
      evidence_count: (ins as { evidence_count: number }).evidence_count ?? 0,
      evidence: (evRows ?? []).map((e: Record<string, unknown>) => ({
        thread_id: String(e.thread_id),
        message_id: String(e.message_id),
        author_name: (e.author_name as string) ?? null,
        platform: String(e.platform ?? ''),
        text_snippet: (e.text_snippet as string) ?? null,
      })),
      created_at: (ins as { created_at?: string }).created_at ?? null,
    });
  }
  return result;
}
