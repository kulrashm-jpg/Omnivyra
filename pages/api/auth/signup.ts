import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/auth/signup
 *
 * Public pre-signup gate. Runs the checks that must happen BEFORE the
 * browser fires `supabase.auth.signUp`. Responsibilities:
 *
 *   1. Personal-email / MX / rate-limit gates.
 *   2. ACCOUNT_EXISTS  — email is already a completed user (active role).
 *   3. ACCOUNT_EXISTS  — email is already confirmed in auth.users from a
 *                        prior flow (orphaned). Blocks the silent
 *                        user_repeated_signup failure mode.
 *   4. CLAIMED_DOMAIN — another user from this email's domain is already
 *                        the COMPANY_ADMIN. First time we see this email,
 *                        we send them a referral email with the admin's
 *                        contact details and write a signup_referrals row.
 *                        Subsequent attempts skip the email and return
 *                        alreadyReferred=true.
 *   5. Upsert signup_intents row and return { proceed: true }.
 *
 * Does NOT send a confirmation email — Supabase sends that itself when the
 * client calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  lookupExistingAccount,
  mintSignupIntent,
  resolveClaimedDomainRefusal,
  runSignupIdentityGate,
} from '../../../backend/services/signupIntentMint';
import { httpStatusFor, ELIGIBILITY_MESSAGES } from '../../../lib/auth/domainEligibilityModel';
import { checkRateLimit, EMAIL_LINK_LIMIT } from '../../../lib/auth/rateLimit';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { verifyCaptchaToken, CAPTCHA_FAILED_RESPONSE } from '../../../lib/auth/captcha';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  signupRejectionEventFor,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

