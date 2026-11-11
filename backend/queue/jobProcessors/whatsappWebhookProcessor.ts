/**
 * WhatsApp Webhook Event Processor
 *
 * Processes raw Meta webhook payloads from the whatsapp-webhook queue.
 * Each job = one full Meta webhook POST body (already signature-verified).
 *
 * Routes per event type:
 *   statuses  → verifyCallbackRecipient (marker + number), recordWhatsAppProviderEvent
 *               (append-only ledger, with the verified recipient), then
 *               updateRecipientDelivery (a permanent failure also restricts the number)
 *   messages  → handleInboundMessage (messageRouter); a whole-message STOP is
 *               first recorded as a WhatsApp unsubscribe (whatsappOptOut.ts)
 *   message_template_status_update → handleTemplateStatusWebhook (templateService)
 */

import type { Job } from 'bullmq';
import { recordWhatsAppProviderEvent, updateRecipientDelivery, verifyCallbackRecipient } from '../../services/whatsappBroadcastService';
import { handleTemplateStatusWebhook } from '../../services/whatsappTemplateService';
import { detectWhatsAppOptOut, recordWhatsAppOptOut } from '../../services/whatsappOptOut';
import { supabase } from '../../db/supabaseClient';

export interface WaWebhookJob {
  payload: any; // raw parsed Meta webhook body
}

