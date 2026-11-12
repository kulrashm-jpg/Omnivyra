/**
 * claimedDomainNotifyService.ts
 *
 * When a verified user from an already-claimed email domain tries to create
 * an account/company, we must NOT auto-join them. Instead both parties are
 * emailed:
 *   1) the prospect gets the existing admin's contact details so they know
 *      who to ask for an invite;
 *   2) EVERY active company admin (bounded) gets a notice that a real, verified
 *      person from their domain just tried to sign up, with a link to invite them.
 *
 * Both emails are deduped per prospect email via `signup_referrals` (one row per prospect):
 *   - the PROSPECT email by `admin_email_sent_at`;
 *   - the ADMIN notice by `admin_user_id`, written ONLY after the notice was actually sent - so a
 *     failed send is retried on the next attempt, and a sent one is never repeated.
 * WARNING - BOTH COLUMN NAMES SAY THE OPPOSITE OF WHAT THEY MARK (a rename is pending; it needs a
 * migration). Do NOT "correct" the code to match the names: that reintroduces the re-notify bug.
 * `admin_user_id` references users(id) ON DELETE SET NULL, so hard-deleting the notified admin's users
 * row would reset the marker and re-enable the notice (no app path hard-deletes users today).
 * Because callers notify only on a VERIFIED email-domain match, one prospect maps to one company, so
 * per-prospect dedupe is per (company, prospect) by construction.
 * TWO dedupe mechanisms, on DIFFERENT keys - neither is redundant:
 *   - this module's markers above (per prospect; admin_user_id = the admin notice went out);
 *   - send-transactional-email's own idempotency reservation (6f, fix/email-idempotency, migration
 *     20270217000031), keyed on the idempotency keys passed below: `company-referral:<prospect email>` and
 *     `inbound-signup-notice:<company>:<prospect email>:<admin user id>` (one key PER ADMIN since all active
 *     admins are notified). Until that lands the key is inert, and these markers are the only dedupe.
 * (e1 2026-11-12, 05 review: the admin notice used to be gated only by `if (adminEmail)`, and its
 * `inbound-signup-notice:<company>:<prospect>` idempotency key is never applied by the email
 * function - it only reaches a log context - so every attempt re-notified the admin.)
 *
 * This used to live (unreachable) inside pages/api/auth/sync-supabase-user.ts.
 * It is now a shared service so the live onboarding path
 * (pages/api/onboarding/setup-company.ts) and any future sync backstop call
 * the SAME implementation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import {
  sendCompanyAdminReferral,
  sendInboundSignupNoticeToAdmin,
} from './emailService';

const SUPPORT_EMAIL = 'support@omnivyra.com';

export interface ClaimedDomainNotifyInput {
  /**
   * Optional — there is NO user row yet when this is called from the
   * pre-signup gate (pages/api/auth/signup.ts). Kept for callers that do
   * have a verified user (onboarding). The body does not depend on it;
   * dedup is keyed on prospectEmail via signup_referrals.
   */
  prospectUserId?: string;
  prospectEmail: string;
  emailDomain: string;
  companyId: string;
  companyName: string | null;
  nowIso: string;
}

/**
 * What happened to the ADMIN notice - so a caller never tells the prospect "we've asked your admin"
 * when nobody was asked (05 review, 2026-11-12):
 *   'sent'         - the notice was handed to the email function by THIS call;
 *   'already_sent' - an earlier attempt by this prospect already notified this admin;
 *   'no_admin' - the company has no active COMPANY_ADMIN with an email (a recovery case);
 *   'failed'   - the send (or a lookup) failed.
 */
/** Upper bound on how many active admins one join request emails. */
const MAX_ADMINS_NOTIFIED = 10;

export type ClaimedDomainAdminNotice = 'sent' | 'already_sent' | 'no_admin' | 'failed';
export interface ClaimedDomainNotifyOutcome { adminNotice: ClaimedDomainAdminNotice }


/**
 * Best-effort. Never throws — failures are logged so the caller's response is
 * never broken by a transient email/DB issue. Returns what happened to the admin notice.
 */
