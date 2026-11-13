/**
 * OWNER RULING (2026-11-13, via e9): billing WRITES are company admins only - buying credits, starting a subscription,
 * changing the billing profile or the billing context (country / currency). Platform super admins keep their bypass
 * (requireTenantAccess's platform rule, unchanged).
 *
 * The set is NORMALISED role names, applied through requireTenantAccess { requireNormalizedRoleIn }: the stored role is
 * passed through normalizeRole first, so every spelling the system treats as a company admin ('ADMIN', 'COMPANYADMIN',
 * 'company admin', ...) passes, and nothing has to track the normaliser's aliases by hand (05, 2026-11-13 - a raw
 * list containing ADMIN but not COMPANYADMIN would have refused a real company admin). A per-company SUPER_ADMIN row
 * also passes. A member outside the set gets 403 { code: 'INSUFFICIENT_ROLE' }.
 *
 * WHY THIS GATE NORMALISES AND 55's CAMPAIGN WRITE-ROLE GATE DOES NOT (do not harmonise them): normalising is unsafe only
 * where it COLLAPSES a distinction the gate needs - VIEWER and CONTENT_ENGAGER both become VIEW_ONLY, which is why the
 * campaign gate reads the raw role. Here nothing collapses: everything that normalises to COMPANY_ADMIN IS a company
 * admin, while a raw list misses spellings (the normaliser also UPPERCASES, so 'admin' is a company admin a raw
 * includes() would refuse).
 *
 * DELIBERATELY NOT GATED: POST /api/billing/checkout/verify and /close. They finish a payment the organisation has
 * ALREADY made; refusing them to a non-admin member would strand money that has left the customer. They stay
 * membership-level (any active member of the paying org).
 */
export const BILLING_WRITE_ROLES: readonly string[] = Object.freeze(['COMPANY_ADMIN', 'SUPER_ADMIN']);
