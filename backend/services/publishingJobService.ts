import { ownedDbTable } from '../db/writeOwner';
import { getCmsAdapter, isCmsProvider } from './cms/registry';
import type { CmsProvider } from './cms/types';
import { getIntegration } from './integrationService';
import type { Blog } from './blogService';
import { captureQueueMetrics, recordWorkerHeartbeat } from './queueOperationsService';
import { runWorkerSnapshotShadowHook } from './workerSnapshotShadowHook';
import { recordAuditEvent } from './auditEventService';
import { randomUUID } from 'crypto';

export type PublishingJobStatus = 'queued' | 'processing' | 'published' | 'failed' | 'retrying' | 'cancelled' | 'dead_letter' | 'scheduled';
export type PublishingFailureCategory = 'validation' | 'auth' | 'rate_limit' | 'provider' | 'timeout' | 'not_found' | 'unknown' | 'uncertain' | 'unsupported';

/**
 * A CREATE whose outcome is unknown: the provider call STARTED and did not come back as a clear
 * rejection (a timeout, a 5xx, a socket error, an unrecognised failure, or a failure that still
 * carried an external id). The post may be LIVE, so it is never retried automatically: the job is
 * dead-lettered for a person to verify on the site (05, 2026-11-12).
 * ONE constant, written by the attempt/job writers and read by stale recovery: failure_category is
 * TEXT with no CHECK, so two literals that drift apart would silently turn "uncertain" into a
 * retry - a double publish. Never spell this value out anywhere else.
 */
export const UNCERTAIN_PUBLISH_CATEGORY: PublishingFailureCategory = 'uncertain';

/** Server-side REFUSALS: nothing was created, so a retry is safe. Everything else is uncertain. */
const DEFINITE_REJECTIONS: readonly PublishingFailureCategory[] = ['validation', 'auth', 'not_found', 'rate_limit'];

/** update/delete target an existing external id: a retry cannot create a second post. */
const isCreateJob = (job: Pick<PublishingJob, 'job_type'>): boolean =>
  job.job_type !== 'update_post' && job.job_type !== 'delete_post';

export const UNCERTAIN_PUBLISH_MESSAGE =
  'Publish outcome unknown: the CMS call started but did not return a clear answer, so the post may or may not be live. Verify on the site before retrying.';

/**
 * Classify a RETURNED failure. Exported so each CMS adapter's failure messages can be held to it
 * (no transport failure may map into a definite rejection).
 */
export function classifyPublishFailure(
  job: Pick<PublishingJob, 'job_type'>,
  result: { message: string; externalId?: string; unsupported?: true },
): PublishingFailureCategory {
  // The adapter says so STRUCTURALLY (no network call was made), so this is never a guess from text.
  if (result.unsupported === true && !result.externalId) return 'unsupported';
  const category = categorizeFailure(result.message);
  if (!isCreateJob(job)) return category;
  if (result.externalId) return UNCERTAIN_PUBLISH_CATEGORY; // something was created
  return DEFINITE_REJECTIONS.includes(category) ? category : UNCERTAIN_PUBLISH_CATEGORY;
}

