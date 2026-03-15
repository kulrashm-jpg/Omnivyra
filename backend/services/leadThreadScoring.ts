/**
 * Lead Thread Scoring
 * Computes thread-level lead score from signals, question intent, and depth.
 */

import { supabase } from '../db/supabaseClient';

const DEBOUNCE_SECONDS = 5;

export type ThreadLeadScoreResult = {
  thread_lead_score: number;
  lead_detected: boolean;
  signal_count: number;
  top_lead_intent: string | null;
};

export type ThreadLeadScores = Map<string, ThreadLeadScoreResult>;

/**
 * Batch compute thread lead scores for multiple threads.
 */
export async function computeThreadLeadScoresBatch(
  threadIds: string[],
  organizationId: string
): Promise<ThreadLeadScores> {
  const result = new Map<string, ThreadLeadScoreResult>();
  if (threadIds.length === 0) return result;

  const { data: signals } = await supabase
    .from('engagement_lead_signals')
    .select('thread_id, lead_score, confidence_score, lead_intent')
    .in('thread_id', threadIds)
    .eq('organization_id', organizationId);

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id')
    .in('thread_id', threadIds);

  const depthByThread = new Map<string, number>();
  for (const m of messages ?? []) {
    const tid = (m as { thread_id: string }).thread_id;
    depthByThread.set(tid, (depthByThread.get(tid) ?? 0) + 1);
  }

  const messageIds = (messages ?? []).map((m: { id: string }) => m.id);
  const questionCountByThread = new Map<string, number>();
  if (messageIds.length > 0) {
    const { data: intel } = await supabase
      .from('engagement_message_intelligence')
      .select('message_id, question_detected')
      .in('message_id', messageIds);
    const msgToThread = new Map<string, string>();
    for (const m of messages ?? []) {
      msgToThread.set((m as { id: string }).id, (m as { thread_id: string }).thread_id);
    }
    for (const i of intel ?? []) {
      const mid = (i as { message_id: string }).message_id;
      const tid = msgToThread.get(mid);
      if (tid && (i as { question_detected?: boolean }).question_detected) {
        questionCountByThread.set(tid, (questionCountByThread.get(tid) ?? 0) + 1);
      }
    }
  }

  const signalsByThread = new Map<string, Array<{ lead_score: number; confidence_score?: number; lead_intent: string }>>();
  for (const s of signals ?? []) {
    const tid = (s as { thread_id: string }).thread_id;
    const list = signalsByThread.get(tid) ?? [];
    list.push({
      lead_score: (s as { lead_score: number }).lead_score ?? 0,
      confidence_score: (s as { confidence_score?: number }).confidence_score,
      lead_intent: (s as { lead_intent: string }).lead_intent ?? '',
    });
    signalsByThread.set(tid, list);
  }

  for (const threadId of threadIds) {
    const signalList = signalsByThread.get(threadId) ?? [];
    const depth = depthByThread.get(threadId) ?? 0;
    const questionCount = questionCountByThread.get(threadId) ?? 0;

    let threadScore = 0;
    let topIntent: string | null = null;
    let maxSignalScore = 0;

    if (signalList.length > 0) {
      for (const s of signalList) {
        const weighted = (s.lead_score ?? 0) * (s.confidence_score ?? 0.8);
        threadScore += weighted;
        if ((s.lead_score ?? 0) > maxSignalScore) {
          maxSignalScore = s.lead_score;
          topIntent = s.lead_intent || null;
        }
      }
      threadScore = Math.min(100, Math.round(threadScore / Math.max(1, signalList.length)) + 10);
    }
    if (questionCount > 0 && threadScore > 0) {
      threadScore = Math.min(100, threadScore + 5 * Math.min(questionCount, 3));
    }
    if (depth >= 3 && threadScore > 0) {
      threadScore = Math.min(100, threadScore + 5);
    }

    result.set(threadId, {
      thread_lead_score: Math.min(100, threadScore),
      lead_detected: signalList.length > 0,
      signal_count: signalList.length,
      top_lead_intent: topIntent,
    });
  }

  return result;
}

/**
 * Schedule a thread score recompute.
 * ON CONFLICT DO UPDATE with LEAST(scheduled_at) for hot-thread fairness.
 * No score computation or cache read. Worker computes and updates cache.
 */
export async function scheduleThreadScoreUpdate(threadId: string, organizationId: string): Promise<void> {
  await supabase.rpc('schedule_lead_thread_recompute', {
    p_thread_id: threadId,
    p_organization_id: organizationId,
  });
}

/**
 * Calculate thread_lead_score for a single thread.
 */
export async function computeThreadLeadScore(
  threadId: string,
  organizationId: string
): Promise<ThreadLeadScoreResult> {
  const map = await computeThreadLeadScoresBatch([threadId], organizationId);
  return (
    map.get(threadId) ?? {
      thread_lead_score: 0,
      lead_detected: false,
      signal_count: 0,
      top_lead_intent: null,
    }
  );
}