export async function notifyAdminAndProspectOfClaimedDomain(
  db: SupabaseClient,
  input: ClaimedDomainNotifyInput,
): Promise<ClaimedDomainNotifyOutcome> {
  let adminNotice: ClaimedDomainAdminNotice = 'failed';
  try {
    // ALL active COMPANY_ADMINs of the claimed company, oldest first (owner ruling 2026-11-12: the
    // join request goes to the company's admins). Fan-out bounded by MAX_ADMINS_NOTIFIED.
    const { data: adminRoleRows, error: adminRoleErr } = await db
      .from('user_company_roles')
      .select('user_id, created_at')
      .eq('company_id', input.companyId)
      .eq('status', 'active')
      .eq('role', 'COMPANY_ADMIN')
      .order('created_at', { ascending: true })
      .limit(MAX_ADMINS_NOTIFIED);
    const adminIds = [...new Set(
      ((adminRoleRows ?? []) as Array<{ user_id?: string | null }>)
        .map((r) => r.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )];
    const { data: adminUsers, error: adminUserErr } = adminIds.length
      ? await db.from('users').select('id, name, email').in('id', adminIds)
      : { data: [], error: null };
    type AdminUser = { id: string; name?: string | null; email?: string | null };
    const byId = new Map(((adminUsers ?? []) as AdminUser[]).map((u) => [u.id, u]));
    const admins = adminIds
      .map((id) => byId.get(id))
      .filter((u): u is AdminUser & { email: string } => typeof u?.email === 'string' && u.email.length > 0);
    // The prospect's email carries ONE contact: the oldest active admin.
    const adminEmail = admins[0]?.email ?? null;
    const adminName = admins[0]?.name ?? null;
    // A failed admin lookup is 'failed', never 'no_admin' (a null error is not an answer).
    if (!adminRoleErr && !adminUserErr && admins.length === 0) adminNotice = 'no_admin';

    // Dedupe via signup_referrals — one row per (prospect email). Tracks
    // separately whether each of the two emails has already gone out.
    const { data: existingReferral } = await db
      .from('signup_referrals')
      .select('id, admin_email_sent_at, attempt_count, admin_user_id')
      .eq('email', input.prospectEmail)
      .maybeSingle();

    let shouldSendProspectEmail = false;
    let referralId: string | null = (existingReferral as { id?: string } | null)?.id ?? null;

    if (!existingReferral) {
      const { data: inserted, error: insertErr } = await db
        .from('signup_referrals')
        .insert({
          email:            input.prospectEmail,
          domain:           input.emailDomain,
          company_id:       input.companyId,
          // admin_user_id is the ADMIN-NOTICE marker: written only after a successful send (below).
          admin_user_id:    null,
          first_attempt_at: input.nowIso,
          last_attempt_at:  input.nowIso,
          attempt_count:    1,
        })
        .select('id')
        .maybeSingle();
      if (insertErr) {
        logger.warn('claimed_domain_referral_insert_failed', {
          email:   input.prospectEmail,
          message: insertErr.message,
        });
      } else {
        shouldSendProspectEmail = true;
        referralId = (inserted as { id?: string } | null)?.id ?? null;
      }
    } else {
      await db
        .from('signup_referrals')
        .update({
          last_attempt_at: input.nowIso,
          attempt_count:   ((existingReferral as { attempt_count?: number }).attempt_count ?? 1) + 1,
        })
        .eq('id', (existingReferral as { id: string }).id);
      shouldSendProspectEmail = !(existingReferral as { admin_email_sent_at?: string | null }).admin_email_sent_at;
    }

    // 1) Prospect email — admin contact details (deduped via admin_email_sent_at).
    if (shouldSendProspectEmail) {
      try {
        await sendCompanyAdminReferral(
          input.prospectEmail,
          {
            admin:        adminEmail ? { name: adminName, email: adminEmail } : null,
            companyName:  input.companyName,
            supportEmail: SUPPORT_EMAIL,
          },
          `company-referral:${input.prospectEmail}`,
        );
        if (referralId) {
          await db
            .from('signup_referrals')
            .update({ admin_email_sent_at: input.nowIso })
            .eq('id', referralId);
        }
      } catch (err) {
        logger.warn('claimed_domain_prospect_email_send_failed', {
          email:   input.prospectEmail,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2) Admin notification — best-effort, deduped by the admin_user_id marker (the idempotency key
    //    below is NOT applied by the email function; it is kept only for log correlation).
    const priorNotifiedAdmin = (existingReferral as { admin_user_id?: string | null } | null)?.admin_user_id ?? null;
    if (priorNotifiedAdmin) {
      adminNotice = 'already_sent';
    } else if (admins.length > 0) {
      // Every active admin is told. The request counts as made once ANY admin was notified; the marker
      // then records the first one, so later attempts never re-send (an admin whose individual send
      // failed while another succeeded is not retried - logged below).
      let firstNotified: string | null = null;
      for (const admin of admins) {
        try {
          await sendInboundSignupNoticeToAdmin(
            admin.email,
            {
              prospectEmail: input.prospectEmail,
              companyName:   input.companyName,
              supportEmail:  SUPPORT_EMAIL,
            },
            `inbound-signup-notice:${input.companyId}:${input.prospectEmail}:${admin.id}`,
          );
          firstNotified ??= admin.id;
        } catch (err) {
          logger.warn('claimed_domain_admin_notice_send_failed', {
            adminUserId:   admin.id,
            prospectEmail: input.prospectEmail,
            message:       err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (firstNotified) {
        adminNotice = 'sent';
        if (referralId) {
          await db
            .from('signup_referrals')
            .update({ admin_user_id: firstNotified })
            .eq('id', referralId);
        }
      }
    }
  } catch (err) {
    // Hard guard: a claimed-domain notification must never break the caller's
    // signup/onboarding response.
    logger.warn('claimed_domain_notify_failed', {
      email:   input.prospectEmail,
      message: err instanceof Error ? err.message : String(err),
    });
    adminNotice = 'failed';
  }
  return { adminNotice };
}
