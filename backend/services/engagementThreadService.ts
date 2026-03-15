/**
 * Engagement Thread Service
 *
 * Provides thread listing for the Unified Engagement Inbox.
 * Supports filters: organization_id, platform, source_id, priority, date_range.
 */

import { supabase } from '../db/supabaseClient';
import { scoreThreadPriority } from './engagementThreadPriorityService';
import { computeThreadLeadScoresBatch } from './leadThreadScoring';

export type GetThreadsFilters = {
  organization_id: string;
  platform?: string | null;
  source_id?: string | null;
  priority?: 'high' | 'medium' | 'low' | null;
  start_date?: string | null;
  end_date?: string | null;
  limit?: number;
  exclude_ignored?: boolean;
};

export type ThreadSummary = {
  thread_id: string;
  platform: string;
  author_summary: string;
  message_count: number;
  latest_message: string | null;
  latest_message_time: string | null;
  latest_message_id?: string | null;
  priority_score: number;
  unread_count: number;
  dominant_intent?: string | null;
  lead_detected?: boolean;
  lead_score?: number;
  negative_feedback?: boolean;
  customer_question?: boolean;
  classification_category?: string | null;
  triage_priority?: number | null;
  sentiment?: string | null;
};

export async function getThreads(filters: GetThreadsFilters): Promise<ThreadSummary[]> {
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

  let query = supabase
    .from('engagement_threads')
    .select('id, platform, platform_thread_id, source_id, organization_id, priority_score, unread_count, created_at, updated_at')
    .eq('organization_id', filters.organization_id)
    .order('updated_at', { ascending: false })
    .limit(limit * 2);

  if (filters.platform) {
    query = query.eq('platform', filters.platform);
  }
  if (filters.exclude_ignored) {
    query = query.eq('ignored', false);
  }
  if (filters.source_id) {
    query = query.eq('source_id', filters.source_id);
  }
  if (filters.start_date) {
    query = query.gte('updated_at', filters.start_date);
  }
  if (filters.end_date) {
    query = query.lte('updated_at', filters.end_date);
  }

  const { data: threads, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }
  const list = threads ?? [];

  const threadIds = list.map((t: { id: string }) => t.id);
  if (threadIds.length === 0) {
    return [];
  }

  const leadScores = await computeThreadLeadScoresBatch(threadIds, filters.organization_id);

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, classification_category, triage_priority, sentiment')
    .in('thread_id', threadIds)
    .eq('organization_id', filters.organization_id);
  const classificationByThread = new Map<string, { classification_category?: string; triage_priority?: number; sentiment?: string }>();
  (classifications ?? []).forEach((r: { thread_id: string; classification_category?: string; triage_priority?: number; sentiment?: string }) => {
    classificationByThread.set(r.thread_id, {
      classification_category: r.classification_category ?? null,
      triage_priority: r.triage_priority ?? null,
      sentiment: r.sentiment ?? null,
    });
  });

  const { data: threadIntel } = await supabase
    .from('engagement_thread_intelligence')
    .select('thread_id, dominant_intent, lead_detected, negative_feedback, customer_question, influencer_detected')
    .in('thread_id', threadIds);
  const intelByThread = new Map<string, { dominant_intent?: string; lead_detected?: boolean; negative_feedback?: boolean; customer_question?: boolean; influencer_detected?: boolean }>();
  (threadIntel ?? []).forEach((r: any) => {
    intelByThread.set(r.thread_id, {
      dominant_intent: r.dominant_intent ?? null,
      lead_detected: r.lead_detected === true,
      negative_feedback: r.negative_feedback === true,
      customer_question: r.customer_question === true,
      influencer_detected: r.influencer_detected === true,
    });
  });

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform_created_at, author_id, sentiment_score')
    .in('thread_id', threadIds)
    .order('platform_created_at', { ascending: false });

  const latestByThread = new Map<string, { id: string; content: string; platform_created_at: string | null; sentiment_score?: number | null }>();
  const countByThread = new Map<string, number>();
  const authorIds = new Set<string>();
  (messages ?? []).forEach((m: any) => {
    if (!latestByThread.has(m.thread_id)) {
      latestByThread.set(m.thread_id, {
        id: m.id,
        content: (m.content ?? '').toString().slice(0, 200),
        platform_created_at: m.platform_created_at ?? null,
        sentiment_score: m.sentiment_score ?? null,
      });
    }
    countByThread.set(m.thread_id, (countByThread.get(m.thread_id) ?? 0) + 1);
    if (m.author_id) authorIds.add(m.author_id);
  });

  const authorMap = new Map<string, { username?: string; display_name?: string }>();
  if (authorIds.size > 0) {
    const { data: authors } = await supabase
      .from('engagement_authors')
      .select('id, username, display_name')
      .in('id', Array.from(authorIds));
    (authors ?? []).forEach((a: any) => authorMap.set(a.id, { username: a.username, display_name: a.display_name }));
  }

  const firstAuthorByThread = new Map<string, string>();
  (messages ?? []).forEach((m: any) => {
    if (!firstAuthorByThread.has(m.thread_id) && m.author_id) {
      const a = authorMap.get(m.author_id);
      firstAuthorByThread.set(m.thread_id, a?.display_name ?? a?.username ?? 'Unknown');
    }
  });

  const results: ThreadSummary[] = [];
  for (const t of list) {
    const latest = latestByThread.get(t.id);
    const msgCount = countByThread.get(t.id) ?? 0;
    const authorSummary = firstAuthorByThread.get(t.id) ?? 'Unknown';
    const intel = intelByThread.get(t.id);
    const leadResult = leadScores.get(t.id);
    const leadDetected = leadResult?.lead_detected ?? intel?.lead_detected ?? false;
    const leadScore = leadResult?.thread_lead_score ?? 0;
    const classification = classificationByThread.get(t.id);

    const scored = scoreThreadPriority({
      content: latest?.content ?? '',
      sentiment_score: latest?.sentiment_score ?? null,
      negative_feedback: intel?.negative_feedback,
      lead_detected: leadDetected,
      customer_question: intel?.customer_question,
      influencer_signal: intel?.influencer_detected,
    });
    const priorityScore = scored.priority_score;
    if (filters.priority) {
      const label = priorityScore >= 50 ? 'high' : priorityScore >= 25 ? 'medium' : 'low';
      if (label !== filters.priority) continue;
    }
    results.push({
      thread_id: t.id,
      platform: t.platform,
      author_summary: authorSummary,
      message_count: msgCount,
      latest_message: latest?.content ?? null,
      latest_message_time: latest?.platform_created_at ?? null,
      latest_message_id: latest?.id ?? null,
      priority_score: priorityScore,
      unread_count: Number(t.unread_count) ?? 0,
      dominant_intent: intel?.dominant_intent ?? null,
      lead_detected: leadDetected,
      lead_score: leadScore,
      negative_feedback: intel?.negative_feedback ?? false,
      customer_question: intel?.customer_question ?? false,
      classification_category: classification?.classification_category ?? null,
      triage_priority: classification?.triage_priority ?? null,
      sentiment: classification?.sentiment ?? null,
    });
    if (results.length >= limit) break;
  }
  results.sort((a, b) => {
    const triageA = a.triage_priority ?? 0;
    const triageB = b.triage_priority ?? 0;
    if (triageB !== triageA) return triageB - triageA;
    const scoreA = a.priority_score ?? 0;
    const scoreB = b.priority_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const atA = a.latest_message_time ?? '';
    const atB = b.latest_message_time ?? '';
    return atB.localeCompare(atA);
  });
  return results;
}
