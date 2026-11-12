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
    reason: "BEARER: possession of the secret invitation token - the lookup is .eq('token_hash', sha256(token)) (the row stores a digest, never the token), unauthenticated, rate-limited per IP (ACCEPT_INVITE_LIMIT: 10 / 15 min). The actor cannot be a member yet - accepting is how they join - so no principal resolves a tenant; the invitation row names it. Every later write (consume CAS, expiry revoke, un-consume on OTP failure) goes through systemTenantContext(row.company_id, reason); pinned by backend/tests/unit/s2InvitationBearerTenant.test.ts 'the consume write carries the invitation's OWN tenant (B)'. Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
  {
    id: 'invite-set-password-own-email',
    tables: ['invitations'],
    file: 'pages/api/auth/set-password.ts',
    reason: "BEARER: TWO independent facts, neither sufficient alone - (1) the authenticated user's OWN email, used ONLY when VERIFIED (the route requires user.emailVerified, resolveAuthenticatedUser's email_confirmed_at, around the WHOLE invitation block; pinned by backend/tests/unit/s2SetPasswordVerifiedEmail.test.ts 'an UNVERIFIED email never activates an invitation'), AND (2) an invitation whose magic-link token was ALREADY CONSUMED (the lookup requires token_consumed_at IS NOT NULL) - the email only selects among invitations someone already exercised the secret token for. The user is not a member yet - activation is what makes them one - so the invitation row names the tenant. Every later write goes through systemTenantContext(row.company_id, reason); activation itself is the activate_invitation_membership RPC. Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
  {
    id: 'invite-resend-self-serve',
    tables: ['invitations'],
    file: 'pages/api/auth/resend-invitation.ts',
    reason: "BEARER: an email address whose only authority is to cause an invitation email to be delivered TO THAT SAME ADDRESS - it gains the requester nothing they did not already control. Rate-limited per IP AND per email (two checkRateLimit calls, EMAIL_LINK_LIMIT) so one known address cannot be spammed. The requester is not a member - they lost their invitation - so the row names the tenant. The response is a CONSTANT 200 whether or not an invitation exists (no enumeration), pinned by backend/tests/unit/s2InvitationBearerTenant.test.ts 'self-serve resend answers the same 200 body whether or not an invitation exists'. Every later write (revoke of the old row) goes through systemTenantContext(row.company_id, reason); pinned by 'the revoke of the old invitation carries its OWN tenant (B)'. Reads nothing else cross-tenant; all other access is tenant-scoped.",
    owner: 'virality-e1',
  },
  {
    id: 'own-phone-identity-scoped',
    tables: ['free_credit_profiles'],
    file: 'pages/api/auth/get-stored-phone.ts',
    reason: "IDENTITY-SCOPED, no tenant involved: the caller's OWN phone number, selected by .eq('user_id', user.id) where user comes from getSupabaseUserFromRequest (401 without a session). It reads one column (phone_number) of the caller's own row - never another user's - pinned by backend/tests/unit/s2OwnPhoneIdentityScoped.test.ts 'returns only the caller's own phone, never another user's'. Reads nothing else cross-tenant; writes nothing.",
    owner: 'virality-e1',
  },
  {
    id: 'company-name-availability',
    tables: ['company_profiles'],
    file: 'pages/api/onboarding/validate-company-name.ts',
    reason: "PUBLIC signup check 'is this EXACT company name taken' - uniqueness is a property across ALL tenants, so the lookup cannot be tenant-scoped. It answers ONLY a boolean (never an id or another name): the input is escaped before .ilike (escapeLikePattern: % _ and \\ are literal, so a prefix like 'A%' matches only a company literally named 'A%'), and the endpoint is rate-limited per IP (NAME_CHECK_LIMIT 30/min). Pinned by backend/tests/unit/s2CompanyNameAvailability.test.ts 'a wildcard prefix never matches another company' and 'rate-limited per IP'. Reads nothing else cross-tenant; writes nothing.",
    owner: 'virality-e1',
  },
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