export interface PublishingJob {
  id: string;
  company_id: string;
  website_id: string | null;
  connection_id: string | null;
  blog_id: string | null;
  provider: CmsProvider;
  job_type: 'publish_post' | 'update_post' | 'delete_post' | 'schedule_post' | 'sync_post' | 'upload_media';
  status: PublishingJobStatus;
  idempotency_key: string;
  scheduled_for: string | null;
  run_after: string;
  attempt_count: number;
  /**
   * PER-JOB and MUTABLE: a manual retry of a dead-lettered job raises it (requeueDeadLetteredPublishingJob),
   * so it is not a constant per job type. Nothing should reason about it as one - compare it only with
   * this job's own attempt_count (05).
   */
  max_attempts: number;
  request_payload: Record<string, unknown>;
  provider_response: Record<string, unknown>;
  provider_response_snapshots?: unknown[];
  last_error: string | null;
  created_by: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
  lock_expires_at?: string | null;
  external_id?: string | null;
  external_url?: string | null;
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

/**
 * An existing job with the same key may be RE-ARMED (its payload and timing replaced, and run
 * again) only from these states - nothing of it is in flight and nothing of it is live. `failed`
 * is terminal-unsupported (no call was made); `cancelled` never ran.
 */
const REARMABLE_STATUSES: readonly PublishingJobStatus[] = ['queued', 'retrying', 'scheduled', 'failed', 'cancelled'];

/**
 * Create the job for (company, idempotency key), or return the one that already holds the key.
 *
 * CLASS-2 (e9 sweep, 2026-11-12): this was an upsert with ON CONFLICT DO UPDATE, which reset ANY
 * existing job to queued - a second Publish click (or a second tab) during a live run reset the
 * `processing` job and ran it again (a DUPLICATE post), and re-armed a `published` job or an
 * outcome-unknown `dead_letter` one past the confirm gate. Now: insert ON CONFLICT DO NOTHING (the
 * unique key publishing_jobs_idempotency_unique is the constraint); an existing job is re-armed
 * only from REARMABLE_STATUSES, by a compare-and-set on the status read with the row count
 * checked. A job that is processing / published / dead_letter is returned UNTOUCHED and the
 * caller decides from its status.
 */
export async function createPublishingJob(input: CreatePublishingJobInput): Promise<PublishingJob> {
  const now = new Date().toISOString();
  const fields = {
    website_id: input.websiteId ?? null,
    connection_id: input.connectionId ?? null,
    blog_id: input.blogId ?? null,
    provider: input.provider,
    job_type: input.jobType ?? (input.scheduledFor ? 'schedule_post' : 'publish_post'),
    status: (input.scheduledFor ? 'scheduled' : 'queued') as PublishingJobStatus,
    scheduled_for: input.scheduledFor ?? null,
    run_after: input.scheduledFor ?? now,
    request_payload: input.requestPayload ?? {},
    updated_at: now,
  };
  const { data: inserted, error } = await ownedDbTable('publishing_jobs')
    .upsert({
      ...fields,
      company_id: input.companyId,
      idempotency_key: input.idempotencyKey,
      created_by: input.createdBy ?? null,
    }, { onConflict: 'company_id,idempotency_key', ignoreDuplicates: true })
    .select('*');
  if (error) throw new Error(error.message);
  if (Array.isArray(inserted) && inserted.length > 0) return inserted[0] as PublishingJob;

  const existing = await readJobByKey(input.companyId, input.idempotencyKey);
  if (!REARMABLE_STATUSES.includes(existing.status)) return existing;
  const { data: rearmed, error: rearmError } = await ownedDbTable('publishing_jobs')
    .update({
      ...fields,
      next_retry_at: null, dead_letter_at: null, failure_category: null, last_error: null,
      locked_by: null, locked_at: null, lock_expires_at: null,
      max_attempts: Math.max(Number(existing.max_attempts) || 0, (Number(existing.attempt_count) || 0) + 1),
    })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .select('*');
  if (rearmError) throw new Error(`Publishing job not re-armed: ${rearmError.message}`);
  if (Array.isArray(rearmed) && rearmed.length === 1) return rearmed[0] as PublishingJob;
  // Another request moved it between the read and the write: return what it is now, untouched.
  return readJobByKey(input.companyId, input.idempotencyKey);
}

async function readJobByKey(companyId: string, idempotencyKey: string): Promise<PublishingJob> {
  const { data, error } = await ownedDbTable('publishing_jobs')
    .select('*')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(`Publishing job unreadable: ${error.message}`);
  if (!data) throw new Error('Publishing job neither created nor found by its idempotency key');
  return data as PublishingJob;
}

/**
 * The claim a run holds: still `processing` AND the exact lock it took (locked_by + locked_at).
 * Every write that acts on the claim filters on it, so a run whose lock expired - and whose job was
 * recovered and claimed again - cannot write over the newer run (CLASS-2). A worker process reuses
 * one locked_by for every claim, so locked_at is what tells two claims apart.
 */
function whereClaimHeld<Q>(query: Q, job: PublishingJob): Q {
  return (query as any).eq('status', 'processing').eq('locked_by', job.locked_by ?? null).eq('locked_at', job.locked_at ?? null);
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
    // An unwritten claim is not a claim: the job is not run (fail closed), and it is logged.
    if (claim.error) { console.error('[publishingJob] claim not written; job not run this tick', { job_id: row.id, error: claim.error.message }); continue; }
    if (claim.data) claimed.push(claim.data as PublishingJob);
  }
  return claimed;
}

export type PublishingExecution = { success: boolean; message: string; external_id?: string; external_url?: string; notClaimed?: true };

