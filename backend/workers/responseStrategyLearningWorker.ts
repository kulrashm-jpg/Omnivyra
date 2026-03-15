/**
 * Response Strategy Learning Worker
 * Aggregates response_performance_metrics + engagement_thread_classification
 * into response_strategy_intelligence. Runs every 15 minutes.
 */

import { supabase } from '../db/supabaseClient';
import { classifyStrategyType } from '../services/replyIntelligenceService';
import { recordMetric } from '../services/systemHealthMetricsService';
import { executeWithRetry } from '../services/workerRetryService';
import { getControls } from '../services/engagementGovernanceService';

const BATCH_LIMIT = 500;

export async function runResponseStrategyLearningWorker(): Promise<{
  processed: number;
  upserted: number;
  errors: number;
}> {
  const startMs = Date.now();
  try {
    return await executeWithRetry(
      'responseStrategyLearningWorker',
      {},
      () => runResponseStrategyLearningWorkerImpl(startMs)
    );
  } catch (err) {
    console.warn('[responseStrategyLearning] failed after retries', (err as Error)?.message);
    void recordMetric('response_strategy_learning_worker', 'errors', 1, 'runs').catch(() => {});
    return { processed: 0, upserted: 0, errors: 1 };
  }
}

async function runResponseStrategyLearningWorkerImpl(startMs: number): Promise<{
  processed: number;
  upserted: number;
  errors: number;
}> {
  let offset = 0;
  const agg = new Map<
    string,
    {
      organization_id: string;
      classification_category: string;
      sentiment: string;
      strategy_type: string;
      total_uses: number;
      successful_interactions: number;
      engagement_score: number;
    }
  >();
  let totalProcessed = 0;

  while (true) {
    const { data: metricsRows, error: metricsError } = await supabase
      .from('response_performance_metrics')
      .select('id, organization_id, thread_id, message_id, platform, engagement_like_count, engagement_reply_count, engagement_followup_count, lead_conversion')
      .eq('evaluation_window_closed', true)
      .range(offset, offset + BATCH_LIMIT - 1);

    if (metricsError) throw new Error(metricsError.message);

    const rows = (metricsRows ?? []) as Array<{
      id: string;
      organization_id: string;
      thread_id: string;
      message_id: string;
      engagement_like_count: number;
      engagement_reply_count: number;
      engagement_followup_count: number;
      lead_conversion: boolean;
    }>;

    if (rows.length === 0) break;
    totalProcessed += rows.length;

    const threadIds = [...new Set(rows.map((r) => r.thread_id))];
    const msgIds = rows.map((r) => r.message_id);

    const orgIds = [...new Set(rows.map((r) => r.organization_id))];
    const { data: classifications } = await supabase
      .from('engagement_thread_classification')
      .select('thread_id, organization_id, classification_category, sentiment')
      .in('thread_id', threadIds)
      .in('organization_id', orgIds);

    const classByThread = new Map<string, { classification_category: string; sentiment: string }>();
    (classifications ?? []).forEach((c: { thread_id: string; organization_id?: string; classification_category?: string; sentiment?: string }) => {
      const key = `${c.thread_id}|${c.organization_id ?? ''}`;
      classByThread.set(key, {
        classification_category: (c.classification_category ?? 'general_comment').toString(),
        sentiment: (c.sentiment ?? 'neutral').toString().toLowerCase(),
      });
    });

    const { data: messages } = await supabase
      .from('engagement_messages')
      .select('id, content')
      .in('id', msgIds);

    const contentByMsg = new Map<string, string>();
    (messages ?? []).forEach((m: { id: string; content?: string }) => {
      contentByMsg.set(m.id, (m.content ?? '').toString());
    });

    const controlsCache = new Map<string, boolean>();
    for (const r of rows) {
      const classification = classByThread.get(`${r.thread_id}|${r.organization_id}`);
      if (!classification) continue;

      let allowed = controlsCache.get(r.organization_id);
      if (allowed === undefined) {
        const ctrl = await getControls(r.organization_id);
        allowed = ctrl.response_strategy_learning_enabled;
        controlsCache.set(r.organization_id, allowed);
      }
      if (!allowed) continue;

      const content = contentByMsg.get(r.message_id) ?? '';
      const strategy_type = classifyStrategyType(content);

      const liked = (r.engagement_like_count ?? 0) > 0;
      const followup = (r.engagement_reply_count ?? 0) > 0 || (r.engagement_followup_count ?? 0) > 0;
      const led = r.lead_conversion === true;
      const successful = liked || followup || led;
      const engagement =
        (r.engagement_like_count ?? 0) * 1 +
        (r.engagement_reply_count ?? 0) * 2 +
        (r.engagement_followup_count ?? 0) * 2 +
        (led ? 5 : 0);

      const key = `${r.organization_id}|${classification.classification_category}|${classification.sentiment}|${strategy_type}`;
      const existing = agg.get(key);
      if (existing) {
        existing.total_uses += 1;
        existing.successful_interactions += successful ? 1 : 0;
        existing.engagement_score += engagement;
      } else {
        agg.set(key, {
          organization_id: r.organization_id,
          classification_category: classification.classification_category,
          sentiment: classification.sentiment,
          strategy_type,
          total_uses: 1,
          successful_interactions: successful ? 1 : 0,
          engagement_score: engagement,
        });
      }
    }

    offset += rows.length;
    if (rows.length < BATCH_LIMIT) break;
  }

  if (agg.size === 0) {
    void recordMetric('response_strategy_learning_worker', 'processed', totalProcessed, 'jobs').catch(() => {});
    void recordMetric('response_strategy_learning_worker', 'duration_ms', Date.now() - startMs, 'ms').catch(() => {});
    return { processed: totalProcessed, upserted: 0, errors: 0 };
  }

  const now = new Date().toISOString();
  let upserted = 0;

  for (const row of agg.values()) {
    const confidence_score = Math.log((row.total_uses ?? 0) + 1);

    const { error } = await supabase.from('response_strategy_intelligence').upsert(
      {
        organization_id: row.organization_id,
        classification_category: row.classification_category,
        sentiment: row.sentiment,
        strategy_type: row.strategy_type,
        total_uses: row.total_uses,
        successful_interactions: row.successful_interactions,
        engagement_score: row.engagement_score,
        confidence_score,
        last_updated_at: now,
      },
      {
        onConflict: 'organization_id,classification_category,sentiment,strategy_type',
      }
    );

    if (!error) upserted++;
    else console.warn('[responseStrategyLearning] upsert error', error.message);
  }

  void recordMetric('response_strategy_learning_worker', 'processed', totalProcessed, 'jobs').catch(() => {});
  void recordMetric('response_strategy_learning_worker', 'upserted', upserted, 'jobs').catch(() => {});
  void recordMetric('response_strategy_learning_worker', 'duration_ms', Date.now() - startMs, 'ms').catch(() => {});

  return { processed: totalProcessed, upserted, errors: 0 };
}
