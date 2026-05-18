import { ownedDbTable } from '../db/writeOwner';
import { getCmsAdapter, isCmsProvider } from './cms/registry';
import type { CmsProvider } from './cms/types';
import { getIntegration } from './integrationService';
import type { Blog } from './blogService';

export type PublishingJobStatus = 'queued' | 'processing' | 'published' | 'failed' | 'retrying' | 'cancelled' | 'dead_letter' | 'scheduled';
export type PublishingFailureCategory = 'validation' | 'auth' | 'rate_limit' | 'provider' | 'timeout' | 'not_found' | 'unknown';

export interface PublishingJob {
  id: string;
  company_id: string;
  website_id: string | null;
  connection_id: string | null;
  blog_id: string | null;
  provider: CmsProvider;
  job_type: 'publish_post' | 'update_post' | 'schedule_post' | 'sync_post' | 'upload_media';
  status: PublishingJobStatus;
  idempotency_key: string;
  scheduled_for: string | null;
  run_after: string;
  attempt_count: number;
  max_attempts: number;
  request_payload: Record<string, unknown>;
  provider_response: Record<string, unknown>;
  provider_response_snapshots?: unknown[];
  last_error: string | null;
  created_by: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
  lock_expires_at?: string | null;
}

export interface CreatePublishingJobInput {
  companyId: string;
  websiteId?: string | null;
  connectionId?: string | null;
  blogId?: string | null;
  provider: CmsProvider;
  jobType?: PublishingJob['job_type'];
  idempotencyKey: string;
  requestPayload?: Record<string, unknown>;
  scheduledFor?: string | null;
  createdBy?: string | null;
}

export interface WorkerRunResult {
  claimed: number;
  published: number;
  retrying: number;
  failed: number;
  deadLettered: number;
}

export async function createPublishingJob(input: CreatePublishingJobInput): Promise<PublishingJob> {
  const runAfter = input.scheduledFor ?? new Date().toISOString();
  const { data, error } = await ownedDbTable('publishing_jobs')
    .upsert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      connection_id: input.connectionId ?? null,
      blog_id: input.blogId ?? null,
      provider: input.provider,
      job_type: input.jobType ?? (input.scheduledFor ? 'schedule_post' : 'publish_post'),
      status: input.scheduledFor ? 'scheduled' : 'queued',
      idempotency_key: input.idempotencyKey,
      scheduled_for: input.scheduledFor ?? null,
      run_after: runAfter,
      request_payload: input.requestPayload ?? {},
      created_by: input.createdBy ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,idempotency_key' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PublishingJob;
}

export async function claimDuePublishingJobs(input: {
  workerId: string;
  limit?: number;
  lockMs?: number;
}): Promise<PublishingJob[]> {
  await recoverStalePublishingJobs(input.workerId);
  const now = new Date().toISOString();
  const { data, error } = await ownedDbTable('publishing_jobs')
    .select('*')
    .in('status', ['queued', 'retrying', 'scheduled'])
    .lte('run_after', now)
    .order('run_after', { ascending: true })
    .limit(input.limit ?? 5);
  if (error) throw new Error(error.message);

  const claimed: PublishingJob[] = [];
  for (const row of data || []) {
    const lockExpiresAt = new Date(Date.now() + (input.lockMs ?? 120_000)).toISOString();
    const claim = await ownedDbTable('publishing_jobs')
      .update({
        status: 'processing',
        locked_by: input.workerId,
        locked_at: now,
        lock_expires_at: lockExpiresAt,
        updated_at: now,
      })
      .eq('id', row.id)
      .in('status', ['queued', 'retrying', 'scheduled'])
      .select('*')
      .maybeSingle();
    if (claim.data) claimed.push(claim.data as PublishingJob);
  }
  return claimed;
}

