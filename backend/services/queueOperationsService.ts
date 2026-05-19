import { ownedDbTable } from '../db/writeOwner';

export async function recordWorkerHeartbeat(input: {
  workerId: string;
  workerType: string;
  queueName?: string | null;
  status?: 'healthy' | 'warning' | 'degraded' | 'failed' | 'stale';
  concurrency?: number;
  processedCount?: number;
  failedCount?: number;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ownedDbTable('worker_health').upsert({
    worker_id: input.workerId,
    worker_type: input.workerType,
    queue_name: input.queueName ?? null,
    status: input.status ?? 'healthy',
    heartbeat_at: new Date().toISOString(),
    concurrency: input.concurrency ?? 1,
    processed_count: input.processedCount ?? 0,
    failed_count: input.failedCount ?? 0,
    last_error: input.lastError ?? null,
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'worker_id,worker_type' });
}

export async function captureQueueMetrics(input: {
  queueName: 'publishing_jobs' | 'reconciliation_jobs';
  companyId?: string | null;
  websiteId?: string | null;
}) {
  const table = input.queueName;
  let query = ownedDbTable(table).select('status, run_after, created_at, company_id, website_id');
  if (input.companyId) query = query.eq('company_id', input.companyId);
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const now = Date.now();
  const lagSeconds = rows
    .filter((row: any) => ['queued', 'retrying', 'scheduled'].includes(row.status) && row.run_after)
    .reduce((max: number, row: any) => Math.max(max, Math.max(0, Math.floor((now - new Date(row.run_after).getTime()) / 1000))), 0);
  const counts = {
    queued_count: rows.filter((row: any) => row.status === 'queued' || row.status === 'scheduled').length,
    processing_count: rows.filter((row: any) => row.status === 'processing').length,
    retrying_count: rows.filter((row: any) => row.status === 'retrying').length,
    failed_count: rows.filter((row: any) => row.status === 'failed').length,
    dead_letter_count: rows.filter((row: any) => row.status === 'dead_letter').length,
  };
  const { data: metric, error: insertError } = await ownedDbTable('queue_metrics')
    .insert({
      queue_name: table,
      company_id: input.companyId ?? null,
      website_id: input.websiteId ?? null,
      metric_window_start: new Date(now - 60_000).toISOString(),
      metric_window_end: new Date(now).toISOString(),
      ...counts,
      lag_seconds: lagSeconds,
      metadata: { sampled_rows: rows.length },
    })
    .select('*')
    .single();
  if (insertError) throw new Error(insertError.message);
  return metric;
}

export async function getQueueOperationsSnapshot(input: {
  companyId?: string | null;
  websiteId?: string | null;
}) {
  const [publishing, reconciliation, workers] = await Promise.all([
    captureQueueMetrics({ queueName: 'publishing_jobs', companyId: input.companyId, websiteId: input.websiteId }),
    captureQueueMetrics({ queueName: 'reconciliation_jobs', companyId: input.companyId, websiteId: input.websiteId }),
    ownedDbTable('worker_health').select('*').order('heartbeat_at', { ascending: false }).limit(50),
  ]);
  return { publishing, reconciliation, workers: workers.data ?? [] };
}
