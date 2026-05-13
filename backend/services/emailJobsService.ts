/**
 * emailJobsService — canonical enqueue + payload encryption for the
 * async invite delivery pipeline (Phase 2.A.1).
 *
 * Responsibilities:
 *   - encryptSensitiveField / decryptSensitiveField — AES-256-GCM helpers
 *     for ANY field that must not appear in plaintext at rest (the temp
 *     password being the canonical case).
 *   - enqueueEmailJob — inserts an email_jobs row + writes the 'queued'
 *     email_event. Encrypts sensitive fields when provided.
 *   - buildSendEnvelope — given a row claimed from claim_email_jobs,
 *     decrypts any sensitive fields and returns the body the existing
 *     send-transactional-email Edge Function expects.
 *
 * Security:
 *   - The encryption key is read from EMAIL_JOB_PAYLOAD_KEY (32-byte
 *     base64). Missing key → enqueuing with sensitive fields throws.
 *     We FAIL CLOSED rather than silently storing plaintext.
 *   - The plaintext never appears in logs (only error messages with the
 *     field NAME, never the value).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export type InviteTemplateKey =
  | 'team_invite_magic_link'
  | 'team_invite_credentials';

export interface MagicLinkPayload {
  recipientEmail: string;
  recipientName: string | null;
  companyName: string | null;
  role: string;
  inviteUrl: string;
  invitationId: string;
  correlationId: string;
}

export interface CredentialsPayload {
  recipientEmail: string;
  recipientName: string | null;
  companyName: string | null;
  role: string;
  loginUrl: string;
  /** Plaintext at enqueue time. Encrypted before persistence. */
  temporaryPassword: string;
  invitationId: string | null;
  correlationId: string;
}

export type InvitePayload = MagicLinkPayload | CredentialsPayload;

interface EncryptedField {
  alg: 'aes-256-gcm';
  iv: string;        // base64
  ciphertext: string; // base64
  tag: string;        // base64
}

const SENSITIVE_FIELD_MARK = '__encrypted__';
const SENSITIVE_FIELDS_BY_TEMPLATE: Readonly<Record<InviteTemplateKey, readonly string[]>> = {
  team_invite_magic_link: [],
  team_invite_credentials: ['temporaryPassword'],
};

function getEncryptionKey(): Buffer {
  const raw = process.env.EMAIL_JOB_PAYLOAD_KEY;
  if (!raw) {
    throw new Error(
      'EMAIL_JOB_PAYLOAD_KEY not configured. Cannot enqueue email jobs with sensitive fields. ' +
      'Generate a 32-byte key: `openssl rand -base64 32` and set it in the environment.',
    );
  }
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error('EMAIL_JOB_PAYLOAD_KEY must be base64-encoded 32 bytes (AES-256).');
  }
  return key;
}

