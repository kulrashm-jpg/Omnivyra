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
