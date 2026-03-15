/**
 * Engagement Diagnostics Service
 * Administrative diagnostics for the engagement system.
 */

import { supabase } from '../db/supabaseClient';

const WORKER_COMPONENTS = [
  'conversation_memory_worker',
  'response_performance_evaluation_worker',
  'reply_intelligence_worker',
  'engagement_opportunity_detection_worker',
] as const;

export type WorkerDiagnostics = Record<
  string,
  { last_run_time: string | null; jobs_processed: number; processing_duration_ms: number }
>;

export async function getWorkerDiagnostics(): Promise<WorkerDiagnostics> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('system_health_metrics')
    .select('component, metric_name, metric_value, observed_at')
    .in('component', [...WORKER_COMPONENTS])
    .in('metric_name', ['worker_run', 'jobs_processed', 'processing_duration_ms'])
    .gte('observed_at', since)
    .order('observed_at', { ascending: false });

  if (error) {
    console.warn('[engagementDiagnostics] getWorkerDiagnostics error', error.message);
    return {};
  }

  const rows = (data ?? []) as Array<{
    component: string;
    metric_name: string;
    metric_value: number;
    observed_at: string;
  }>;

  const byComponent: WorkerDiagnostics = {};
  const seen: Record<string, Set<string>> = {};
  for (const c of WORKER_COMPONENTS) {
    byComponent[c] = {
      last_run_time: null,
      jobs_processed: 0,
      processing_duration_ms: 0,
    };
    seen[c] = new Set();
  }

  for (const r of rows) {
    const cur = byComponent[r.component];
    const s = seen[r.component];
    if (!cur || !s) continue;
    const key = r.metric_name;
    if (s.has(key)) continue;
    s.add(key);
    if (r.metric_name === 'worker_run') {
      cur.last_run_time = r.observed_at;
    } else if (r.metric_name === 'jobs_processed') {
      cur.jobs_processed = Number(r.metric_value) || 0;
    } else if (r.metric_name === 'processing_duration_ms') {
      cur.processing_duration_ms = Number(r.metric_value) || 0;
    }
  }

  return byComponent;
}

export type QueueDiagnostics = {
  conversation_memory_rebuild_queue: {
    pending_jobs: number;
    oldest_job_age_seconds: number | null;
  };
};

export async function getQueueDiagnostics(): Promise<QueueDiagnostics> {
  const { count, error: countError } = await supabase
    .from('conversation_memory_rebuild_queue')
    .select('thread_id', { count: 'exact', head: true });

  if (countError) {
    console.warn('[engagementDiagnostics] queue count error', countError.message);
    return {
      conversation_memory_rebuild_queue: { pending_jobs: 0, oldest_job_age_seconds: null },
    };
  }

  const pendingJobs = count ?? 0;
  let oldestJobAgeSeconds: number | null = null;

  if (pendingJobs > 0) {
    const { data: oldest, error: oldestError } = await supabase
      .from('conversation_memory_rebuild_queue')
      .select('scheduled_at')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!oldestError && oldest?.scheduled_at) {
      const scheduled = new Date(oldest.scheduled_at).getTime();
      oldestJobAgeSeconds = Math.max(0, Math.floor((Date.now() - scheduled) / 1000));
    }
  }

  return {
    conversation_memory_rebuild_queue: {
      pending_jobs: pendingJobs,
      oldest_job_age_seconds: oldestJobAgeSeconds,
    },
  };
}

export type IngestionDiagnostics = {
  messages_ingested: number;
  threads_updated: number;
};

export async function getIngestionDiagnostics(): Promise<IngestionDiagnostics> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('system_health_metrics')
    .select('metric_name, metric_value')
    .eq('component', 'engagement_ingestion')
    .in('metric_name', ['messages_ingested', 'threads_updated'])
    .gte('observed_at', since);

  if (error) {
    console.warn('[engagementDiagnostics] getIngestionDiagnostics error', error.message);
    return { messages_ingested: 0, threads_updated: 0 };
  }

  const rows = (data ?? []) as Array<{ metric_name: string; metric_value: number }>;
  let messages_ingested = 0;
  let threads_updated = 0;
  for (const r of rows) {
    const v = Number(r.metric_value) || 0;
    if (r.metric_name === 'messages_ingested') messages_ingested += v;
    else if (r.metric_name === 'threads_updated') threads_updated += v;
  }
  return { messages_ingested, threads_updated };
}

export type ResponseLearningDiagnostics = {
  replies_recorded: number;
  likes_recorded: number;
  lead_conversions: number;
};

export async function getResponseLearningDiagnostics(): Promise<ResponseLearningDiagnostics> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('system_health_metrics')
    .select('metric_name, metric_value')
    .eq('component', 'response_learning_engine')
    .in('metric_name', ['replies_recorded', 'likes_recorded', 'lead_conversions'])
    .gte('observed_at', since);

  if (error) {
    console.warn('[engagementDiagnostics] getResponseLearningDiagnostics error', error.message);
    return { replies_recorded: 0, likes_recorded: 0, lead_conversions: 0 };
  }

  const rows = (data ?? []) as Array<{ metric_name: string; metric_value: number }>;
  let replies_recorded = 0;
  let likes_recorded = 0;
  let lead_conversions = 0;
  for (const r of rows) {
    const v = Number(r.metric_value) || 0;
    if (r.metric_name === 'replies_recorded') replies_recorded += v;
    else if (r.metric_name === 'likes_recorded') likes_recorded += v;
    else if (r.metric_name === 'lead_conversions') lead_conversions += v;
  }
  return { replies_recorded, likes_recorded, lead_conversions };
}

export type ReplyIntelligenceDiagnostics = {
  patterns_learned: number;
  top_pattern_engagement_score: number | null;
};

export async function getReplyIntelligenceDiagnostics(): Promise<ReplyIntelligenceDiagnostics> {
  const { count, error: countError } = await supabase
    .from('response_reply_intelligence')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    console.warn('[engagementDiagnostics] reply intelligence count error', countError.message);
    return { patterns_learned: 0, top_pattern_engagement_score: null };
  }

  const { data: topRow, error: topError } = await supabase
    .from('response_reply_intelligence')
    .select('engagement_score')
    .order('engagement_score', { ascending: false })
    .limit(1)
    .maybeSingle();

  const topScore =
    !topError && topRow?.engagement_score != null
      ? Number(topRow.engagement_score)
      : null;

  return {
    patterns_learned: count ?? 0,
    top_pattern_engagement_score: topScore,
  };
}

export type OpportunityDiagnostics = {
  open_opportunities: number;
  opportunities_detected_last_24h: number;
};

export async function getOpportunityDiagnostics(): Promise<OpportunityDiagnostics> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: openCount, error: openError },
    { count: last24hCount, error: last24hError },
  ] = await Promise.all([
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false),
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .gte('detected_at', since),
  ]);

  if (openError) {
    console.warn('[engagementDiagnostics] open opportunities error', openError.message);
  }
  if (last24hError) {
    console.warn('[engagementDiagnostics] opportunities last 24h error', last24hError.message);
  }

  return {
    open_opportunities: openCount ?? 0,
    opportunities_detected_last_24h: last24hCount ?? 0,
  };
}
