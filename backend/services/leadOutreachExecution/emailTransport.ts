/**
 * WS-3 Milestone-5B — email transport.
 *
 * The first transport that can reach a real person. Everything about its
 * design is shaped by that fact.
 *
 * ─── DISABLED BY DEFAULT, DELIBERATELY ─────────────────────────────────────
 * `LEAD_OUTREACH_EMAIL_ENABLED` must be explicitly `true` or this transport
 * returns `disabled` WITHOUT calling the provider. The architecture gates M5B
 * behind a flag for one tenant; that gate lives here, at the last point before
 * egress, rather than in a caller that a future code path might bypass.
 *
 * ─── PROVIDER BEHIND A PORT ────────────────────────────────────────────────
 * No provider SDK, no HTTP client and no credentials appear in this file. The
 * provider is an injectable port whose default delegates to the platform's
 * existing `send-transactional-email` Edge Function seam — the same mechanism
 * `emailService` uses, which already owns the SES credentials. That keeps
 * provider logic out of the dispatcher AND out of this module, and lets tests
 * exercise every outcome without a network.
 *
 * ─── ACCEPTANCE IS NOT DELIVERY ────────────────────────────────────────────
 * A provider accepting a message means it has taken responsibility for it, not
 * that anybody received it. Acceptance therefore records `sent_unverified` —
 * never `confirmed`, which is reserved for writes the platform completed
 * itself. Delivery, bounces, opens and clicks are later milestones.
 */

import type { OutreachTransport, TransportRequest, TransportResult } from './transport';
import { buildOutreachUnsubscribeUrl, issueOutreachUnsubscribeToken } from '../../security/outreachUnsubscribeToken';

/**
 * The provider name recorded on every SES outreach evidence row. WP3: the SES
 * event webhook resolves provider messages under THIS name, so both sides import
 * it rather than spelling it twice.
 */
export const SES_EDGE_PROVIDER_NAME = 'supabase_edge_ses';

/** WP3 / L5 — the public origin unsubscribe links point at. */
export const UNSUBSCRIBE_BASE_URL_ENV = 'NEXT_PUBLIC_APP_URL';

/** Explicit opt-in. Anything other than `true` keeps this transport inert. */
export const EMAIL_ENABLED_ENV = 'LEAD_OUTREACH_EMAIL_ENABLED';

export const isEmailTransportEnabled = (): boolean =>
  String(process.env[EMAIL_ENABLED_ENV] ?? '').toLowerCase() === 'true';

/** Provider round-trip budget. Exceeding it is a `timeout`, not a failure. */
export const EMAIL_TIMEOUT_MS = 15_000;

export interface EmailProviderRequest {
  to: string;
  idempotencyKey: string;
  /** Tenant the send belongs to — providers scope suppression per sender. */
  companyId: string;
  /**
   * Subject line. Currently a PLACEHOLDER derived from the plan's action.
   *
   * ─── THE WS-4 INSERTION POINT ──────────────────────────────────────────
   * These two fields are the ONLY place generated content enters this
   * runtime, and `createEmailTransport` below is the only place they are
   * populated (from `task.action` / `task.explanation`). WS-4 supplies real
   * content by producing these strings BEFORE dispatch; it does not call the
   * transport, the dispatcher, governance or approval, and it never writes an
   * outreach table. If a future change makes content arrive by any other
   * route, the boundary in docs/WS4-BOUNDARY.md has been broken.
   */
  subject: string;
  /** Body. Currently a PLACEHOLDER derived from the plan's explanation. */
  body: string;
  /**
   * WP3 / L5 — the signed one-click unsubscribe URL for THIS attempt and
   * recipient. Every outreach email carries one; the transport refuses to call a
   * provider without it.
   */
  unsubscribeUrl: string;
}

export interface EmailProviderResponse {
  accepted: boolean;
  messageId: string | null;
  /** Provider-side rejection reason, when it rejected. */
  rejectionReason?: string | null;
  /** True when the provider recognised the idempotency key as a repeat. */
  duplicate?: boolean;
  /** Structured provider response, already free of message content. */
  raw?: Record<string, unknown>;
}

/** The seam every provider implementation satisfies. */
export interface EmailProviderPort {
  readonly name: string;
  send(request: EmailProviderRequest): Promise<EmailProviderResponse>;
}

/**
 * Default provider: the platform's existing transactional-email Edge Function.
 *
 * Reuses the seam `emailService` already uses rather than introducing a second
 * path to SES. The function is invoked with a `lead_outreach` payload type;
 * see the module note in the implementation report — the Edge Function must
 * recognise that type before anything can actually be delivered, which is why
 * this transport ships disabled.
 */
export const supabaseEdgeEmailProvider: EmailProviderPort = {
  name: SES_EDGE_PROVIDER_NAME,
  async send(request: EmailProviderRequest): Promise<EmailProviderResponse> {
    // Imported lazily so the module graph carries no client for a transport
    // that is disabled by default.
    const { supabase } = (await import('../../db/supabaseClient')) as { supabase: { functions: { invoke: (fn: string, opts: unknown) => Promise<{ data?: unknown; error?: { message?: string } }> } } };

    const res = await supabase.functions.invoke('send-transactional-email', {
      body: {
        type: 'lead_outreach',
        recipientEmail: request.to,
        subject: request.subject,
        body: request.body,
        unsubscribeUrl: request.unsubscribeUrl,
        idempotencyKey: request.idempotencyKey,
        companyId: request.companyId,
      },
    });

    if (res.error) {
      return { accepted: false, messageId: null, rejectionReason: String(res.error.message ?? 'provider rejected'), raw: { error: String(res.error.message ?? '') } };
    }
    const data = (res.data ?? {}) as { messageId?: string; id?: string; duplicate?: boolean };
    return {
      accepted: true,
      messageId: data.messageId ?? data.id ?? null,
      duplicate: data.duplicate === true,
      raw: { messageId: data.messageId ?? data.id ?? null },
    };
  },
};

