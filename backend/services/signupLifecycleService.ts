/**
 * signupLifecycleService.ts — THE canonical signup lifecycle (AUTH-001R §1).
 *
 * One deterministic vocabulary + transition map + derivation for the whole
 * signup journey. This is deliberately NOT a new state store:
 *
 *   AUTHORITY = derivation over the EXISTING stores
 *     - signup_intents.status / expires_at   (pre-account)
 *     - users.is_email_verified / onboarding_state / is_deleted
 *     - user_company_roles (status='active')  — canonical membership signal
 *
 * No table is added, no column is written by this module, and the existing
 * `users.onboarding_state` model is untouched — the lifecycle is a pure,
 * deterministic READ over those authorities plus a legal-transition map used
 * by the event layer. That satisfies "one canonical authority" without
 * introducing a parallel state model.
 *
 * Lifecycle (adapted from the suggested order to this product's real flow —
 * here the profile step (ONBOARDING_STARTED) precedes company creation, and
 * company creation is what completes onboarding):
 *
 *   INITIATED → VALIDATING → VALIDATED → VERIFICATION_PENDING → VERIFIED
 *     → ONBOARDING_STARTED → COMPANY_CREATED → ONBOARDING_COMPLETED
 *   failure edges → FAILED;  stall edges → ABANDONED
 *
 * Determinism rules:
 *   - VALIDATING / VALIDATED / COMPANY_CREATED are short-lived (request-
 *     scoped) states; the durable derivation can also observe COMPANY_CREATED
 *     when the company insert landed but the onboarding_state stamp did not.
 *   - Self-transitions are always legal (idempotent retries: re-submit,
 *     resend, re-verify, re-complete are no-ops at the lifecycle level).
 *   - FAILED and ABANDONED are recoverable back into VALIDATING (a user may
 *     always retry signup); ONBOARDING_COMPLETED is terminal.
 */

import { supabase } from '../db/supabaseClient';

export type SignupLifecycleState =
  | 'INITIATED'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'ONBOARDING_STARTED'
  | 'COMPANY_CREATED'
  | 'ONBOARDING_COMPLETED'
  | 'FAILED'
  | 'ABANDONED';

export const SIGNUP_LIFECYCLE_ORDER: ReadonlyArray<SignupLifecycleState> = [
  'INITIATED',
  'VALIDATING',
  'VALIDATED',
  'VERIFICATION_PENDING',
  'VERIFIED',
  'ONBOARDING_STARTED',
  'COMPANY_CREATED',
  'ONBOARDING_COMPLETED',
];

/** Legal transitions (self-transitions are additionally always legal). */
const TRANSITIONS: Readonly<Record<SignupLifecycleState, ReadonlyArray<SignupLifecycleState>>> = {
  INITIATED:             ['VALIDATING', 'FAILED', 'ABANDONED'],
  VALIDATING:            ['VALIDATED', 'FAILED'],
  VALIDATED:             ['VERIFICATION_PENDING', 'VALIDATING', 'FAILED', 'ABANDONED'],
  VERIFICATION_PENDING:  ['VERIFIED', 'VALIDATING', 'FAILED', 'ABANDONED'],
  VERIFIED:              ['ONBOARDING_STARTED', 'FAILED'],
  ONBOARDING_STARTED:    ['COMPANY_CREATED', 'ONBOARDING_COMPLETED', 'FAILED'],
  COMPANY_CREATED:       ['ONBOARDING_COMPLETED', 'FAILED'],
  ONBOARDING_COMPLETED:  [],
  FAILED:                ['VALIDATING', 'ABANDONED'],
  ABANDONED:             ['VALIDATING'],
};

/** Terminal states — no outbound edges except documented recovery. */
export const TERMINAL_LIFECYCLE_STATES: ReadonlySet<SignupLifecycleState> = new Set([
  'ONBOARDING_COMPLETED',
]);

/** True when `from → to` is a legal transition. Self-transitions are legal (idempotent retries). */
export function canTransition(from: SignupLifecycleState, to: SignupLifecycleState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Throwing guard for callers that must never perform an illegal transition. */
export function assertTransition(from: SignupLifecycleState, to: SignupLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`ILLEGAL_SIGNUP_LIFECYCLE_TRANSITION:${from}->${to}`);
  }
}

/**
 * The journey state each canonical signup event implies. Used by the event
 * layer to stamp `journeyState` on every emitted event without touching the
 * call sites (callers may still override explicitly).
 */
