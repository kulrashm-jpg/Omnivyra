/**
 * Engagement Signal Queue
 * Queues incoming signals for batch processing (scoring + insert).
 * Batch size: 50 signals.
 */

import { Queue } from 'bullmq';
import { getRedisConfig } from './bullmqClient';
import { calculateEngagementScore } from '../services/engagementScoreService';
import { supabase } from '../db/supabaseClient';

const QUEUE_NAME = 'engagement-signals';
const BATCH_SIZE = 50;

let engagementSignalQueue: Queue | null = null;

export function getEngagementSignalQueue(): Queue {
  if (!engagementSignalQueue) {
    const config = getRedisConfig();
    engagementSignalQueue = new Queue(QUEUE_NAME, {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
      },
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { count: 1000 },
      },
    });
  }
  return engagementSignalQueue;
}

export interface QueuedSignal {
  campaign_id: string;
  activity_id: string;
  platform: string;
  source_type: string;
  source_id?: string | null;
  conversation_url?: string | null;
  author?: string | null;
  content?: string | null;
  signal_type: string;
  sentiment?: string | null;
  author_influence?: number;
  thread_depth?: number;
}

export async function enqueueEngagementSignals(signals: QueuedSignal[]): Promise<number> {
  if (signals.length === 0) return 0;
  const queue = getEngagementSignalQueue();
  let enqueued = 0;
  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE);
    await queue.add('process-batch', { signals: batch }, { jobId: `sig-${Date.now()}-${i}` });
    enqueued += batch.length;
  }
  return enqueued;
}

export async function processEngagementSignalBatch(signals: QueuedSignal[]): Promise<number> {
  const rows = signals.map((s) => {
    const score = calculateEngagementScore({
      signal_type: s.signal_type,
      sentiment: s.sentiment ?? undefined,
      author_influence: s.author_influence,
      thread_depth: s.thread_depth,
    });
    return {
      campaign_id: s.campaign_id,
      activity_id: s.activity_id,
      platform: s.platform,
      source_type: s.source_type,
      source_id: s.source_id ?? null,
      conversation_url: s.conversation_url ?? null,
      author: s.author ?? null,
      content: s.content ?? null,
      signal_type: s.signal_type,
      engagement_score: score,
    };
  });

  const { error } = await supabase
    .from('campaign_activity_engagement_signals')
    .insert(rows);

  if (error) {
    if (error.code === '23505') {
      return 0;
    }
    throw new Error(error.message);
  }
  return rows.length;
}

export async function getEngagementSignalQueueSize(): Promise<number> {
  try {
    const queue = getEngagementSignalQueue();
    const waiting = await queue.getWaitingCount();
    const delayed = await queue.getDelayedCount();
    const active = await queue.getActiveCount();
    return waiting + delayed + active;
  } catch {
    return 0;
  }
}
