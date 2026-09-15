/**
 * SEC-91 W2-G (STEP 3AH-91, W2G-1) — same-company role gate for the canonical
 * content WRITE routes (pages/api/content/**).
 *
 * Those routes authorized MEMBERSHIP only (enforceCompanyAccess), so a VIEW_ONLY
 * member — and the legacy aliases VIEWER / CONTENT_ENGAGER, which normalise to
 * it — could create, edit, archive, re-status and approve canonical content.
 *
 * The role set is the repository's existing content/campaign authoring policy,
 * not a new one: PERMISSIONS.CREATE_CAMPAIGN (rbacService) — COMPANY_ADMIN,
 * CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, SUPER_ADMIN. VIEW_ONLY
 * holds view capabilities only (capabilityRegistry) and has no content
 * work-area (config/commandCenterCards ROLE_ACCESS_MAP), so it stays read-only.
 * W2A-1b applied the same set to PUT /api/campaigns/:id.
 *
 * It deliberately does NOT implement the finer lifecycle matrix (who may move
 * content to approved / scheduled / published): that is an open product
 * decision (docs/security/SEC91_W2A.md §7.4) and is left to the owner.
 *
 * enforceRole (rbacService) supplies the decision, with the role read for the
 * company the route has ALREADY authorized:
 *   - platform super admins bypass (unchanged);
 *   - the synthetic content_architect principal is admitted because the set
 *     contains COMPANY_ADMIN (unchanged: enforceCompanyAccess fallback (a));
 *   - an invited COMPANY_ADMIN/ADMIN/SUPER_ADMIN row is admitted through
 *     getUserRole's invited-admin fallback (unchanged: fallback (b));
 *   - unknown role or lookup failure ⇒ 403 (fail closed).
 * Call it only AFTER enforceCompanyAccess succeeded for the same companyId.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../rbacService';

/** Content authoring roles — rbacService PERMISSIONS.CREATE_CAMPAIGN. */
export const CONTENT_WRITE_ROLES: readonly Role[] = Object.freeze([
  Role.COMPANY_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);

/**
 * Refuse read-only roles. Returns true when the caller may write; otherwise the
 * 401/403 response has been sent and the route must return.
 */
export async function enforceContentWriteRole(input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId: string;
}): Promise<boolean> {
  const gate = await enforceRole({
    req: input.req,
    res: input.res,
    companyId: input.companyId,
    allowedRoles: [...CONTENT_WRITE_ROLES],
  });
  return gate !== null;
}
