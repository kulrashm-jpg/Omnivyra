import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { isAcceptableEmailAddress } from '../../../lib/auth/emailAddressPolicy';

/**
 * POST /api/onboarding/revalidate-signup
 * Authorization: Bearer <supabase_access_token>
 *
 * P1 (GoTrue-bypass gate): company bootstrap and the initial-credit grant
 * require a bound signup intent minted by OUR server after every signup gate
 * passed. This route serves an authenticated, email-verified user who is not
 * yet onboarded but whose intent is missing, expired, or legacy (no verdict):
 * it re-runs every signup gate and, only on a pass, mints a fresh intent.
 *
 * Gate order (fail closed at every step, nothing minted on a refusal):
 *   1. POST only
 *   2. IP rate limit, authentication, per-uid rate limit
 *   3. email verified                      → 403 EMAIL_NOT_VERIFIED
 *   4. email-address policy                → 400 EMAIL_NOT_ACCEPTABLE
 *   5. company name (latest intent, else body) → 400
 *   6. existing account: soft-deleted      → 403 ACCOUNT_DELETED
 *                        already onboarded → 409 ACCOUNT_EXISTS
 *   7. claimed domain                      → 409 CLAIMED_DOMAIN (signup.ts shape)
 *   8. company identity (hard timeout)     → 503 IDENTITY_VALIDATION_UNAVAILABLE
 *                                            / 4xx eligibility code
 *   9. mint the intent                     → 200 { ok: true }
 *
 * Body: { companyName?: string }   (used only when no prior intent carries one)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { httpStatusFor, ELIGIBILITY_MESSAGES } from '../../../lib/auth/domainEligibilityModel';
import { logger } from '../../../backend/services/logger';
import { ensureSignupCorrelationId, requestIp } from '../../../backend/services/signupEventService';
import {
  lookupExistingAccount,
  mintSignupIntent,
  resolveClaimedDomainRefusal,
  runSignupIdentityGate,
  type ClaimedDomainBody,
} from '../../../backend/services/signupIntentMint';

/** Hard ceiling on the live identity probe; on expiry we fail closed (503). */
const REVALIDATE_IDENTITY_TIMEOUT_MS = 10_000;

type Result =
  | { ok: true }
  | ClaimedDomainBody
  | { error: string; code?: string };

async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limiting — IP gate before auth, UID gate after (as setup-company).
  const ip = requestIp(req);
  const ipRl = await checkRateLimit(ip, { keyPrefix: 'rl:onboarding:revalidate-signup', limit: 5, windowSecs: 3600 });
  if (!ipRl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const uidRl = await checkRateLimit(user.id, { keyPrefix: 'rl:uid:revalidate-signup', limit: 5, windowSecs: 3600 });
  if (!uidRl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  // ── App-level email-verification gate (AUTH-001 §1).
  if (!user.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  // ── Email-address policy.
  if (!isAcceptableEmailAddress(user.email)) {
    return res.status(400).json({
      error: 'Please use a standard email address (letters, digits and . _ + - before the @).',
      code:  'EMAIL_NOT_ACCEPTABLE',
    });
  }
  const normalizedEmail = String(user.email).trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1] ?? '';

  // ── Company name: the latest intent's (any status), else the request body.
  const { data: latestIntent } = await supabase
    .from('signup_intents')
    .select('intent_data')
    .eq('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorName = (latestIntent as { intent_data?: { company_name?: unknown } } | null)
    ?.intent_data?.company_name;
  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as { companyName?: unknown } | null;
  const companyName = (
    typeof priorName === 'string' && priorName.trim()
      ? priorName
      : typeof body?.companyName === 'string' ? body.companyName : ''
  ).trim();
  if (!companyName) return res.status(400).json({ error: 'companyName is required', code: 'COMPANY_NAME_REQUIRED' });
  if (companyName.length > 80) return res.status(400).json({ error: 'companyName is too long', code: 'COMPANY_NAME_TOO_LONG' });

  const correlationId = await ensureSignupCorrelationId(normalizedEmail);
  const logCtx = { userId: user.id, correlationId }; // never log the address (PII); userId is enough to trace

  // ── Existing account (signup.ts §2). An unfinished account is exactly the
  // case this route serves; a soft-deleted or already-onboarded one is not.
  const account = await lookupExistingAccount(normalizedEmail);
  if (account.kind === 'deleted') {
    logger.info('onboarding_revalidate_signup_refused', { ...logCtx, reason: 'ACCOUNT_DELETED' });
    return res.status(403).json({ error: 'This account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }
  if (account.kind === 'active') {
    logger.info('onboarding_revalidate_signup_refused', { ...logCtx, reason: 'ACCOUNT_EXISTS' });
    return res.status(409).json({ error: 'This account is already set up. Please log in.', code: 'ACCOUNT_EXISTS' });
  }

  // ── Claimed domain (signup.ts §4) — same notify flow and response shape.
  // Fail closed (P2): an unfinished claimed-domain lookup is a retryable 503, never "unclaimed".
  let claimed: Awaited<ReturnType<typeof resolveClaimedDomainRefusal>>;
  try {
    claimed = await resolveClaimedDomainRefusal({ normalizedEmail, domain, correlationId });
  } catch (err) {
    logger.warn('signup_claimed_domain_lookup_failed', { message: err instanceof Error ? err.message : String(err) });
    return res.status(503).json({ error: 'We could not verify your organization right now. Please try again in a moment.', code: 'IDENTITY_VALIDATION_UNAVAILABLE' });
  }
  if (claimed) {
    logger.info('onboarding_revalidate_signup_refused', { ...logCtx, reason: 'CLAIMED_DOMAIN', companyId: claimed.companyId });
    return res.status(httpStatusFor('CLAIMED_DOMAIN')).json(claimed.body);
  }

  // ── Authoritative company identity (signup.ts §4.5) with a hard timeout.
  const gate = await runSignupIdentityGate(normalizedEmail, { timeoutMs: REVALIDATE_IDENTITY_TIMEOUT_MS });
  if (gate.kind === 'unavailable') {
    logger.warn('onboarding_revalidate_signup_identity_unavailable', { ...logCtx, message: gate.message, timedOut: gate.timedOut });
    return res.status(503).json({
      error: 'We could not verify your organization right now. Please try again in a moment.',
      code:  'IDENTITY_VALIDATION_UNAVAILABLE',
    });
  }
  if (gate.kind === 'refused') {
    const reason = gate.identity.validationReason ?? 'BLOCKED';
    logger.info('onboarding_revalidate_signup_refused', { ...logCtx, reason });
    return res.status(httpStatusFor(reason)).json({ error: ELIGIBILITY_MESSAGES[reason], code: reason });
  }

  // ── Every gate passed — mint the bound intent.
  const minted = await mintSignupIntent({
    email:        normalizedEmail,
    companyName,
    identity:     gate.identity,
    autoApproved: gate.autoApproved,
    correlationId,
    source:       'onboarding_revalidate',
    refreshExpiredPending: true,
  });
  if (!minted.ok) {
    logger.error('onboarding_revalidate_signup_mint_failed', { ...logCtx, stage: minted.stage, message: minted.error });
    return res.status(500).json({ error: 'Could not complete signup validation. Please try again.' });
  }

  logger.info('onboarding_revalidate_signup_minted', {
    ...logCtx,
    intentId: minted.intentId,
    verdict: gate.autoApproved ? 'auto_approved' : 'eligible',
  });
  return res.status(200).json({ ok: true });
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/onboarding/revalidate-signup' });
