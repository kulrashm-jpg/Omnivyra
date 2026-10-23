/**
 * domainReminderService.ts
 *
 * Single-purpose helper that sends a "verify your domain" email. Mirrors
 * the existing emailService.ts pattern (delegates to the Edge Function
 * `send-transactional-email`, which holds SES credentials and renders HTML).
 *
 * Edge Function contract (template-side, must be added there before this
 * helper actually delivers email):
 *
 *   payload.type = 'domain_verification_reminder'
 *   payload.recipientEmail
 *   payload.finalDomain
 *   payload.dashboardUrl
 *
 *   Subject: "Verify your domain to unlock full access"
 *   Body:    "You're almost done setting up {finalDomain}. Add your
 *             verification record and click verify. If you need help,
 *             return to your dashboard: {dashboardUrl}"
 *
 * Until the Edge Function adds a case for `domain_verification_reminder`,
 * delivery will fail at the Edge Function level and the caller's wrapping
 * try/catch will swallow it. That's intentional — soft enforcement.
 *
 * NOTE (4C-5A): that paragraph is now STALE. The Edge Function does handle
 * `domain_verification_reminder` — it is in its `KNOWN_TYPES` allow-list — so
 * this reminder is deliverable today. Left in place rather than rewritten
 * because correcting it is outside the phase that found it; treat the
 * allow-list as the authority.
 *
 * ═══ CONTACT GOVERNANCE: EXEMPT BY OWNER DECISION (E4, Phase 4C-5C) ════════
 *
 * This path deliberately does NOT call `mayContact`, and that is a decision
 * rather than an oversight. The owner has ruled the domain-verification
 * reminder an account/transactional communication about the recipient's OWN
 * platform account and verification status, and therefore exempt from the
 * current prospect-contact governance restrictions.
 *
 * Do not add a governance check here on the assumption it was forgotten. If you
 * believe it belongs, that is a reversal of an owner decision, not a bug fix.
 *
 * THE EXEMPTION IS THIS PATH ONLY. It says nothing about the `email_jobs` queue
 * drain, the helpers in `emailService`, or activation outreach — each of those
 * is still an open question. The full boundary contract, including why the
 * distinction cannot presently be expressed in the governance data model, is
 * recorded once in `backend/services/emailService.ts`.
 *
 * This comment enforces nothing at runtime. The classification it records is
 * pinned by `backend/tests/unit/w2c5bEmailGovernanceBoundary.test.ts`.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { getCanonicalAppUrl } from '../config/getCanonicalAppUrl';

export interface SendDomainVerificationReminderInput {
  user_email: string;
  final_domain: string;
}

function appUrl(): string {
  return getCanonicalAppUrl();
}

export async function sendDomainVerificationReminder(
  input: SendDomainVerificationReminderInput,
): Promise<void> {
  const recipientEmail = String(input.user_email || '').trim();
  const finalDomain    = String(input.final_domain || '').trim().toLowerCase();
  if (!recipientEmail || !finalDomain) {
    logger.warn('domain_verification_reminder_skipped_invalid_input', {
      recipientEmail: !!recipientEmail,
      finalDomain:    !!finalDomain,
    });
    return;
  }

  const dashboardUrl = `${appUrl()}/onboarding/domain-verification`;

  try {
    const { error } = await supabase.functions.invoke('send-transactional-email', {
      body: {
        type:           'domain_verification_reminder',
        recipientEmail,
        finalDomain,
        dashboardUrl,
      },
    });
    if (error) {
      logger.warn('domain_verification_reminder_send_failed', {
        recipientEmail,
        finalDomain,
        message: error.message,
      });
      return;
    }
    logger.info('domain_verification_reminder_sent', {
      recipientEmail,
      finalDomain,
    });
  } catch (err) {
    logger.warn('domain_verification_reminder_threw', {
      recipientEmail,
      finalDomain,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
