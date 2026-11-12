/**
 * Signup bootstrap gate - P1 of the GoTrue-bypass fix (e1, 2026-11-13; e9 ruling, 05 review).
 *
 * THE HOLE. A bot can create a Supabase auth identity directly (GoTrue anon-key signup / OTP) and skip every gate
 * signup.ts runs (address policy, free-mail, CLAIMED_DOMAIN, the live-website identity check). Email confirmation
 * still applies, but after it the bot reached setup-company / onboarding/complete and got a company plus the initial
 * free credits. P1 makes BOTH chokepoints require proof that the server's own gates passed:
 *
 *   - company creation (setup-company, onboarding/complete) requires a BOUND signup intent - minted only by the
 *     server after every gate passed (signup.ts or POST /api/onboarding/revalidate-signup);
 *   - the company's PRIMARY KEY IS THE INTENT'S id. The company INSERT is therefore the atomic, once-only consume:
 *     a failed bootstrap writes nothing and the intent stays usable; a retry re-enters the same id (23505 -> the
 *     existing race path, which admits only a user who already holds that company); two companies from one intent
 *     are impossible. No consumed-flag, no migration.
 *   - the initial-credit grant's CREATION branch requires the organization to be intent-born (a signup_intents row
 *     whose id = orgId) - inside grantInitialFreeCredit, so no future caller can skip it.
 *
 * INVARIANT (05): `companies.id` must stay SERVER-MINTED. Because the company insert is the consume, any route that
 * inserted a company row with a caller-chosen id would become a signup-pre-emption primitive (insert first; the
 * victim's bootstrap then hits 23505 without membership and is refused permanently). Do not add one.
 *
 * Acceptable intent (all must hold - "the CAS repeats its preconditions"):
 *   email = the verified email (lowercased); status in (pending, completed) - verify-email flips pending->completed
 *   at verification, so 'completed' does NOT mean consumed; expires_at > now; intent_data.validated_company_domain
 *   equals normalizeCompanyDomain(email) (owner ruling: website domain = admin email domain at the registrable
 *   domain); intent_data.validated_website_url non-empty; and intent_data.verdict in ('eligible','auto_approved')
 *   (e9: both accepted - today's bar, now explicit) - OR a LEGACY intent (no verdict) created before
 *   SIGNUP_INTENT_VERDICT_CUTOFF: every pre-deploy intent was minted by signup.ts only after its gates passed, and
 *   the bypass never mints one (e9: unconditional; cheap insurance for the deploy window).
 * Anything else -> SIGNUP_REVALIDATION_REQUIRED: the UI shows a RESUME prompt (never an error) and calls
 * POST /api/onboarding/revalidate-signup, which re-runs every gate and mints a fresh intent.
 */
import { supabase } from '../db/supabaseClient';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';
import { logger } from './logger';

/**
 * Server-side cutoff (never from the client): intents created BEFORE this instant without a verdict are legacy
 * signup.ts mints and are accepted. Set to the P1 deploy; 83 confirms the exact value at release. After deploy every
 * mint carries a verdict, so the constant only matters for the deploy window.
 */
export const SIGNUP_INTENT_VERDICT_CUTOFF = '2026-11-20T00:00:00.000Z';

const ACCEPTED_VERDICTS = new Set(['eligible', 'auto_approved']);

export type BootstrapIntent = {
  intentId: string;
  websiteUrl: string;
  companyDomain: string;
  verdict: 'eligible' | 'auto_approved' | 'legacy';
  companyName: string | null;
};

export type BootstrapIntentResult =
  | { ok: true; intent: BootstrapIntent }
  | { ok: false; reason: 'SIGNUP_REVALIDATION_REQUIRED' | 'INTENT_LOOKUP_FAILED' };

type IntentRow = {
  id: string;
  status: string | null;
  created_at: string | null;
  expires_at: string | null;
  intent_data: Record<string, unknown> | null;
};

/** Pure: is this intent row acceptable for bootstrapping a company for `email`? */
export function acceptableIntent(row: IntentRow, email: string, nowMs: number): BootstrapIntent | null {
  if (!row || !row.id) return null;
  if (row.status !== 'pending' && row.status !== 'completed') return null;
  const expires = row.expires_at ? Date.parse(row.expires_at) : NaN;
  if (!Number.isFinite(expires) || expires <= nowMs) return null;
  const data = (row.intent_data ?? {}) as Record<string, unknown>;
  const emailDomain = normalizeCompanyDomain(email);
  const companyDomain = typeof data.validated_company_domain === 'string' ? data.validated_company_domain.trim().toLowerCase() : '';
  if (!emailDomain || companyDomain !== emailDomain) return null;
  const websiteUrl = typeof data.validated_website_url === 'string' ? data.validated_website_url.trim() : '';
  if (!websiteUrl || normalizeCompanyDomain(websiteUrl) !== emailDomain) return null;
  const verdict = typeof data.verdict === 'string' ? data.verdict : null;
  let accepted: BootstrapIntent['verdict'] | null = null;
  if (verdict && ACCEPTED_VERDICTS.has(verdict)) accepted = verdict as 'eligible' | 'auto_approved';
  else if (!verdict) {
    const created = row.created_at ? Date.parse(row.created_at) : NaN;
    if (Number.isFinite(created) && created < Date.parse(SIGNUP_INTENT_VERDICT_CUTOFF)) accepted = 'legacy';
  }
  if (!accepted) return null;
  const companyName = typeof data.company_name === 'string' && data.company_name.trim() ? data.company_name.trim() : null;
  return { intentId: row.id, websiteUrl, companyDomain, verdict: accepted, companyName };
}

/**
 * The bound intent for a VERIFIED user's company bootstrap. Callers must already have required
 * user.emailVerified. A read error is INTENT_LOOKUP_FAILED (retryable 503), never "no intent" and never "allowed".
 */
export async function resolveBootstrapIntent(
  email: string | null | undefined,
  deps: { now?: () => number } = {},
): Promise<BootstrapIntentResult> {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'SIGNUP_REVALIDATION_REQUIRED' };
  const nowMs = (deps.now ?? Date.now)();
  const { data, error } = await supabase
    .from('signup_intents')
    .select('id, status, created_at, expires_at, intent_data')
    .eq('email', normalized)
    .in('status', ['pending', 'completed'])
    .gt('expires_at', new Date(nowMs).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    logger.warn('signup_bootstrap_intent_lookup_failed', { message: error.message });
    return { ok: false, reason: 'INTENT_LOOKUP_FAILED' };
  }
  for (const row of (data ?? []) as IntentRow[]) {
    const intent = acceptableIntent(row, normalized, nowMs);
    if (intent) return { ok: true, intent };
  }
  return { ok: false, reason: 'SIGNUP_REVALIDATION_REQUIRED' };
}

/**
 * Credit chokepoint: was this organization born from a server-minted signup intent (companies.id = intent id)?
 * 'unknown' on a read error - the grant treats that as "not now" (fail closed, retryable), never as yes.
 */
export async function isIntentBornOrganization(orgId: string): Promise<'yes' | 'no' | 'unknown'> {
  if (!orgId) return 'no';
  const { data, error } = await supabase
    .from('signup_intents')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  if (error) return 'unknown';
  return data ? 'yes' : 'no';
}

/** Telemetry for a refused bootstrap (never includes the email). */
export function logCompanyBootstrapRefused(endpoint: string, reason: string, userId: string | null): void {
  logger.warn('auth.company_bootstrap_refused', { endpoint, reason, userId });
}