/**
 * Run ONE job now (Publish now). Claims only a job that is waiting (queued / retrying / scheduled):
 * a job already `processing` belongs to another run - claiming it too called the CMS twice
 * (CLASS-2). Not claimable -> { notClaimed: true }, nothing written. The default worker id is
 * unique per call, so two inline runs never share a claim identity.
 */
export async function executePublishingJob(jobId: string, workerId = `inline-worker:${randomUUID()}`): Promise<PublishingExecution> {
  const claimed = await ownedDbTable('publishing_jobs')
    .update({
      status: 'processing',
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      lock_expires_at: new Date(Date.now() + 120_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['queued', 'retrying', 'scheduled'])
    .select('*')
    .maybeSingle();
  if (claimed.error) throw new Error(`Publishing job not claimed: ${claimed.error.message}`);
  if (!claimed.data) return { success: false, notClaimed: true, message: 'This post is already being published by another run.' };
  return executeClaimedPublishingJob(claimed.data as PublishingJob, workerId);
}

export async function executeClaimedPublishingJob(job: PublishingJob, workerId: string): Promise<PublishingExecution> {
  if (!isCmsProvider(job.provider)) {
    await markJobFailure(job, `Unsupported CMS provider: ${job.provider}`, 'validation');
    return { success: false, message: `Unsupported CMS provider: ${job.provider}` };
  }

  const started = Date.now();
  const attemptNumber = job.attempt_count + 1;
  // Set IMMEDIATELY before each adapter call: the only fact that separates "we never asked" (safe to
  // retry) from "we asked and do not know" (may be live).
  let providerCallStarted = false;

  // The persisted attempt_count is what bounds retries (max_attempts): a silent failure here let
  // a job retry without end. It is also the CLAIM CHECK, written FIRST and fenced on the claim: a
  // run that lost its claim (lock expired, job recovered and claimed again) stops here, before an
  // attempt row or a provider call - two runs never share an attempt number (CLASS-2).
  const { data: counted, error: countError } = await whereClaimHeld(ownedDbTable('publishing_jobs')
    .update({ attempt_count: attemptNumber, updated_at: new Date().toISOString() })
    .eq('id', job.id), job)
    .select('id');
  if (countError) throw new Error(`Publishing attempt not recorded: ${countError.message}`);
  if (!Array.isArray(counted) || counted.length === 0) {
    console.warn('[publishingJob] claim lost before the provider call; this run stops (nothing sent)', { job_id: job.id, worker_id: workerId });
    return { success: false, notClaimed: true, message: 'This publishing job is now held by another run.' };
  }

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

  try {
    const blog = await loadPublishingBlog(job);
    const integration = await loadPublishingIntegration(job);

    // Env-gated worker shadow snapshot hook (WORKER_SNAPSHOT_SHADOW_ENABLED).
    // Advisory telemetry only — runs after live draft resolution, never throws
    // into the publish path, never alters publish/queue/retry behavior.
    try {
      await runWorkerSnapshotShadowHook({
        jobId: job.id,
        blogId: job.blog_id ?? null,
        companyId: job.company_id,
        liveDraft: blog as unknown as Record<string, unknown>,
        liveDraftRenderedHtml: String(job.request_payload?.html_content ?? ''),
        integrationType: job.provider,
      });
    } catch { /* shadow hook is advisory-only — never affects publishing */ }

    const adapter = getCmsAdapter(job.provider);
    const ctx = {
      provider: job.provider,
      companyId: job.company_id,
      connectionId: job.connection_id,
      websiteId: job.website_id,
      config: integration.config,
      timeoutMs: Number(job.request_payload?.timeout_ms ?? 30_000),
    };
    const externalId = String(job.request_payload?.external_id ?? blog.external_id ?? '');

    let result: { success: boolean; message: string; externalId?: string; externalUrl?: string; providerResponse?: unknown };
    if (job.job_type === 'delete_post') {
      if (!externalId) {
        result = { success: false, message: 'delete_post requires external_id on the blog row.' };
      } else {
        providerCallStarted = true;
        const del = await adapter.deletePost(ctx, externalId);
        result = { success: del.success, message: del.message, providerResponse: del.providerResponse };
      }
    } else if (job.job_type === 'update_post') {
      if (!externalId) {
        result = { success: false, message: 'update_post requires external_id on the blog row.' };
      } else {
        providerCallStarted = true;
        result = await adapter.updatePost(ctx, externalId, {
          blog,
          htmlContent: String(job.request_payload?.html_content ?? ''),
          scheduledFor: job.scheduled_for,
          status: 'publish',
        });
      }
    } else {
      providerCallStarted = true;
      result = await adapter.publishPost(ctx, {
        blog,
        htmlContent: String(job.request_payload?.html_content ?? ''),
        scheduledFor: job.scheduled_for,
        status: job.job_type === 'schedule_post' || job.scheduled_for ? 'future' : String(job.request_payload?.publish_status || 'publish') as any,
      });
    }

    const duration = Date.now() - started;
    const category = result.success ? null : classifyPublishFailure(job, result);
    // LOAD-BEARING for stale recovery, which reads this row to decide whether a stuck job was
    // published: if this write fails the attempt stays 'running' = outcome unknown, which recovery
    // dead-letters for review (never republishes). Logged, not thrown: the provider already answered.
    const { error: attemptResultError } = await ownedDbTable('publishing_attempts')
      .update({
        status: result.success ? 'succeeded' : 'failed',
        provider_response: result.providerResponse ?? {},
        error_message: result.success ? null : result.message,
        duration_ms: duration,
        failure_category: category,
        finished_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);
    if (attemptResultError) {
      console.error('[publishingJob] attempt result NOT recorded; a stale job will be dead-lettered for review, never republished', {
        job_id: job.id, attempt_id: attempt.id, success: result.success, external_id: result.externalId ?? null, error: attemptResultError.message,
      });
    }

    if (result.success) {
      await markJobPublished(job, result, duration);
      if (job.job_type === 'delete_post') {
        const { error: blogError } = await ownedDbTable('blogs')
          .update({
            status: 'archived',
            external_id: null,
            external_url: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.blog_id)
          .eq('company_id', job.company_id);
        if (blogError) logBlogNotUpdated(job, result, blogError.message);
      } else if (job.job_type === 'update_post') {
        const { error: blogError } = await ownedDbTable('blogs')
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.blog_id)
          .eq('company_id', job.company_id);
        if (blogError) logBlogNotUpdated(job, result, blogError.message);
      } else {
        const { error: blogError } = await ownedDbTable('blogs')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            external_id: result.externalId ?? null,
            external_url: result.externalUrl ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.blog_id)
          .eq('company_id', job.company_id);
        if (blogError) logBlogNotUpdated(job, result, blogError.message);
      }
      return { success: true, message: result.message, external_id: result.externalId, external_url: result.externalUrl };
    }

    await markJobFailure(job, result.message, category, attemptNumber, result.providerResponse, duration);
    return { success: false, message: result.message };
  } catch (err) {
    const duration = Date.now() - started;
    const message = err instanceof Error ? err.message : 'Publishing job failed';
    // A throw AFTER the provider call started (timeout, socket, an adapter exception) is uncertain
    // for a create; before it (blog / integration load) nothing was sent.
    const category = providerCallStarted && isCreateJob(job) ? UNCERTAIN_PUBLISH_CATEGORY : categorizeFailure(message);
    // best-effort: the failure is recorded on the job by markJobFailure below; an unwritten attempt stays 'running' (recovery reviews it)
    const { error: catchAttemptError } = await ownedDbTable('publishing_attempts')
      .update({
        status: 'failed',
        error_message: message,
        failure_category: category,
        duration_ms: duration,
        finished_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);
    if (catchAttemptError) console.warn('[publishingJob] failed attempt not recorded', { job_id: job.id, attempt_id: attempt.id, error: catchAttemptError.message });
    await markJobFailure(job, message, category, attemptNumber, undefined, duration);
    return { success: false, message };
  }
}

// ── Dead-letter visibility + manual retry (e9, pre-launch) ───────────────────

/** One blog's stuck publish, with the EVIDENCE an operator needs to decide (05). */
export interface PublishingIssue {
  job_id: string;
  blog_id: string | null;
  provider: string;
  job_type: string;
  dead_letter_at: string;
  last_error: string | null;
  /** The post may be LIVE: a retry must be confirmed after checking the site. */
  outcome_unknown: boolean;
  last_attempt: { status: string; error_message: string | null; started_at: string | null; finished_at: string | null } | null;
}

/**
 * The company's dead-lettered publishing jobs, ONE per blog (the blog's latest job, and only if
 * that job is dead-lettered - a later publish supersedes it). Keyed on the PAIR status =
 * 'dead_letter' AND dead_letter_at set, so a writer that sets one without the other cannot
 * repopulate the queue (05). Reads THROW on error: an unreadable queue is never "no issues".
 */
export async function listPublishingIssues(companyId: string): Promise<PublishingIssue[]> {
  const { data: jobs, error } = await ownedDbTable('publishing_jobs')
    .select('id, blog_id, provider, job_type, status, dead_letter_at, last_error, failure_category, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Publishing jobs unreadable: ${error.message}`);
  const latestPerBlog = new Map<string, any>();
  for (const j of (jobs ?? []) as any[]) {
    const key = String(j.blog_id ?? `job:${j.id}`);
    if (!latestPerBlog.has(key)) latestPerBlog.set(key, j);
  }
  const stuck = [...latestPerBlog.values()].filter((j) => j.status === 'dead_letter' && j.dead_letter_at);
  if (stuck.length === 0) return [];

  const { data: attempts, error: attemptsError } = await ownedDbTable('publishing_attempts')
    .select('job_id, attempt_number, status, error_message, started_at, finished_at')
    .in('job_id', stuck.map((j) => j.id))
    .order('attempt_number', { ascending: false });
  if (attemptsError) throw new Error(`Publishing attempts unreadable: ${attemptsError.message}`);
  const lastAttempt = new Map<string, any>();
  for (const a of (attempts ?? []) as any[]) if (!lastAttempt.has(a.job_id)) lastAttempt.set(a.job_id, a);

  return stuck.map((j) => {
    const a = lastAttempt.get(j.id);
    return {
      job_id: j.id,
      blog_id: j.blog_id ?? null,
      provider: j.provider,
      job_type: j.job_type,
      dead_letter_at: j.dead_letter_at,
      last_error: j.last_error ?? null,
      outcome_unknown: j.failure_category === UNCERTAIN_PUBLISH_CATEGORY,
      last_attempt: a ? { status: a.status, error_message: a.error_message ?? null, started_at: a.started_at ?? null, finished_at: a.finished_at ?? null } : null,
    };
  });
}

export type RequeueResult =
  | { ok: true; outcome_unknown: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_DEAD_LETTER' | 'CONFIRM_OUTCOME_UNKNOWN'; message: string };

/**
 * Re-queue ONE dead-lettered job. Refused unless it is dead-lettered (status AND dead_letter_at).
 * A job whose outcome is UNKNOWN (the post may be live) is re-queued ONLY with an explicit
 * confirmation - enforced HERE, not only in the UI, because a retry may publish a duplicate.
 * Compare-and-set on status = 'dead_letter', so two clicks re-queue it once. Audited.
 */
export async function requeueDeadLetteredPublishingJob(input: {
  jobId: string;
  companyId: string;
  actorUserId: string | null;
  confirmOutcomeUnknown?: boolean;
}): Promise<RequeueResult> {
  const { data: job, error } = await ownedDbTable('publishing_jobs')
    .select('id, company_id, status, dead_letter_at, failure_category, last_error, attempt_count, max_attempts')
    .eq('id', input.jobId)
    .eq('company_id', input.companyId)
    .maybeSingle();
  if (error) throw new Error(`Publishing job unreadable: ${error.message}`);
  if (!job) return { ok: false, code: 'NOT_FOUND', message: 'Publishing job not found.' };
  const j = job as any;
  if (j.status !== 'dead_letter' || !j.dead_letter_at) {
    return { ok: false, code: 'NOT_DEAD_LETTER', message: 'Only a dead-lettered publishing job can be retried.' };
  }
  const outcomeUnknown = j.failure_category === UNCERTAIN_PUBLISH_CATEGORY;
  if (outcomeUnknown && input.confirmOutcomeUnknown !== true) {
    return {
      ok: false,
      code: 'CONFIRM_OUTCOME_UNKNOWN',
      message: 'This post may already be live. Check the site first; retry only with confirmation, or you may publish a duplicate.',
    };
  }
  const now = new Date().toISOString();
  const requeue = ownedDbTable('publishing_jobs')
    .update({
      status: 'queued', run_after: now, next_retry_at: null, dead_letter_at: null, failure_category: null,
      last_error: null, locked_by: null, locked_at: null, lock_expires_at: null,
      // One more attempt beyond what it has used, so a manual retry is never refused by the ceiling.
      // This makes max_attempts per-job MUTABLE state (N manual retries move it N times): readers must
      // compare it with this job's attempt_count only, never treat it as the job type's constant (05).
      max_attempts: Math.max(Number(j.max_attempts) || 0, (Number(j.attempt_count) || 0) + 1),
      updated_at: now,
    })
    .eq('id', input.jobId)
    .eq('company_id', input.companyId)
    .eq('status', 'dead_letter')
    // Pinned to the dead letter that was READ (and confirmed): one that cycled to a newer,
    // outcome-unknown dead letter in between is not re-queued on the old confirmation (CLASS-2).
    .eq('dead_letter_at', j.dead_letter_at);
  const { data: moved, error: moveError } = await (j.failure_category == null
    ? requeue.is('failure_category', null)
    : requeue.eq('failure_category', j.failure_category))
    .select('id');
  if (moveError) throw new Error(`Publishing job not re-queued: ${moveError.message}`);
  if (!Array.isArray(moved) || moved.length === 0) {
    return { ok: false, code: 'NOT_DEAD_LETTER', message: 'This job is no longer dead-lettered (it may already have been retried).' };
  }
  try {
    // best-effort: the re-queue already happened; an audit failure is logged, never undoes it
    await recordAuditEvent({
      companyId: input.companyId, actorUserId: input.actorUserId, actorType: 'user',
      action: 'publishing_job.manual_retry', resourceType: 'publishing_job', resourceId: input.jobId,
      severity: outcomeUnknown ? 'warning' : 'info',
      metadata: { outcome_unknown: outcomeUnknown, confirmed_outcome_unknown: input.confirmOutcomeUnknown === true, previous_last_error: j.last_error ?? null },
    });
  } catch (err) {
    console.error('[publishingJob] manual retry not audited', { job_id: input.jobId, error: err instanceof Error ? err.message : String(err) });
  }
  return { ok: true, outcome_unknown: outcomeUnknown };
}

export async function runPublishingWorker(input: { workerId?: string; limit?: number; lockMs?: number } = {}): Promise<WorkerRunResult> {
  const workerId = input.workerId ?? `publisher-${Date.now()}`;
  await recordWorkerHeartbeat({ workerId, workerType: 'publishing', queueName: 'publishing_jobs', status: 'healthy' });
  const jobs = await claimDuePublishingJobs({ workerId, limit: input.limit ?? 5, lockMs: input.lockMs });
  const result: WorkerRunResult = { claimed: jobs.length, published: 0, retrying: 0, failed: 0, deadLettered: 0 };

  for (const job of jobs) {
    const execution = await executeClaimedPublishingJob(job, workerId);
    if (execution.success) result.published += 1;
    else {
      // best-effort: worker metrics only (published/retrying/failed counters); no job state depends on it
      const refreshed = await ownedDbTable('publishing_jobs').select('status').eq('id', job.id).maybeSingle();
      if (refreshed.error) console.warn('[publishingJob] status for worker metrics unreadable', { job_id: job.id, error: refreshed.error.message });
      if ((refreshed.data as any)?.status === 'dead_letter') result.deadLettered += 1;
      else if ((refreshed.data as any)?.status === 'retrying') result.retrying += 1;
      else result.failed += 1;
    }
  }

  await recordWorkerHeartbeat({
    workerId,
    workerType: 'publishing',
    queueName: 'publishing_jobs',
    status: result.deadLettered || result.failed ? 'warning' : 'healthy',
    processedCount: result.published + result.retrying + result.failed + result.deadLettered,
    failedCount: result.failed + result.deadLettered,
    metadata: { ...result },
  });
  await captureQueueMetrics({ queueName: 'publishing_jobs' }).catch(() => null);
  return result;
}

/**
 * A job left `processing` past its lock. It used to go straight back to `retrying` - which
 * PUBLISHED AGAIN whenever the post had gone out but the job was never marked published (a worker
 * crash after the provider call, or a failed markJobPublished write). Its latest attempt decides:
 *   succeeded        -> it WAS published: mark the job published (repair). Never republish.
 *   running          -> outcome unknown: DEAD-LETTER for a person to verify on the site.
 *   failed + uncertain (UNCERTAIN_PUBLISH_CATEGORY) -> the same dead-letter.
 *   failed (definite rejection) / none -> retrying, as before.
 *   attempt unreadable -> left as it is this tick (logged); the next run decides.
 */
export async function recoverStalePublishingJobs(workerId = 'stale-recovery'): Promise<number> {
  const now = new Date().toISOString();
  // best-effort: an unreadable stale list only delays recovery to the next tick; nothing is re-queued without it
  const { data, error: staleError } = await ownedDbTable('publishing_jobs')
    .select('id, attempt_count, locked_by')
    .eq('status', 'processing')
    .lt('lock_expires_at', now)
    .limit(50);
  if (staleError) console.warn('[publishingJob] stale processing jobs unreadable; recovery deferred', { error: staleError.message });
  let recovered = 0;
  for (const job of data || []) {
    const { data: lastAttempt, error: attemptError } = await ownedDbTable('publishing_attempts')
      .select('status, provider_response, failure_category')
      .eq('job_id', job.id)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attemptError) {
      console.error('[publishingJob] stale job left processing: its last attempt is unreadable, so whether it published is unknown', {
        job_id: job.id, error: attemptError.message,
      });
      continue;
    }
    const lastStatus = (lastAttempt as { status?: string } | null)?.status ?? null;
    const lastCategory = (lastAttempt as { failure_category?: string | null } | null)?.failure_category ?? null;
    const patch: Record<string, unknown> = { locked_by: null, locked_at: null, lock_expires_at: null, updated_at: now };
    if (lastStatus === 'succeeded') {
      Object.assign(patch, { status: 'published', last_error: null, completed_at: now,
        provider_response: (lastAttempt as { provider_response?: unknown }).provider_response ?? {} });
    } else if (lastStatus === 'running' || (lastStatus === 'failed' && lastCategory === UNCERTAIN_PUBLISH_CATEGORY)) {
      Object.assign(patch, { status: 'dead_letter', dead_letter_at: now, failure_category: UNCERTAIN_PUBLISH_CATEGORY,
        last_error: `Stale while publishing (recovered by ${workerId}): the post may or may not be live. Verify on the site before retrying.` });
    } else {
      // failed (a definite rejection) or NO attempt row. No attempt row means the provider was never
      // called ONLY because the attempt row is inserted BEFORE the call and a failed insert aborts
      // the run (executeClaimedPublishingJob). If that insert is ever made best-effort, "none"
      // becomes ambiguous and this branch would double-publish (05).
      Object.assign(patch, { status: 'retrying',
        run_after: new Date(Date.now() + backoffMs(Number((job as any).attempt_count || 0))).toISOString(),
        last_error: `Recovered stale processing job by ${workerId}` });
    }
    // best-effort: a failed recovery write leaves the job processing; the next tick retries the same decision
    // Pinned to the STALE claim that was read (its lock still expired, the same holder): a job
    // finished and claimed again in between holds a fresh lock, and this decision - made from the
    // old run's attempt - must not land on the new run (CLASS-2). Only a moved row counts.
    const holder = (job as { locked_by?: string | null }).locked_by ?? null;
    const recover = ownedDbTable('publishing_jobs')
      .update(patch)
      .eq('id', job.id)
      .eq('status', 'processing')
      .lt('lock_expires_at', now);
    const { data: moved, error: recoverError } = await (holder === null ? recover.is('locked_by', null) : recover.eq('locked_by', holder))
      .select('id');
    if (recoverError) {
      console.warn('[publishingJob] stale job recovery not written; retried next tick', { job_id: job.id, error: recoverError.message });
      continue;
    }
    if (!Array.isArray(moved) || moved.length === 0) continue; // re-claimed or finished since the read
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
  const { data, error } = await ownedDbTable('company_integrations')
    .select('id')
    .eq('company_id', job.company_id)
    .eq('website_connection_id', job.connection_id)
    .maybeSingle();
  // A failed read is not "integration not found": the job records the real cause.
  if (error) throw new Error(`Publishing integration unreadable: ${error.message}`);
  if (!data?.id) throw new Error('Integration not found for publishing connection');
  const integration = await getIntegration(String(data.id), job.company_id);
  if (!integration) throw new Error('Integration not found for publishing connection');
  return integration;
}

async function markJobPublished(job: PublishingJob, result: { providerResponse?: unknown; externalId?: string; externalUrl?: string; message: string }, duration: number): Promise<void> {
  const response = (result.providerResponse ?? {}) as Record<string, unknown>;
  // The post is LIVE. If this write fails the job stays `processing`; stale recovery then reads the
  // 'succeeded' attempt and marks it published - it is never republished. Logged at ERROR.
  const { data: marked, error: publishedError } = await whereClaimHeld(ownedDbTable('publishing_jobs')
    .update({
      status: 'published',
      external_id: result.externalId ?? null,
      external_url: result.externalUrl ?? null,
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
    .eq('id', job.id), job)
    .select('id');
  if (publishedError) {
    console.error('[publishingJob] PUBLISHED but the job was not marked published; stale recovery will repair it from the succeeded attempt (no republish)', {
      job_id: job.id, external_id: result.externalId ?? null, external_url: result.externalUrl ?? null, error: publishedError.message,
    });
  } else if (!Array.isArray(marked) || marked.length === 0) {
    // This run's lock expired and another run holds the job now. The post IS live: the evidence
    // is logged, and the succeeded attempt row records it; the newer run's state is not overwritten.
    console.error('[publishingJob] PUBLISHED after this run lost its claim; the job is held by another run - verify for a duplicate', {
      job_id: job.id, external_id: result.externalId ?? null, external_url: result.externalUrl ?? null,
    });
  }

  await logPublishingEvent(job, 'publish_succeeded', 'info', result.message, {
    external_id: result.externalId,
    external_url: result.externalUrl,
    duration_ms: duration,
  });
}

async function markJobFailure(
  job: PublishingJob,
  message: string,
  category: PublishingFailureCategory,
  attemptNumber = job.attempt_count,
  providerResponse?: unknown,
  duration?: number,
): Promise<void> {
  const uncertain = category === UNCERTAIN_PUBLISH_CATEGORY;
  if (uncertain) message = `${UNCERTAIN_PUBLISH_MESSAGE} (${message})`;
  // Unsupported (no call was made; it can never succeed): TERMINAL `failed` - not retried, and not
  // dead-lettered with "verify on the site", which would be false and would devalue that message.
  const unsupported = category === 'unsupported';
  const exhausted = uncertain || unsupported || attemptNumber >= job.max_attempts || category === 'validation' || category === 'auth';
  const status: PublishingJobStatus = unsupported ? 'failed' : exhausted ? 'dead_letter' : 'retrying';
  const nextRetryAt = exhausted ? null : new Date(Date.now() + backoffMs(attemptNumber)).toISOString();
  // Not silent: an unwritten failure leaves the job `processing`; stale recovery then reads the
  // failed attempt and re-queues it (the retry bound is the persisted attempt_count).
  const { data: failed, error: failureWriteError } = await whereClaimHeld(ownedDbTable('publishing_jobs')
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
      dead_letter_at: status === 'dead_letter' ? new Date().toISOString() : null,
      execution_duration_ms: duration ?? null,
      metrics: { duration_ms: duration ?? null, attempts: attemptNumber, failure_category: category },
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id), job)
    .select('id');
  if (failureWriteError) {
    console.error('[publishingJob] job failure not recorded; stale recovery will re-decide it', { job_id: job.id, status, error: failureWriteError.message });
  } else if (!Array.isArray(failed) || failed.length === 0) {
    // A late outcome from a run that lost its claim: writing `retrying` here re-armed a job another
    // run was publishing (CLASS-2). Not written; the failed attempt row keeps the evidence.
    console.warn('[publishingJob] failure after this run lost its claim; not written over the newer run', { job_id: job.id, status, category });
  }

  await logPublishingEvent(job, exhausted ? 'publish_dead_lettered' : 'publish_retrying', 'error', message, {
    failure_category: category,
    attempt_number: attemptNumber,
    next_retry_at: nextRetryAt,
  });
}

function logBlogNotUpdated(job: PublishingJob, result: { externalId?: string; externalUrl?: string }, error: string): void {
  // The post is live and the job is published; the blog row does not say so. Logged at ERROR with
  // the external id so it can be restored (later update/delete jobs target it by external_id).
  console.error('[publishingJob] published, but the blog row was NOT updated', {
    job_id: job.id, blog_id: job.blog_id, job_type: job.job_type, external_id: result.externalId ?? null, external_url: result.externalUrl ?? null, error,
  });
}

async function logPublishingEvent(job: PublishingJob, eventName: string, level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown>): Promise<void> {
  // best-effort: integration_logs is a log mirror; the job row and the attempt row hold the state
  const { error } = await ownedDbTable('integration_logs').insert({
    company_id: job.company_id,
    website_id: job.website_id,
    connection_id: job.connection_id,
    provider: job.provider,
    event_name: eventName,
    level,
    message,
    metadata: { ...metadata, job_id: job.id },
  });
  if (error) console.warn('[publishingJob] integration log not written', { job_id: job.id, event_name: eventName, error: error.message });
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
