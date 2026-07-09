import { ownedDbTable } from '../db/writeOwner';
import { mergeConnectionConfig } from './integrationCredentialService';
import { rediscoverAndRepairApiBase, resolveCanonicalApiBase } from './cms/cmsApiBaseResolver';
import { recordAuditEvent, recordCredentialAccessAudit } from './auditEventService';
import { captureQueueMetrics, recordWorkerHeartbeat } from './queueOperationsService';

export type PublishIntegrityStatus =
  | 'healthy'
  | 'drifted'
  | 'missing'
  | 'duplicate'
  | 'externally_modified'
  | 'orphaned'
  | 'failed';

type ReconciliationClaim = {
  id: string;
  company_id: string;
  website_id?: string | null;
  publishing_job_id?: string | null;
  provider: string;
  external_id?: string | null;
  attempt_count: number;
  max_attempts: number;
  metadata?: Record<string, unknown>;
};

export async function enqueuePublishReconciliation(input: {
  companyId: string;
  websiteId?: string | null;
  publishingJobId?: string | null;
  provider: string;
  externalId?: string | null;
  idempotencyKey?: string | null;
  runAfter?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const key = input.idempotencyKey ?? `publish-integrity:${input.publishingJobId ?? input.externalId ?? cryptoSafeKey(input.provider)}`;
  const { data, error } = await ownedDbTable('reconciliation_jobs')
    .upsert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      publishing_job_id: input.publishingJobId ?? null,
      provider: input.provider,
      external_id: input.externalId ?? null,
      idempotency_key: key,
      run_after: input.runAfter ?? new Date().toISOString(),
      status: 'queued',
      metadata: input.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,idempotency_key' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function enqueuePublishedJobsForReconciliation(input: {
  companyId?: string | null;
  websiteId?: string | null;
  limit?: number;
}) {
  let query = ownedDbTable('publishing_jobs')
    .select('id, company_id, website_id, provider, external_id, external_url, provider_response, blog_id, updated_at')
    .eq('status', 'published')
    .not('external_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(input.limit ?? 50);
  if (input.companyId) query = query.eq('company_id', input.companyId);
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const jobs = data ?? [];
  for (const job of jobs as any[]) {
    await enqueuePublishReconciliation({
      companyId: job.company_id,
      websiteId: job.website_id,
      publishingJobId: job.id,
      provider: job.provider,
      externalId: job.external_id,
      idempotencyKey: `publish-integrity:${job.id}`,
      metadata: { external_url: job.external_url, provider_response: job.provider_response, blog_id: job.blog_id },
    });
  }
  return { queued: jobs.length };
}

export async function runPublishReconciliationWorker(input: {
  workerId?: string;
  limit?: number;
  lockSeconds?: number;
}) {
  const workerId = input.workerId ?? `reconcile-${Date.now()}`;
  await recordWorkerHeartbeat({ workerId, workerType: 'reconciliation', queueName: 'reconciliation_jobs', status: 'healthy' });
  const claims = await claimReconciliationJobs(workerId, input.limit ?? 5, input.lockSeconds ?? 120);
  const results = [];
  for (const claim of claims) {
    results.push(await executeReconciliationJob(claim, workerId));
  }
  const failed = results.filter((result) => result.status === 'failed').length;
  await recordWorkerHeartbeat({
    workerId,
    workerType: 'reconciliation',
    queueName: 'reconciliation_jobs',
    status: failed ? 'warning' : 'healthy',
    processedCount: results.length,
    failedCount: failed,
    metadata: { claimed: claims.length },
  });
  await captureQueueMetrics({ queueName: 'reconciliation_jobs' }).catch(() => null);
  return { workerId, claimed: claims.length, results };
}

async function claimReconciliationJobs(workerId: string, limit: number, lockSeconds: number): Promise<ReconciliationClaim[]> {
  const { data, error } = await ownedDbTable('reconciliation_jobs')
    .select('*')
    .in('status', ['queued', 'retrying'])
    .lte('run_after', new Date().toISOString())
    .order('run_after', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const claims: ReconciliationClaim[] = [];
  for (const job of (data ?? []) as any[]) {
    const lockExpires = new Date(Date.now() + lockSeconds * 1000).toISOString();
    const { data: updated, error: updateError } = await ownedDbTable('reconciliation_jobs')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        lock_expires_at: lockExpires,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .in('status', ['queued', 'retrying'])
      .select('*')
      .maybeSingle();
    if (!updateError && updated) claims.push(updated as ReconciliationClaim);
  }
  return claims;
}

async function executeReconciliationJob(job: ReconciliationClaim, workerId: string) {
  const started = Date.now();
  const attemptNumber = (job.attempt_count ?? 0) + 1;
  let status: PublishIntegrityStatus = 'failed';
  let snapshot: Record<string, unknown> = {};
  let driftSummary: Record<string, unknown> = {};
  let errorMessage: string | null = null;

  try {
    const context = await loadPublishingContext(job);
    const result = await verifyExternalPublish(context);
    status = result.status;
    snapshot = result.providerSnapshot;
    driftSummary = result.driftSummary;
    await upsertIntegrityStatus(job, context, status, snapshot, driftSummary);
    await ownedDbTable('reconciliation_jobs')
      .update({
        status,
        attempt_count: attemptNumber,
        last_error: null,
        locked_at: null,
        locked_by: null,
        lock_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Reconciliation failed';
    const dead = attemptNumber >= (job.max_attempts ?? 3);
    await ownedDbTable('reconciliation_jobs')
      .update({
        status: dead ? 'dead_letter' : 'retrying',
        attempt_count: attemptNumber,
        last_error: errorMessage,
        run_after: new Date(Date.now() + backoffMs(attemptNumber)).toISOString(),
        locked_at: null,
        locked_by: null,
        lock_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    status = 'failed';
  }

  const durationMs = Date.now() - started;
  await ownedDbTable('reconciliation_attempts').insert({
    reconciliation_job_id: job.id,
    attempt_number: attemptNumber,
    status,
    provider_snapshot: snapshot,
    drift_summary: driftSummary,
    error_message: errorMessage,
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
  });
  await recordAuditEvent({
    companyId: job.company_id,
    websiteId: job.website_id,
    actorType: 'worker',
    action: 'publishing.reconcile',
    resourceType: 'reconciliation_job',
    resourceId: job.id,
    severity: status === 'healthy' ? 'info' : 'warning',
    metadata: { status, worker_id: workerId, duration_ms: durationMs },
  });
  return { id: job.id, status, durationMs, error: errorMessage };
}

async function loadPublishingContext(job: ReconciliationClaim) {
  const { data: publishingJob } = job.publishing_job_id
    ? await ownedDbTable('publishing_jobs')
        .select('*, blogs(id, title, slug, updated_at)')
        .eq('id', job.publishing_job_id)
        .maybeSingle()
    : { data: null };
  const connectionId = (publishingJob as any)?.connection_id ?? (job.metadata?.connection_id as string | undefined);
  const { data: connection } = connectionId
    ? await ownedDbTable('website_connections').select('*').eq('id', connectionId).maybeSingle()
    : { data: null };
  const config = await mergeConnectionConfig(
    connectionId,
    ((connection as any)?.non_secret_config ?? {}) as Record<string, string>,
    {},
  );
  await recordCredentialAccessAudit({
    companyId: job.company_id,
    websiteId: job.website_id,
    connectionId,
    actorType: 'worker',
    purpose: 'publish_reconciliation',
  });
  return {
    job,
    publishingJob: publishingJob as any,
    connection: connection as any,
    config,
    externalId: job.external_id ?? (publishingJob as any)?.external_id,
  };
}

async function verifyExternalPublish(context: Awaited<ReturnType<typeof loadPublishingContext>>): Promise<{
  status: PublishIntegrityStatus;
  providerSnapshot: Record<string, unknown>;
  driftSummary: Record<string, unknown>;
}> {
  if (context.job.provider !== 'wordpress') {
    return {
      status: 'healthy',
      providerSnapshot: { provider: context.job.provider, check: 'provider_not_deep_supported' },
      driftSummary: {},
    };
  }
  const siteUrl = String(context.config.site_url || '').replace(/\/$/, '');
  const username = context.config.username;
  const appPassword = context.config.app_password;
  if (!siteUrl || !username || !appPassword) throw new Error('WordPress credentials are missing for reconciliation');
  if (!context.externalId) return { status: 'orphaned', providerSnapshot: {}, driftSummary: { reason: 'missing_external_id' } };

  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const connectionId = (context.connection as any)?.id ?? null;

  // Reconciliation uses the SAME canonical API base as publishing — never the
  // hardcoded /wp-json/wp/v2 (broke /wp, subdir & proxy installs).
  // HARDEN-005A: WordPress siteUrl/base is customer-configured — SSRF-safe fetch.
  const { safeFetch } = await import('../../lib/security/safeFetch');
  const resolved = await resolveCanonicalApiBase({
    provider: 'wordpress',
    siteUrl,
    connectionId,
    fetchFn: (url) => safeFetch(url, {}, { allowHttp: true, maxBytes: 10 * 1024 * 1024 }),
  });
  let apiBase = resolved.apiBase;
  const fetchPost = (base: string) =>
    safeFetch(`${base}/posts/${encodeURIComponent(context.externalId!)}?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
    }, { allowHttp: true, maxBytes: 10 * 1024 * 1024 });

  let res = await fetchPost(apiBase);

  // A 404 may mean the post is gone OR the REST root moved. Repair the base
  // once before concluding the external post is missing (avoids false drift).
  if (res.status === 404) {
    const repaired = await rediscoverAndRepairApiBase({
      provider: 'wordpress',
      siteUrl,
      connectionId,
      fetchFn: (url) => safeFetch(url, {}, { allowHttp: true, maxBytes: 10 * 1024 * 1024 }),
    });
    if (repaired.apiBase && repaired.apiBase !== apiBase) {
      apiBase = repaired.apiBase;
      res = await fetchPost(apiBase);
    }
  }

  const payload = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { status: 'missing', providerSnapshot: { status: res.status }, driftSummary: { reason: 'external_post_missing' } };
  }
  if (!res.ok) throw new Error(`WordPress reconciliation returned status ${res.status}`);

  const expectedTitle = String(context.publishingJob?.blogs?.title ?? '').trim();
  const externalTitle = String(payload?.title?.raw || payload?.title?.rendered || '').replace(/<[^>]*>/g, '').trim();
  const expectedUrl = String(context.publishingJob?.external_url || '');
  const externalUrl = String(payload?.link || '');
  const differences: Record<string, unknown> = {};
  if (expectedTitle && externalTitle && expectedTitle !== externalTitle) differences.title = { expected: expectedTitle, actual: externalTitle };
  if (expectedUrl && externalUrl && expectedUrl !== externalUrl) differences.permalink = { expected: expectedUrl, actual: externalUrl };
  if (payload?.status && !['publish', 'future', 'draft'].includes(payload.status)) differences.status = payload.status;

  return {
    status: Object.keys(differences).length ? 'externally_modified' : 'healthy',
    providerSnapshot: payload,
    driftSummary: differences,
  };
}

async function upsertIntegrityStatus(
  job: ReconciliationClaim,
  context: Awaited<ReturnType<typeof loadPublishingContext>>,
  status: PublishIntegrityStatus,
  providerSnapshot: Record<string, unknown>,
  driftSummary: Record<string, unknown>,
) {
  await ownedDbTable('publish_integrity_status').upsert({
    company_id: job.company_id,
    website_id: job.website_id ?? null,
    publishing_job_id: job.publishing_job_id ?? null,
    blog_id: context.publishingJob?.blog_id ?? null,
    provider: job.provider,
    external_id: context.externalId ?? null,
    external_url: providerSnapshot.link ?? context.publishingJob?.external_url ?? null,
    integrity_status: status === 'failed' ? 'drifted' : status,
    last_checked_at: new Date().toISOString(),
    drift_summary: driftSummary,
    provider_snapshot: providerSnapshot,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,publishing_job_id' });
}

function backoffMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * Math.pow(2, Math.max(0, attempt - 1)));
}

function cryptoSafeKey(value: string): string {
  return Buffer.from(value).toString('base64url').slice(0, 24);
}