const trim = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
};

/** Basic shape check. A malformed address is a rejection, not a provider call. */
const looksLikeEmail = (v: string | null): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Build the email transport around a provider port.
 *
 * Injectable so tests exercise acceptance, rejection, timeout and error paths
 * without a network — and so a future provider swap changes one argument.
 */
export function createEmailTransport(
  provider: EmailProviderPort = supabaseEdgeEmailProvider,
  options: { timeoutMs?: number; enabled?: () => boolean; unsubscribeBaseUrl?: () => string | undefined } = {},
): OutreachTransport {
  const timeoutMs = options.timeoutMs ?? EMAIL_TIMEOUT_MS;
  const enabled = options.enabled ?? isEmailTransportEnabled;
  const unsubscribeBaseUrl = options.unsubscribeBaseUrl ?? (() => process.env[UNSUBSCRIBE_BASE_URL_ENV]);

  return {
    channel: 'email',
    provider: provider.name,
    external: true,

    async send(request: TransportRequest): Promise<TransportResult> {
      const base = { provider: provider.name, providerMessageId: null, duplicate: false } as const;

      // 1. The flag gate — checked before anything else, at the last point
      //    before egress. A disabled transport never calls the provider.
      if (!enabled()) {
        return {
          ...base, outcome: 'disabled', deliveryStatus: 'failed',
          response: { reason: 'email transport disabled' },
          error: `${EMAIL_ENABLED_ENV} is not enabled`,
        };
      }

      // 2. Recipient validation — a malformed address is our rejection, and
      //    sending it would waste provider reputation on a guaranteed bounce.
      if (!looksLikeEmail(request.recipient)) {
        return {
          ...base, outcome: 'rejected', deliveryStatus: 'failed',
          response: { reason: 'invalid_recipient' },
          error: 'recipient is missing or not a valid email address',
        };
      }

      // 2a. WP3 / L5 — the unsubscribe link. Minted for THIS attempt and THIS
      //     address, so the endpoint can record a restriction against exactly
      //     what was contacted. No attempt, no key, or no usable public origin
      //     means no working link — and then nothing is sent.
      let unsubscribeUrl: string;
      try {
        if (!request.attemptId) throw new Error('no attempt');
        const token = issueOutreachUnsubscribeToken({
          organizationId: request.task.companyId,
          attemptId: request.attemptId,
          recipient: request.recipient,
        });
        unsubscribeUrl = buildOutreachUnsubscribeUrl(token, unsubscribeBaseUrl());
      } catch {
        return {
          ...base, outcome: 'rejected', deliveryStatus: 'failed',
          response: { reason: 'unsubscribe_link_unavailable' },
          error: 'an unsubscribe link could not be produced for this attempt; nothing was sent',
        };
      }

      const subject = trim(request.task.action, 200) || 'Following up';
      const body = trim(request.task.explanation, 4000) || subject;
      const startedMs = Date.now();

      try {
        // 3. Timeout is enforced HERE rather than trusted from the provider: a
        //    provider that never answers would otherwise hold the dispatch
        //    open indefinitely with the task stuck in `dispatching`.
        const response = await Promise.race([
          provider.send({
            to: request.recipient,
            idempotencyKey: request.idempotencyKey,
            companyId: request.task.companyId,
            subject,
            body,
            unsubscribeUrl,
          }),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error('__ws3_transport_timeout__')), timeoutMs);
            // Never keep the process alive for a timeout that may not fire.
            if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref();
          }),
        ]);

        const latencyMs = Math.max(0, Date.now() - startedMs);

        if (!response.accepted) {
          return {
            ...base, outcome: 'rejected', deliveryStatus: 'failed', latencyMs,
            providerMessageId: response.messageId ?? null,
            response: { rejectionReason: response.rejectionReason ?? null, ...(response.raw ?? {}) },
            error: response.rejectionReason ?? 'provider rejected the message',
          };
        }

        // Accepted — the provider owns it now. NOT delivered.
        return {
          outcome: 'accepted',
          provider: provider.name,
          providerMessageId: response.messageId ?? null,
          deliveryStatus: 'sent_unverified',
          response: { accepted: true, ...(response.raw ?? {}) },
          duplicate: response.duplicate === true,
          latencyMs,
        };
      } catch (e) {
        const latencyMs = Math.max(0, Date.now() - startedMs);
        const message = e instanceof Error ? e.message : String(e);

        if (message === '__ws3_transport_timeout__') {
          return {
            ...base, outcome: 'timeout', deliveryStatus: 'failed', latencyMs,
            // A timeout is genuinely ambiguous: the provider may have accepted
            // it. Recorded as its own outcome so it is never mistaken for a
            // clean failure that could be safely repeated.
            response: { reason: 'provider_timeout', timeoutMs },
            error: `provider did not respond within ${timeoutMs}ms`,
          };
        }
        return {
          ...base, outcome: 'provider_error', deliveryStatus: 'failed', latencyMs,
          response: { reason: 'provider_error' },
          error: message.slice(0, 300),
        };
      }
    },
  };
}