export const EVENT_IMPLIED_LIFECYCLE_STATE: Readonly<Record<string, SignupLifecycleState>> = {
  SignupAttempted:          'VALIDATING',
  SignupValidated:          'VALIDATED',
  SignupRejected:           'FAILED',
  PublicEmailRejected:      'FAILED',
  DisposableEmailRejected:  'FAILED',
  WebsiteRejected:          'FAILED',
  ValidationFailed:         'FAILED',
  CompanyExists:            'FAILED',
  VerificationSent:         'VERIFICATION_PENDING',
  VerificationSucceeded:    'VERIFIED',
  OnboardingStarted:        'ONBOARDING_STARTED',
  CompanyCreated:           'COMPANY_CREATED',
  CreditsGranted:           'COMPANY_CREATED',
  OnboardingCompleted:      'ONBOARDING_COMPLETED',
  SystemFailure:            'FAILED',
};

export interface DerivedSignupLifecycle {
  state: SignupLifecycleState;
  /** Which authority decided the state (diagnostics / recovery UX). */
  authority: 'user_company_roles' | 'users' | 'signup_intents' | 'none';
  /** The concrete resume step the client should take from this state. */
  nextStep:
    | 'retry_signup'          // INITIATED / FAILED / ABANDONED
    | 'verify_email'          // VERIFICATION_PENDING (resend available)
    | 'set_password'          // VERIFIED but has_password=false
    | 'complete_profile'      // VERIFIED
    | 'create_company'        // ONBOARDING_STARTED / COMPANY_CREATED
    | 'enter_app';            // ONBOARDING_COMPLETED
}

/**
 * Derive the canonical lifecycle state for an email from the existing
 * authorities. Pure read — deterministic, retry-safe, replay-safe (same
 * inputs → same answer), and safe to call on every request.
 *
 * Returns null when NO journey exists for this email (nothing to resume).
 * Never throws.
 */
export async function deriveSignupLifecycle(email: string): Promise<DerivedSignupLifecycle | null> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('id, is_deleted, is_email_verified, has_password, onboarding_state')
      .eq('email', normalized)
      .maybeSingle();

    if (userRow) {
      const u = userRow as {
        id: string; is_deleted?: boolean; is_email_verified?: boolean;
        has_password?: boolean; onboarding_state?: string | null;
      };
      if (u.is_deleted) return { state: 'FAILED', authority: 'users', nextStep: 'retry_signup' };

      const onboardingState = String(u.onboarding_state ?? '');

      // Membership is the canonical completion signal.
      const { data: activeRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', u.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (activeRole) {
        return onboardingState === 'company_complete'
          ? { state: 'ONBOARDING_COMPLETED', authority: 'user_company_roles', nextStep: 'enter_app' }
          // Company/membership exists but the onboarding_state stamp is
          // missing (partial write) — resumable at company setup, which is
          // idempotent and will re-stamp.
          : { state: 'COMPANY_CREATED', authority: 'user_company_roles', nextStep: 'create_company' };
      }

      if (onboardingState === 'company_complete') {
        // State says complete but no active membership — mismatched
        // self-registered membership was filtered; resume at company step.
        return { state: 'ONBOARDING_STARTED', authority: 'users', nextStep: 'create_company' };
      }
      if (onboardingState === 'profile_complete') {
        return { state: 'ONBOARDING_STARTED', authority: 'users', nextStep: 'create_company' };
      }
      if (u.is_email_verified === true) {
        return {
          state: 'VERIFIED',
          authority: 'users',
          nextStep: u.has_password === true ? 'complete_profile' : 'set_password',
        };
      }
      return { state: 'VERIFICATION_PENDING', authority: 'users', nextStep: 'verify_email' };
    }

    // No users row — the journey (if any) lives on signup_intents.
    const { data: intent } = await supabase
      .from('signup_intents')
      .select('status, expires_at')
      .eq('email', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!intent) return null;

    const i = intent as { status?: string; expires_at?: string };
    if (i.status === 'pending' && i.expires_at && new Date(i.expires_at) > new Date()) {
      // Validated at signup; the confirmation email round-trip is in flight.
      return { state: 'VERIFICATION_PENDING', authority: 'signup_intents', nextStep: 'verify_email' };
    }
    if (i.status === 'completed') {
      // Intent consumed but the users row is gone — treat as abandoned/retryable.
      return { state: 'ABANDONED', authority: 'signup_intents', nextStep: 'retry_signup' };
    }
    // pending-but-expired or status='expired'
    return { state: 'ABANDONED', authority: 'signup_intents', nextStep: 'retry_signup' };
  } catch {
    // Derivation must never break a caller — absence of an answer is the
    // safe degraded result (callers fall back to their legacy behavior).
    return null;
  }
}
