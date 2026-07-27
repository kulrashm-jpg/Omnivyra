/**
 * LC-501 (W5.1) — C3 Email connector (CERTIFICATION MODE: dry-run only, NO live send).
 *
 * The only connector eligible this wave. It supports preview, dry-run, idempotency and
 * cancellation-before-dispatch. It NEVER transmits a real email in W5.1: a second hard
 * gate (GTM_LIVE_SEND, default OFF) plus the W5.1 out-of-scope rule keep it dry-run. The
 * live path is the existing `emailService` (`send-transactional-email` edge fn, idempotent)
 * — wired only in a future certified wave (M5), never here.
 */

import { createHash } from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function envLiveSendEnabled(): boolean {
  return process.env.GTM_LIVE_SEND === 'true'; // default OFF
}

export function buildIdempotencyKey(campaignId: string, entityId: string, channel: string, messageId: string): string {
  return createHash('sha256').update(`${campaignId}|${entityId}|${channel}|${messageId}`).digest('hex').slice(0, 32);
}

export interface EmailMessage { subject: string; body: string; messageId?: string }
export interface ConnectorPreview { channel: 'email'; to: string; subject: string; bodyPreview: string }
export interface ConnectorResult { dispatched: false; dryRun: true; idempotencyKey: string; preview: ConnectorPreview }

export function previewEmail(message: EmailMessage, recipient: string): ConnectorPreview {
  return { channel: 'email', to: recipient, subject: message.subject, bodyPreview: message.body.slice(0, 240) };
}

export function validateEmailTarget(recipient: string): { ok: boolean; reason?: string } {
  if (!EMAIL_RE.test(String(recipient || ''))) return { ok: false, reason: 'invalid_recipient' };
  return { ok: true };
}

/**
 * Dry-run dispatch. ALWAYS returns dispatched:false in W5.1 — it does not call the live
 * email service. (Belt-and-suspenders: even if GTM_LIVE_SEND were true, W5.1 forbids it.)
 */
export async function dispatchEmail(input: { campaignId: string; entityId: string; recipient: string; message: EmailMessage }): Promise<ConnectorResult> {
  const messageId = input.message.messageId ?? 'default';
  const idempotencyKey = buildIdempotencyKey(input.campaignId, input.entityId, 'email', messageId);
  // W5.1: NO LIVE SEND. The live path (emailService.sendTransactional, idempotent) is M5-only.
  return { dispatched: false, dryRun: true, idempotencyKey, preview: previewEmail(input.message, input.recipient) };
}
