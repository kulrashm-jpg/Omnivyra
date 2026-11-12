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
    reason: "IDENTITY-SCOPED read of a TENANT table (free_credit_profiles carries organization_id) by a key NARROWER than the tenant key (83 ruling 1, 2026-11-12). (1) The key is UNIQUE: free_credit_profiles_user_id_key UNIQUE (user_id), so .eq('user_id', user.id) selects exactly the caller's single row - adding organization_id would exclude nothing. (2) The key comes from the AUTHENTICATED SESSION, never the request: user.id is public.users.id from getSupabaseUserFromRequest (which wraps resolveAuthenticatedUser; 401 without a session) - it is what free_credit_profiles.user_id references (FK to public.users(id)); no query/body value reaches the filter. (3) The row's organization_id is NEVER used for authorization (nor read: the select is phone_number only). The read uses supabaseAdmin (service role), so RLS is NOT a backstop - the user_id filter is the entire control. Pinned by backend/tests/unit/s2OwnPhoneIdentityScoped.test.ts 'returns only the caller's own phone, never another user's'. Reads nothing else cross-tenant; writes nothing.",
    owner: 'virality-e1',
  },
  {
    id: 'company-name-availability',
    tables: ['company_profiles'],
    file: 'pages/api/onboarding/validate-company-name.ts',
    reason: "PUBLIC signup check 'is this EXACT company name taken' - uniqueness is a property across ALL tenants, so the lookup cannot be tenant-scoped. It answers ONLY a boolean (never an id or another name), and the boolean is decided by case-insensitive EQUALITY in code (isExactNameMatch) - so no pattern character in either layer (SQL LIKE % _ \\ or PostgREST's * -> %) can widen the answer beyond the exact name; the .ilike pattern (likeCandidatePattern) only narrows which candidate rows are fetched. Inherent and accepted: it reveals whether one EXACT name exists. The per-IP limit (NAME_CHECK_LIMIT 30/min, fails closed on limiter outage) is a speed bump, not the control. Pinned by backend/tests/unit/s2CompanyNameAvailability.test.ts 'a wildcard prefix never matches another company' and 'rate-limited per IP'. Reads nothing else cross-tenant; writes nothing.",
    owner: 'virality-e1',
  },
  {
    id: 'creator-audit-append-only-sink',
    tables: ['creator_audit_log'],
    file: 'backend/services/creatorAuditTrailService.ts',
    reason: "SYSTEM-WRITER SINK (83 ruling 4, 2026-11-12): recordAuditEntry buffers best-effort audit entries from many call sites and flush() INSERTS them in one batch, so a batch mixes tenants and NULL-company system entries (prod: 65/65 rows NULL company) - there is no single tenant to scope the write to. Each row carries its OWN company_id (entry.companyId or the ambient trace's), never another entry's. WRITE-ONLY: flush() only ever inserts - it never selects, updates or deletes, and returns nothing to any caller; the readers (getAuditHistoryForPlan / getAuditHistoryForScheduledPost) go through tenantTable, so nothing is read back to a tenant by this path. Pinned by backend/tests/unit/s2CreatorAuditSink.test.ts 'flush only inserts, and each row keeps its own company'. Reads nothing cross-tenant; writes only creator_audit_log. Follow-up (NON-BLOCKING-SCHEDULED): an optional tenant per entry so stamped entries go through the seam.",
    owner: 'virality-e1',
  },
  {
    id: 'narrative-cron-company-discovery',
    tables: ['content_opportunities'],
    file: 'backend/scheduler/schedulerIntelligenceJobs.ts',
    reason: "SYSTEM JOB WORK-SET DISCOVERY (83 ruling 2, 2026-11-12): runNarrativeEngine must find WHICH companies have work before it can run per company, so it reads content_opportunities across tenants - selecting company_id ONLY, for rows created in the last 7 days, capped at 5000 rows. No title, description or any other content column is read, nothing is written by this read, and nothing from it reaches a tenant: each discovered company is then processed under systemTenantContext(companyId) through tenantTable/tenantChildTableOf (generateCampaignNarratives). Pinned by backend/tests/unit/s2NarrativeEngineTenant.test.ts 'discovery reads company_id only' and 'each company is processed only with its own opportunities'. Reads nothing else cross-tenant.",
    owner: 'virality-e1',
  },
  {
    id: 'strategy-templates-user-owned-or-public',
    tables: ['strategy_templates'],
    file: 'backend/services/strategyTemplateService.ts',
    reason: "USER-OWNED + PUBLIC BY DESIGN (83 ruling 3, 2026-11-12): a strategy template belongs to its user_id (company_id is optional and often NULL) and is_public templates are readable by every signed-in user, so tenant scoping does not apply. Enforced: listStrategyTemplates returns only rows with user_id = the authenticated caller OR is_public = true (two exact reads, no interpolated filter); getStrategyTemplate's row is disclosed by pages/api/strategy-templates/[id].ts only to its owner or when public (a PRIVATE template of another user answers 404); updateStrategyTemplate / deleteStrategyTemplate are pinned to .eq('user_id', owner) and the route refuses a non-owner (403) before calling them; createStrategyTemplate writes user_id = the caller and a company_id only after enforceCompanyAccess. Pinned by backend/tests/unit/s2StrategyTemplatesOwnerScoped.test.ts 'a non-owner can never PUT or DELETE', 'a non-owner never reads a PRIVATE template, even by id' and 'the list is own + public only'. Reads nothing else cross-tenant.",
    owner: 'virality-e1',
  },
] as const;

export const CROSS_TENANT_IDS: ReadonlySet<string> = new Set(CROSS_TENANT_ALLOW_LIST.map((e) => e.id));
