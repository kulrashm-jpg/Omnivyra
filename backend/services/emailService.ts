import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

type EmailJobName = 'magic_link' | 'invite' | 'reset';
type EmailJobStatus = 'pending' | 'processing' | 'failed' | 'sent' | 'dead';

type EmailEnvelope = {
  to: string;
  subject: string;
  html: string;
};

type EmailJobRow = {
  id: string;
  job_type: EmailJobName;
  recipient_email: string;
  subject: string;
  html: string;
  status: EmailJobStatus;
  retry_count: number;
  last_error: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  request_id: string | null;
};

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [750, 2_000, 5_000];

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    throw new Error('EMAIL_TRANSPORT_NOT_CONFIGURED');
  }

  return { apiKey, from };
}

function payloadHash(name: EmailJobName, envelope: EmailEnvelope): string {
  return createHash('sha256')
    .update(JSON.stringify({
      name,
      to: envelope.to.toLowerCase(),
      subject: envelope.subject,
      html: envelope.html,
    }))
    .digest('hex');
}

async function sendViaResend(envelope: EmailEnvelope): Promise<void> {
  const { apiKey, from } = getEmailConfig();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [envelope.to],
      subject: envelope.subject,
      html: envelope.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`EMAIL_SEND_FAILED:${response.status}:${body}`);
  }
}

