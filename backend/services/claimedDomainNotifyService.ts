/**
 * claimedDomainNotifyService.ts
 *
 * When a verified user from an already-claimed email domain tries to create
 * an account/company, we must NOT auto-join them. Instead both parties are
 * emailed:
 *   1) the prospect gets the existing admin's contact details so they know
 *      who to ask for an invite;
 *   2) the company admin gets a notice that a real, verified person from
 *      their domain just tried to sign up.
 *
 * Both emails are deduped per prospect email via `signup_referrals` so repeat
 * verifies / bouncing email links don't keep notifying the admin.
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
 * Best-effort. Never throws — failures are logged so the caller's response is
 * never broken by a transient email/DB issue.
 */
export async function notifyAdminAndProspectOfClaimedDomain(
  db: SupabaseClient,
  input: ClaimedDomainNotifyInput,
): Promise<void> {
  try {
    // Find an active COMPANY_ADMIN of the claimed company.
    const { data: adminRoleRow } = await db
      .from('user_company_roles')
      .select('user_id, created_at')
      .eq('company_id', input.companyId)
      .eq('status', 'active')
      .eq('role', 'COMPANY_ADMIN')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const adminUserId = (adminRoleRow as { user_id?: string } | null)?.user_id ?? null;
    const { data: adminUser } = adminUserId
      ? await db.from('users').select('name, email').eq('id', adminUserId).maybeSingle()
      : { data: null };
    const adminEmail = (adminUser as { email?: string } | null)?.email ?? null;
    const adminName = (adminUser as { name?: string | null } | null)?.name ?? null;

    // Dedupe via signup_referrals — one row per (prospect email). Tracks
    // separately whether each of the two emails has already gone out.
    const { data: existingReferral } = await db
      .from('signup_referrals')
      .select('id, admin_email_sent_at, attempt_count')
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
          admin_user_id:    adminUserId,
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

    // 2) Admin notification — best-effort; idempotent via the Supabase email
    //    enqueue idempotency key so repeat verifies don't double-send.
    if (adminEmail) {
      try {
        await sendInboundSignupNoticeToAdmin(
          adminEmail,
          {
            prospectEmail: input.prospectEmail,
            companyName:   input.companyName,
            supportEmail:  SUPPORT_EMAIL,
          },
          `inbound-signup-notice:${input.companyId}:${input.prospectEmail}`,
        );
      } catch (err) {
        logger.warn('claimed_domain_admin_notice_send_failed', {
          adminEmail,
          prospectEmail: input.prospectEmail,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    // Hard guard: a claimed-domain notification must never break the caller's
    // signup/onboarding response.
    logger.warn('claimed_domain_notify_failed', {
      email:   input.prospectEmail,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
