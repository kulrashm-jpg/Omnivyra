/**
 * Which connected social account may a post be published through? (BLOCKING fast-track, e9 2026-11-13.)
 *
 * Every path that resolved a post's account when the post carried none (the publish cron, manual publish,
 * the legacy ad-hoc scheduler) took "the user's active account for the platform" in ANY company. A user who
 * belongs to two companies could therefore have company A's post PUBLISHED through company B's account.
 *
 * The rule, in one place:
 *  - a CAMPAIGN post: the account must belong to the campaign's company (campaigns.company_id). A campaign
 *    with no company fails visibly (CAMPAIGN_COMPANY_MISSING, logged CRITICAL), never a fallback;
 *  - a STANDALONE post (no campaign; PromotionWorkspace / the multi-platform scheduler / the ad-hoc API): it
 *    has no company to scope by, so the user's matching accounts must all belong to ONE company (or to none);
 *    accounts in two companies are ambiguous (ACCOUNT_AMBIGUOUS) and the user must pick one;
 *  - no matching account: NO_CONNECTED_ACCOUNT (visible, terminal);
 *  - a failed read is never "no account": CAMPAIGN_UNREADABLE / ACCOUNT_LOOKUP_FAILED are retryable.
 * Among several accounts in the SAME company, the newest wins (the previous ordering, where one existed).
 */
import { supabase } from '../db/supabaseClient';

export type PostAccountFailureCode =
  | 'NO_CONNECTED_ACCOUNT'
  | 'ACCOUNT_AMBIGUOUS'
  | 'CAMPAIGN_COMPANY_MISSING'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_UNREADABLE'
  | 'ACCOUNT_LOOKUP_FAILED';

/** One shape (the project's compiler settings do not narrow a union on `ok`): on ok, socialAccountId is set and
 *  code/message are null; on failure, socialAccountId is null and code/message say why. */
export type PostAccountResolution = {
  ok: boolean;
  socialAccountId: string | null;
  companyId: string | null;
  code: PostAccountFailureCode | null;
  message: string | null;
  retryable: boolean;
};

type AccountRow = { id: string; company_id: string | null; created_at?: string | null };

const fail = (code: PostAccountFailureCode, message: string, retryable = false): PostAccountResolution =>
  ({ ok: false, socialAccountId: null, companyId: null, code, message, retryable });
const found = (socialAccountId: string, companyId: string | null): PostAccountResolution =>
  ({ ok: true, socialAccountId, companyId, code: null, message: null, retryable: false });

export async function resolvePostSocialAccount(input: {
  userId: string;
  /** Every platform key that counts as this platform (e.g. ['x', 'twitter']). */
  platforms: string[];
  campaignId?: string | null;
}): Promise<PostAccountResolution> {
  const platforms = [...new Set(input.platforms.filter(Boolean))];
  const label = platforms[0] ?? 'this platform';

  if (input.campaignId) {
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', input.campaignId)
      .maybeSingle();
    if (campaignError) return fail('CAMPAIGN_UNREADABLE', 'Could not read the post\'s campaign; try again.', true);
    if (!campaign) return fail('CAMPAIGN_NOT_FOUND', 'The post\'s campaign no longer exists.');
    const companyId = (campaign as { company_id?: string | null }).company_id ?? null;
    if (!companyId) {
      console.error('[postSocialAccountResolver] CRITICAL: campaign has no company; refusing to pick an account', {
        campaignId: input.campaignId, userId: input.userId,
      });
      return fail('CAMPAIGN_COMPANY_MISSING', 'This post\'s campaign has no company, so no account can be chosen for it.');
    }
    const { data, error } = await supabase
      .from('social_accounts')
      .select('id, company_id, created_at')
      .eq('user_id', input.userId)
      .eq('is_active', true)
      .eq('company_id', companyId)
      .in('platform', platforms)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return fail('ACCOUNT_LOOKUP_FAILED', 'Could not check your connected accounts; try again.', true);
    const row = ((data ?? []) as AccountRow[])[0];
    if (!row?.id) return fail('NO_CONNECTED_ACCOUNT', `No connected ${label} account in this company. Connect one in Settings → Social Accounts.`);
    return found(String(row.id), companyId);
  }

  // Standalone post: all of the user's matching accounts must belong to ONE company (or to none).
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, company_id, created_at')
    .eq('user_id', input.userId)
    .eq('is_active', true)
    .in('platform', platforms)
    .order('created_at', { ascending: false });
  if (error) return fail('ACCOUNT_LOOKUP_FAILED', 'Could not check your connected accounts; try again.', true);
  const rows = (data ?? []) as AccountRow[];
  if (rows.length === 0) return fail('NO_CONNECTED_ACCOUNT', `No connected ${label} account found. Connect one in Settings → Social Accounts.`);
  const companies = new Set(rows.map((r) => r.company_id ?? '<none>'));
  if (companies.size > 1) {
    return fail('ACCOUNT_AMBIGUOUS', `You have ${label} accounts in more than one company; choose the account to publish with.`);
  }
  return found(String(rows[0].id), rows[0].company_id ?? null);
}
