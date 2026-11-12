/**
 * signupWithoutIntentTelemetry — P1 (GoTrue-bypass hardening) detector.
 *
 * Every brand-new identity reaches a public.users row through one of two
 * inserts: /api/auth/sync-supabase-user ("Third: brand-new user") and
 * /api/auth/verify-email (first-verify path). A legitimate signup always passes
 * /api/auth/signup first, which writes a `signup_intents` row. A users-row
 * creation for an email with NO signup_intents row at all (any status, any
 * expiry) therefore means the identity was created outside the app's signup
 * gates — e.g. a direct GoTrue anon-key signup.
 *
 * TELEMETRY ONLY. This never throws, never blocks, and never changes a
 * response. A read error (or a read that returns no answer) skips the
 * telemetry. The email is never logged — only the endpoint and the auth uid.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { incrementAuthMetric } from './authMetrics';

export type SignupWithoutIntentEndpoint = 'sync-supabase-user' | 'verify-email';

export const SIGNUP_WITHOUT_INTENT_LOG_EVENT = 'auth.signup_without_intent';
export const SIGNUP_WITHOUT_INTENT_METRIC = 'auth.signup.without_intent';

export async function recordSignupWithoutIntentIfMissing(params: {
  email: string | null | undefined;
  endpoint: SignupWithoutIntentEndpoint;
  supabaseUid: string | null | undefined;
}): Promise<void> {
  const { endpoint, supabaseUid } = params;
  try {
    const email = String(params.email ?? '').trim().toLowerCase();
    if (!email) return;
    const { data, error } = await supabase
      .from('signup_intents')
      .select('id')
      .eq('email', email)
      .limit(1);
    if (error) {
      logger.warn('auth.signup_without_intent_check_failed', {
        endpoint,
        supabaseUid: supabaseUid ?? null,
        message: error.message,
      });
      return;
    }
    // A null error is not an answer: only a real array decides presence.
    if (!Array.isArray(data)) {
      logger.warn('auth.signup_without_intent_check_failed', {
        endpoint,
        supabaseUid: supabaseUid ?? null,
        message: 'no answer from signup_intents read',
      });
      return;
    }
    if (data.length > 0) return;
    logger.warn(SIGNUP_WITHOUT_INTENT_LOG_EVENT, { endpoint, supabaseUid: supabaseUid ?? null });
    incrementAuthMetric(SIGNUP_WITHOUT_INTENT_METRIC, { endpoint });
  } catch (err) {
    try {
      logger.warn('auth.signup_without_intent_check_failed', {
        endpoint,
        supabaseUid: supabaseUid ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // telemetry must never throw
    }
  }
}
