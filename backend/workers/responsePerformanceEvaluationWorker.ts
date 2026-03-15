/**
 * Response Performance Evaluation Worker
 * Closes evaluation window for metrics older than 24 hours.
 */

import { supabase } from '../db/supabaseClient';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';

export async function runResponsePerformanceEvaluationWorker(): Promise<{
  closed: number;
  errors: number;
}> {
  const startMs = Date.now();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    return await executeWithRetry(
      'responsePerformanceEvaluationWorker',
      { cutoff },
      async () => {
        const { data: rows, error: selectError } = await supabase
          .from('response_performance_metrics')
          .select('id')
          .eq('evaluation_window_closed', false)
          .lt('created_at', cutoff);

        if (selectError) throw new Error(selectError.message);

        const ids = (rows ?? []).map((r: { id: string }) => r.id);
        if (ids.length === 0) {
          const durationMs = Date.now() - startMs;
          void recordMetric('response_performance_evaluation_worker', 'worker_run', 1, 'runs', { closed: 0, errors: 0 }).catch(() => {});
          void recordMetric('response_performance_evaluation_worker', 'jobs_processed', 0, 'jobs').catch(() => {});
          void recordMetric('response_performance_evaluation_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
          return { closed: 0, errors: 0 };
        }

        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('response_performance_metrics')
          .update({
            evaluation_window_closed: true,
            evaluation_closed_at: now,
          })
          .in('id', ids);

        if (updateError) throw new Error(updateError.message);

        const durationMs = Date.now() - startMs;
        void recordMetric('response_performance_evaluation_worker', 'worker_run', 1, 'runs', { closed: ids.length, errors: 0 }).catch(() => {});
        void recordMetric('response_performance_evaluation_worker', 'jobs_processed', ids.length, 'jobs').catch(() => {});
        void recordMetric('response_performance_evaluation_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});

        return { closed: ids.length, errors: 0 };
      }
    );
  } catch (err) {
    console.warn('[responsePerformanceEvaluationWorker] failed after retries', (err as Error)?.message);
    const durationMs = Date.now() - startMs;
    void recordMetric('response_performance_evaluation_worker', 'worker_run', 1, 'runs', { closed: 0, errors: 1 }).catch(() => {});
    void recordMetric('response_performance_evaluation_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
    return { closed: 0, errors: 1 };
  }
}
