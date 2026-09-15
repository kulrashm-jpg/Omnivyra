/**
 * Shared campaign access for API routes.
 * Resolves company from DB (campaign_versions by campaign_id), then checks user company + campaign role.
 * Use for any campaign-scoped endpoint that must enforce multi-tenant access.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { getUserCompanyRole, isPlatformSuperAdmin, Role } from './rbacService';
import { companyOperationalState } from './companyOperationalState';
import {
  resolveEffectiveCampaignRole,
  isCompanyOverrideRole,
  type CampaignAuthContext,
} from './campaignRoleService';
import { resolveUserContext } from './userContextService';
import { attributeAuthenticatedPrincipal } from './requestContextPrincipal';

export type CampaignAccessResult = {
  userId: string;
  companyId: string;
  campaignId: string;
  campaignAuth?: CampaignAuthContext;
};

/**
 * B4.1 — THE campaign → company resolution seam.
 *
 * `campaign_versions.company_id` is the authoritative owner record, NOT
 * `campaigns.company_id`. The evidence is the campaign creation flows: every
 * one of them writes a `campaign_versions` row carrying `company_id`, while
 * only some also set `campaigns.company_id` (create-12week-plan.ts,
 * planner-finalize.ts and proposals/convert.ts insert `campaigns` with
 * `user_id` alone). Resolving through `campaigns` would therefore reject
 * legitimate campaigns created by the majority path.
 *
 * `campaigns.company_id` is NOT deprecated — 13 routes authorize through
 * `TenantGuard.requireCampaignTenantAccess`, which reads it and fails closed
 * when it is absent. Both mechanisms stay; this function only states which one
 * campaign→company resolution uses.
 *
 * Returns null when the campaign has no owner record. Callers MUST treat null
 * as "deny", never as "unowned" — this value is only ever compared against an
 * already-authorized companyId; it never grants access on its own.
 *
 * SEC-91A (STEP 3AH-91, A8) — legacy fallback to `campaigns.company_id`, ONLY
 * when the campaign has NO `campaign_versions` row at all. Four creation paths
 * insert a `campaigns` row with a server-derived `company_id` but never write a
 * version row (campaigns/pending/[id]/approve, autonomousScheduler,
 * adsIngestionService; legacy campaigns/save writes neither), so their
 * campaigns resolved to "no owner" and every requireCampaignAccess route
 * answered 404 to their own company. This mirrors campaignOwnershipService,
 * which already accepts `campaigns.company_id` for legacy campaigns.
 *
 * Why this cannot open cross-tenant access:
 *   - when ANY version row exists it stays authoritative — the fallback never
 *     overrides or competes with a version owner (divergent rows keep the
 *     version answer, unchanged);
 *   - the fallback only yields the company recorded on the campaign itself
 *     (a `campaigns.company_id` that is null still means "no owner" → deny);
 *   - the value is still only an owner CLAIM: requireCampaignAccess goes on to
 *     prove the caller's membership in exactly that company;
 *   - a lookup error on either read answers null (deny), never "unowned".
 */
export async function resolveCampaignCompanyId(campaignId: string): Promise<string | null> {
  if (!campaignId || typeof campaignId !== 'string') return null;
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (data) return data.company_id ? String(data.company_id) : null;

  // No version row at all → legacy owner record on the campaign itself.
  const legacy = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (legacy.error || !legacy.data) return null;
  const legacyCompanyId = (legacy.data as { company_id?: string | null }).company_id;
  return legacyCompanyId ? String(legacyCompanyId) : null;
}

/**
 * Verify authenticated user has access to the campaign.
 * Company is resolved from DB (campaign_versions), not from client.
 * On failure sends 401/404/403 and returns null. On success returns access context.
 */
