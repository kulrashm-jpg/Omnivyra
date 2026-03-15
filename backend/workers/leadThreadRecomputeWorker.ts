/**
 * Lead Thread Recompute Worker
 * Pull-based worker that processes lead_thread_recompute_queue.
 * Claim-before-delete: rows deleted only after successful compute.
 * Dynamic batch sizing based on queue depth.
 */

import { supabase } from '../db/supabaseClient';
import { computeThreadLeadScore } from '../services/leadThreadScoring';

const MIN_BATCH = 20;
const MAX_BATCH = 200;

export async function runLeadThreadRecomputeWorker(): Promise<{
  processed: number;
  errors: number;
  retriesExhausted: number;
}> {
  const { data: approxCount, error: countError } = await supabase.rpc(
    'get_lead_recompute_queue_approx_count'
  );
  let queueSize = MIN_BATCH;
  if (!countError && approxCount != null) {
    queueSize = Math.max(0, typeof approxCount === 'number' ? approxCount : Number(approxCount) || 0);
  }
  const batchSize = Math.min(MAX_BATCH, Math.max(MIN_BATCH, Math.floor(queueSize / 10)));

  const { data: claimed, error } = await supabase.rpc('claim_lead_thread_recompute_batch', {
    p_limit: batchSize,
  });

  if (error) {
    console.warn('[leadThreadRecompute] claim error', (error as Error)?.message);
    return { processed: 0, errors: 1, retriesExhausted: 0 };
  }

  const rows = (claimed ?? []) as Array<{
    thread_id: string;
    organization_id: string;
    retry_count: number;
  }>;
  let processed = 0;
  let errors = 0;
  let retriesExhausted = 0;

  for (const row of rows) {
    try {
      const result = await computeThreadLeadScore(row.thread_id, row.organization_id);
      await supabase.from('lead_thread_score_cache').upsert(
        {
          thread_id: row.thread_id,
          organization_id: row.organization_id,
          thread_lead_score: result.thread_lead_score,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'thread_id,organization_id' }
      );
      await supabase
        .from('lead_thread_recompute_queue')
        .delete()
        .eq('thread_id', row.thread_id)
        .eq('organization_id', row.organization_id);
      processed++;
    } catch (err) {
      const currentRetry = row.retry_count ?? 0;
      const newRetryCount = currentRetry + 1;
      if (newRetryCount > 10) {
        await supabase
          .from('lead_thread_recompute_queue')
          .delete()
          .eq('thread_id', row.thread_id)
          .eq('organization_id', row.organization_id);
        console.warn(
          '[leadThreadRecompute] retries exhausted, deleted',
          { thread_id: row.thread_id, organization_id: row.organization_id },
          (err as Error)?.message
        );
        retriesExhausted++;
      } else {
        await supabase
          .from('lead_thread_recompute_queue')
          .update({ retry_count: newRetryCount, claimed_at: null })
          .eq('thread_id', row.thread_id)
          .eq('organization_id', row.organization_id);
        console.warn('[leadThreadRecompute] computeThreadLeadScore error', (err as Error)?.message);
      }
      errors++;
    }
  }

  return { processed, errors, retriesExhausted };
}

/**
 * Cleanup orphan queue rows (thread no longer exists).
 * Run every 10 minutes.
 */
export async function runLeadThreadRecomputeQueueCleanup(): Promise<{ deleted: number }> {
  const { data, error } = await supabase.rpc('cleanup_lead_thread_recompute_queue_orphans');
  if (error) {
    console.warn('[leadThreadRecompute] cleanup error', (error as Error)?.message);
    return { deleted: 0 };
  }
  const deleted = typeof data === 'number' ? data : Number(data) || 0;
  return { deleted };
}
