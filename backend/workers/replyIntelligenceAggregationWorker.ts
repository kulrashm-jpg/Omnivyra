/**
 * Reply Intelligence Aggregation Worker
 * Aggregates response_performance_metrics into response_reply_intelligence.
 */

import { supabase } from '../db/supabaseClient';
import {
  classifyReplyCategory,
  normalizeReplyPattern,
} from '../services/replyIntelligenceService';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';

const BATCH_LIMIT = 1000;

type AggregationKey = string;
type AggregationRow = {
  organization_id: string;
  platform: string;
  reply_pattern: string;
  reply_category: string;
  sample_reply: string | null;
  total_replies: number;
  total_likes: number;
  total_followups: number;
  total_leads: number;
};

function makeKey(org: string, platform: string, pattern: string, category: string): AggregationKey {
  return `${org}|${platform}|${pattern}|${category}`;
}

export async function runReplyIntelligenceAggregationWorker(): Promise<{
  processed: number;
  upserted: number;
  errors: number;
}> {
  const startMs = Date.now();
  try {
    return await executeWithRetry(
      'replyIntelligenceAggregationWorker',
      {},
      async () => runReplyIntelligenceAggregationWorkerImpl(startMs)
    );
  } catch (err) {
    console.warn('[replyIntelligenceAggregation] failed after retries', (err as Error)?.message);
    const durationMs = Date.now() - startMs;
    void recordMetric('reply_intelligence_worker', 'worker_run', 1, 'runs', { processed: 0, errors: 1 }).catch(() => {});
    void recordMetric('reply_intelligence_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
    return { processed: 0, upserted: 0, errors: 1 };
  }
}

async function runReplyIntelligenceAggregationWorkerImpl(startMs: number): Promise<{
  processed: number;
  upserted: number;
  errors: number;
}> {
  let offset = 0;
  const agg = new Map<AggregationKey, AggregationRow>();
  let totalProcessed = 0;

  while (true) {
    const { data: metricsRows, error: metricsError } = await supabase
      .from('response_performance_metrics')
      .select('id, organization_id, thread_id, message_id, platform, engagement_like_count, engagement_reply_count, lead_conversion')
      .eq('evaluation_window_closed', true)
      .range(offset, offset + BATCH_LIMIT - 1);

    if (metricsError) throw new Error(metricsError.message);

    const rows = (metricsRows ?? []) as Array<{
      id: string;
      organization_id: string;
      thread_id: string;
      message_id: string;
      platform: string;
      engagement_like_count: number;
      engagement_reply_count: number;
      lead_conversion: boolean;
    }>;

    if (rows.length === 0) break;
    totalProcessed += rows.length;

    const msgIds = rows.map((r) => r.message_id);
    const { data: replyMessages } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, parent_message_id, content')
      .in('parent_message_id', msgIds);

    const replyByParentThread = new Map<string, { content: string | null }>();
    for (const m of replyMessages ?? []) {
      const msg = m as { parent_message_id?: string; thread_id?: string; content?: string };
      const parent = msg.parent_message_id;
      const tid = msg.thread_id;
      if (parent && tid) {
        const key = `${parent}|${tid}`;
        if (!replyByParentThread.has(key)) {
          replyByParentThread.set(key, { content: msg.content ?? null });
        }
      }
    }

    for (const r of rows) {
      const replyData = replyByParentThread.get(`${r.message_id}|${r.thread_id}`);
      const content = replyData?.content ?? null;
      const reply_category = classifyReplyCategory(content);
      const reply_pattern = normalizeReplyPattern(content);

      const key = makeKey(r.organization_id, r.platform, reply_pattern, reply_category);
      const existing = agg.get(key);
      const likes = r.engagement_like_count ?? 0;
      const followups = r.engagement_reply_count ?? 0;
      const leads = r.lead_conversion ? 1 : 0;

      if (existing) {
        existing.total_replies += 1;
        existing.total_likes += likes;
        existing.total_followups += followups;
        existing.total_leads += leads;
        if (content && !existing.sample_reply) existing.sample_reply = content.slice(0, 500);
      } else {
        agg.set(key, {
          organization_id: r.organization_id,
          platform: r.platform,
          reply_pattern,
          reply_category,
          sample_reply: content ? content.slice(0, 500) : null,
          total_replies: 1,
          total_likes: likes,
          total_followups: followups,
          total_leads: leads,
        });
      }
    }

    offset += rows.length;
    if (rows.length < BATCH_LIMIT) break;
  }

  if (agg.size === 0) {
    const durationMs = Date.now() - startMs;
    void recordMetric('reply_intelligence_worker', 'worker_run', 1, 'runs', { processed: totalProcessed, errors: 0 }).catch(() => {});
    void recordMetric('reply_intelligence_worker', 'jobs_processed', totalProcessed, 'jobs').catch(() => {});
    void recordMetric('reply_intelligence_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
    void recordMetric('reply_intelligence_worker', 'aggregation_cycles', 1, 'runs').catch(() => {});
    return { processed: totalProcessed, upserted: 0, errors: 0 };
  }

  const now = new Date().toISOString();
  let upserted = 0;

  for (const row of agg.values()) {
    const engagement_score =
      (row.total_likes ?? 0) * 1 + (row.total_followups ?? 0) * 2 + (row.total_leads ?? 0) * 5;
    const confidence_score = Math.log((row.total_replies ?? 0) + 1);

    const { error } = await supabase.from('response_reply_intelligence').upsert(
      {
      organization_id: row.organization_id,
      platform: row.platform,
      reply_pattern: row.reply_pattern,
      reply_category: row.reply_category,
      sample_reply: row.sample_reply,
      total_replies: row.total_replies,
      total_likes: row.total_likes,
      total_followups: row.total_followups,
      total_leads: row.total_leads,
      engagement_score,
      confidence_score,
      last_updated_at: now,
    },
    {
      onConflict: 'organization_id,platform,reply_pattern,reply_category',
    }
  );

    if (!error) upserted++;
    else console.warn('[replyIntelligenceAggregation] upsert error', error.message);
  }

  const durationMs = Date.now() - startMs;
  void recordMetric('reply_intelligence_worker', 'worker_run', 1, 'runs', { processed: totalProcessed, upserted, errors: 0 }).catch(() => {});
  void recordMetric('reply_intelligence_worker', 'jobs_processed', totalProcessed, 'jobs').catch(() => {});
  void recordMetric('reply_intelligence_worker', 'processing_duration_ms', durationMs, 'ms').catch(() => {});
  void recordMetric('reply_intelligence_worker', 'aggregation_cycles', 1, 'runs').catch(() => {});

  return { processed: totalProcessed, upserted, errors: 0 };
}