type SuccessResponse = { proceed: true };
type ErrorResponse = {
  error: string;
  code?: string;
  /** CLAIMED_DOMAIN only: the prospect was already emailed on a prior attempt. */
  alreadyReferred?: boolean;
  /** CLAIMED_DOMAIN only: masked admin email shown on the contact-admin screen. */
  adminEmailMasked?: string | null;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);
  const ip = authRequestIp(req);
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:signup', limit: 5, windowSecs: 3600 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, companyName, captchaToken } = body as {
    email?: string;
    companyName?: string;
    captchaToken?: string | null;
  };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  // ── 0. CAPTCHA (no-op until CAPTCHA_PROVIDER is configured) ──────────────
  const captcha = await verifyCaptchaToken(captchaToken, ip);
  if (!captcha.ok) {
    return res.status(400).json(CAPTCHA_FAILED_RESPONSE);
  }

  // Company name is required for self-serve signups (the user becomes the
  // COMPANY_ADMIN of this company on first email verify). Stored on the
  // signup_intents row so /auth/callback can bootstrap the company without
  // asking the user again.
  const trimmedCompany = String(companyName ?? '').trim();
  if (!trimmedCompany) return res.status(400).json({ error: 'companyName is required' });
  if (trimmedCompany.length > 80) return res.status(400).json({ error: 'companyName is too long' });

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1] ?? '';
  if (!domain) return res.status(400).json({ error: 'Invalid email address' });

  // ── 0.5. Journey correlation ID + attempt event (AUTH-001 §9/§10) ─────────
  // Reuses the journey ID from an earlier attempt (persisted on the pending
  // signup_intents row) so retries and later stages (verify, company, credits)
  // group under one ID in capability_audit_log.resource_id.
  const userAgent = requestUserAgent(req);
  const correlationId = await ensureSignupCorrelationId(normalizedEmail);
  const emitOutcome = (
    event: Parameters<typeof emitSignupEvent>[0]['event'],
    outcome: 'allowed' | 'denied',
    reason?: string,
    companyId?: string | null,
  ) =>
    emitSignupEvent({
      event, outcome, correlationId,
      email: normalizedEmail,
      reason: reason ?? null,
      companyId: companyId ?? null,
      ip, userAgent,
    });
  await emitOutcome('SignupAttempted', 'allowed');

  // ── 1. Authoritative company-identity gate ───────────────────────────────
  // The single eligibility decision (personal-email, email capability, live
  // canonical website at the email domain, website⇄email-domain match) now
  // runs in section 4.5 below — AFTER the existing-user / orphan / claimed
  // checks — so a returning user whose website is transiently down can still
  // resume, and an already-claimed domain keeps the richer notify flow in
  // section 4. See validateCompanyIdentity (companyIdentityValidationService).

  // ── 2. Same email already a completed user? ──────────────────────────────
  // An existing public.users row with an active role = finished account;
  // route them to /login. Soft-deleted = blocked. Existing row without an
  // active role = abandoned onboarding; fall through (re-signup allowed).
  // Canonical "completed account" signal is an active row in
  // user_company_roles. users.company_id / users.role are deprecated and
  // no longer read here.
  const existingAccount = await lookupExistingAccount(normalizedEmail);

  if (existingAccount.kind === 'deleted') {
    await emitOutcome('SignupRejected', 'denied', 'ACCOUNT_DELETED');
    return res.status(403).json({ error: 'This account has been deactivated.', code: 'ACCOUNT_DELETED' });
  }

  if (existingAccount.kind !== 'none') {
    if (existingAccount.kind === 'active') {
      await emitOutcome('SignupRejected', 'denied', 'ACCOUNT_EXISTS');
      return res.status(409).json({
        error: 'An account with this email already exists. Please log in.',
        code:  'ACCOUNT_EXISTS',
      });
    }

    await emitOutcome('SignupRejected', 'denied', 'RESUME_SIGNUP');
    return res.status(409).json({
      error: 'We found an unfinished account for this email. Please sign in to continue setup.',
      code:  'RESUME_SIGNUP',
    });
  }

  // The CLAIMED_DOMAIN gate runs in section 4 below (after the orphaned
  // auth.users check) so a returning user with their OWN email resumes via
  // ACCOUNT_EXISTS / RESUME_SIGNUP instead of being told to contact an admin.

  // ── 3. auth.users already has this email confirmed? ───────────────────────
  // Catches the orphan case where auth.users was created by a prior flow
  // (e.g. the old ensureAuthUserExists hack) but public.users never
  // followed. Without this, Supabase would silently swallow a repeat
  // signup and never send the email.
  try {
    const { data: authConfirmed, error: rpcErr } = await supabase.rpc('auth_user_confirmed', {
      p_email: normalizedEmail,
    });
    if (rpcErr) {
      logger.warn('auth_signup_auth_confirmed_rpc_failed', { email: normalizedEmail, message: rpcErr.message });
    } else if (authConfirmed === true) {
      await emitOutcome('SignupRejected', 'denied', 'RESUME_SIGNUP_ORPHANED_AUTH');
      return res.status(409).json({
        error: 'We found an unfinished account for this email. Please sign in to continue setup.',
        code:  'RESUME_SIGNUP',
      });
    }
  } catch (err: any) {
    logger.warn('auth_signup_auth_confirmed_rpc_threw', { email: normalizedEmail, message: err?.message });
  }

  // ── 4. Domain already claimed by an existing company ─────────────────────
  // If any company already owns this email's domain, a NEW person from that
  // domain CANNOT self-register. We block here — BEFORE the confirmation
  // email is sent — so they never get a verification mail for an account
  // that can't exist. They see the admin's (masked) contact details, and
  // both the prospect and the company admin are emailed. Deduped per
  // prospect email via signup_referrals so repeat attempts don't re-spam
  // the admin (the signup endpoint is also IP rate-limited above).
  // The first user of a domain is unaffected: their company row doesn't
  // exist yet at signup time, so there's nothing to match.
  {
    const claimed = await resolveClaimedDomainRefusal({ normalizedEmail, domain, correlationId });
    if (claimed) {
      await emitOutcome('CompanyExists', 'denied', 'CLAIMED_DOMAIN', claimed.companyId);
      return res.status(httpStatusFor('CLAIMED_DOMAIN')).json(claimed.body);
    }
  }

  // ── 4.5. Authoritative company-identity validation (rules 1–4) ───────────
  // THE single eligibility decision. Runs only for genuinely-new, non-claimed
  // signups (returning users resumed in §2/§3; claimed domains returned in §4).
  // Fail-CLOSED: if validation cannot complete, we never let the client create
  // an account — onboarding/setup-company will no longer re-validate (Phase 8),
  // so the verdict must be settled here. Rule 5 (already-claimed) is owned by
  // §4 above, so it is disabled in this call to avoid a second, side-effect-free
  // claimed check racing the notify/referral flow.
  const identityGate = await runSignupIdentityGate(normalizedEmail);
  if (identityGate.kind === 'unavailable') {
    logger.error('auth_signup_identity_validation_threw', { email: normalizedEmail, message: identityGate.message, correlationId });
    await emitOutcome('SystemFailure', 'denied', 'IDENTITY_VALIDATION_UNAVAILABLE');
    return res.status(503).json({
      error: 'We could not verify your organization right now. Please try again in a moment.',
      code:  'IDENTITY_VALIDATION_UNAVAILABLE',
    });
  }
  const identity = identityGate.identity;

  // PROD-CX-004 §6 — auto-approve the narrow, provably-real case: MX valid + a
  // web host resolves in DNS, only the website was unreachable from our egress
  // (no SSRF/forwarding/canonical/parked concern). Email ownership is proven by
  // the verification step that gates account creation downstream, so admitting
  // the signup_intent here never creates an unverified account. The intent is
  // tagged for operator visibility. Flag-gated (default ON) for instant rollback;
  // when off, the case falls through to the normal review-block below.
  // The decision itself lives in runSignupIdentityGate (shared with
  // /api/onboarding/revalidate-signup).
  const autoApproveReview = identityGate.kind === 'pass' && identityGate.autoApproved;

  if (identityGate.kind === 'refused') {
    // PUBLIC_EMAIL / NO_EMAIL_CAPABILITY / NO_WEBSITE_FOUND / FORWARDING_DOMAIN /
    // DOMAIN_NOT_CANONICAL / DOMAIN_MISMATCH / BLOCKED — all messaged from the
    // single ELIGIBILITY_MESSAGES source. Review-needed cases surface the
    // "contact our team" copy; the account-creating handoff is not taken.
    const reason = identity.validationReason ?? 'BLOCKED';
    logger.info('auth_signup_identity_blocked', {
      email: normalizedEmail,
      reason,
      requiresManualReview: identity.requiresManualReview,
      diagnostics: identity.diagnostics ?? null,
      correlationId,
    });
    await emitOutcome(signupRejectionEventFor(reason), 'denied', reason);
    return res.status(httpStatusFor(reason)).json({
      error: ELIGIBILITY_MESSAGES[reason],
      code:  reason,
    });
  }

  if (autoApproveReview) {
    logger.info('auth_signup_identity_auto_approved', {
      email: normalizedEmail,
      reason: identity.validationReason,
      diagnostics: identity.diagnostics ?? null,
      correlationId,
    });
  }

  // ── 5. Fresh signup path — upsert signup_intents and let the client proceed.
  // The validated identity is persisted on the intent so onboarding/setup-company
  // consume the verdict instead of re-deriving it (system-of-record handoff).
  // Shared with /api/onboarding/revalidate-signup (backend/services/signupIntentMint).
  const minted = await mintSignupIntent({
    email:       normalizedEmail,
    companyName: trimmedCompany,
    identity,
    autoApproved: autoApproveReview,
    correlationId,
    source:      'signup_form',
    // e1 2026-11-13: a returning user whose pending intent EXPIRED used to get a 500 (the one-pending-per-email
    // unique index rejected the new insert); refresh that row in place instead, exactly as revalidate-signup does.
    refreshExpiredPending: true,
  });

  // A failed refresh of an existing pending intent was never surfaced here;
  // only a failed INSERT fails the request (unchanged behaviour).
  if (!minted.ok && minted.stage === 'insert') {
    logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: minted.error, correlationId });
    await emitOutcome('SystemFailure', 'denied', 'INTENT_INSERT_FAILED');
    return res.status(500).json({ error: 'Failed to initiate signup' });
  }

  await emitOutcome('SignupValidated', 'allowed');
  return res.status(200).json({ proceed: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/signup' });
