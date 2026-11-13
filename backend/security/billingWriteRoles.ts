/**
 * OWNER RULING (2026-11-13, via e9): billing WRITES are company admins only - buying credits, starting a subscription,
 * changing the billing profile or the billing context (country / currency). Platform super admins keep their bypass
 * (requireTenantAccess's platform rule, unchanged).
 *
 * The set is the company-admin set the repository already uses for admin-only tenant actions (resend-invitation):
 * COMPANY_ADMIN, its legacy alias ADMIN, and a per-company SUPER_ADMIN row. A member outside it gets 403
 * { code: 'INSUFFICIENT_ROLE' }.
 *
 * DELIBERATELY NOT GATED: POST /api/billing/checkout/verify and /close. They finish a payment the organisation has
 * ALREADY made; refusing them to a non-admin member would strand money that has left the customer. They stay
 * membership-level (any active member of the paying org).
 */
export const BILLING_WRITE_ROLES: readonly string[] = Object.freeze(['COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN']);
