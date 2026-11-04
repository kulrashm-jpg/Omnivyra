import { enqueueOrThrow } from '../middleware/queueBackpressure';
import { ownedDbTable } from '../db/writeOwner';
/**
 * WhatsApp Broadcast Service
 *
 * Manages 1-to-many WhatsApp message sends:
 *  - Create broadcast + expand recipients
 *  - Enqueue chunked jobs per tier limits
 *  - Track per-recipient delivery
 *  - Retry failed recipients
 *
 * Incorporates:
 *  - Refinement 4: ON CONFLICT DO NOTHING on recipient insert
 *  - Improvement 4: tier-aware batch chunking
 *  - Improvement 5 / Refinement 7: template safety check before enqueue
 */

import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';

import { getActiveTemplate } from './whatsappTemplateService';
import { checkAndConsume, getBroadcastChunkStrategy } from './whatsappRateLimiter';
import { getValidAccessToken } from '../auth/metaAuthService';
import { requireEncryptionKey } from '../auth/credentialEncryption';

// W0-C — the canonical contact-governance evaluator. `mayContact` is pure; the
// tenant-scoped read is the only I/O this adds, and it happens once per batch.
import { mayContact } from './prospectIdentity/contactGovernance';
import {
  loadTenantGovernanceRecords,
  normalizeGovernanceTarget,
} from './prospectIdentity/contactGovernanceRepository';
import { isLeadOutreachGloballyDisabled, loadTenantGovernanceConfig } from './leadOutreachExecution/governanceService';

const META_GRAPH = 'https://graph.facebook.com/v22.0';

const PHONE_SALT = process.env.PHONE_HASH_SALT ?? '';

const RECIPIENT_ID_PAGE = 1000;

/** How the orchestration adapter names a broadcast it creates for a journey step (`wf:<task>`). */
export const JOURNEY_BROADCAST_PREFIX = 'wf:';

/**
 * A journey recipient a send-time check refused. Terminal, and never picked up by
 * `retryFailed`. The cause is in `error_message`. Text status: the column has no CHECK.
 */
export const BLOCKED_SEND_CONTROL = 'blocked_send_control';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContactInput {
  phone_e164:   string;   // E.164 format, e.g. "+15551234567"
  contact_name?: string;
}

export interface CreateBroadcastInput {
  company_id:        string;
  social_account_id: string;
  name:              string;
  message_type:      'template' | 'text' | 'image';
  template_name?:    string;
  template_params?:  Record<string, unknown>;
  body?:             string;
  media_id?:         string;
  media_caption?:    string;
  scheduled_for?:    string;
  created_by?:       string;
}

export interface RecipientDeliveryUpdate {
  wa_message_id: string;
  status:        'sent' | 'delivered' | 'read' | 'failed';
  error_code?:   number;
  error_message?: string;
}

// ── Phone privacy helpers ─────────────────────────────────────────────────────

function hashPhone(e164: string): string {
  if (!PHONE_SALT) throw new Error('PHONE_HASH_SALT env var not set');
  return crypto.createHmac('sha256', PHONE_SALT).update(e164.replace(/\s/g, '')).digest('hex');
}

