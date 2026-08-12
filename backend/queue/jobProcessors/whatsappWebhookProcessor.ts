/**
 * WhatsApp Webhook Event Processor
 *
 * Processes raw Meta webhook payloads from the whatsapp-webhook queue.
 * Each job = one full Meta webhook POST body (already signature-verified).
 *
 * Routes per event type:
 *   statuses  → updateRecipientDelivery (deliveryTracker)
 *   messages  → handleInboundMessage (messageRouter)
 *   message_template_status_update → handleTemplateStatusWebhook (templateService)
 */

import type { Job } from 'bullmq';
import { updateRecipientDelivery } from '../../services/whatsappBroadcastService';
import { handleTemplateStatusWebhook } from '../../services/whatsappTemplateService';
import { supabase } from '../../db/supabaseClient';

export interface WaWebhookJob {
  payload: any; // raw parsed Meta webhook body
}

export async function processWhatsAppWebhookJob(job: Job<WaWebhookJob>): Promise<void> {
  const { payload } = job.data;
  if (!payload) throw new Error('[wa-webhook-processor] missing payload');

  const entries: any[] = payload?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      // ── Delivery status updates ─────────────────────────────────────────
      for (const status of value?.statuses ?? []) {
        try {
          const mapped = mapMetaStatus(status.status);
          if (mapped) {
            await updateRecipientDelivery({
              wa_message_id:  status.id,
              status:         mapped,
              error_code:     status.errors?.[0]?.code,
              error_message:  status.errors?.[0]?.title,
            });
          }
        } catch (err) {
          console.error('[wa-webhook-processor] status update failed', err);
        }
      }

      // ── Inbound messages ────────────────────────────────────────────────
      for (const message of value?.messages ?? []) {
        try {
          await handleInboundMessage(value.metadata?.phone_number_id, message);
        } catch (err) {
          console.error('[wa-webhook-processor] inbound message failed', err);
        }
      }

      // ── Template status events ──────────────────────────────────────────
      if (change?.field === 'message_template_status_update') {
        try {
          await handleTemplateStatusWebhook({
            message_template_id:   value.message_template_id ?? '',
            message_template_name: value.message_template_name ?? '',
            event:                 value.event,
            reason:                value.reason,
          });
        } catch (err) {
          console.error('[wa-webhook-processor] template status failed', err);
        }
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapMetaStatus(status: string): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch (status) {
    case 'sent':      return 'sent';
    case 'delivered': return 'delivered';
    case 'read':      return 'read';
    case 'failed':    return 'failed';
    default:          return null;
  }
}

async function handleInboundMessage(phoneNumberId: string, message: any): Promise<void> {
  if (!phoneNumberId || !message?.from || !message?.id) return;

  const { data: account } = await supabase
    .from('social_accounts')
    .select('id, company_id')
    .eq('phone_number_id', phoneNumberId)
    .single();

  if (!account) return;

  const platformThreadId = `wa:${account.id}:${message.from}`;
  const windowExpiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: thread, error: threadError } = await supabase
    .from('engagement_threads')
    .upsert({
      platform:           'whatsapp',
      platform_thread_id: platformThreadId,
      organization_id:    account.company_id,
      social_account_id:  account.id,
      window_expires_at:  windowExpiresAt,
      window_open:        true,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'platform,platform_thread_id,organization_id' })
    .select('id')
    .single();

  if (threadError || !thread?.id) {
    console.error('[wa-webhook-processor] thread upsert failed', threadError);
    return;
  }

  const textBody = message?.text?.body
    ?? message?.button?.text
    ?? message?.interactive?.button_reply?.title
    ?? '[non-text message]';

  await supabase
    .from('engagement_messages')
    .upsert({
      thread_id:           thread.id,
      platform:            'whatsapp',
      platform_message_id: message.id,
      direction:           'inbound',
      content:             textBody,
      raw_payload:         message,
      status:              'received',
      created_at:          new Date(parseInt(message.timestamp, 10) * 1000).toISOString(),
      // Message identity is THREAD-scoped, matching every other caller
      // (engagement/reply.ts, bulkEngagementService.ts). Two reasons it cannot
      // be (platform, platform_message_id):
      //   1. that unique index is PARTIAL, and PostgREST emits a column-only
      //      inference clause, so Postgres refuses it as an arbiter (42P10) —
      //      which is why no inbound message has ever persisted;
      //   2. it is platform-GLOBAL. A DO UPDATE keyed on it would let one
      //      tenant's webhook rewrite another tenant's message row — including
      //      its thread_id — because thread_id is in the payload. Thread scope
      //      makes that structurally impossible: a different tenant's copy
      //      lives in a different thread, so it never matches.
    }, { onConflict: 'thread_id,platform_message_id' });
}
