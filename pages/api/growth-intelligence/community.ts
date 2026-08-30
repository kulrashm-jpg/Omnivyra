/**
 * GET /api/growth-intelligence/community
 * Phase-1 Read-Only. Returns community engagement metrics.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 * Query: companyId (required — authorized by withRBAC and bound to the read).
 *        organizationId (optional) is a SCOPE REQUEST, not a grant: it is only
 *        accepted when it names the company withRBAC already authorized.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC, type RbacContext } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { getCommunityEngagementMetrics } from '../../../backend/services/growthIntelligence';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  /*
   * GROWTH-COMMUNITY-SEC-001 — the operative organization is DERIVED from the
   * authorized context, never from request input.
   *
   * The defect: the route authorized `req.query.companyId` (A) but read with
   * `req.query.organizationId` (B), which merely "defaulted to" A:
   *
   *     withRBAC / requireCompanyContext   authorize   companyId = A
   *     getCommunityEngagementMetrics(supabase, organizationId = B)
   *       -> community_ai_actions.eq('organization_id', B)
   *
   * Nothing bound A to B — the identifier-mismatch class of WITHRBAC-STRUCT-001.
   * `community_ai_actions.organization_id` is a companies(id) value (the schema
   * spells that FK out on the sibling community tables, the module's own
   * getGrowthIntelligenceSummary passes companyId into this very metric, and
   * enforceCompanyAccess passes companyId as `organizationId` into TenantGuard),
   * so B is another tenant's company and A's members could read its
   * executed-action counts.
   *
   * The binding is `req.rbac.companyId` — the exact value withRBAC passed to
   * enforceRole for the authorization decision (WITHRBAC-STRUCT-001) — and NOT
   * a comparison of the two caller-supplied parameters, both of which are
   * attacker-controlled.
   */
  const rbac = (req as unknown as { rbac?: RbacContext }).rbac;
  if (!rbac?.companyId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const authorizedCompanyId = rbac.companyId.trim();
  if (!authorizedCompanyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  // Membership/tenant authorization on the AUTHORIZED company, before any read.
  const companyContext = await requireCompanyContext({
    req,
    res,
    companyId: authorizedCompanyId,
  });
  if (!companyContext) return;

  /*
   * A caller may still NAME an organization, but naming is not granting: the
   * only accepted value is the company already authorized above. Anything else
   * is refused before the read runs, so the sink is never reached with a
   * foreign identity.
   */
  const requestedOrganizationId = (req.query.organizationId as string)?.trim?.();
  if (requestedOrganizationId && requestedOrganizationId !== companyContext.companyId) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    const data = await getCommunityEngagementMetrics(supabase, companyContext.companyId);
    return res.status(200).json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch community engagement';
    return res.status(500).json({ success: false, error: message });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);
