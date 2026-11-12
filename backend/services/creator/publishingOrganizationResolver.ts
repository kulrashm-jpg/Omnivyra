/**
 * Canonical Publishing Organization Resolver.
 *
 * The ONE runtime source of organization (company) identity for publishing. Every
 * publishing path resolves the owning org through here instead of ad-hoc lookups or
 * the userId-as-companyId fallback. AUTHORITY (e9 ruling after migration 20270217000028): the
 * scheduled POST's own `company_id` is canonical when the caller has it (`postCompanyId`); the
 * connected account must MATCH it (publishAccountCompanyGuard) and never defines it. Only for a post
 * without a company: `social_accounts.company_id`, then `campaigns.company_id`, then the post's
 * own bindings, in that order. Never a caller-supplied id.
 *
 * This consolidates the lookup that `publishProcessor` previously inlined (twice) so
 * the server asset resolver always receives the real company id, lifting hit-rate.
 * Returns null when the org genuinely cannot be determined (caller then falls back
 * exactly as before).
 *
 * unread-error pkg 2: a FAILED read is not "cannot be determined". PostgREST returns the error (never
 * throws), and each read used to ignore it: a failed social_accounts read fell through to the
 * CAMPAIGN's company (not necessarily the account's owner), and a failure anywhere could answer null,
 * so publishProcessor ran the publish with no tenant id. Every read error now throws
 * PublishingOrgReadError, so the publish attempt fails and is retried instead of proceeding under a
 * wrong or missing tenant. Callers that only refresh media (publishNowService) already catch and skip.
 */

import { supabase } from '../../db/supabaseClient';

export interface PublishingOrgInput {
  /** scheduled_posts.company_id (canonical since 028); used first when present. */
  postCompanyId?: string | null;
  socialAccountId?: string | null;
  campaignId?: string | null;
  scheduledPostId?: string | null;
}

export class PublishingOrgReadError extends Error {
  readonly code = 'PUBLISHING_ORG_READ_FAILED';
  constructor(readonly source: 'social_accounts' | 'campaigns' | 'scheduled_posts', cause: { message?: string } | unknown) {
    const detail = (cause as { message?: unknown } | null | undefined)?.message;
    super(`Publishing organization could not be resolved: ${source} read failed${typeof detail === 'string' && detail ? ` (${detail})` : ''}`);
    this.name = 'PublishingOrgReadError';
  }
}

/** Runs one read; a returned error OR a thrown one becomes PublishingOrgReadError (never null). */
async function readOne<T>(source: PublishingOrgReadError['source'], run: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  let result: { data: unknown; error: unknown };
  try {
    result = await run();
  } catch (thrown) {
    throw new PublishingOrgReadError(source, thrown);
  }
  if (result.error) throw new PublishingOrgReadError(source, result.error);
  return (result.data as T | null) ?? null;
}

async function companyOfSocialAccount(id: string): Promise<string | null> {
  const data = await readOne<{ company_id?: string }>('social_accounts', () =>
    supabase.from('social_accounts').select('company_id').eq('id', id).maybeSingle());
  const org = data?.company_id;
  return org ? String(org) : null;
}

async function companyOfCampaign(id: string): Promise<string | null> {
  const data = await readOne<{ company_id?: string }>('campaigns', () =>
    supabase.from('campaigns').select('company_id').eq('id', id).maybeSingle());
  const org = data?.company_id;
  return org ? String(org) : null;
}

/**
 * Resolve the canonical organization id for a publish. Order: connected account →
 * campaign → (scheduled post's account/campaign). Returns null only when none resolve;
 * THROWS PublishingOrgReadError when a read fails.
 */
export async function resolvePublishingOrganization(input: PublishingOrgInput): Promise<string | null> {
  if (input.postCompanyId) return String(input.postCompanyId);
  if (input.socialAccountId) {
    const org = await companyOfSocialAccount(String(input.socialAccountId));
    if (org) return org;
  }
  if (input.campaignId) {
    const org = await companyOfCampaign(String(input.campaignId));
    if (org) return org;
  }
  if (input.scheduledPostId) {
    const row = await readOne<{ social_account_id?: string | null; campaign_id?: string | null }>('scheduled_posts', () =>
      supabase
        .from('scheduled_posts')
        .select('social_account_id, campaign_id')
        .eq('id', String(input.scheduledPostId))
        .maybeSingle());
    if (row?.social_account_id) { const org = await companyOfSocialAccount(String(row.social_account_id)); if (org) return org; }
    if (row?.campaign_id) { const org = await companyOfCampaign(String(row.campaign_id)); if (org) return org; }
  }
  return null;
}
