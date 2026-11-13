import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { isAcceptableEmailAddress, EMAIL_ADDRESS_POLICY_MESSAGE } from '../../../lib/auth/emailAddressPolicy';

/**
 * POST /api/auth/signup
 *
 * The ONLY self-serve creator of an auth identity (P2, e1 2026-11-13; owner ruling: no CAPTCHA, public signup
 * disabled at the provider once this ships). In order - and the order is load-bearing:
 *
 *   0. Per-IP rate limit; input checks (email, password policy, company name; address policy where present).
 *   1. ACCOUNT_EXISTS / ACCOUNT_DELETED / orphan-resume for an email that already has an account.
 *   2. CLAIMED_DOMAIN - matched on the raw host AND the registrable domain; fails CLOSED (503) on a read error.
 *   3. The authoritative company-identity gate (runSignupIdentityGate).
 *   4. Success-only ceilings: per registrable domain (3/h, 10/day -> 429) and global (200/h -> 503; alert at 30/h).
 *   5. Mint the signup intent (signupIntentMint - the single writer; carries the verdict P1's bootstrap requires).
 *   6. ONLY NOW create the identity via the admin API (email_confirm false - confirmation stays enforced), so a
 *      refused attempt writes NO auth.users row.
 *   7. Send the confirmation link (signInWithOtp, shouldCreateUser:false), then record the success + telemetry.
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
import { checkRateLimit, peekRateLimit, EMAIL_LINK_LIMIT, type RateLimitConfig } from '../../../lib/auth/rateLimit';
import { validatePassword } from '../../../lib/auth/passwordPolicy';
import { normalizeCompanyDomain } from '../../../lib/shared/domain/companyDomain';
import { getCanonicalAppUrl } from '../../../backend/config/getCanonicalAppUrl';
import { incrementAuthMetric } from '../../../backend/services/authMetrics';
import { notifySignupLimiterUnavailable, sendSignupBusy } from '../../../backend/services/opsAlertService';
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
  // onRedisFailure:'closed' pins THIS limit's degraded mode (never the global sensitive-mode env, which would close
  // login too). A degraded limiter reports bypassed and is answered below with the retryable 503.
  const rl = await checkRateLimit(ip, { ...EMAIL_LINK_LIMIT, keyPrefix: 'rl:auth:signup', limit: 5, windowSecs: 3600, onRedisFailure: 'closed' });
  // Owner ruling (e1 2026-11-13): with no CAPTCHA, the limiter IS the defence - if Redis/Upstash is unreachable or
  // over quota (the limiter reports `bypassed`), signup FAILS CLOSED with a retryable 503 (never a 500, never a
  // silent pass) and the owner is notified at most once per outage window. Login and the rest of the app are not
  // affected by this rule.
  if (rl.bypassed) {
    void notifySignupLimiterUnavailable('/api/auth/signup', `per-ip limiter degraded (${rl.degradedMode ?? 'unknown'})`);
    return sendSignupBusy(res);
  }
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, companyName, captchaToken, password } = body as {
    email?: string;
    companyName?: string;
    captchaToken?: string | null;
    password?: unknown;
  };

  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'email is required' });

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

  // Conservative address policy where an address first enters (defence in depth; never rely on the provider).
  if (!isAcceptableEmailAddress(email)) return res.status(400).json({ error: EMAIL_ADDRESS_POLICY_MESSAGE });
  // P2 (e1 2026-11-13): signup.ts is the ONLY self-serve creator of an auth identity, so it takes the password and
  // creates the identity itself (after every gate - see step 6). The browser no longer calls supabase.auth.signUp.
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'password is required', code: 'PASSWORD_REQUIRED' });
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) return res.status(400).json({ error: passwordCheck.reason, code: 'PASSWORD_INVALID' });

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1] ?? '';
  if (!domain) return res.status(400).json({ error: 'Invalid email address' });
  // Identity + quota key: the REGISTRABLE domain (eTLD+1) - bot1.example.com and bot2.example.com are one domain.
  const registrableDomain = normalizeCompanyDomain(normalizedEmail) || domain;

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
    // Fail closed (P2): an unfinished claimed-domain lookup is a retryable 503, never "unclaimed".
    let claimed: Awaited<ReturnType<typeof resolveClaimedDomainRefusal>>;
    try {
      claimed = await resolveClaimedDomainRefusal({ normalizedEmail, domain, correlationId });
    } catch (err) {
      logger.warn('signup_claimed_domain_lookup_failed', { message: err instanceof Error ? err.message : String(err) });
      return res.status(503).json({ error: 'We could not verify your organization right now. Please try again in a moment.', code: 'IDENTITY_VALIDATION_UNAVAILABLE' });
    }
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

  // ── 4.9 P2 signup ceilings (e1 2026-11-13; e9 ruling, 05 review) ──────────
  // Counted on SUCCESSFUL signups only (peek now, record after step 6), so refused attempts from rotating IPs can
  // never exhaust a budget and lock legitimate users - or a whole domain - out:
  //   per registrable domain: SIGNUP_DOMAIN_HOURLY / SIGNUP_DOMAIN_DAILY  -> 429 SIGNUP_DOMAIN_LIMIT
  //   global:                 SIGNUP_GLOBAL_HOURLY (hard)                  -> 503 SIGNUP_PAUSED (retryable)
  // The per-IP limit at the top of the handler still counts every attempt.
  const [domainHour, domainDay, globalHour] = await Promise.all([
    peekRateLimit(registrableDomain, SIGNUP_DOMAIN_HOURLY),
    peekRateLimit(registrableDomain, SIGNUP_DOMAIN_DAILY),
    peekRateLimit('all', SIGNUP_GLOBAL_HOURLY),
  ]);
  if (domainHour.bypassed || domainDay.bypassed || globalHour.bypassed) {
    void notifySignupLimiterUnavailable('/api/auth/signup', 'success-ceiling limiter degraded');
    return sendSignupBusy(res);
  }
  if (!globalHour.allowed) {
    logger.warn('auth.signup_global_ceiling_reached', { count: globalHour.count });
    incrementAuthMetric('auth.signup.attempt', { outcome: 'global_ceiling' });
    return res.status(503).json({ error: 'Signups are temporarily paused. Please try again shortly.', code: 'SIGNUP_PAUSED' });
  }
  if (!domainHour.allowed || !domainDay.allowed) {
    logger.warn('auth.signup_domain_ceiling_reached', { registrable_domain: registrableDomain });
    incrementAuthMetric('auth.signup.attempt', { outcome: 'domain_ceiling' });
    return res.status(429).json({
      error: "Too many new accounts from your organization's domain right now. Please try again later.",
      code:  'SIGNUP_DOMAIN_LIMIT',
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
  if (minted.ok === false && minted.stage === 'insert') {
    logger.error('auth_signup_intent_insert_failed', { email: normalizedEmail, message: minted.error, correlationId });
    await emitOutcome('SystemFailure', 'denied', 'INTENT_INSERT_FAILED');
    return res.status(500).json({ error: 'Failed to initiate signup' });
  }

  // ── 6. Create the auth identity - ONLY NOW (P2) ──────────────────────────
  // ORDER IS LOAD-BEARING: every eligibility gate above runs BEFORE the identity exists, so a refused attempt writes
  // NO auth.users row (pinned by p2SignupServerCreation.test.ts). The intent is minted first: if creation then fails,
  // the retry re-uses the same pending intent. email_confirm:false - email confirmation stays ENFORCED.
  const created = await supabase.auth.admin.createUser({ email: normalizedEmail, password, email_confirm: false });
  const alreadyExists = !!created.error && /already (been )?registered|already exists/i.test(String(created.error.message ?? ''));
  if (created.error && !alreadyExists) {
    logger.error('auth_signup_identity_create_failed', { message: created.error.message, correlationId });
    await emitOutcome('SystemFailure', 'denied', 'IDENTITY_CREATE_FAILED');
    return res.status(500).json({ error: 'We could not create your account right now. Please try again.', code: 'IDENTITY_CREATE_FAILED' });
  }

  // ── 7. Confirmation link - the same primitive resend-verification uses; never creates a user.
  // An identity that already existed (an unconfirmed earlier attempt) gets a fresh link; its password is unchanged.
  const { error: linkError } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: { shouldCreateUser: false, emailRedirectTo: `${getCanonicalAppUrl()}/auth/callback` },
  });
  if (linkError) logger.warn('auth_signup_confirmation_send_failed', { message: linkError.message, correlationId });

  // ── 8. Record the SUCCESS against the ceilings; burst telemetry by registrable domain.
  if (!alreadyExists) {
    const [, , globalRecorded] = await Promise.all([
      checkRateLimit(registrableDomain, SIGNUP_DOMAIN_HOURLY),
      checkRateLimit(registrableDomain, SIGNUP_DOMAIN_DAILY),
      checkRateLimit('all', SIGNUP_GLOBAL_HOURLY),
    ]);
    const createdThisHour = SIGNUP_GLOBAL_HOURLY.limit - globalRecorded.remaining;
    if (createdThisHour >= SIGNUP_GLOBAL_ALERT_PER_HOUR) {
      logger.warn('auth.signup_burst', { created_this_hour: createdThisHour, threshold: SIGNUP_GLOBAL_ALERT_PER_HOUR });
      incrementAuthMetric('auth.signup.burst', {});
    }
  }
  logger.info('auth.signup_attempt', { registrable_domain: registrableDomain, outcome: alreadyExists ? 'resumed' : 'created' });
  incrementAuthMetric('auth.signup.attempt', { outcome: alreadyExists ? 'resumed' : 'created' });

  await emitOutcome('SignupValidated', 'allowed');
  return res.status(200).json({ proceed: true });
}


/** P2 success-only signup ceilings (e9 defaults 2026-11-13; the owner may change them). */
const SIGNUP_DOMAIN_HOURLY: RateLimitConfig = { keyPrefix: 'rl:auth:signup-ok:domain:1h', limit: 3, windowSecs: 3600, onRedisFailure: 'closed' };
const SIGNUP_DOMAIN_DAILY: RateLimitConfig = { keyPrefix: 'rl:auth:signup-ok:domain:1d', limit: 10, windowSecs: 86400, onRedisFailure: 'closed' };
const SIGNUP_GLOBAL_HOURLY: RateLimitConfig = { keyPrefix: 'rl:auth:signup-ok:global:1h', limit: 200, windowSecs: 3600, onRedisFailure: 'closed' };
const SIGNUP_GLOBAL_ALERT_PER_HOUR = 30;

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/signup' });