export async function requireCampaignAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  campaignId: string
): Promise<CampaignAccessResult | null> {
  if (!campaignId || typeof campaignId !== 'string') {
    res.status(400).json({ error: 'Campaign ID is required' });
    return null;
  }

  // ROUTE-AUTH-001 (STEP 3AH-85) — authenticate BEFORE touching the campaign.
  // The owner lookup used to run first, so an anonymous caller got 404 for an
  // unknown campaign and 401 for a real one: an existence oracle that every
  // caller had to neutralise by hoisting resolveUserContext itself. Answering
  // authentication first makes every anonymous request look identical.
  // resolveUserContext still supports the explicit local dev opt-in.
  const user = await resolveUserContext(req);
  const userId = user?.userId ?? null;
  if (!userId) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  // B4.1 — extracted to resolveCampaignCompanyId (same query, same ordering,
  // same "no owner ⇒ 404" semantics) so the canonical content path resolves
  // campaign ownership through exactly this authority rather than a second one.
  const companyId = await resolveCampaignCompanyId(campaignId);
  if (!companyId) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }

  // Fast-path: content_architect or env-listed company — grant COMPANY_ADMIN access.
  const isContentArchitect = userId === 'content_architect';
  const hasEnvAccess = isContentArchitect || user.companyIds.includes(companyId);

  let role: (typeof Role)[keyof typeof Role] | null = null;
  if (hasEnvAccess) {
    // SEC-91 W2-A (STEP 3AH-91, W2A-5) — organization state. The fast path is
    // "active member of the owning company" (resolveUserContext.companyIds), but
    // it never checked companies.status, while the canonical tenant guard
    // (TenantGuard.assertTenantAccess, behind enforceCompanyAccess /
    // requireTenantAccess) denies an active member of a non-active company
    // (ORG_INACTIVE / ORG_NOT_FOUND → 403) unless they are a platform super
    // admin. Same decision here, same responses; a lookup failure is a
    // retryable 503, never an allow. The content-architect principal keeps its
    // documented legacy fallback (enforceCompanyAccess fallback (a)).
    if (!isContentArchitect) {
      const orgState = await companyOperationalState(companyId);
      if (orgState === 'lookup_error') {
        res.status(503).json({
          error: 'Membership check is temporarily unavailable. Please try again.',
          code: 'TENANT_LOOKUP_ERROR',
          retryable: true,
        });
        return null;
      }
      if (orgState === 'not_operational' && !(await isPlatformSuperAdmin(userId))) {
        res.status(403).json({ error: 'Access denied to company' });
        return null;
      }
    }
    role = Role.COMPANY_ADMIN;
  } else {
    // DB role lookup (normal authenticated path). getUserCompanyRole answers:
    // platform super admin (ACTIVE SUPER_ADMIN row), an ACTIVE membership role,
    // or — the same legacy fallback enforceCompanyAccess keeps — an INVITED
    // COMPANY_ADMIN/ADMIN/SUPER_ADMIN row.
    //
    // SEC-91A (STEP 3AH-91, A2) — this used to fall back further to
    // getCompanyRoleIncludingInvited and accept ANY invited role (e.g. an
    // invited CONTENT_CREATOR who never accepted, or whose invitation expired),
    // while enforceCompanyAccess — the guard on the same company's other routes —
    // accepts invited ADMIN roles only. That extra fallback only ever added
    // invited non-admin roles, so it is removed: both guards now agree on who is
    // a member.
    const roleResult = await getUserCompanyRole(req, companyId);
    role = roleResult.role;
    if (!role) {
      // SEC-91A (A6) — 403 for "exists, not yours" vs 404 for "no owner" is
      // kept deliberately: it is the platform-wide TenantGuard vocabulary
      // (requireTenantAccess NOT_A_MEMBER 403 vs ORG_NOT_FOUND 404,
      // requireCampaignTenantAccess, content/index CROSS_TENANT_CAMPAIGN), it
      // is reachable only by an AUTHENTICATED caller, and it discloses nothing
      // but whether a random v4 UUID exists. See docs/security/SEC91_A.md §A6.
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    }
    // SEC-91 W2-G (STEP 3AH-91, W2G-4) — organization state on this path too.
    // It admits principals the fast path does not: an INVITED
    // COMPANY_ADMIN/ADMIN/SUPER_ADMIN row (getUserRole's legacy fallback) and an
    // active member whose context membership read failed. Neither was checked
    // against companies.status, so an invited admin kept campaign access to a
    // suspended / inactive / deleted company. Same decision as the fast path and
    // as enforceCompanyAccess's invited fallback: non-operational ⇒ 403, lookup
    // failure ⇒ retryable 503. Platform super admins keep TenantGuard's bypass
    // (checked first, so they never depend on the company read).
    if (!(await isPlatformSuperAdmin(userId))) {
      const orgState = await companyOperationalState(companyId);
      if (orgState === 'lookup_error') {
        res.status(503).json({
          error: 'Membership check is temporarily unavailable. Please try again.',
          code: 'TENANT_LOOKUP_ERROR',
          retryable: true,
        });
        return null;
      }
      if (orgState === 'not_operational') {
        res.status(403).json({ error: 'Access denied to company' });
        return null;
      }
    }
  }

  let campaignAuth: CampaignAuthContext | undefined;
  if (isCompanyOverrideRole(role)) {
    campaignAuth = { companyRole: role, campaignRole: null, effectiveRole: role, source: 'company' };
  } else {
    const campaignAuthResult = await resolveEffectiveCampaignRole(userId, campaignId, companyId);
    if (campaignAuthResult.error === 'CAMPAIGN_ROLE_REQUIRED') {
      res.status(403).json({ error: 'CAMPAIGN_ROLE_REQUIRED' });
      return null;
    }
    campaignAuth = campaignAuthResult.error
      ? undefined
      : {
          companyRole: campaignAuthResult.companyRole,
          campaignRole: campaignAuthResult.campaignRole,
          effectiveRole: campaignAuthResult.effectiveRole,
          source: campaignAuthResult.source,
        };
  }

  // SEC-91 W2-A (W2A-4) — record the authorized principal (observe-only by
  // default; see requestContextPrincipal.ts).
  attributeAuthenticatedPrincipal({ userId, orgId: companyId, source: 'requireCampaignAccess' });

  return {
    userId,
    companyId,
    campaignId,
    campaignAuth,
  };
}