export function encryptSensitiveField(plaintext: string): EncryptedField {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSensitiveField(envelope: unknown): string {
  if (
    !envelope
    || typeof envelope !== 'object'
    || (envelope as EncryptedField).alg !== 'aes-256-gcm'
  ) {
    throw new Error('SENSITIVE_FIELD_MALFORMED');
  }
  const e = envelope as EncryptedField;
  const key = getEncryptionKey();
  const iv = Buffer.from(e.iv, 'base64');
  const ct = Buffer.from(e.ciphertext, 'base64');
  const tag = Buffer.from(e.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function hashPayloadForDedupe(templateKey: string, recipientEmail: string, invitationId: string | null): string {
  return createHash('sha256')
    .update([templateKey, recipientEmail.toLowerCase(), invitationId ?? ''].join(':'))
    .digest('hex');
}

/**
 * Encrypt sensitive fields in place. Returns a new object — does not mutate
 * the input. The sensitive field VALUE is replaced by an envelope and we
 * add `__encrypted__: <field-name-list>` so the worker knows what to decrypt.
 *
 * NEVER logs the plaintext.
 */
function redactPayloadForStorage(templateKey: InviteTemplateKey, payload: Record<string, unknown>): {
  storedPayload: Record<string, unknown>;
  encrypted: boolean;
} {
  const sensitiveFields = SENSITIVE_FIELDS_BY_TEMPLATE[templateKey];
  if (!sensitiveFields || sensitiveFields.length === 0) {
    return { storedPayload: { ...payload }, encrypted: false };
  }
  const out: Record<string, unknown> = { ...payload };
  const redacted: string[] = [];
  for (const field of sensitiveFields) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) {
      out[field] = encryptSensitiveField(value);
      redacted.push(field);
    }
  }
  if (redacted.length > 0) {
    out[SENSITIVE_FIELD_MARK] = redacted;
    return { storedPayload: out, encrypted: true };
  }
  return { storedPayload: out, encrypted: false };
}

export interface EnqueueResult {
  jobId: string;
  status: 'queued';
  replayed: boolean;
}

export interface EnqueueOptions {
  templateKey: InviteTemplateKey;
  recipientEmail: string;
  payload: InvitePayload;
  invitationId: string | null;
  correlationId: string;
  /**
   * Optional idempotency key. When provided, a duplicate enqueue with the
   * same key returns the existing job_id ({ replayed: true }).
   */
  idempotencyKey?: string;
  /**
   * Optional override for the per-row retry cap. Defaults to 5.
   */
  maxRetries?: number;
}

/**
 * Insert an email_jobs row + write a 'queued' email_event. Encrypts any
 * sensitive fields before persistence. NEVER returns the plaintext or
 * logs it. Idempotency-safe via the idempotency_key column.
 */
export async function enqueueEmailJob(opts: EnqueueOptions): Promise<EnqueueResult> {
  const recipientEmail = opts.recipientEmail.toLowerCase();
  const { storedPayload, encrypted } = redactPayloadForStorage(
    opts.templateKey,
    opts.payload as unknown as Record<string, unknown>,
  );

  const jobTypeByTemplate: Record<InviteTemplateKey, string> = {
    team_invite_magic_link: 'team_invite_magic_link',
    team_invite_credentials: 'team_invite_credentials',
  };

  const idempotencyKey = opts.idempotencyKey?.trim() || null;

  // Pre-flight: idempotency replay path.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('email_jobs')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) {
      return { jobId: (existing as any).id, status: 'queued', replayed: true };
    }
  }

  const payloadHash = hashPayloadForDedupe(opts.templateKey, recipientEmail, opts.invitationId);

  const insertPayload: Record<string, unknown> = {
    job_type: jobTypeByTemplate[opts.templateKey],
    template_key: opts.templateKey,
    payload: storedPayload,
    payload_encrypted: encrypted,
    payload_hash: payloadHash,
    recipient_email: recipientEmail,
    status: 'pending',
    retry_count: 0,
    max_retries: typeof opts.maxRetries === 'number' && opts.maxRetries > 0 ? Math.min(opts.maxRetries, 10) : 5,
    invitation_id: opts.invitationId,
    correlation_id: opts.correlationId,
    idempotency_key: idempotencyKey,
    next_attempt_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insErr } = await supabase
    .from('email_jobs')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insErr) {
    // 23505 = unique race on idempotency_key OR pending-payload uniqueness.
    if (insErr.code === '23505') {
      if (idempotencyKey) {
        const { data: replay } = await supabase
          .from('email_jobs')
          .select('id')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();
        if (replay) {
          return { jobId: (replay as any).id, status: 'queued', replayed: true };
        }
      }
      // Pending-payload collision: there is already an in-flight job for the
      // same (recipient, job_type, payload_hash). Return it as queued.
      const { data: dupe } = await supabase
        .from('email_jobs')
        .select('id')
        .eq('payload_hash', payloadHash)
        .eq('recipient_email', recipientEmail)
        .eq('job_type', jobTypeByTemplate[opts.templateKey])
        .in('status', ['pending', 'processing', 'failed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dupe) {
        return { jobId: (dupe as any).id, status: 'queued', replayed: true };
      }
    }
    logger.error('email_jobs_enqueue_failed', {
      template: opts.templateKey,
      recipient: recipientEmail,
      message: insErr.message,
    });
    throw new Error(`EMAIL_JOB_ENQUEUE_FAILED:${insErr.message}`);
  }

  const jobId = (inserted as any).id as string;

  // Write 'queued' event. Best-effort — never blocks the enqueue itself.
  const { error: evtErr } = await supabase.rpc('record_email_event', {
    p_job_id: jobId,
    p_event_type: 'queued',
    p_metadata: { encrypted, max_retries: insertPayload.max_retries },
    p_failure_reason: null,
  });
  if (evtErr) {
    logger.warn('email_jobs_queued_event_write_failed', {
      jobId,
      message: evtErr.message,
    });
  }

  return { jobId, status: 'queued', replayed: false };
}