function encryptPhone(e164: string): string {
  // Reuse AES-256-GCM from tokenStore encryption pattern.
  // SEC91-B12: the shared strict key parser — a missing/malformed ENCRYPTION_KEY fails with
  // a clear error instead of `ENCRYPTION_KEY ?? ''` silently producing a short key buffer.
  const key = requireEncryptionKey();
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(e164, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc;
}

export function decryptPhone(encrypted: string): string {
  const key = requireEncryptionKey();
  const [ivHex, tagHex, enc] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
}

// ── Sender-account ownership ──────────────────────────────────────────────────

/**
 * A broadcast is sent with the Meta token and phone number of
 * `social_account_id`. That id arrives in the request body, so it must belong to
 * the broadcast's company; otherwise an admin of company A could send through
 * company B's WhatsApp number and token.
 *
 * Refusal reasons: `not_found` covers both "no such account" and "another
 * company's account" (the caller must not learn which); `unreadable` is a failed
 * lookup and also refuses (fail closed).
 */
export type SenderAccountRefusal = 'not_found' | 'unreadable';

export class WhatsAppSenderAccountError extends Error {
  constructor(public readonly reason: SenderAccountRefusal) {
    super(reason === 'unreadable'
      ? 'WhatsApp sender account could not be verified'
      : 'WhatsApp sender account not found');
    this.name = 'WhatsAppSenderAccountError';
  }
}

export async function loadOwnedSenderAccount(
  companyId: unknown,
  socialAccountId: unknown,
): Promise<
  | { ok: true; account: { id: string; company_id: string; phone_number_id: string | null } }
  | { ok: false; reason: SenderAccountRefusal }
> {
  if (typeof companyId !== 'string' || !companyId || typeof socialAccountId !== 'string' || !socialAccountId) {
    return { ok: false, reason: 'not_found' };
  }
  let res: { data?: any; error?: unknown };
  try {
    res = await ownedDbTable('social_accounts')
      .select('id, company_id, phone_number_id')
      .eq('id', socialAccountId)
      .eq('company_id', companyId)
      .maybeSingle();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (res.error) return { ok: false, reason: 'unreadable' };
  // The predicate already scopes by company; the comparison is defence in depth.
  if (!res.data || res.data.company_id !== companyId) return { ok: false, reason: 'not_found' };
  return { ok: true, account: res.data };
}

/**
 * HTTP mapping for routes, matching `pages/api/social/comments.ts`: an unknown
 * and a foreign account both get 404, a failed lookup 503. Null for any other error.
 */
export function senderAccountRefusalResponse(err: unknown): { status: 404 | 503; error: string } | null {
  if (!(err instanceof WhatsAppSenderAccountError)) return null;
  return err.reason === 'unreadable'
    ? { status: 503, error: 'Social account lookup failed. Please try again.' }
    : { status: 404, error: 'Social account not found' };
}

async function assertOwnedSenderAccount(companyId: unknown, socialAccountId: unknown) {
  const check = await loadOwnedSenderAccount(companyId, socialAccountId);
  if (check.ok === false) throw new WhatsAppSenderAccountError(check.reason);
  return check.account;
}

// ── Create broadcast ──────────────────────────────────────────────────────────

export async function createBroadcast(input: CreateBroadcastInput): Promise<string> {
  await assertOwnedSenderAccount(input.company_id, input.social_account_id);

  const { data, error } = await ownedDbTable('whatsapp_broadcasts')
    .insert({
      ...input,
      status:     'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to create broadcast: ${error?.message}`);
  return data.id;
}

// ── Expand recipients ─────────────────────────────────────────────────────────

/**
 * Bulk insert contacts as broadcast recipients.
 * Refinement 4: ON CONFLICT DO NOTHING — safe for re-runs and retries.
 * Constraint: UNIQUE (broadcast_id, hashed_phone)
 */
export async function expandRecipients(
  broadcastId: string,
  contacts:    ContactInput[],
): Promise<{ inserted: number; skipped: number }> {
  const rows = contacts.map((c) => ({
    broadcast_id:    broadcastId,
    hashed_phone:    hashPhone(c.phone_e164),
    encrypted_phone: encryptPhone(c.phone_e164),
    contact_name:    c.contact_name ?? null,
    status:          'pending',
    retry_count:     0,
    created_at:      new Date().toISOString(),
  }));

  // Batch insert in chunks of 500 to avoid Supabase payload limits
  let inserted = 0;
  let skipped  = 0;
  const CHUNK  = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await ownedDbTable('whatsapp_broadcast_recipients')
      .upsert(chunk, { onConflict: 'broadcast_id,hashed_phone', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`expandRecipients batch ${i} failed: ${error.message}`);
    inserted += data?.length ?? 0;
    skipped  += chunk.length - (data?.length ?? 0);
  }

  // Update total_recipients count on broadcast
  await ownedDbTable('whatsapp_broadcasts')
    .update({ total_recipients: inserted, updated_at: new Date().toISOString() })
    .eq('id', broadcastId);

  return { inserted, skipped };
}

// ── Enqueue broadcast ─────────────────────────────────────────────────────────

/**
 * Validate template, check rate limits, chunk recipients, enqueue jobs.
 * Improvement 5 / Refinement 7: template check happens here — before any job creation.
 */
export async function enqueueBroadcast(
  broadcastId: string,
  plan:        string,
): Promise<void> {
  const { data: broadcast, error } = await ownedDbTable('whatsapp_broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (error || !broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  // A draft created before the ownership check existed may name another
  // company's account; refuse before its rate limit or queue is touched.
  await assertOwnedSenderAccount(broadcast.company_id, broadcast.social_account_id);

  // Improvement 5 + Refinement 7: validate template before touching queue
  if (broadcast.message_type === 'template') {
    if (!broadcast.template_name) {
      throw new Error('template_name is required for template broadcasts');
    }
    // Throws if template is missing, not approved, or not active
    await getActiveTemplate(broadcast.company_id, broadcast.template_name);
  }

  // Count pending recipients
  const { count } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  const totalCount = count ?? 0;
  if (totalCount === 0) throw new Error('No pending recipients for broadcast');

  // Check rate limit for total recipient count
  const rateCheck = await checkAndConsume({
    social_account_id: broadcast.social_account_id,
    phone_number_id:   broadcast.social_account_id, // resolved to phone_number_id in service
    company_id:        broadcast.company_id,
    plan,
    count:             totalCount,
  });

  if (!rateCheck.allowed) {
    await ownedDbTable('whatsapp_broadcasts')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', broadcastId);
    throw new Error(
      `Rate limit exceeded (tier ${rateCheck.tier}). ` +
      `Remaining today: ${rateCheck.remaining}. Broadcast paused.`
    );
  }

  // Improvement 4: tier-aware chunking
  const { batch_size, delay_ms } = getBroadcastChunkStrategy(rateCheck.tier);

  // Fetch recipient IDs in pages and add to queue
  const { getContentQueue } = await import('../queue/contentGenerationQueues');
  const queue = getContentQueue('whatsapp-broadcast');

  // Every id is read BEFORE the first job is queued, and paged by key. Batch 0 has no
  // delay, so a worker moves rows out of `pending` while this runs: an offset over that
  // shrinking set skips recipients, and they are never queued.
  const pendingIds: string[] = [];
  for (;;) {
    let page = ownedDbTable('whatsapp_broadcast_recipients')
      .select('id')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if (pendingIds.length > 0) page = page.gt('id', pendingIds[pendingIds.length - 1]);

    const { data: recipients, error: readError } = await page
      .order('id', { ascending: true })
      .limit(RECIPIENT_ID_PAGE);
    if (readError) throw new Error(`Broadcast recipients unreadable: ${readError.message}`);
    // Until an empty page: the server's row cap may be lower than the page asked for.
    if (!recipients?.length) break;
    pendingIds.push(...recipients.map((r) => r.id as string));
  }

  let batchIndex = 0;

  for (let i = 0; i < pendingIds.length; i += batch_size) {
    const recipientIds = pendingIds.slice(i, i + batch_size);

    await enqueueOrThrow(
      queue,
      'whatsapp-broadcast',
      'wa-broadcast-batch',
      { broadcast_id: broadcastId, recipient_ids: recipientIds },
      {
        jobId:    `wa-batch-${broadcastId}-${batchIndex}`,
        delay:    batchIndex * delay_ms,
        priority: 6,
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5000 },
      },
    );

    batchIndex += 1;
  }

  await ownedDbTable('whatsapp_broadcasts')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', broadcastId);
}

// ── Send-time checks for journey broadcasts (B-17) ───────────────────────────

/**
 * The WS-3 tenant controls for this channel: null when it may be used, otherwise why
 * not. A failed read gives `configured: false`, so it refuses.
 */
export async function whatsappChannelRefusal(companyId: string): Promise<string | null> {
  if (isLeadOutreachGloballyDisabled()) return 'global_kill_switch';
  const config = await loadTenantGovernanceConfig(companyId);
  if (!config.configured || !config.enabled) return 'tenant_not_enabled';
  if (config.killSwitch) return 'tenant_kill_switch';
  if (!config.enabledChannels.includes('whatsapp')) return 'channel_not_enabled';
  return null;
}

/**
 * Has this number written to the tenant since the broadcast was created? The webhook
 * processor keys threads as wa:<account>:<digits>. Read against every WhatsApp account
 * of the tenant, as journeyResponses does. Not a verdict on the journey, which the next
 * sweep settles: only a reason not to send now. Fails closed.
 */
async function inboundRefusal(broadcast: any, phone: string): Promise<string | null> {
  const unreadable = 'inbound_unreadable';
  const createdMs = Date.parse(String(broadcast.created_at));
  if (!Number.isFinite(createdMs)) return unreadable;
  // Meta's timestamps have no milliseconds, so a reply in the same second must still count.
  const since = new Date(Math.floor(createdMs / 1000) * 1000).toISOString();
  const digits = phone.replace(/\D/g, '');

  try {
    const accounts = await ownedDbTable('social_accounts')
      .select('id')
      .eq('company_id', broadcast.company_id)
      .eq('platform', 'whatsapp');
    if (accounts.error) return unreadable;
    const threadKeys = (accounts.data ?? []).map((a) => `wa:${String(a.id)}:${digits}`);
    if (threadKeys.length === 0) return null;

    const threads = await ownedDbTable('engagement_threads')
      .select('id')
      .eq('organization_id', broadcast.company_id)
      .eq('platform', 'whatsapp')
      .in('platform_thread_id', threadKeys);
    if (threads.error) return unreadable;
    const threadIds = (threads.data ?? []).map((t) => String(t.id));
    if (threadIds.length === 0) return null;

    const messages = await ownedDbTable('engagement_messages')
      .select('id')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .limit(1);
    if (messages.error) return unreadable;
    return (messages.data ?? []).length > 0 ? 'inbound_since_broadcast' : null;
  } catch {
    return unreadable;
  }
}

// ── Process a single batch (called by queue processor) ───────────────────────

export async function processBatch(
  broadcastId:  string,
  recipientIds: string[],
): Promise<void> {
  const { data: broadcast } = await ownedDbTable('whatsapp_broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (!broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  // B-17. The adapter checks the tenant controls before a journey broadcast exists, but
  // the job can wait in the queue, so a kill switch thrown or a reply received meanwhile
  // must still stop it. Journey broadcasts only: these are lead-outreach controls, and a
  // tenant with no config row would otherwise have every operator broadcast refused.
  const isJourney = typeof broadcast.name === 'string' && broadcast.name.startsWith(JOURNEY_BROADCAST_PREFIX);

  if (isJourney) {
    const refusal = await whatsappChannelRefusal(broadcast.company_id);
    if (refusal !== null) {
      const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: BLOCKED_SEND_CONTROL, error_code: null, error_message: `send_control: ${refusal}` })
        .in('id', recipientIds)
        .eq('status', 'pending');
      // Nothing was sent; the job retries and the row stays `pending` until it is recorded.
      if (blockError) throw new Error(`send control block could not be recorded: ${blockError.message}`);
      return;
    }
  }

  // Re-checked here, before the token is read, because a job may have been
  // queued (or a draft created) before the route checked ownership, and the
  // retry path reaches this function without the route. On refusal nothing is
  // sent, recipients stay `pending`, and the job fails visibly.
  const account = await assertOwnedSenderAccount(broadcast.company_id, broadcast.social_account_id);

  if (!account.phone_number_id) throw new Error('phone_number_id not set on social account');

  const accessToken = await getValidAccessToken(broadcast.social_account_id);

  const { data: recipients } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id, encrypted_phone, contact_name')
    .in('id', recipientIds);

  if (!recipients?.length) return;

  // ── W0-C. CONTACT GOVERNANCE, before any external send ───────────────────
  // This path reaches Meta Graph without ever passing the outreach dispatch
  // gate, so the same canonical rules are applied here. `whatsapp` is already a
  // KNOWN_CHANNEL, so restrictions for it can exist and were simply not read.
  //
  // One tenant-scoped read per batch, then the PURE evaluator per recipient.
  // FAIL CLOSED: if the store cannot be read, NOTHING in this batch is sent.
  const governance = await loadTenantGovernanceRecords(broadcast.company_id, ['whatsapp']);
  const governanceNow = new Date().toISOString();

  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const phone = decryptPhone(recipient.encrypted_phone);

    // Evaluated BEFORE the message body is built and before `fetch`, so a
    // refusal cannot reach the provider.
    const verdict = governance.ok
      ? mayContact({
        organizationId: broadcast.company_id,
        personId: null,
        targetNormalized: normalizeGovernanceTarget('whatsapp', phone),
        channel: 'whatsapp',
        now: governanceNow,
        records: governance.records,
      })
      : null;

    if (!verdict || verdict.decision !== 'allowed') {
      const reason = verdict
        ? `${verdict.governanceType ?? verdict.decision}: ${verdict.reason}`
        : `governance unreadable: ${governance.error ?? 'unknown'}`;
      // `error_code` is an INTEGER column (Meta's numeric code); the governance
      // cause is text and goes in `error_message`. Writing the text code into the
      // integer column failed the whole update, leaving the recipient `pending`.
      await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'blocked_governance', error_code: null, error_message: `contact_governance: ${reason}` })
        .eq('id', recipient.id)
        .eq('status', 'pending');
      failedCount++;
      continue;
    }

    // After governance, which outranks it, so a recorded opt-out still reads as one.
    if (isJourney) {
      const refusal = await inboundRefusal(broadcast, phone);
      if (refusal !== null) {
        const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
          .update({ status: BLOCKED_SEND_CONTROL, error_code: null, error_message: `send_control: ${refusal}` })
          .eq('id', recipient.id)
          .eq('status', 'pending');
        if (blockError) throw new Error(`send control block could not be recorded: ${blockError.message}`);
        failedCount++;
        continue;
      }
    }

    // ── CLAIM before the external send (compare-and-set) ──────────────────
    // A batch job is retried (attempts: 3) and a recipient id can reach two
    // batches, while this loop never looked at the status it was given. Only the
    // invocation that moves the row `pending → sending` may send it; every other
    // one skips, so a retry can never message a recipient twice.
    const { data: claimed } = await ownedDbTable('whatsapp_broadcast_recipients')
      .update({ status: 'sending' })
      .eq('id', recipient.id)
      .eq('status', 'pending')
      .select('id');
    if (!Array.isArray(claimed) || claimed.length === 0) continue;

    try {
      const messageBody = buildMessageBody(broadcast, phone);

      const res = await fetch(`${META_GRAPH}/${account.phone_number_id}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(messageBody),
      });

      const result = await res.json().catch(() => ({}));

      if (res.ok && result?.messages?.[0]?.id) {
        await ownedDbTable('whatsapp_broadcast_recipients')
          .update({ status: 'sent', wa_message_id: result.messages[0].id, sent_at: new Date().toISOString() })
          .eq('id', recipient.id);
        sentCount++;
      } else if (res.ok) {
        // Accepted without a message id: Meta may have sent it. Never retried
        // automatically (`retryFailed` only re-queues `failed`).
        await ownedDbTable('whatsapp_broadcast_recipients')
          .update({ status: 'send_uncertain', error_message: 'provider accepted the request without a message id' })
          .eq('id', recipient.id);
        failedCount++;
      } else {
        const errCode    = result?.error?.code ?? res.status;
        const errMessage = result?.error?.message ?? 'Unknown error';
        // Fetch current retry_count then increment (supabase.rpc can't be used inline as a value)
        const { data: cur } = await ownedDbTable('whatsapp_broadcast_recipients')
          .select('retry_count')
          .eq('id', recipient.id)
          .single();
        await ownedDbTable('whatsapp_broadcast_recipients')
          .update({ status: 'failed', error_code: errCode, error_message: errMessage, retry_count: (cur?.retry_count ?? 0) + 1 })
          .eq('id', recipient.id);
        failedCount++;
      }
    } catch (err) {
      // The request may have reached Meta before the exception (a timeout, a reset
      // connection): the outcome is UNKNOWN, so it is recorded as uncertain and is
      // never re-queued by `retryFailed`, which would risk a duplicate message.
      await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'send_uncertain', error_message: err instanceof Error ? err.message : 'Exception' })
        .eq('id', recipient.id);
      failedCount++;
    }
  }

  // Increment broadcast counters
  if (sentCount > 0 || failedCount > 0) {
    await supabase.rpc('increment_broadcast_counts', {
      p_broadcast_id: broadcastId,
      p_sent:         sentCount,
      p_failed:       failedCount,
    });
  }
}

// ── Build message body ────────────────────────────────────────────────────────

function buildMessageBody(broadcast: any, toPhone: string): Record<string, unknown> {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                toPhone,
  };

  if (broadcast.message_type === 'template' && broadcast.template_name) {
    return { ...base, type: 'template', template: { name: broadcast.template_name, language: { code: 'en_US' }, ...(broadcast.template_params ?? {}) } };
  }

  if (broadcast.message_type === 'image' && broadcast.media_id) {
    return { ...base, type: 'image', image: { id: broadcast.media_id, caption: broadcast.media_caption ?? '' } };
  }

  return { ...base, type: 'text', text: { body: broadcast.body ?? '' } };
}

// ── Retry failed recipients ───────────────────────────────────────────────────

export async function retryFailed(broadcastId: string): Promise<void> {
  const { data: failed } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'failed')
    .lt('retry_count', 3);

  if (!failed?.length) return;

  // Reset to pending for re-enqueue
  await ownedDbTable('whatsapp_broadcast_recipients')
    .update({ status: 'pending', next_retry_at: null })
    .in('id', failed.map((r) => r.id));

  // Re-enqueue as a single batch
  const { getContentQueue } = await import('../queue/contentGenerationQueues');
  const queue = getContentQueue('whatsapp-broadcast');
  await enqueueOrThrow(queue, 'whatsapp-broadcast', 'wa-broadcast-batch', {
    broadcast_id:  broadcastId,
    recipient_ids: failed.map((r) => r.id),
  }, {
    jobId:    `wa-retry-${broadcastId}-${Date.now()}`,
    priority: 7,
    attempts: 2,
    backoff:  { type: 'exponential', delay: 10000 },
  });
}

// ── Update delivery status (called by deliveryTracker) ───────────────────────

/**
 * The statuses each webhook event may move a recipient FROM, so status only goes
 * forward. Meta does not order its webhooks and a job can replay them, so without this
 * a late `sent` rewrites `delivered`, and a late `failed` makes a delivered message
 * eligible for `retryFailed`: a duplicate. `failed` can still be overtaken: evidence
 * that it arrived outranks it. A row only has a message id once `processBatch` wrote
 * `sent`, so a `sent` event never has anything to advance, and `pending` or `sending`
 * here mean a retry is in flight and the id belongs to the previous attempt.
 */
const DELIVERY_ADVANCES_FROM: Record<RecipientDeliveryUpdate['status'], readonly string[]> = {
  sent:      [],
  failed:    ['sent'],
  delivered: ['sent', 'failed'],
  read:      ['sent', 'failed', 'delivered'],
};

export async function updateRecipientDelivery(update: RecipientDeliveryUpdate): Promise<void> {
  const advancesFrom = DELIVERY_ADVANCES_FROM[update.status];
  if (advancesFrom.length === 0) return;

  // No status_at: that column is on engagement_messages. Writing it here failed every
  // delivery update, silently, because the result below read as 'no such recipient'.
  const updateData: Record<string, unknown> = {
    status:    update.status,
  };

  if (update.status === 'delivered') updateData.delivered_at = new Date().toISOString();
  if (update.status === 'read')      updateData.read_at      = new Date().toISOString();
  if (update.error_code)             updateData.error_code   = update.error_code;
  if (update.error_message)          updateData.error_message = update.error_message;

  // Not `.single()`: wa_message_id has no unique key on the chain, and zero rows is the
  // normal answer for a message that is not ours or an event that has nothing to advance.
  const { data: moved, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update(updateData)
    .eq('wa_message_id', update.wa_message_id)
    .in('status', [...advancesFrom])
    .select('broadcast_id');

  // Thrown so the webhook job is retried. Only rows that moved are counted below, so
  // replaying an event that did apply cannot count it twice.
  if (error) throw new Error(`[wa-delivery] delivery update failed: ${error.message}`);

  const recipient = moved?.[0];
  if (!recipient) return;

  // Increment broadcast aggregate counter
  if (update.status === 'delivered' || update.status === 'read') {
    const col = update.status === 'read' ? 'read_count' : 'delivered_count';
    await supabase.rpc('increment_broadcast_stat', {
      p_broadcast_id: recipient.broadcast_id,
      p_column:       col,
    });
  }
}
