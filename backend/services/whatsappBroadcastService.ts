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

const META_GRAPH = 'https://graph.facebook.com/v22.0';

const PHONE_SALT = process.env.PHONE_HASH_SALT ?? '';

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
  // Reuse AES-256-GCM from tokenStore encryption pattern
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex').slice(0, 32);
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(e164, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc;
}

export function decryptPhone(encrypted: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex').slice(0, 32);
  const [ivHex, tagHex, enc] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
}

// ── Create broadcast ──────────────────────────────────────────────────────────

export async function createBroadcast(input: CreateBroadcastInput): Promise<string> {
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

  let offset = 0;
  let batchIndex = 0;

  while (offset < totalCount) {
    const { data: recipients } = await ownedDbTable('whatsapp_broadcast_recipients')
      .select('id')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .range(offset, offset + batch_size - 1);

    if (!recipients?.length) break;

    const recipientIds = recipients.map((r) => r.id);

    await queue.add(
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

    offset     += batch_size;
    batchIndex += 1;
  }

  await ownedDbTable('whatsapp_broadcasts')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', broadcastId);
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

  const accessToken = await getValidAccessToken(broadcast.social_account_id);

  const { data: account } = await ownedDbTable('social_accounts')
    .select('phone_number_id')
    .eq('id', broadcast.social_account_id)
    .single();

  if (!account?.phone_number_id) throw new Error('phone_number_id not set on social account');

  const { data: recipients } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id, encrypted_phone, contact_name')
    .in('id', recipientIds);

  if (!recipients?.length) return;

  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const phone = decryptPhone(recipient.encrypted_phone);

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
      await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Exception', retry_count: 1 })
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
  await queue.add('wa-broadcast-batch', {
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

export async function updateRecipientDelivery(update: RecipientDeliveryUpdate): Promise<void> {
  const updateData: Record<string, unknown> = {
    status:    update.status,
    status_at: new Date().toISOString(),
  };

  if (update.status === 'delivered') updateData.delivered_at = new Date().toISOString();
  if (update.status === 'read')      updateData.read_at      = new Date().toISOString();
  if (update.error_code)             updateData.error_code   = update.error_code;
  if (update.error_message)          updateData.error_message = update.error_message;

  const { data: recipient } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update(updateData)
    .eq('wa_message_id', update.wa_message_id)
    .select('broadcast_id')
    .single();

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
