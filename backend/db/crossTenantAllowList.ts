/**
 * Cross-tenant access allow-list (tenant-seam plan, owner-approved 2026-11-12).
 *
 * A call that must stay on `ownedDbTable` / `supabase.from` against a TENANT table (it legitimately spans
 * tenants, or it runs before any tenant is known) carries a marker on the line directly above the call:
 *
 *     // cross-tenant: <id>
 *
 * and <id> must be an entry here. scripts/check-tenant-seam.js refuses a marker whose id is not listed, so the
 * allow-list cannot be self-granted inline. Adding an entry is a reviewed change (GOV-SECURITY 83 + 05).
 * Each entry names the table(s), the file it may appear in, why it is cross-tenant, and its owner.
 */
export type CrossTenantEntry = { id: string; tables: readonly string[]; file: string; reason: string; owner: string };

export const CROSS_TENANT_ALLOW_LIST: readonly CrossTenantEntry[] = [
  {
    id: 'wa-webhook-shared-number',
    tables: ['social_accounts'],
    file: 'backend/queue/jobProcessors/whatsappWebhookProcessor.ts',
    reason: 'an inbound Meta webhook names a phone_number_id, not a tenant; the lookup resolves WHICH tenant owns it (the shared-number guard refuses ambiguity)',
    owner: 'virality-6f',
  },
  {
    id: 'invite-accept-token-bearer',
    tables: ['invitations'],
    file: 'pages/api/auth/accept-invite.ts',
    reason: "BEARER: possession of the secret invitation token (looked up by sha256(token), unauthenticated). The actor cannot be a member yet - accepting is how they join - so no principal resolves a tenant; the invitation row names it. Every later write goes through systemTenantContext(row.company_id, reason). Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
  {
    id: 'invite-set-password-own-email',
    tables: ['invitations'],
    file: 'pages/api/auth/set-password.ts',
    reason: "BEARER: the authenticated user's OWN email, used ONLY when VERIFIED - the route requires user.emailVerified (resolveAuthenticatedUser's email_confirmed_at) before the email selects any invitation; pinned by backend/tests/unit/s2SetPasswordVerifiedEmail.test.ts 'an UNVERIFIED email never activates an invitation'. The user is not a member yet - activation is what makes them one - so the invitation row names the tenant. Every later write goes through systemTenantContext(row.company_id, reason); activation itself is the activate_invitation_membership RPC. Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
  {
    id: 'invite-resend-self-serve',
    tables: ['invitations'],
    file: 'pages/api/auth/resend-invitation.ts',
    reason: "BEARER: an email address (self-serve resend, rate-limited per IP and per email). The requester is not a member - they lost their invitation - so the row names the tenant. The response is a CONSTANT 200 whether or not an invitation exists (no enumeration), pinned by backend/tests/unit/s2InvitationBearerTenant.test.ts 'self-serve resend answers the same 200 body whether or not an invitation exists'. Every later write goes through systemTenantContext(row.company_id, reason). Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
