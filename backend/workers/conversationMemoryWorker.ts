/**
 * Conversation Memory Worker
 * Polls conversation_memory_rebuild_queue and runs updateThreadMemory for each claimed row.
 * Decouples memory rebuilds from ingestion pipeline.
 */

import { supabase } from '../db/supabaseClient';
import {
  isMemoryCurrentFromQueue,
  updateThreadMemory,
} from '../services/conversationMemoryService';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';

const BATCH_LIMIT = 20;

export async function runConversationMemoryWorker(): Promise<{
  processed: number;
  errors: number;
}> {
  const startMs = Date.now();

  const { count: backlogCount } = await supabase
    .from('conversation_memory_rebuild_queue')
    .select('thread_id', { count: 'exact', head: true });
  void recordMetric('conversation_memory_worker', 'queue_backlog', backlogCount ?? 0, 'jobs').catch(() => {});

  const { data: claimed, error } = await supabase.rpc('claim_conversation_memory_rebuild_batch', {
    p_limit: BATCH_LIMIT,
  });

  if (error) {
    console.warn('[conversationMemoryWorker] claim error', (error as Error)?.message);
    void recordMetric('conversation_memory_worker', 'worker_run', 1, 'runs', { processed: 0, errors: 1 }).catch(() => {});
    void recordMetric('conversation_memory_worker', 'jobs_processed', 0, 'jobs').catch(() => {});
    void recordMetric('conversation_memory_worker', 'processing_duration_ms', Date.now() - startMs, 'ms').catch(() => {});
    return { processed: 0, errors: 1 };
  }

  const rows = (claimed ?? []) as Array<{ thread_id: string; latest_message_id: string | null }>;
  let processed = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await executeWithRetry(
        'conversationMemoryWorker',
        { thread_id: row.thread_id, latest_message_id: row.latest_message_id },
        async () => {
          const current = await isMemoryCurrentFromQueue(row.thread_id, row.latest_message_id);
          if (current) {
            await supabase
              .from('conversation_memory_rebuild_queue')
              .delete()
              .eq('thread_id', row.thread_id);
            return;
          }
          await updateThreadMemory(row.thread_id, row.latest_message_id);
          await supabase
            .from('conversation_memory_rebuild_queue')
            .delete()
            .eq('thread_id', row.thread_id);
        }
      );
      processed++;
    } catch {
      errors++;
    }
  }

  const durationMs = Date.now() - startMs;
  void recordMetric('conversation_memory_worker', 'worker_run', 1, 'runs', { processed, errors }).catch(() => {});
  void recordMetric('conversation_memory_worker', 'jobs_processed', processed, 'jobs').catch(() => {});
  void recordMetric('conversation_memory_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});

  return { processed, errors };
}
