import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET|POST /api/cron/email-jobs
 *
 * Phase 2.A.1 — async email delivery worker.
 *
 * Cron-triggered: configured at every minute in vercel.json. Each invocation:
 *   1. Authenticates the caller via CRON_SECRET bearer (same pattern as
 *      pages/api/cron/process-scheduled-posts.ts).
 *   2. Claims up to BATCH_SIZE jobs atomically via claim_email_jobs RPC
 *      (5-min visibility timeout, FOR UPDATE SKIP LOCKED, retry_count <
 *      max_retries, dead_lettered_at IS NULL).
 *   3. For each claimed job:
 *      a. Writes 'claimed' event (and 'retried' if retry_count > 0).
 *      b. Writes 'sending' event.
 *      c. Decrypts sensitive fields, builds Edge Function envelope.
 *      d. Invokes send-transactional-email Edge Function.
 *      e. On success → finalize_email_job(status='sent').
 *         On failure with retries remaining → finalize_email_job(status='failed',
 *           next_attempt_at = exponential backoff).
 *         On failure with no retries remaining → finalize_email_job(status='dead').
 *   4. Returns a summary { claimed, sent, failed, dead_lettered, decode_failed }.
 *
 * IMPORTANT — security:
 *   - Plaintext temporary passwords ONLY exist in worker memory for the
 *     duration of the Edge Function invoke. They are never logged.
 *   - Decryption errors are logged with the field name, not the value.
 *   - Job claim is bounded (BATCH_SIZE = 20) so a runaway loop cannot
 *     blast all queued mail in a single tick.
 *   - If decryption fails, the job is dead-lettered immediately (no
 *     point in retrying — the key or payload is broken).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomBytes } from 'crypto';

import { supabase } from '../../../backend/db/supabaseClient';
import { logger } from '../../../backend/services/logger';
import {
  buildSendEnvelopeFromClaim,
  computeNextAttemptAt,
} from '../../../backend/services/emailJobsService';

const BATCH_SIZE = 20;

interface ClaimedJob {
  id: string;
  job_type: string;
  template_key: string | null;
  payload: Record<string, unknown> | null;
  payload_encrypted: boolean;
  recipient_email: string;
  subject: string | null;
  html: string | null;
  retry_count: number;
  max_retries: number;
  invitation_id: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  request_id: string | null;
}

function workerId(): string {
  return `cron-${process.env.VERCEL_REGION ?? 'local'}-${randomBytes(4).toString('hex')}`;
}

/**
 * Fire-and-forget event helpers — never block the worker loop.
 */
async function emitEvent(jobId: string, eventType: string, failureReason: string | null = null, metadata: Record<string, unknown> | null = null): Promise<void> {
  const { error } = await supabase.rpc('record_email_event', {
    p_job_id: jobId,
    p_event_type: eventType,
    p_metadata: metadata,
    p_failure_reason: failureReason,
  });
  if (error) {
    logger.warn('email_jobs_worker_event_emit_failed', {
      jobId,
      eventType,
      message: error.message,
    });
  }
}

async function finalize(
  jobId: string,
  status: 'sent' | 'failed' | 'dead',
  opts: {
    error?: string | null;
    providerMessageId?: string | null;
    nextAttemptAt?: Date | null;
  } = {},
): Promise<void> {
  const { error } = await supabase.rpc('finalize_email_job', {
    p_job_id: jobId,
    p_status: status,
    p_error: opts.error ?? null,
    p_provider_message_id: opts.providerMessageId ?? null,
    p_next_attempt_at: opts.nextAttemptAt ? opts.nextAttemptAt.toISOString() : null,
  });
  if (error) {
    logger.error('email_jobs_worker_finalize_failed', {
      jobId,
      status,
      message: error.message,
    });
  }
}

