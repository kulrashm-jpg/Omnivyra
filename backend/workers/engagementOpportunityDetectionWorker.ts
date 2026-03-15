/**
 * Engagement Opportunity Detection Worker
 * Scans engagement_messages and detects opportunities.
 */

import { supabase } from '../db/supabaseClient';
import {
  detectEngagementOpportunity,
  type EngagementMessageRow,
} from '../services/engagementOpportunityService';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';
import { getControls } from '../services/engagementGovernanceService';

const BATCH_LIMIT = 100;
const LOOKBACK_DAYS = 7;

export async function runEngagementOpportunityDetectionWorker(): Promise<{
  processed: number;
  opportunities: number;
  errors: number;
}> {
  const startMs = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: messages, error: msgError } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, author_id, platform, content, created_at, platform_created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(BATCH_LIMIT);

  if (msgError) {
    console.warn('[engagementOpportunityDetection] messages select error', msgError.message);
    const durationMs = Date.now() - startMs;
    void recordMetric('engagement_opportunity_detection_worker', 'worker_run', 1, 'runs', { processed: 0, opportunities: 0, errors: 1 }).catch(() => {});
    void recordMetric('engagement_opportunity_detection_worker', 'jobs_processed', 0, 'jobs').catch(() => {});
    void recordMetric('engagement_opportunity_detection_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
    void recordMetric('engagement_opportunity_engine', 'opportunities_detected', 0, 'count').catch(() => {});
    return { processed: 0, opportunities: 0, errors: 1 };
  }

  const rows = (messages ?? []) as Array<{
    id: string;
    thread_id: string;
    author_id: string | null;
    platform: string;
    content: string | null;
    created_at?: string | null;
    platform_created_at?: string | null;
  }>;

  if (rows.length === 0) {
    const durationMs = Date.now() - startMs;
    void recordMetric('engagement_opportunity_detection_worker', 'worker_run', 1, 'runs', { processed: 0, opportunities: 0, errors: 0 }).catch(() => {});
    void recordMetric('engagement_opportunity_detection_worker', 'jobs_processed', 0, 'jobs').catch(() => {});
    void recordMetric('engagement_opportunity_detection_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
    void recordMetric('engagement_opportunity_engine', 'opportunities_detected', 0, 'count').catch(() => {});
    return { processed: 0, opportunities: 0, errors: 0 };
  }

  const threadIds = [...new Set(rows.map((r) => r.thread_id))];
  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id, organization_id')
    .in('id', threadIds)
    .not('organization_id', 'is', null);

  const orgByThread = new Map<string, string>();
  for (const t of threads ?? []) {
    const org = (t as { organization_id?: string }).organization_id;
    if (org) orgByThread.set((t as { id: string }).id, org);
  }

  let opportunities = 0;

  let errors = 0;
  for (const msg of rows) {
    const orgId = orgByThread.get(msg.thread_id);
    if (!orgId) continue;

    const controls = await getControls(orgId);
    if (!controls.opportunity_detection_enabled) continue;

    try {
      await executeWithRetry(
        'engagementOpportunityDetectionWorker',
        { message_id: msg.id, thread_id: msg.thread_id },
        async () => {
          const oppId = await detectEngagementOpportunity(
            msg as EngagementMessageRow,
            orgId
          );
          if (oppId) opportunities++;
        }
      );
    } catch {
      errors++;
    }
  }

  const durationMs = Date.now() - startMs;
  void recordMetric('engagement_opportunity_detection_worker', 'worker_run', 1, 'runs', { processed: rows.length, opportunities, errors }).catch(() => {});
  void recordMetric('engagement_opportunity_detection_worker', 'jobs_processed', rows.length, 'jobs').catch(() => {});
  void recordMetric('engagement_opportunity_detection_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
  void recordMetric('engagement_opportunity_engine', 'opportunities_detected', opportunities, 'count').catch(() => {});

  return { processed: rows.length, opportunities, errors };
}