async function createOrReuseEmailJob(
  name: EmailJobName,
  envelope: EmailEnvelope,
  idempotencyKey?: string,
): Promise<{ jobId: string; replayed: boolean }> {
  const ctx = getRequestContext();
  const normalizedTo = envelope.to.toLowerCase();
  const hash = payloadHash(name, { ...envelope, to: normalizedTo });
  const payload = {
    job_type: name,
    recipient_email: normalizedTo,
    subject: envelope.subject,
    html: envelope.html,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    metadata: null,
    payload_hash: hash,
    idempotency_key: idempotencyKey ?? ctx.idempotencyKey ?? null,
    request_id: ctx.requestId ?? null,
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('email_jobs')
    .insert(payload)
    .select('id')
    .single();

  if (!error && data?.id) {
    return { jobId: data.id as string, replayed: false };
  }

  if (error?.code !== '23505') {
    throw new Error(`EMAIL_JOB_CREATE_FAILED:${error?.message ?? 'unknown'}`);
  }

  let query = supabase
    .from('email_jobs')
    .select('id')
    .eq('job_type', name)
    .eq('recipient_email', normalizedTo)
    .eq('payload_hash', hash)
    .in('status', ['pending', 'processing', 'failed', 'sent'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (payload.idempotency_key) {
    query = supabase
      .from('email_jobs')
      .select('id')
      .eq('idempotency_key', payload.idempotency_key)
      .limit(1);
  }

  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError || !existing?.id) {
    throw new Error(`EMAIL_JOB_REUSE_FAILED:${existingError?.message ?? 'not_found'}`);
  }

  return { jobId: existing.id as string, replayed: true };
}

async function loadEmailJob(jobId: string): Promise<EmailJobRow> {
  const { data, error } = await supabase
    .from('email_jobs')
    .select('id, job_type, recipient_email, subject, html, status, retry_count, last_error, idempotency_key, payload_hash, request_id')
    .eq('id', jobId)
    .single();

  if (error || !data) {
    throw new Error(`EMAIL_JOB_LOAD_FAILED:${error?.message ?? 'unknown'}`);
  }

  return data as EmailJobRow;
}

async function updateEmailJob(
  jobId: string,
  patch: Partial<{
    status: EmailJobStatus;
    retry_count: number;
    last_error: string | null;
    sent_at: string | null;
    next_attempt_at: string | null;
    locked_at: string | null;
    locked_by: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from('email_jobs')
    .update({
      ...patch,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    throw new Error(`EMAIL_JOB_UPDATE_FAILED:${error.message}`);
  }
}

function computeNextAttemptAt(retryCount: number): string {
  const delayMs = RETRY_DELAYS_MS[Math.max(0, retryCount - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  return new Date(Date.now() + delayMs).toISOString();
}

async function completeJob(job: EmailJobRow): Promise<void> {
  await updateEmailJob(job.id, {
    status: 'sent',
    retry_count: job.retry_count + 1,
    last_error: null,
    sent_at: new Date().toISOString(),
    next_attempt_at: null,
    locked_at: null,
    locked_by: null,
  });
}

async function failJob(job: EmailJobRow, error: Error, workerId?: string): Promise<void> {
  const nextRetryCount = job.retry_count + 1;
  const terminal = nextRetryCount >= MAX_RETRIES;
  await updateEmailJob(job.id, {
    status: terminal ? 'dead' : 'failed',
    retry_count: nextRetryCount,
    last_error: error.message,
    next_attempt_at: terminal ? null : computeNextAttemptAt(nextRetryCount),
    locked_at: null,
    locked_by: terminal ? workerId ?? null : null,
  });
}

async function claimEmailJobs(limit = 20, workerId = `inline-${process.pid}`): Promise<EmailJobRow[]> {
  const { data, error } = await supabase.rpc('claim_email_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`EMAIL_JOB_CLAIM_FAILED:${error.message}`);
  }

  return ((data ?? []) as EmailJobRow[]).map((row) => ({
    ...row,
    status: 'processing',
    last_error: null,
  }));
}

async function claimInlineJob(jobId: string, workerId: string): Promise<EmailJobRow | null> {
  const { data, error } = await supabase
    .from('email_jobs')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['pending', 'failed'])
    .select('id, job_type, recipient_email, subject, html, status, retry_count, last_error, idempotency_key, payload_hash, request_id')
    .maybeSingle();

  if (error) {
    throw new Error(`EMAIL_JOB_INLINE_CLAIM_FAILED:${error.message}`);
  }

  return (data as EmailJobRow | null) ?? null;
}

async function attemptJob(job: EmailJobRow, workerId?: string): Promise<void> {
  try {
    await sendViaResend({
      to: job.recipient_email,
      subject: job.subject,
      html: job.html,
    });
    await completeJob(job);
  } catch (error) {
    const resolved = error instanceof Error ? error : new Error(String(error));
    await failJob(job, resolved, workerId);
    logger.warn('email_job_attempt_failed', {
      jobId: job.id,
      jobType: job.job_type,
      recipient: job.recipient_email,
      attempt: job.retry_count + 1,
      error: resolved.message,
    });
    throw resolved;
  }
}

export async function processPendingEmailJobs(limit = 20, workerId = `inline-${process.pid}`): Promise<number> {
  const claimed = await claimEmailJobs(limit, workerId);
  let processed = 0;
  for (const job of claimed) {
    try {
      await attemptJob(job, workerId);
    } catch (error) {
      const jobAfterFailure = await loadEmailJob(job.id);
      if (jobAfterFailure.status === 'dead') {
        logger.error('email_job_dead_lettered', {
          jobId: job.id,
          jobType: job.job_type,
          recipient: job.recipient_email,
          error: jobAfterFailure.last_error,
        });
      }
    }
    processed += 1;
  }
  return processed;
}

async function enqueueAndSend(name: EmailJobName, envelope: EmailEnvelope, idempotencyKey?: string): Promise<void> {
  const { jobId } = await createOrReuseEmailJob(name, envelope, idempotencyKey);
  const workerId = `inline-${process.pid}`;
  const claimed = await claimInlineJob(jobId, workerId);
  const job = claimed ?? await loadEmailJob(jobId);

  if (job.status === 'sent') {
    return;
  }

  if (!claimed && job.status === 'processing') {
    return;
  }

  try {
    await attemptJob(
      {
        ...job,
        status: 'processing',
      },
      workerId,
    );
  } catch (error) {
    logger.error('email_dispatch_failed', {
      jobId,
      jobType: name,
      recipient: envelope.to,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function generateSupabaseEmailLink(
  email: string,
  type: 'magiclink' | 'recovery',
  redirectUrl: string,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo: redirectUrl },
  });

  if (error) {
    throw new Error(`EMAIL_LINK_GENERATION_FAILED:${error.message}`);
  }

  const actionLink = data?.properties?.action_link;
  if (!actionLink || !String(actionLink).includes('http')) {
    throw new Error('EMAIL_LINK_GENERATION_EMPTY');
  }

  return String(actionLink);
}

function renderActionEmail(title: string, body: string, ctaLabel: string, ctaUrl: string): string {
  return [
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#10233d">`,
    `<h2 style="margin:0 0 16px">${title}</h2>`,
    `<p style="margin:0 0 20px;line-height:1.6">${body}</p>`,
    `<p style="margin:0 0 24px">`,
    `<a href="${ctaUrl}" style="display:inline-block;background:#0A66C2;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:600">${ctaLabel}</a>`,
    `</p>`,
    `<p style="margin:0;color:#6B7C93;font-size:13px">If you did not request this, you can ignore this email.</p>`,
    `</div>`,
  ].join('');
}

export async function sendMagicLink(
  email: string,
  redirectUrl?: string,
  idempotencyKey?: string,
): Promise<{ actionLink: string }> {
  const actionLink = await generateSupabaseEmailLink(
    email,
    'magiclink',
    redirectUrl || `${getAppUrl()}/auth/callback?mode=passwordless`,
  );

  await enqueueAndSend(
    'magic_link',
    {
      to: email,
      subject: 'Your Omnivyra sign-in link',
      html: renderActionEmail(
        'Sign in to Omnivyra',
        'Use the secure sign-in link below to continue to your account.',
        'Sign in',
        actionLink,
      ),
    },
    idempotencyKey,
  );

  return { actionLink };
}

export async function sendInvite(email: string, inviteLink: string, idempotencyKey?: string): Promise<void> {
  await enqueueAndSend(
    'invite',
    {
      to: email,
      subject: 'You have been invited to Omnivyra',
      html: renderActionEmail(
        'You have been invited',
        'Use the invitation link below to accept access to your organization account.',
        'Accept invitation',
        inviteLink,
      ),
    },
    idempotencyKey,
  );
}

export async function sendReset(
  email: string,
  redirectUrl?: string,
  idempotencyKey?: string,
): Promise<{ actionLink: string }> {
  const actionLink = await generateSupabaseEmailLink(
    email,
    'recovery',
    redirectUrl || `${getAppUrl()}/auth/set-password?flow=recovery`,
  );

  await enqueueAndSend(
    'reset',
    {
      to: email,
      subject: 'Reset your Omnivyra password',
      html: renderActionEmail(
        'Reset your password',
        'Use the secure reset link below to set a new password.',
        'Reset password',
        actionLink,
      ),
    },
    idempotencyKey,
  );

  return { actionLink };
}
