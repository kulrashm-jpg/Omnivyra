/**
 * signupIntentMint — the ONLY producer of a "bound signup intent" (P1).
 *
 * A signup_intents row carrying a settled identity verdict is what onboarding
 * consumes before it bootstraps a company or grants the initial credits. It is
 * minted ONLY by our server, ONLY after every signup gate passed, so an auth
 * identity created directly against GoTrue (anon-key signUp) has no intent and
 * cannot reach company creation.
 *
 * Producers:
 *   - POST /api/auth/signup                 (pre-signup gate, section 5)
 *   - POST /api/onboarding/revalidate-signup (verified-but-not-onboarded users
 *     whose intent is missing / expired / legacy)
 *
 * Consumer contract (onboarding): email = verified email (lowercased);
 * status in ('pending','completed'); expires_at > now();
 * intent_data.validated_company_domain === normalizeCompanyDomain(email);
 * intent_data.validated_website_url non-empty; intent_data.verdict in
 * ('eligible','auto_approved').
 *
 * The shared gates both producers run live here too, so neither can drift to
 * fewer checks than the other.
 */

import { supabase } from '../db/supabaseClient';
import {
  validateCompanyIdentity,
  COMPANY_IDENTITY_VALIDATION_VERSION,
  type CompanyIdentity,
} from './companyIdentityValidationService';
import { ELIGIBILITY_MESSAGES } from '../../lib/auth/domainEligibilityModel';
import { notifyAdminAndProspectOfClaimedDomain } from './claimedDomainNotifyService';
import { logger } from './logger';

export type SignupIntentVerdict = 'eligible' | 'auto_approved';

export const SIGNUP_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

// ── Gate: existing account (signup.ts §2) ───────────────────────────────────

export type ExistingAccountState =
  | { kind: 'none' }
  | { kind: 'deleted'; userId: string }
  | { kind: 'active'; userId: string }
  | { kind: 'unfinished'; userId: string };

/**
 * Canonical "completed account" signal is an active user_company_roles row for
 * the public.users row matching this email. Soft-deleted users are reported as
 * 'deleted' (the role lookup is skipped, as in signup.ts).
 */
export async function lookupExistingAccount(normalizedEmail: string): Promise<ExistingAccountState> {
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, is_deleted, onboarding_state')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!existingUser) return { kind: 'none' };
  const userId = (existingUser as { id: string }).id;
  if ((existingUser as { is_deleted?: boolean }).is_deleted) return { kind: 'deleted', userId };

  const { data: companyRole } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return companyRole ? { kind: 'active', userId } : { kind: 'unfinished', userId };
}

// ── Gate: claimed domain (signup.ts §4) ─────────────────────────────────────

export type ClaimedDomainBody = {
  error: string;
  code: 'CLAIMED_DOMAIN';
  alreadyReferred: boolean;
  adminEmailMasked: string | null;
};

/** "jo••••@acme.com" — enough to recognise the admin without leaking the full address. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, host] = email.split('@');
  if (!local || !host) return null;
  const shown = local.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(1, local.length - shown.length))}@${host}`;
}

/**
 * If a company already owns this email's domain, a NEW person from that domain
 * cannot self-register. Sends the (deduped) admin + prospect notification and
 * returns the 409 body; returns null when the domain is unclaimed.
 * `domain` is the raw email host, exactly as signup.ts matches it.
 */
export async function resolveClaimedDomainRefusal(args: {
  normalizedEmail: string;
  domain: string;
  correlationId: string;
}): Promise<{ companyId: string; body: ClaimedDomainBody } | null> {
  const { normalizedEmail, domain, correlationId } = args;
  const { data: byWebsite } = await supabase
    .from('companies')
    .select('id, name')
    .eq('website_domain', domain)
    .maybeSingle();
  const claimedCompany =
    byWebsite ??
    (
      await supabase
        .from('companies')
        .select('id, name')
        .eq('admin_email_domain', domain)
        .maybeSingle()
    ).data;

  if (!claimedCompany) return null;
  const company = claimedCompany as { id: string; name: string | null };

  // Resolve the company admin's email for the masked display.
  const { data: adminRole } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', company.id)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const adminUserId = (adminRole as { user_id?: string } | null)?.user_id ?? null;
  const { data: adminUser } = adminUserId
    ? await supabase.from('users').select('email').eq('id', adminUserId).maybeSingle()
    : { data: null };
  const adminEmail = (adminUser as { email?: string } | null)?.email ?? null;

  // alreadyReferred = the prospect was already emailed on a prior attempt.
  const { data: priorReferral } = await supabase
    .from('signup_referrals')
    .select('admin_email_sent_at')
    .eq('email', normalizedEmail)
    .maybeSingle();
  const alreadyReferred = !!(priorReferral as { admin_email_sent_at?: string | null } | null)
    ?.admin_email_sent_at;

  // Fire both emails (idempotent / deduped inside the service; never throws).
  await notifyAdminAndProspectOfClaimedDomain(supabase, {
    prospectEmail: normalizedEmail,
    emailDomain:   domain,
    companyId:     company.id,
    companyName:   company.name,
    nowIso:        new Date().toISOString(),
  });

  logger.info('auth_signup_company_claimed_blocked', {
    email:     normalizedEmail,
    domain,
    companyId: company.id,
    alreadyReferred,
    correlationId,
  });

  return {
    companyId: company.id,
    body: {
      error:            ELIGIBILITY_MESSAGES.CLAIMED_DOMAIN,
      code:             'CLAIMED_DOMAIN',
      alreadyReferred,
      adminEmailMasked: maskEmail(adminEmail),
    },
  };
}

// ── Gate: authoritative company identity (signup.ts §4.5) ───────────────────