/**
 * Given a row claimed by claim_email_jobs, build the body the Edge Function
 * expects. Decrypts any fields listed under __encrypted__.
 *
 * Returns the body envelope OR an error string if the payload is malformed.
 */
export function buildSendEnvelopeFromClaim(claimed: {
  template_key: string | null;
  payload: Record<string, unknown> | null;
  payload_encrypted: boolean;
  recipient_email: string;
}): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!claimed.template_key) {
    return { ok: false, error: 'MISSING_TEMPLATE_KEY' };
  }
  if (!claimed.payload || typeof claimed.payload !== 'object') {
    return { ok: false, error: 'MISSING_PAYLOAD' };
  }

  const work: Record<string, unknown> = { ...(claimed.payload as Record<string, unknown>) };
  const redacted = (work[SENSITIVE_FIELD_MARK] as string[] | undefined) ?? [];

  if (claimed.payload_encrypted && redacted.length > 0) {
    for (const field of redacted) {
      try {
        const decrypted = decryptSensitiveField(work[field]);
        work[field] = decrypted;
      } catch (err: any) {
        return { ok: false, error: `DECRYPT_FAILED:${field}:${err?.message ?? 'unknown'}` };
      }
    }
  }
  delete work[SENSITIVE_FIELD_MARK];

  // Map our template key → the Edge Function's `type` field.
  const typeByTemplate: Record<string, string> = {
    team_invite_magic_link: 'team_invite',
    team_invite_credentials: 'team_invite_credentials',
  };
  const edgeType = typeByTemplate[claimed.template_key];
  if (!edgeType) {
    return { ok: false, error: `UNKNOWN_TEMPLATE:${claimed.template_key}` };
  }

  // Translate our generic payload field names to the Edge Function's schema.
  if (claimed.template_key === 'team_invite_magic_link') {
    return {
      ok: true,
      body: {
        type: edgeType,
        recipientEmail: claimed.recipient_email,
        inviteUrl: String(work.inviteUrl ?? ''),
      },
    };
  }

  if (claimed.template_key === 'team_invite_credentials') {
    return {
      ok: true,
      body: {
        type: edgeType,
        recipientEmail: claimed.recipient_email,
        fullName: (work.recipientName as string | null) ?? null,
        companyName: (work.companyName as string | null) ?? null,
        role: String(work.role ?? ''),
        loginUrl: String(work.loginUrl ?? ''),
        temporaryPassword: String(work.temporaryPassword ?? ''),
      },
    };
  }

  return { ok: false, error: 'UNHANDLED_TEMPLATE' };
}

/**
 * Exponential backoff schedule for transient send failures.
 *
 * retry_count is the number of PRIOR failed attempts (0 after the first
 * failure means this is failure #1). Mapping:
 *
 *   failure #1 → 60s
 *   failure #2 → 5 min
 *   failure #3 → 30 min
 *   failure #4 → 2 hours
 *   failure #5 → 12 hours
 *
 * The worker dead-letters when retry_count reaches max_retries.
 */
export function computeNextAttemptAt(retryCount: number): Date {
  const seconds = [60, 300, 1800, 7200, 43200];
  const idx = Math.min(Math.max(retryCount, 0), seconds.length - 1);
  return new Date(Date.now() + seconds[idx] * 1000);
}