export async function processWhatsAppWebhookJob(job: Job<WaWebhookJob>): Promise<void> {
  const { payload } = job.data;
  if (!payload) throw new Error('[wa-webhook-processor] missing payload');

  const entries: any[] = payload?.entry ?? [];

  // The kinds of event that failed. A failure never stops the rest of the payload, and
  // the job fails after the loop so its attempts apply. Replaying the whole payload is
  // safe because each event is idempotent: delivery status only moves forward and counts
  // only what moved, status events collapse on the ledger key (message, status, event time),
  // opt-outs collapse on the governance store's canonical key, inbound messages are
  // insert-or-ignore per tenant, template events set final state.
  const failed: string[] = [];

  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;

      // ── Delivery status updates ─────────────────────────────────────────
      for (const status of value?.statuses ?? []) {
        try {
          const mapped = mapMetaStatus(status.status);
          if (mapped && status.id) {
            // Follow-up A: the marker is checked against the number BEFORE the event is kept,
            // so the ledger names the recipient only when it is verified. A failed read throws
            // here, before anything is written, and the job retries.
            const verifiedRecipientId = await verifyCallbackRecipient(status.biz_opaque_callback_data, status.recipient_id);
            // G-9b: the event is kept first, whether or not it moves a recipient.
            await recordWhatsAppProviderEvent({
              wa_message_id: String(status.id),
              status:        mapped,
              timestamp:     status.timestamp,
              error_code:    status.errors?.[0]?.code,
              error_message: status.errors?.[0]?.title,
              verified_recipient_id: verifiedRecipientId,
            });
            await updateRecipientDelivery({
              wa_message_id:  status.id,
              status:         mapped,
              error_code:     status.errors?.[0]?.code,
              error_message:  status.errors?.[0]?.title,
              // L-4: our recipient id echoed back, and the number it went to, so a send
              // whose response was lost can be matched (updateRecipientDelivery).
              callback_data:   typeof status.biz_opaque_callback_data === 'string' ? status.biz_opaque_callback_data : null,
              recipient_wa_id: typeof status.recipient_id === 'string' ? status.recipient_id : null,
            });
          }
        } catch (err) {
          console.error('[wa-webhook-processor] status update failed', err);
          failed.push('status');
        }
      }

      // ── Inbound messages ────────────────────────────────────────────────
      for (const message of value?.messages ?? []) {
        try {
          await handleInboundMessage(value.metadata?.phone_number_id, message);
        } catch (err) {
          console.error('[wa-webhook-processor] inbound message failed', err);
          failed.push('inbound');
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
          failed.push('template');
        }
      }
    }
  }

  // Kinds and a count only: this reaches logs and dead letters, so never a number or text.
  if (failed.length > 0) {
    throw new Error(`[wa-webhook-processor] ${failed.length} event(s) failed: ${[...new Set(failed)].join(', ')}`);
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

  // Not `.single()`: phone_number_id is not unique, and two rows read as "no account",
  // which dropped the message and any STOP in it. A read failure is not "no account".
  const { data: rows, error: accountError } = await supabase
    .from('social_accounts')
    .select('id, company_id, is_active')
    .eq('platform', 'whatsapp')
    .eq('phone_number_id', phoneNumberId);

  if (accountError) throw new Error(`account lookup failed: ${accountError.code ?? 'unknown'}`);
  if (!rows?.length) return;

  // The live account answers for the number; a number on a deactivated account still
  // resolves, because a STOP must not depend on the account being connected. Ordered so
  // that a replay lands on the same thread.
  const active = rows.filter((r: any) => r.is_active === true);
  const candidates = [...(active.length > 0 ? active : rows)].sort((a: any, b: any) => (String(a.id) < String(b.id) ? -1 : 1));
  const firstPerTenant = candidates.filter((r: any, i: number) => candidates.findIndex((c: any) => c.company_id === r.company_id) === i);

  const optOut = detectWhatsAppOptOut(message?.text?.body ?? message?.button?.text ?? message?.interactive?.button_reply?.title);

  if (firstPerTenant.length > 1) {
    // Whose conversation this is cannot be known, so no tenant is given the text. A STOP
    // binds every tenant holding the number: that only ever narrows contact. The job then
    // fails, so the event survives to the dead letter for a person to resolve.
    console.error('[wa-webhook-processor] phone_number_id held by more than one tenant', {
      accounts: firstPerTenant.map((r: any) => r.id), waMessageId: message.id,
    });
    if (optOut) {
      for (const holder of firstPerTenant) await recordOptOut(holder, message, optOut.keyword);
    }
    throw new Error('phone_number_id held by more than one tenant');
  }

  const account = firstPerTenant[0];

  // Opt-out first, so a failed thread write below can never swallow it. The
  // conversation record is still kept: the message is stored as usual, and only then
  // does an opt-out that could still succeed fail the job for another attempt.
  const retryOptOut = optOut ? (await recordOptOut(account, message, optOut.keyword)) === 'retry' : false;

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
    throw new Error('thread upsert failed');
  }

  const textBody = message?.text?.body
    ?? message?.button?.text
    ?? message?.interactive?.button_reply?.title
    ?? '[non-text message]';

  // M-2: insert-or-ignore. A re-delivery never rewrites a stored message: not its status (a
  // reply or read state is not reset to 'received'), not its content (a cleared message is
  // not refilled, N-4), and not its row id (journey event ids hash it).
  const { error: messageError } = await supabase
    .from('engagement_messages')
    .upsert({
      thread_id:           thread.id,
      platform:            'whatsapp',
      platform_message_id: message.id,
      direction:           'inbound',
      content:             textBody,
      raw_payload:         message,
      status:              'received',
      created_at:          messageCreatedAt(message.timestamp),
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
    }, { onConflict: 'thread_id,platform_message_id', ignoreDuplicates: true });

  // M-4: 23505 here can only come from the tenant index (organization_id, platform,
  // platform_message_id): this tenant already holds the message, under the thread of the
  // account that was active when it first arrived. It is stored; a re-delivery after the
  // active account changed is not a failure.
  if (messageError && messageError.code !== '23505') throw new Error(`message upsert failed: ${messageError.code ?? 'unknown'}`);
  if (retryOptOut) throw new Error('opt-out not recorded');
}

/**
 * M-3: Meta's send time (unix seconds). A message without a usable one is stored at receipt
 * time instead of failing, and dead-lettering, the whole event.
 */
function messageCreatedAt(timestamp: unknown): string {
  const seconds = typeof timestamp === 'string' || typeof timestamp === 'number' ? Number(timestamp) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

/**
 * Records one opt-out. 'retry' only for a failure another attempt could fix: a terminal
 * writer refusal or an invalid sender would fail the same way every time, so those stay
 * logged, not retried.
 */
async function recordOptOut(account: any, message: any, keyword: string): Promise<'done' | 'retry'> {
  const recorded = await recordWhatsAppOptOut({
    organizationId:  account.company_id,
    waId:            String(message.from),
    waMessageId:     String(message.id),
    keyword,
    socialAccountId: account.id ?? null,
  });
  if (recorded.status === 'recorded' || recorded.status === 'already_present') return 'done';
  // Never the number or the text — a code, the tenant and the message id.
  console.error('[wa-webhook-processor] opt-out NOT recorded', {
    status: recorded.status, reason: recorded.reason, attempts: recorded.attempts,
    companyId: account.company_id, waMessageId: message.id,
  });
  return recorded.status === 'retryable_failure' ? 'retry' : 'done';
}
