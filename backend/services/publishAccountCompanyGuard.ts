/**
 * CORRECT-SENDING GUARD (BLOCKING, e9 option B, 2026-11-13): a post is published ONLY through an account
 * of the post's OWN company.
 *
 * AUTHORITY (e9 ruling, after migration 20270217000028): scheduled_posts.company_id is canonical. The
 * account must MATCH it; it never defines it.
 *
 * ONE helper, called by every publish entry point, always on the social_account_id that is actually
 * published with (platformAdapter.publishToPlatform / publishThread use the caller's id, not the row's):
 *   - publishNowService.publishNow (cron safety net, manual /api/social/publish);
 *   - publishProcessor.processPublishJob (queue worker, before runJob so a refusal uses no rate-limit unit);
 *   - threadPublishOrchestrator.resumeThreadPublish (super-admin thread resume).
 *
 * Verdicts:
 *   ok         - the account's company equals the post's company;
 *   mismatch   - account in another company, account with no company, or no such account (terminal);
 *   unverified - the account read failed, or the post carries no company (a schema without 028): never
 *                publish, leave the post as it is, retry later.
 */
import { supabase } from '../db/supabaseClient';

export type PublishAccountCompanyVerdict = {
  verdict: 'ok' | 'mismatch' | 'unverified';
  /** The post's company when known (the canonical publishing organization). */
  postCompanyId: string | null;
  accountCompanyId: string | null;
  message: string | null;
};

export const ACCOUNT_COMPANY_MISMATCH = 'ACCOUNT_COMPANY_MISMATCH';
export const PUBLISH_COMPANY_UNVERIFIED = 'PUBLISH_COMPANY_UNVERIFIED';

export async function checkPublishAccountCompany(
  post: { id?: string; company_id?: string | null },
  socialAccountId: string,
): Promise<PublishAccountCompanyVerdict> {
  const postCompanyId = post.company_id ?? null;
  if (!postCompanyId) {
    console.error('[publishAccountCompanyGuard] CRITICAL: post has no company_id (schema without migration 20270217000028?); not publishing', {
      scheduled_post_id: post.id,
    });
    return {
      verdict: 'unverified', postCompanyId: null, accountCompanyId: null,
      message: 'Publish refused: the post\'s company could not be determined; it was left unchanged for retry.',
    };
  }
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, company_id')
    .eq('id', socialAccountId)
    .maybeSingle();
  if (error) {
    console.error('[publishAccountCompanyGuard] account company read failed; not publishing', {
      scheduled_post_id: post.id, error: error.message,
    });
    return {
      verdict: 'unverified', postCompanyId, accountCompanyId: null,
      message: 'Publish refused: could not verify the account\'s company; it was left unchanged for retry.',
    };
  }
  const accountCompanyId = (data as { company_id?: string | null } | null)?.company_id ?? null;
  if (!data || accountCompanyId !== postCompanyId) {
    console.warn('[publishAccountCompanyGuard] account/post company mismatch; not publishing', {
      scheduled_post_id: post.id, social_account_id: socialAccountId, post_company_id: postCompanyId, account_company_id: accountCompanyId,
    });
    return {
      verdict: 'mismatch', postCompanyId, accountCompanyId,
      message: `Publish refused (${ACCOUNT_COMPANY_MISMATCH}): the social account is not connected in this post's company. Reconnect the account in this company's Settings → Social Accounts.`,
    };
  }
  return { verdict: 'ok', postCompanyId, accountCompanyId, message: null };
}