async function processOne(job: ClaimedJob): Promise<'sent' | 'failed' | 'dead' | 'decode_failed'> {
  await emitEvent(job.id, 'claimed', null, { worker_retry_count: job.retry_count });
  if (job.retry_count > 0) {
    await emitEvent(job.id, 'retried', null, { attempt: job.retry_count + 1 });
  }

  // Backwards-compat: legacy rows pre-rendered subject+html and lack a template_key.
  // For those, send the literal subject+html via SES with a degraded code path.
  // Phase 2.A.1 rows always have template_key — both paths are supported below.
  let body: Record<string, unknown> | null = null;
  if (job.template_key) {
    const envelope = buildSendEnvelopeFromClaim({
      template_key: job.template_key,
      payload: job.payload,
      payload_encrypted: job.payload_encrypted,
      recipient_email: job.recipient_email,
    });
    if (envelope.ok !== true) {
      logger.error('email_jobs_worker_envelope_failed', {
        jobId: job.id,
        template: job.template_key,
        error: envelope.error,
      });
      await finalize(job.id, 'dead', { error: `ENVELOPE_FAILED:${envelope.error}` });
      return 'decode_failed';
    }
    body = envelope.body;
  } else if (job.subject && job.html) {
    // Legacy pre-rendered row. Existing callers used company_referral and
    // inbound_signup_notice via direct Edge Function — but a few code paths
    // may have written subject+html only. We have no clean way to send via
    // the typed Edge Function without a template type, so we dead-letter
    // and log loudly. This codepath is NOT used by Phase 2.A.1 enqueues.
    logger.warn('email_jobs_worker_legacy_row_dead_lettered', { jobId: job.id });
    await finalize(job.id, 'dead', { error: 'LEGACY_PRE_RENDERED_ROW_UNSUPPORTED' });
    return 'decode_failed';
  } else {
    await finalize(job.id, 'dead', { error: 'MISSING_TEMPLATE_AND_PRE_RENDERED' });
    return 'decode_failed';
  }

  await emitEvent(job.id, 'sending');

  try {
    const { data, error } = await supabase.functions.invoke('send-transactional-email', {
      body,
    });
    if (error) {
      throw new Error(error.message || 'EDGE_FUNCTION_ERROR');
    }
    const providerMessageId =
      data && typeof data === 'object' && 'message_id' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).message_id)
        : null;
    await finalize(job.id, 'sent', { providerMessageId });
    return 'sent';
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const willRetry = job.retry_count + 1 < job.max_retries;
    if (willRetry) {
      const next = computeNextAttemptAt(job.retry_count);
      await finalize(job.id, 'failed', { error: message, nextAttemptAt: next });
      return 'failed';
    }
    await finalize(job.id, 'dead', { error: message });
    return 'dead';
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cron auth — same pattern as other cron endpoints. Fail closed on missing
  // secret so a misconfigured deploy cannot leak an unauthenticated worker.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.warn('email_jobs_worker_cron_secret_missing');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const id = workerId();
  const summary = {
    worker_id: id,
    claimed: 0,
    sent: 0,
    failed: 0,
    dead_lettered: 0,
    decode_failed: 0,
  };

  try {
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_email_jobs', {
      p_worker_id: id,
      p_limit: BATCH_SIZE,
    });
    if (claimErr) {
      logger.error('email_jobs_worker_claim_failed', { workerId: id, message: claimErr.message });
      return res.status(500).json({ error: 'CLAIM_FAILED', details: claimErr.message });
    }

    const jobs: ClaimedJob[] = Array.isArray(claimed) ? (claimed as ClaimedJob[]) : [];
    summary.claimed = jobs.length;

    for (const job of jobs) {
      const result = await processOne(job);
      if (result === 'sent') summary.sent += 1;
      else if (result === 'failed') summary.failed += 1;
      else if (result === 'dead') summary.dead_lettered += 1;
      else summary.decode_failed += 1;
    }

    return res.status(200).json(summary);
  } catch (err: any) {
    logger.error('email_jobs_worker_unhandled_exception', {
      workerId: id,
      message: err?.message ?? String(err),
    });
    return res.status(500).json({
      error: 'WORKER_FAILED',
      details: err?.message ?? String(err),
      summary,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/email-jobs' });