export type IdentityGateResult =
  | { kind: 'unavailable'; message: string; timedOut: boolean }
  | { kind: 'refused'; identity: CompanyIdentity }
  | { kind: 'pass'; identity: CompanyIdentity; autoApproved: boolean };

export class IdentityValidationTimeoutError extends Error {
  constructor(ms: number) {
    super(`company identity validation exceeded ${ms}ms`);
    this.name = 'IdentityValidationTimeoutError';
  }
}

/**
 * Runs validateCompanyIdentity (rule 5 disabled — the claimed-domain gate above
 * owns it) and the PROD-CX-004 §6 auto-approve decision. Never throws: a throw,
 * or exceeding `timeoutMs` when given, is reported as 'unavailable' so callers
 * fail CLOSED.
 */
export async function runSignupIdentityGate(
  normalizedEmail: string,
  opts: { timeoutMs?: number } = {},
): Promise<IdentityGateResult> {
  let identity: CompanyIdentity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const validation = validateCompanyIdentity(normalizedEmail, {
      lookupClaimedCompany: async () => null,
    });
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const ms = opts.timeoutMs;
      // A late rejection after the timeout won the race must not go unhandled.
      validation.catch(() => undefined);
      identity = await Promise.race([
        validation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new IdentityValidationTimeoutError(ms)), ms);
        }),
      ]);
    } else {
      identity = await validation;
    }
  } catch (err: any) {
    return {
      kind: 'unavailable',
      message: String(err?.message ?? err),
      timedOut: err instanceof IdentityValidationTimeoutError,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Flag-gated (default ON) for instant rollback.
  const autoApproveEnabled = (process.env.IDENTITY_HARDENING_AUTO_APPROVE ?? 'true').toLowerCase() !== 'false';
  const autoApproved = identity.autoApprovable === true && autoApproveEnabled;

  if (!identity.eligible && !autoApproved) return { kind: 'refused', identity };
  return { kind: 'pass', identity, autoApproved };
}

// ── Mint ────────────────────────────────────────────────────────────────────

export type MintSignupIntentInput = {
  email: string;
  companyName: string;
  identity: Pick<
    CompanyIdentity,
    'companyIdentityDomain' | 'normalizedWebsiteDomain' | 'websiteUrl' | 'validationReason'
  >;
  autoApproved: boolean;
  correlationId: string;
  /** signup_intents.source for a NEW row (default 'signup_form'). */
  source?: string;
  /**
   * When no unexpired pending intent exists but an EXPIRED pending one does,
   * refresh that row (new intent_data + expires_at) instead of inserting a
   * second pending row, which the one-pending-per-email unique index refuses.
   * Off for signup.ts (its behaviour is unchanged); on for revalidate-signup.
   */
  refreshExpiredPending?: boolean;
};

export type MintSignupIntentResult =
  | { ok: true; intentId: string | null }
  | { ok: false; stage: 'insert' | 'refresh'; error: string };

export function buildSignupIntentData(input: MintSignupIntentInput): Record<string, unknown> {
  const { companyName, identity, autoApproved, correlationId } = input;
  return {
    company_name:             companyName,
    validated_company_domain: identity.companyIdentityDomain,
    validated_website_domain: identity.normalizedWebsiteDomain,
    validated_website_url:    identity.websiteUrl,
    validated_at:             new Date().toISOString(),
    validation_version:       COMPANY_IDENTITY_VALIDATION_VERSION,
    // P1 — the settled verdict onboarding requires before company bootstrap.
    verdict:                  (autoApproved ? 'auto_approved' : 'eligible') as SignupIntentVerdict,
    // AUTH-001 §10 — journey correlation ID; later stages (verify-email,
    // setup-company, credits) recover it from here by email.
    correlation_id:           correlationId,
    // PROD-CX-004 §6 — ops-visible marker when this signup was admitted via the
    // auto-approve path (DNS web host present, site unreachable from our egress)
    // rather than a clean live-website pass. Absent on the normal eligible path.
    ...(autoApproved
      ? { auto_approved: true, auto_approved_reason: identity.validationReason }
      : {}),
  };
}

/**
 * Upsert the pending signup intent for this email with the validated identity.
 * Callers MUST have run every signup gate first.
 */
export async function mintSignupIntent(input: MintSignupIntentInput): Promise<MintSignupIntentResult> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + SIGNUP_INTENT_TTL_MS).toISOString();
  const intentData = buildSignupIntentData(input);

  const { data: existingIntent } = await supabase
    .from('signup_intents')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existingIntent) {
    // Refresh the existing pending intent with the latest company name +
    // validated identity + verdict in case the user changed it before re-submitting.
    const id = (existingIntent as { id: string }).id;
    const { error } = await supabase
      .from('signup_intents')
      .update({ intent_data: intentData })
      .eq('id', id);
    if (error) return { ok: false, stage: 'refresh', error: error.message };
    return { ok: true, intentId: id };
  }

  if (input.refreshExpiredPending) {
    const { data: expiredPending } = await supabase
      .from('signup_intents')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();
    if (expiredPending) {
      const id = (expiredPending as { id: string }).id;
      const { error } = await supabase
        .from('signup_intents')
        .update({ intent_data: intentData, expires_at: expiresAt })
        .eq('id', id)
        .eq('status', 'pending');
      if (error) return { ok: false, stage: 'refresh', error: error.message };
      return { ok: true, intentId: id };
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('signup_intents')
    .insert({
      email:       normalizedEmail,
      source:      input.source ?? 'signup_form',
      status:      'pending',
      expires_at:  expiresAt,
      intent_data: intentData,
    })
    .select('id')
    .maybeSingle();

  if (insertErr) return { ok: false, stage: 'insert', error: insertErr.message };
  return { ok: true, intentId: (inserted as { id?: string } | null)?.id ?? null };
}
