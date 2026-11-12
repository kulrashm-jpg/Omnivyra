/**
 * What a failed `send-transactional-email` invoke means for the email_jobs retry (CLASS-2 D3, e9).
 *
 * The worker retried every failure, so a lost answer to a message SES had accepted was SENT AGAIN.
 * The same verdict as CMS publishing: only a failure known to have sent nothing is retried.
 *
 *   not_sent  - the function ANSWERED and says so: a 4xx (it refused the request before any send:
 *               auth, bad body, missing type), or a 500 whose body carries outcome "not_sent"
 *               (supabase/functions/send-transactional-email/outcome.ts).
 *   uncertain - everything else: a 500 without that answer (outcome "uncertain", or an older
 *               function that does not say), a relay error, a network error or timeout - the
 *               request may have reached SES. Never retried automatically.
 */
export type EmailSendFailureOutcome = 'not_sent' | 'uncertain';

export async function emailSendFailureOutcome(error: unknown): Promise<EmailSendFailureOutcome> {
  const e = error as { name?: unknown; context?: unknown } | null;
  if (!e || e.name !== 'FunctionsHttpError') return 'uncertain';
  const response = e.context as { status?: unknown; clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } | undefined;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status !== null && status >= 400 && status < 500) return 'not_sent';
  try {
    const reader = typeof response?.clone === 'function' ? response.clone() : response;
    const body = reader && typeof reader.json === 'function' ? await reader.json() : null;
    return (body as { outcome?: unknown } | null)?.outcome === 'not_sent' ? 'not_sent' : 'uncertain';
  } catch {
    return 'uncertain';
  }
}

/** The dead-letter reason of an uncertain send: a person checks the recipient's inbox / SES before any resend. */
export const EMAIL_OUTCOME_UNCERTAIN_PREFIX = 'OUTCOME_UNCERTAIN';
