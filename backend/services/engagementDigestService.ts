/**
 * Engagement Digest Service
 * Generates daily digest: new threads, high priority, leads, opportunities, recommended threads.
 */

import { supabase } from '../db/supabaseClient';
import { getThreads } from './engagementThreadService';

export type DailyDigest = {
  digest_date: string;
  new_threads: number;
  high_priority_threads: number;
  lead_signals: number;
  opportunity_signals: number;
  recommended_thread_ids: string[];
  generated_at?: string;
};

export async function generateDailyDigest(organizationId: string): Promise<DailyDigest | null> {
  if (!organizationId) return null;

  const digestDate = new Date().toISOString().slice(0, 10);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    newThreadsResult,
    highPriorityResult,
    leadSignalsResult,
    opportunitySignalsResult,
    threads,
  ] = await Promise.all([
    supabase
      .from('engagement_threads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('ignored', false)
      .gte('created_at', since24h),
    getHighPriorityCount(organizationId),
    supabase
      .from('engagement_lead_signals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('detected_at', since24h),
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('resolved', false)
      .gte('detected_at', since24h),
    getThreads({
      organization_id: organizationId,
      limit: 50,
      exclude_ignored: true,
    }),
  ]);

  const new_threads = newThreadsResult.count ?? 0;
  const lead_signals = leadSignalsResult.count ?? 0;
  const opportunity_signals = opportunitySignalsResult.count ?? 0;
  const high_priority_threads = highPriorityResult ?? 0;

  const recommended = threads
    .sort((a, b) => {
      const triageA = a.triage_priority ?? 0;
      const triageB = b.triage_priority ?? 0;
      if (triageB !== triageA) return triageB - triageA;
      const scoreA = a.priority_score ?? 0;
      const scoreB = b.priority_score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const unreadA = a.unread_count ?? 0;
      const unreadB = b.unread_count ?? 0;
      return unreadB - unreadA;
    })
    .slice(0, 10)
    .map((t) => t.thread_id);

  const digest: DailyDigest = {
    digest_date: digestDate,
    new_threads,
    high_priority_threads,
    lead_signals,
    opportunity_signals,
    recommended_thread_ids: recommended,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('engagement_daily_digest').upsert(
    {
      organization_id: organizationId,
      digest_date: digestDate,
      new_threads,
      high_priority_threads,
      lead_signals,
      opportunity_signals,
      recommended_thread_ids: recommended,
      generated_at: digest.generated_at,
    },
    {
      onConflict: 'organization_id,digest_date',
    }
  );

  if (error) {
    console.warn('[engagementDigest] upsert error', error.message);
  }

  return digest;
}

async function getHighPriorityCount(organizationId: string): Promise<number> {
  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('ignored', false);
  const threadIds = (threads ?? []).map((t: { id: string }) => t.id);
  if (threadIds.length === 0) return 0;

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, triage_priority')
    .in('thread_id', threadIds)
    .eq('organization_id', organizationId);
  const triageByThread = new Map<string, number>();
  (classifications ?? []).forEach((r: { thread_id: string; triage_priority?: number }) => {
    triageByThread.set(r.thread_id, r.triage_priority ?? 0);
  });

  const { data: threadRows } = await supabase
    .from('engagement_threads')
    .select('id, priority_score')
    .in('id', threadIds)
    .eq('organization_id', organizationId);

  let count = 0;
  (threadRows ?? []).forEach((t: { id: string; priority_score?: number }) => {
    const triage = triageByThread.get(t.id) ?? 0;
    const score = Number(t.priority_score) ?? 0;
    if (triage >= 5 || score >= 50) count++;
  });
  return count;
}

export async function getDigest(
  organizationId: string,
  date?: string
): Promise<DailyDigest | null> {
  if (!organizationId) return null;

  const digestDate = date ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('engagement_daily_digest')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('digest_date', digestDate)
    .maybeSingle();

  if (error || !data) return null;

  return {
    digest_date: data.digest_date,
    new_threads: data.new_threads ?? 0,
    high_priority_threads: data.high_priority_threads ?? 0,
    lead_signals: data.lead_signals ?? 0,
    opportunity_signals: data.opportunity_signals ?? 0,
    recommended_thread_ids: Array.isArray(data.recommended_thread_ids)
      ? data.recommended_thread_ids
      : [],
    generated_at: data.generated_at,
  };
}
