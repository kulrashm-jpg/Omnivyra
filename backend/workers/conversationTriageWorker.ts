/**
 * Conversation Triage Worker
 * Scans threads with new messages, classifies unclassified or stale threads.
 * Runs every 3 minutes.
 */

import { supabase } from '../db/supabaseClient';
import { classifyThread } from '../services/conversationTriageService';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';
import { getControls } from '../services/engagementGovernanceService';

const BATCH_LIMIT = 15;

export async function runConversationTriageWorker(): Promise<{
  processed: number;
  errors: number;
}> {
  const startMs = Date.now();
  let processed = 0;
  let errors = 0;

  const { data: threads, error: threadsErr } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .not('organization_id', 'is', null)
    .eq('ignored', false)
    .limit(100);

  if (threadsErr || !threads?.length) {
    return { processed: 0, errors: 0 };
  }

  const threadIds = (threads ?? []).map((t: { id: string }) => t.id);

  const { data: latestMsgs } = await supabase
    .from('engagement_messages')
    .select('thread_id, platform_created_at')
    .in('thread_id', threadIds)
    .order('platform_created_at', { ascending: false });

  const latestByThread = new Map<string, string>();
  for (const m of latestMsgs ?? []) {
    const t = m as { thread_id: string; platform_created_at: string };
    if (!latestByThread.has(t.thread_id)) {
      latestByThread.set(t.thread_id, t.platform_created_at ?? '');
    }
  }

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, classified_at')
    .in('thread_id', threadIds);

  const needsClassification: Array<{ threadId: string; organizationId: string }> = [];
  for (const t of threads ?? []) {
    const th = t as { id: string; organization_id: string };
    const latestMsgTime = latestByThread.get(th.id) ?? '';
    const existing = (classifications ?? []).find((c: { thread_id: string }) => c.thread_id === th.id) as {
      classified_at?: string;
    } | undefined;
    if (!existing) {
      needsClassification.push({ threadId: th.id, organizationId: th.organization_id });
    } else if (latestMsgTime && existing.classified_at && latestMsgTime > existing.classified_at) {
      needsClassification.push({ threadId: th.id, organizationId: th.organization_id });
    }
    if (needsClassification.length >= BATCH_LIMIT) break;
  }

  for (const { threadId, organizationId } of needsClassification) {
    const controls = await getControls(organizationId);
    if (!controls.triage_engine_enabled) continue;

    try {
      await executeWithRetry(
        'conversationTriageWorker',
        { threadId, organizationId },
        async () => {
          const result = await classifyThread(threadId, organizationId);
          if (!result) throw new Error('classifyThread returned null');

          const { data: existing } = await supabase
            .from('engagement_thread_classification')
            .select('id')
            .eq('thread_id', threadId)
            .eq('organization_id', organizationId)
            .maybeSingle();

          const row = {
            organization_id: organizationId,
            thread_id: threadId,
            classification_category: result.classification_category,
            classification_confidence: result.classification_confidence,
            sentiment: result.sentiment,
            triage_priority: result.triage_priority,
            classified_at: new Date().toISOString(),
          };

          if (existing) {
            const { error: updateErr } = await supabase
              .from('engagement_thread_classification')
              .update(row)
              .eq('thread_id', threadId)
              .eq('organization_id', organizationId);
            if (updateErr) throw new Error(updateErr.message);
          } else {
            const { error: insertErr } = await supabase.from('engagement_thread_classification').insert(row);
            if (insertErr) throw new Error(insertErr.message);
          }
        }
      );
      processed++;
    } catch {
      errors++;
    }
  }

  void recordMetric('conversation_triage_worker', 'processed', processed, 'jobs').catch(() => {});
  void recordMetric('conversation_triage_worker', 'errors', errors, 'jobs').catch(() => {});
  void recordMetric('conversation_triage_worker', 'duration_ms', Date.now() - startMs, 'ms').catch(() => {});

  return { processed, errors };
}
