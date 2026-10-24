/**
 * Closure-014 (B) — pure pre-authorization predicates for middleware that must
 * decide BEFORE the handler whether a caller could possibly be authorized
 * (e.g. withIdempotency's `authorize`, so an unprivileged caller reserves no
 * idempotency row).
 *
 * These never write a response and never audit: the handler's own
 * requireCapability call remains the single audited decision (capability,
 * step-up, trusted device). They only answer "is it even possible?" using the
 * same predicates the guard uses, so they can never authorize anything.
 */
import type { NextApiRequest } from 'next';
import type { Capability } from '../../shared/contracts/security';
import { resolvePrincipal } from './IdentityResolver';
import { hasPlatformWriteAuthority } from './platformWriteAuthority';
import { isPlatformSuperAdminPrincipal } from './platformCapabilities';
import { isPlatformTierWrite } from './requireCapability';

/**
 * A predicate that is true only when the request's principal holds `capability`
 * (or the capability picked for this method) and, for a platform-tier write,
 * has platform write authority.
 */
export function mayAttemptCapability(
  pick: Capability | ((req: NextApiRequest) => Capability | null),
): (req: NextApiRequest) => Promise<boolean> {
  return async (req) => {
    const capability = typeof pick === 'function' ? pick(req) : pick;
    if (!capability) return true; // no capability applies to this method — the handler decides
    const result = await resolvePrincipal(req);
    if (result.ok !== true) return false;
    const principal = result.principal;
    if (!principal.capabilities.includes(capability)) return false;
    if (isPlatformTierWrite(capability, req.method) && !hasPlatformWriteAuthority(principal)) return false;
    return true;
  };
}

/** admin/invite-user: a platform SUPER_ADMIN (cross-org invite) or an active COMPANY_ADMIN (own org). */
export async function mayAttemptInvite(req: NextApiRequest): Promise<boolean> {
  const result = await resolvePrincipal(req);
  if (result.ok !== true) return false;
  const p = result.principal;
  if (p.legacyCookieSuperAdmin === true) return false;
  return isPlatformSuperAdminPrincipal(p)
    || p.organizations.some((m) => m.role === 'COMPANY_ADMIN' && m.status === 'active');
}