export async function executePublishingJob(jobId: string, workerId = 'inline-worker'): Promise<{ success: boolean; message: string; external_id?: string }> {
  const claimed = await ownedDbTable('publishing_jobs')
    .update({
      status: 'processing',
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      lock_expires_at: new Date(Date.now() + 120_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['queued', 'retrying', 'scheduled', 'processing'])
    .select('*')
    .maybeSingle();
  if (claimed.error || !claimed.data) throw new Error(claimed.error?.message || 'Publishing job not found or not claimable');
  return executeClaimedPublishingJob(claimed.data as PublishingJob, workerId);
}

export async function executeClaimedPublishingJob(job: PublishingJob, workerId: string): Promise<{ success: boolean; message: string; external_id?: string }> {
  if (!isCmsProvider(job.provider)) {
    await markJobFailure(job, `Unsupported CMS provider: ${job.provider}`, 'validation');
    return { success: false, message: `Unsupported CMS provider: ${job.provider}` };
  }

  const started = Date.now();
  const attemptNumber = job.attempt_count + 1;
  const { data: attempt, error: attemptError } = await ownedDbTable('publishing_attempts')
    .insert({
      job_id: job.id,
      attempt_number: attemptNumber,
      status: 'running',
      request_payload: job.request_payload ?? {},
      worker_id: workerId,
    })
    .select('*')
    .single();
  if (attemptError) throw new Error(attemptError.message);

  await ownedDbTable('publishing_jobs')
    .update({ attempt_count: attemptNumber, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  try {
    const blog = await loadPublishingBlog(job);
    const integration = await loadPublishingIntegration(job);
    const adapter = getCmsAdapter(job.provider);
    const result = await adapter.publishPost({
      provider: job.provider,
      companyId: job.company_id,
      connectionId: job.connection_id,
      websiteId: job.website_id,
      config: integration.config,
      timeoutMs: Number(job.request_payload?.timeout_ms ?? 30_000),
    }, {
      blog,
      htmlContent: String(job.request_payload?.html_content ?? ''),
      scheduledFor: job.scheduled_for,
      status: job.job_type === 'schedule_post' || job.scheduled_for ? 'future' : String(job.request_payload?.publish_status || 'publish') as any,
    });

    const duration = Date.now() - started;
    const category = result.success ? null : categorizeFailure(result.message);
    await ownedDbTable('publishing_attempts')
      .update({
        status: result.success ? 'succeeded' : 'failed',
        provider_response: result.providerResponse ?? {},
        error_message: result.success ? null : result.message,
        duration_ms: duration,
        failure_category: category,
        finished_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);

    if (result.success) {
      await markJobPublished(job, result, duration);
      await ownedDbTable('blogs')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          external_id: result.externalId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.blog_id)
        .eq('company_id', job.company_id);
      return { success: true, message: result.message, external_id: result.externalId };
    }

    await markJobFailure(job, result.message, category, attemptNumber, result.providerResponse, duration);
    return { success: false, message: result.message };
  } catch (err) {
    const duration = Date.now() - started;
    const message = err instanceof Error ? err.message : 'Publishing job failed';
    const category = categorizeFailure(message);
    await ownedDbTable('publishing_attempts')
      .update({
        status: 'failed',
        error_message: message,
        failure_category: category,
        duration_ms: duration,
        finished_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);
    await markJobFailure(job, message, category, attemptNumber, undefined, duration);
    return { success: false, message };
  }
}

export async function runPublishingWorker(input: { workerId?: string; limit?: number; lockMs?: number } = {}): Promise<WorkerRunResult> {
  const workerId = input.workerId ?? `publisher-${Date.now()}`;
  const jobs = await claimDuePublishingJobs({ workerId, limit: input.limit ?? 5, lockMs: input.lockMs });
  const result: WorkerRunResult = { claimed: jobs.length, published: 0, retrying: 0, failed: 0, deadLettered: 0 };

  for (const job of jobs) {
    const execution = await executeClaimedPublishingJob(job, workerId);
    if (execution.success) result.published += 1;
    else {
      const refreshed = await ownedDbTable('publishing_jobs').select('status').eq('id', job.id).maybeSingle();
      if ((refreshed.data as any)?.status === 'dead_letter') result.deadLettered += 1;
      else if ((refreshed.data as any)?.status === 'retrying') result.retrying += 1;
      else result.failed += 1;
    }
  }

  return result;
}

export async function recoverStalePublishingJobs(workerId = 'stale-recovery'): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await ownedDbTable('publishing_jobs')
    .select('id, attempt_count')
    .eq('status', 'processing')
    .lt('lock_expires_at', now)
    .limit(50);
  let recovered = 0;
  for (const job of data || []) {
    await ownedDbTable('publishing_jobs')
      .update({
        status: 'retrying',
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        run_after: new Date(Date.now() + backoffMs(Number((job as any).attempt_count || 0))).toISOString(),
        last_error: `Recovered stale processing job by ${workerId}`,
        updated_at: now,
      })
      .eq('id', job.id);
    recovered += 1;
  }
  return recovered;
}

async function loadPublishingBlog(job: PublishingJob): Promise<Blog> {
  const { data, error } = await ownedDbTable('blogs')
    .select('*')
    .eq('id', job.blog_id)
    .eq('company_id', job.company_id)
    .single();
  if (error || !data) throw new Error(error?.message || 'Blog not found for publishing job');
  return data as Blog;
}

async function loadPublishingIntegration(job: PublishingJob) {
  const { data } = await ownedDbTable('company_integrations')
    .select('id')
    .eq('company_id', job.company_id)
    .eq('website_connection_id', job.connection_id)
    .maybeSingle();
  if (!data?.id) throw new Error('Integration not found for publishing connection');
  const integration = await getIntegration(String(data.id), job.company_id);
  if (!integration) throw new Error('Integration not found for publishing connection');
  return integration;
}

async function markJobPublished(job: PublishingJob, result: { providerResponse?: unknown; externalId?: string; message: string }, duration: number): Promise<void> {
  const response = (result.providerResponse ?? {}) as Record<string, unknown>;
  await ownedDbTable('publishing_jobs')
    .update({
      status: 'published',
      provider_response: response,
      provider_response_snapshots: [...(Array.isArray(job.provider_response_snapshots) ? job.provider_response_snapshots : []), response],
      last_error: null,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      execution_duration_ms: duration,
      metrics: { duration_ms: duration, attempts: job.attempt_count + 1 },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  await logPublishingEvent(job, 'publish_succeeded', 'info', result.message, { external_id: result.externalId, duration_ms: duration });
}

async function markJobFailure(
  job: PublishingJob,
  message: string,
  category: PublishingFailureCategory,
  attemptNumber = job.attempt_count,
  providerResponse?: unknown,
  duration?: number,
): Promise<void> {
  const exhausted = attemptNumber >= job.max_attempts || category === 'validation' || category === 'auth';
  const status: PublishingJobStatus = exhausted ? 'dead_letter' : 'retrying';
  const nextRetryAt = exhausted ? null : new Date(Date.now() + backoffMs(attemptNumber)).toISOString();
  await ownedDbTable('publishing_jobs')
    .update({
      status,
      provider_response: providerResponse ?? {},
      last_error: message,
      failure_category: category,
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
      next_retry_at: nextRetryAt,
      run_after: nextRetryAt ?? new Date().toISOString(),
      dead_letter_at: exhausted ? new Date().toISOString() : null,
      execution_duration_ms: duration ?? null,
      metrics: { duration_ms: duration ?? null, attempts: attemptNumber, failure_category: category },
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  await logPublishingEvent(job, exhausted ? 'publish_dead_lettered' : 'publish_retrying', 'error', message, {
    failure_category: category,
    attempt_number: attemptNumber,
    next_retry_at: nextRetryAt,
  });
}

async function logPublishingEvent(job: PublishingJob, eventName: string, level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown>): Promise<void> {
  await ownedDbTable('integration_logs').insert({
    company_id: job.company_id,
    website_id: job.website_id,
    connection_id: job.connection_id,
    provider: job.provider,
    event_name: eventName,
    level,
    message,
    metadata: { ...metadata, job_id: job.id },
  });
}

function backoffMs(attemptNumber: number): number {
  const base = Math.min(Math.max(attemptNumber, 1), 6);
  return Math.min(60 * 60 * 1000, 2 ** base * 30_000);
}

function categorizeFailure(message: string): PublishingFailureCategory {
  const text = message.toLowerCase();
  if (text.includes('credential') || text.includes('auth') || text.includes('401') || text.includes('403')) return 'auth';
  if (text.includes('timeout') || text.includes('aborted')) return 'timeout';
  if (text.includes('429') || text.includes('rate')) return 'rate_limit';
  if (text.includes('not found') || text.includes('missing')) return 'not_found';
  if (text.includes('required') || text.includes('unsupported')) return 'validation';
  return 'provider';
}
