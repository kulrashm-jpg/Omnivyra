# Security closure matrix — STEP 3AH-91 (unified)

**Base:** `main @ f44b1387` (PR #245 merged and live). **Integration branch:** `sec/3ah91-integration` → one PR to `main`, **not merged** (merging to `main` auto-deploys the Railway worker).
**Scope:** every finding from SEC-A … SEC-F (wave 1), W2-A / W2-B / W2-E / W2-F / W2-G (wave 2) and the integration pass. MCP is excluded by instruction.

**Verdicts:** `CLOSED` = fixed in code on the integration branch (or already fixed, or a reviewed false positive), with regression tests and gates; `CLOSED — MANUAL OPERATION REQUIRED` = the code side is closed and a named owner/operator step remains; `ACCEPTED — DOCUMENTED` = a reviewed, justified residual; `OPEN — REMEDIATION REQUIRED` = not closed.

**Production status vocabulary:** *Not deployed* = fixed on the integration branch only; production still runs `f44b1387` (nothing in this program was deployed). *Live (#245)* = already fixed in production. *Operator* = depends on a manual step. *CI-only* = gate change, no runtime effect.

Commit references are short SHAs on the named workstream branch, all merged into `sec/3ah91-integration` (`int/` = made on the integration branch itself). Per-workstream detail: `docs/security/SEC91_{A,B,C,D,E,F,W2A,W2B,W2E,W2F,W2G}.md`, rotation runbook `SEC91_B_CREDENTIAL_ROTATION.md`.

## Summary

<!-- SUMMARY -->
| Verdict | P1 | P2 | P3 | — | Total |
|---|---|---|---|---|---|
| CLOSED | 12 | 30 | 47 | 5 | 94 |
| CLOSED — MANUAL OPERATION REQUIRED | 2 | 9 | 7 | 0 | 18 |
| ACCEPTED — DOCUMENTED | 0 | 1 | 14 | 1 | 16 |
| OPEN — REMEDIATION REQUIRED | 0 | 0 | 0 | 0 | 0 |
| **Total** | 14 | 40 | 68 | 6 | 128 |

OPEN rows: none.
<!-- /SUMMARY -->

## A. Authorization / tenant isolation (SEC-A, W2-A, W2-G)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-A1-a | P1 | `wordpress-plugin/heartbeat` accepted a bare `registration_id` without a token (anonymous overwrite; revoked row → `connected`) | OPEN | FIXED: plugin token required, registration taken from the token; service-level binding (W2A-2) | a/85a2874, w2a/18f6650 | `sec91AWordpressPlugin` (16), `sec91W2AWordpressPluginService` | Not deployed | Merge + deploy | CLOSED |
| SEC91-A1-b | P1 | `lead-intelligence/execution` capabilities from a cross-company admin role (VIEW_ONLY of Y could release DNC / kill-switch in Y) | OPEN | FIXED: role from `TenantGuard.assertTenantAccess` for the requested company | a/4981bed | `sec91AExecutionCaps` (18) | Not deployed | Merge + deploy | CLOSED |
| SEC91-A1-c (F1-01) | P3 | `accounts/[platform]` POST unauthenticated; logged caller's OAuth `code` | OPEN (R1-METHOD) | FIXED; method exemption retired | a/7700b5d, int/202c246 | `sec91AMethodGaps` (10), `sec91FRouteAuthMethod` | Not deployed | — | CLOSED |
| SEC91-A1-d (F1-02) | P2 | `track/angle-industry-matrix` GET: anonymous read of the platform-wide aggregate | OPEN (R1-METHOD) | FIXED: authenticated session required; exemption retired | a/7700b5d, int/202c246 | `sec91AMethodGaps` | Not deployed | — | CLOSED |
| SEC91-A1-e (F1-03) | P2 | Same route POST: any member of any company wrote the global aggregate | OPEN | FIXED: active platform super admin only | a/7700b5d | `sec91AMethodGaps` | Not deployed | — | CLOSED |
| SEC91-A1-f | — | Per-method sweep of 1,322 routes: 18 residual flags | — | FALSE POSITIVE (each reviewed: CORS OPTIONS, public blog GETs, signed webhooks, method-conditional guards, identity-scoped helpers) | — | route gate (R1-METHOD) | n/a | — | CLOSED |
| SEC91-A1-g | — | 65 binding-claim allowlist entries | — | Reviewed: 58 OK; weak ones fixed as A1-b, A2-a, A2-e, A6-b, W2A-1 | — | route gate evidence re-verification | n/a | — | CLOSED |
| SEC91-A2-a | P1 | `isSuperAdmin` / `isPlatformSuperAdmin` ignored `user_company_roles.status` (inactive/invited SUPER_ADMIN row = platform bypass into every tenant) | OPEN | FIXED; owner decision A2-a (active row required); characterization test superseded | a/a98b2ba, int/cc39f85 | `sec91ASuperAdminStatus` (17), `sec91ATenantGuardParity`, `superadminMembershipValidity001` | Not deployed | **Before deploy:** every intended operator's SUPER_ADMIN row `active`, on an internal company that customer-disable flows never touch (ideally two operators) — SEC91_A §7 | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-A2-b | P2 | `requireCampaignAccess` accepted ANY invited role | OPEN | FIXED (matches `enforceCompanyAccess`) | a/a98b2ba | `sec91ACampaignAccess` (16) | Not deployed | — | CLOSED |
| SEC91-A2-c | P1 | `community-ai/connectors/status` authorized `tenant_id`, read `organization_id` | OPEN | FIXED: ids must match; only the authorized id is read | a/e92d3bc | `sec91AConnectorsStatus` (5) | Not deployed | — | CLOSED |
| SEC91-A2-d | P3 | `engagement/reply` draft looked up by id alone (foreign-draft status oracle) | OPEN | FIXED: foreign ≡ missing (404) | a/4901c8a | `sec91AEngagementReplyDraft` (5) | Not deployed | — | CLOSED |
| SEC91-A2-e | P2 | Calendar showed a shared member's standalone posts made for company B on company A's calendar | OPEN | FIXED for posts whose social account carries a company; lookup fails closed | a/ccd6cf4 | `sec91ACalendarStandalone` (5) | Not deployed | Legacy remainder: `scheduled_posts` has no `company_id` — schema migration + backfill (owner) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-A3 | P1 | Super-admin derived from user-writable metadata | OPEN (audit) | ALREADY FIXED (#245); whole-repo sweep found no remaining decision on user-writable data | — | #245 suites | Live (#245) | — | CLOSED |
| SEC91-A4-a | P1 | Plugin registration without company admin | OPEN (audit) | ALREADY FIXED (#245) | — | `routeAuth001PluginWorkers` | Live (#245) | — | CLOSED |
| SEC91-A4-b | P1 | `wordpress-plugin/revoke` IDOR: admin of A revoked any tenant's registration | OPEN (new) | FIXED at the route and in the service UPDATE | a/85a2874, w2a/18f6650 | `sec91AWordpressPlugin`, `sec91W2AWordpressPluginService` | Not deployed | — | CLOSED |
| SEC91-A4-c | P3 | Plugin disconnect (plugin token) silently 401 | OPEN | FIXED: a valid `ovwp_` bearer revokes exactly its own registration | a/85a2874 | `sec91AWordpressPlugin` | Not deployed | — | CLOSED |
| SEC91-A5 | P2 | `admin/autonomous/decisions` role | OPEN (audit) | ALREADY FIXED / aligned; sibling POST gated by W2A-1d | — | `routeAuth001DataAdmin` | Live (#245) | — | CLOSED |
| SEC91-A6-a | P3 | Authenticated 403 (foreign) vs 404 (unknown) campaign existence oracle (`requireCampaignAccess`, inline in several campaign routes) | OPEN | INTENTIONALLY ACCEPTED: authenticated callers only; ids are UUIDs; established TenantGuard vocabulary | — | pinned by `campaignResourceAuthzSec001` | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-A6-b | P3 | Anonymous existence oracle on 4 id-keyed routes | OPEN | FIXED: authenticate before any lookup | a/51783fd | `sec91AExistenceOracle` (10) | Not deployed | — | CLOSED |
| SEC91-A7 | P3 | TenantGuard: two decision copies, wrong `deleted_at` claim | OPEN | FIXED (docs) + parity pinned (244 fixtures) | a/455edc1 | `sec91ATenantGuardParity` (7) | n/a | — | CLOSED |
| SEC91-A8 | P3 | Campaigns without `campaign_versions` 404 for their own company | OPEN | FIXED: fallback to `campaigns.company_id` only when no version row exists | a/a98b2ba | `sec91ACampaignAccess` | Not deployed | Optional read-only listing before deploy (SEC91_A §7) | CLOSED |
| SEC91-A9 | — | 31 dormant routes (D16 / D2 5 / F10) remain covered | — | VERIFIED; pinned by SEC-F6 | — | `sec91FDormantRoutes` (41) | n/a | — | CLOSED |
| SEC91-W2A-1a | P2 | `campaigns/[id]` DELETE open to any member incl. VIEW_ONLY | OPEN (SEC-A §8) | FIXED: CAMPAIGN_DELETE holders (COMPANY_ADMIN, SUPER_ADMIN) | w2a/50dbb28 | `sec91W2AVerticalRbac` | Not deployed | — | CLOSED |
| SEC91-W2A-1b | P2 | `campaigns/[id]` PUT (rename, pause/cancel/activate) open to VIEW_ONLY | OPEN (SEC-A §8) | FIXED: campaign-authoring roles (PERMISSIONS.CREATE_CAMPAIGN) | w2a/50dbb28 | `sec91W2AVerticalRbac` | Not deployed | Owner decision on finer activation/cancel rights (SEC91_W2A §7.2) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-W2A-1c | P2 | `reports/[reportId]` DELETE open to VIEW_ONLY (UI-only rule) | OPEN (SEC-A §8) | FIXED: role checked in the report's own company; unknown roles refused | w2a/50dbb28 | `sec91W2AVerticalRbac` | Not deployed | — | CLOSED |
| SEC91-W2A-1d | P2 | `admin/autonomous` POST open to any member | OPEN (SEC-A §8) | FIXED: COMPANY_ADMIN / platform super admin | w2a/50dbb28 | `sec91W2AVerticalRbac` | Not deployed | — | CLOSED |
| SEC91-W2A-2a/b/c | P2 | WordPress plugin service: revoke/heartbeat by id alone; registration nonce never consumed; verify re-verified revoked rows | OPEN (SEC-A §6) | FIXED: company in the UPDATE, token-bound heartbeat, atomic single-use nonce, revoked rows refused | w2a/18f6650 | `sec91W2AWordpressPluginService` (16 fail on base) | Not deployed | — | CLOSED |
| SEC91-W2A-2d | P3 | Registration nonce has no expiry | OPEN | ACCEPTED: nonce is now single-use and registration-bound; expiry needs a schema migration plus an ordered code deploy (SEC91_W2A §6.3) | — | — | Live | Optional hardening (migration + code) | ACCEPTED — DOCUMENTED |
| SEC91-W2A-3 | P3 | `ai/generate-content` looked up the campaign before authenticating | OPEN (SEC-A §6) | FIXED: authenticate first; owner via `resolveCampaignCompanyId` | w2a/e3b94c5 | `sec91W2AGenerateContentAuthFirst` | Not deployed | — | CLOSED |
| SEC91-W2A-3-R | P3 | Other `ai/generate-content` types answer without authentication | OPEN | ACCEPTED: static demo / rule-based payloads; no DB read, no provider call | — | route gate (inline-binding evidence) | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-W2A-5a | P3 | `requireCampaignAccess` ignored company suspension | OPEN | FIXED: same decision as TenantGuard | w2a/53b212b | `sec91W2ACampaignAccessOrgStatus` | Not deployed | Optional read-only pre-deploy listing (SEC91_W2A §7.5) | CLOSED |
| SEC91-W2A-5b | P3 | Every active member is effective COMPANY_ADMIN in `requireCampaignAccess`; campaign-level roles never enforced | OPEN (SEC-A §8) | Not changed: enforcing today would 403 every non-admin member without a `campaign_user_roles` row on ~100 routes | — | — | Live | Owner decision (keep company-wide, or backfill + enforce) — SEC91_W2A §7.3 | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-W2A-5c | P3 | `POST /api/content` took the author from the body | OPEN (SEC-A §8) | FIXED: author = authorized principal | w2a/53b212b | `sec91W2AContentAuthorship` | Not deployed | — | CLOSED |
| SEC91-W2A-5e | P3 | Governance approvals: every caller acted as `compliance_reviewer` (routes also always 400) | OPEN (SEC-A §8) | FIXED: company + role from `withRBAC`; unmapped roles least-privileged | w2a/53b212b | `sec91W2AGovernanceApprovals` | Not deployed (runtime flag off) | — | CLOSED |
| SEC91-W2F-1a | **P1** | `activity-workspace/content` (re-exported handler): a member of A overwrote B's scheduled content via B's activity id; raw id interpolated into a PostgREST `.or()` filter | OPEN (new, found by W2F-1) | FIXED: the activity's campaign must be owned by the authorized company (404 before AI/credit work); writes only to the verified row; body `campaignId` bound; unsafe ids rejected at route and writer. Gate: reviewed `inline-binding` entry, evidence re-verified every run | w2a/7aca517, int/a9719cc | `sec91W2AActivityWorkspaceBinding` (10 fail on base), `sec91W2FRouteAuthReExport` (evidence load-bearing) | Not deployed — **live code at f44b1387 is exposed** | Merge + deploy (priority) | CLOSED |
| SEC91-W2F-1b | P3 | `creator-content/generate` read a campaign snapshot by an unbound `campaign_id` | OPEN (new) | FIXED: `enforceCompanyAccess({ companyId, campaignId })` + company-scoped read; gate passes on primitives | w2a/917c77c, int/a9719cc | `sec91W2ACreatorGenerateCampaignBinding` (6) | Not deployed | — | CLOSED |
| SEC91-W2G-1 | P3 | Canonical content write routes (`pages/api/content/**`: create incl. `lifecycleStatus`, edit, archive, status, approval, variants/blocks/assets/lineage/performance/prediction/quality/recommendations, mark-used) open to read-only roles (VIEW_ONLY, VIEWER, CONTENT_ENGAGER) — partial W2A-5d | OPEN (SEC-A §8, W2A-5d) | FIXED: write methods require PERMISSIONS.CREATE_CAMPAIGN roles in the authorized company; reads unchanged; super admin / content architect / invited admin / legacy ADMIN keep access. Non-writing routes reviewed (FALSE POSITIVE) or already role-gated | w2g/56cb053 | `sec91W2GContentWriteRbac` (325; 63 fail on base) | Not deployed | — | CLOSED |
| SEC91-W2G-1-R | P3 | Finer content lifecycle matrix (who may move content to approved / scheduled / published) — residual of W2A-5d | OPEN | Not implemented: the only UI caller advances status after the scheduler has already acted, so splitting authoring roles is a product decision; proposed matrix in SEC91_W2A §7.4 | — | — | Live | Owner decision; enforce in `POST /api/content`, `/:id/status` and `/:id/approval` together | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-W2G-2 | P3 | `POST /api/campaigns/pending/:id/approve` created and scheduled a campaign after a membership check only | OPEN (W2-A §6.2) | FIXED: COMPANY_ADMIN / SUPER_ADMIN row in the pending campaign's company, or platform super admin (W2A-1d policy) | w2g/005c61f | `sec91W2GPendingCampaignApprove` (16; 9 fail on base) | Not deployed | — | CLOSED |
| SEC91-W2G-3 | P3 | Orchestration synchronizer interpolated its argument into a PostgREST `.or()` filter (same shape as W2F-1a; not request-reachable today) | OPEN (W2-A §6.4) | FIXED: `isSafeActivityKey` before any query; unsafe key → null, not logged | w2g/491b4a7 | `sec91W2GSynchronizerActivityKey` (21; 15 fail on base) | Not deployed | — | CLOSED |
| SEC91-W2G-4 | P3 | Invited COMPANY_ADMIN admitted into a suspended / inactive / deleted company (`enforceCompanyAccess` and `requireCampaignAccess`), contrary to the helper's own doc | OPEN (W2-A §8) | FIXED: invited-admin fallback requires an active company; lookup error → retryable 503, never allow; platform super admin bypass unchanged | w2g/0e2ea25 | `sec91W2GInvitedAdminOrgStatus` (33; 7 fail on base) | Not deployed | Optional read-only pre-deploy listing (SEC91_W2G §7) | CLOSED |
| SEC91-W2G-5 | P3 | `setPrincipal()` (policy gate) recorded the principal via `enterWith` inside an awaited guard — invisible to the handler (same defect as W2A-4) | OPEN (W2-A §6.6) | FIXED: routed through `attributeAuthenticatedPrincipal`, staged by the `ai-guard-principal` flag (shadow = record only); `activeOrgId` forwarded only for an active membership | w2g/7a76579 | `sec91W2GPolicyGatePrincipal` (13; 9 fail on base) | Not deployed (route-policy gate default off) | Covered by the W2A-4 / D1d operator procedure | CLOSED |
| SEC91-W2G-N1 | P2 | `POST /api/content/approve` / `reject` acted on a body `assetId` without binding it to the authorized company; approver taken from the body | OPEN (new, found by W2-G) | FIXED at integration: asset → campaign → owning company must equal the authorized company (unknown 404, foreign/unresolvable 403); approver = principal. Latent on this tree: `withRBAC`'s literal role list admits only platform super admins (pre-existing, unchanged) | int/15cf45f | `sec91IntContentAssetBinding` (18; 9 fail on base) | Not deployed | Functional (not security): the legacy role list also refuses company admins — product owner to decide the approver roles | CLOSED |
| SEC91-W2G-N2 | P3 | `/api/company/blogs` POST/DELETE open to read-only roles | OPEN (new, found by W2-G) | FIXED at integration: W2G-1 content-authoring gate on writes; reads unchanged | int/15cf45f | `sec91IntContentAssetBinding` | Not deployed | — | CLOSED |
| SEC91-W2G-R1 | P3 | `POST /api/campaigns/pending/:id/approve` answers 404/409 (unknown / already reviewed) before the membership check — status oracle for authenticated callers on random UUIDs | OPEN (W2-G §8) | ACCEPTED: authenticated only, UUID ids, reveals review state not content (same class as A6-a) | — | — | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-W2G-R2 | — | `contentRouteModel.ts` writers accept any activity id (W2-A §6.5 campaignId threading) | OPEN (W2-A §6.5) | ACCEPTED: unreachable — the handler passes only a verified row id and the writer prefers the exact row match; threading touches 13 call sites + the BOLT writer for no reachable benefit | — | `sec91W2AActivityWorkspaceBinding` | Live | — | ACCEPTED — DOCUMENTED |

## B. Secrets / OAuth / credentials (SEC-B, W2-B, integration)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-B1 | P1 | Signing-secret fallback chains ending in the public anon key, the service-role key or literals (extension, claim codes, RPA, invitations) | OPEN | FIXED: dedicated secret → `AUTH_SECRET` only; otherwise fail closed (issuers throw, verifiers reject; 503 `SIGNING_SECRET_UNAVAILABLE`) | b/93e550a, w2b/d4179f2 | `sec91BSigningSecrets` (23), `sec91W2BSigningSecret503` (9) | Not deployed. Production has `AUTH_SECRET` and `INVITATION_TOKEN_SECRET`, so every family resolves without a fallback | Optional: dedicated `EXTENSION_SESSION_SECRET` / `RPA_AUTH_SECRET` / `OAUTH_STATE_HMAC_KEY` with a planned re-login | CLOSED |
| SEC91-B2 | P1 | External-API sources could resolve any server env var into outbound requests; whitelist survived tenant edits | OPEN | FIXED: per-source env policy; infrastructure secrets never resolvable; tenant edit revokes `is_whitelisted` | b/4c7f29b, b/778518a | `sec91BExternalApiEnvExfil` (14), `sec91BExternalApiWhitelistReset` (9) | Not deployed | — | CLOSED |
| SEC91-B3 | P1 | Historically leaked credentials (public repo history) | OPEN | Escalated: rotation runbook (13 credential classes, order, verification, no values) | b/bf88d3c | — | Operator | Owner executes `SEC91_B_CREDENTIAL_ROTATION.md` (Railway tokens + DB password first). Not done by this program (rotation forbidden) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-B4 | P2 | OAuth open redirect (`//evil`, `/\evil`, `returnTo` on invalid signature, connector callbacks) | OPEN | FIXED: one validator at encode and decode; only a correctly signed state yields `returnTo`; GA/GSC callback uses it too | b/9cde4e2, b/e01156d, w2b/44c8436 | `sec91BOAuthRedirect` (44), `sec91W2BCallbackRedirect` (7) | Not deployed | — | CLOSED |
| SEC91-B5 | P2 | Unsigned community-AI connector OAuth state (account-linking CSRF) | OPEN | FIXED: HMAC state bound to company/tenant/user/flow/provider, 10-min TTL | b/e01156d | `sec91BConnectorState` (24) | Not deployed | Deploy note: in-flight connector flows restart | CLOSED |
| SEC91-B6 | P2 | Client secrets, tokens and raw provider bodies in logs | OPEN | FIXED: `safeErrorLog` redaction on refresh/callback paths | b/3740033 | `sec91BSecretLogRedaction` (17) | Not deployed | — | CLOSED |
| SEC91-B7 | P3 | OAuth-state HMAC reused the raw `ENCRYPTION_KEY`; `===` compare | OPEN | FIXED: domain-separated derived key; `timingSafeEqual` | b/9cde4e2, w2b/3a3f6b6 (schema text) | `sec91BOAuthRedirect`, `sec91W2BEnvSchemaText` (4) | Not deployed | Deploy note: states minted in the 10 min before deploy fail once | CLOSED |
| SEC91-B8 | P3 | Legacy plaintext `api_key_value` accepted silently | OPEN | FIXED (visibility): still resolves, reported once per account (id only) | b/ce5827f | `sec91BMiscHardening` | Not deployed | Operator re-enters each flagged key in Super Admin (encrypted on save) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-B9 | P3 | In-memory extension-nonce map and MFA attempt limiter | OPEN | INTENTIONALLY ACCEPTED: replay also needs the per-session HMAC secret within ±5 min; TOTP bounded per instance; recovery codes single-use in the DB; shared-store design documented | — | — | Live | Planned item: Redis store, fail closed with a breaker | ACCEPTED — DOCUMENTED |
| SEC91-B10 | P3 | WhatsApp verify token: unset token matched an empty `hub.verify_token`; challenge echoed | OPEN | FIXED: fail closed, constant-time, plain-token challenge as text/plain | b/ce5827f | `sec91BMiscHardening` B10 | Not deployed | Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` before (re)subscribing | CLOSED |
| SEC91-B11a | P3 | Password-reset gate bypassable (browser calls `resetPasswordForEmail` directly) | OPEN | Cannot be bound in code without moving reset server-side | — | — | Operator | Supabase Auth: enable CAPTCHA + recovery-email rate limit (SEC91_B §7.4) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-B11b | P3 | Sessionless passkey begin-auth disclosed credential ids for a body `userId` | OPEN | FIXED: session principal only | b/ce5827f | `sec91BMiscHardening` B11 | Not deployed | — | CLOSED |
| SEC91-B12 | P3 | Encryption-key parsing inconsistent (hex-or-base64 guess; `?? ''`) | OPEN | FIXED: strict 64-hex everywhere (production key bytes unchanged) | b/ce5827f | `sec91BMiscHardening` B12 | Not deployed | — | CLOSED |
| SEC91-B13 | P2 | Razorpay webhook secret fell back to the API key secret | OPEN (MANUAL in SEC-B) | FIXED at integration: Razorpay uses only its webhook variable (unset ⇒ every webhook rejected); Cashfree keeps its by-design fallback; runbook updated | int/8d9269b | `sec91IntRazorpayWebhookSecret` (5; 2 fail on base); 23 payment suites (491 tests) pass | Not deployed. Vercel production carries `RAZORPAY_WEBHOOK_SECRET` (name listing earlier in this step series); live mode not enabled | Operator: confirm the variable equals the dashboard webhook secret and differs from the key secret; set `RAZORPAY_LIVE_WEBHOOK_SECRET` before enabling live | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-W2B-1 | P2 | `requireManageConnectors` cookie fallback re-admitted deleted / suspended / revoked / invited accounts | OPEN (SEC-A §6) | FIXED: canonical resolver only | w2b/229b5b6 | `sec91W2BConnectorAuth` (13) | Not deployed | — | CLOSED |
| SEC91-W2B-2 | P2 | OAuth `redirect_uri` builders trusted `X-Forwarded-Host` / `Host` | OPEN (SEC-E §6) | FIXED: production uses `NEXT_PUBLIC_APP_URL` only | w2b/229b5b6 | `sec91W2BRedirectOrigin` (22) | Not deployed | Operator: confirm `NEXT_PUBLIC_APP_URL` and the registered X/LinkedIn/Meta/Reddit callbacks; remove any `http://localhost*` URI from production OAuth apps | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-W2B-3 | P3 | 29 auth routes keyed rate limits on the first XFF hop; `check-user` not sensitive | OPEN (SEC-E §6) | FIXED: trusted client IP adapter; `check-user` sensitive | w2b/bc6a8ee | `sec91W2BAuthClientIp` (25) | Not deployed | — | CLOSED |
| SEC91-W2B-4a | P3 | Meta connector callback logged the raw token-exchange body | OPEN (SEC-E §6) | ALREADY FIXED by B6 | b/3740033 | `sec91BSecretLogRedaction` | Not deployed | — | CLOSED |
| SEC91-W2B-4b | P3 | GA/GSC callback redirect used `startsWith('/')` | OPEN (SEC-B §6) | FIXED (defence in depth) | w2b/44c8436 | `sec91W2BCallbackRedirect` (7) | Not deployed | — | CLOSED |
| SEC91-W2B-5 | P3 | Extension/RPA routes returned 500 naming env variables | OPEN (SEC-B §6) | FIXED: 503 with a plain code | w2b/d4179f2 | `sec91W2BSigningSecret503` (9) | Not deployed | — | CLOSED |
| SEC91-W2B-6 | P3 | `OAUTH_STATE_HMAC_KEY` description wrong | OPEN (SEC-B §6) | FIXED (text only) | w2b/3a3f6b6 | `sec91W2BEnvSchemaText` (4) | n/a | — | CLOSED |
| SEC91-W2B-P1 | P3 | Two trusted-client-IP resolvers (`lib/security/clientIp.ts`, `backend/services/ai/trustedClientIp.ts`) with different off-Vercel knobs | OPEN (W2-B proposal) | ACCEPTED: both refuse client-written XFF off-Vercel and agree on Vercel; consolidation is a refactor, not a fix | — | `sec91EClientIp`, `sec91DAiRouteSpend` | Live | Optional consolidation | ACCEPTED — DOCUMENTED |
| SEC91-INT-1 | P2 | `/api/notifications` re-admitted refused sessions through an `@supabase/ssr` + `supabase_uid` fallback (same class as W2B-1) | OPEN (W2-B proposal) | FIXED at integration: canonical resolver only | int/170c971 | `sec91IntNotificationsAuth` (5; 4 fail on base) | Not deployed | — | CLOSED |
| SEC91-INT-2 | P3 | GA OAuth callback logged `req.url`, incl. the single-use authorization `code` and `state` | OPEN (W2-B observation) | FIXED at integration: path only | int/170c971 | `sec91IntGaCallbackLog` | Not deployed | — | CLOSED |
| SEC91-W2F-2a/b/c | P3 | Super-admin / content-architect passwords compared with `!==` (and unsalted SHA-256 hex digests) | OPEN (found by the W2F-2 gate) | FIXED at integration: `constantTimeEqual`, both halves always evaluated; gate `KNOWN_OPEN` emptied | int/b286744 | `sec91IntP3Closures` (30; 9 fail on base), `sec91W2FConstantTime` | Not deployed | Optional: salted KDF for the content-architect password | CLOSED |
| SEC91-W2F-3a | P3 | WhatsApp webhook accepted unsigned payloads when `WHATSAPP_APP_SECRET` was unset outside production | OPEN (found by R4-ENV) | FIXED at integration: unset secret ⇒ 401 in every environment; `knownOpen` entry removed | int/b286744 | `sec91IntP3Closures`, `sec91W2FR4Env` | Not deployed (production already closed) | Local webhook testing needs a local `WHATSAPP_APP_SECRET` | CLOSED |

## C. Workers / queues / runtime (SEC-C, integration)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-C1 | P2 | Publishing/analytics worker triggers fail open | OPEN (audit) | ALREADY FIXED (#245): 503 when unset, `timingSafeEqual` | — | `routeAuth001PluginWorkers` | Live (#245) | — | CLOSED |
| SEC91-C1-b | P2 | `internal/process-reminders`, `internal/metrics` open outside production | OPEN | FIXED: fail closed in every environment; R4-ENV gate prevents recurrence | c/f61d840 | `sec91CInternalEndpointsFailClosed` (8), `sec91W2FR4Env` | Not deployed | — | CLOSED |
| SEC91-C2 | P2 | BullMQ prefix shared across environments (a laptop consumed production jobs) | OPEN | FIXED: env-scoped prefix outside production + consumer seatbelt; production prefix `bull` unchanged | c/7d8d5ea | `sec91CQueueNamespaceIsolation` (30) | Not deployed | Operators who deliberately drive production queues set `OMNIVYRA_ALLOW_SHARED_QUEUES=1` | CLOSED |
| SEC91-C3a | P2 | cronGuard treated a still-connecting Redis client as "no Redis" (unlocked cycle) | OPEN | FIXED: bounded wait for the initial connect | c/3150978 | `sec91CCronGuardLockPolicy` (7) | Not deployed | — | CLOSED |
| SEC91-C3b | P2 | Cron lock fails open during a genuine Redis outage | OPEN | INTENTIONALLY ACCEPTED for one replica; now logged (`cron_lock_fail_open`); `CRON_LOCK_FAIL_CLOSED=1` opt-in | c/3150978 | `sec91CCronGuardLockPolicy` | Live | Revisit if replicas > 1 | ACCEPTED — DOCUMENTED |
| SEC91-C4 | P3 | Non-constant-time machine-secret compares (38 endpoints) | OPEN | FIXED; blocking constant-time gate (W2F-2) | c/f61d840 | `sec91CConstantTimeSecrets` (57) | Not deployed | — | CLOSED |
| SEC91-C5 | P2 | Processors trusted payload tenant ids (billing skipped / cross-campaign writes) | OPEN | FIXED for planning, interactive-plan, creator | c/d1b4c62, c/1584980 | `sec91CJobTenantBinding` (14) | Not deployed | — | CLOSED |
| SEC91-C5-R | P3 | Other payload-trusting processors (content-generation family, engine-jobs, whatsapp, analytics-ingestion) not audited; automation processor dormant | OPEN | ACCEPTED: the queue is reachable only with Redis credentials and every producer authorizes before enqueue; follow-up audit recorded | — | — | Live | Follow-up processor audit | ACCEPTED — DOCUMENTED |
| SEC91-C6a | P2 | Railway deploys ~5 s after merge, before CI | OPEN | Dashboard-only setting | — | — | Operator | M1: enable Railway "Wait for CI" | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-C6b | P2 | The scheduler's SIGTERM handler pre-empted the worker drain | OPEN | FIXED: host owns shutdown; hard-exit backstop | c/3c80daf | `sec91CWorkerShutdownDrain` (35) | Not deployed | M2: Railway draining ≥ 30 s; coordinate with unmerged WS-1 `fix/worker-shutdown-safety` | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-C6c | P3 | Boot cron: `confidenceCalibration` saved but never restored | OPEN | FIXED; 9 unpersisted boot tasks accepted (behaviour decision) | c/3c80daf | `sec91CWorkerShutdownDrain` | Not deployed | — | CLOSED |
| SEC91-C6d | P3 | `railway.json`: no healthcheck / watch paths / draining | OPEN | ACCEPTED: `/health` is not readiness-accurate; watch-path globs unverifiable offline (recommendations in SEC91_C §7 M3) | — | — | Live | Optional M3 | ACCEPTED — DOCUMENTED |
| SEC91-C7 | P2 | Supabase: open network, SSL not enforced, leaked-password protection off, 98 mutable `search_path` functions | OPEN (live evidence) | Manual platform settings + a reviewed migration; new gate rule (INT-C7G) stops new definer functions without a pinned `search_path` | int/7fa2885 (gate) | `sec91FMigrationQuality` (b2) | Operator | M4 network restrictions, M5 SSL enforcement, M6 HIBP, M7 catalog-driven `search_path` migration (SEC91_C §7) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-C8 | P3 | No publish-specific kill switch | OPEN | INTENTIONALLY ACCEPTED (retries/backoff/DLQ/idempotency present) | — | — | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-C9 | P3 | `Dockerfile.cron` unpinned base, `npm install` | OPEN | FIXED: digest-pinned base, `npm ci` (image not deployed — the worker runs cron co-located) | c/d394a34 | `sec91CDockerfilePinning` (4) | n/a (not deployed) | — | CLOSED |
| SEC91-INT-C7G | P3 | Migration gate did not require SECURITY DEFINER routines to pin `search_path` (a later `CREATE OR REPLACE` re-opens C7) | OPEN (SEC-C §6.1c) | FIXED at integration: rule (b2) with a reviewed `-- search-path-ok:` escape; current tree 0 violations | int/7fa2885 | `sec91FMigrationQuality` (b2 block; 4 fail with the rule disabled) | CI-only | — | CLOSED |

## D. AI / billing / provider spend (SEC-D, W2-A, integration)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-D1a | P1 | LLM / paid-provider routes without authentication | OPEN (audit) | ALREADY FIXED (#245); 36 AI-sink routes re-verified | — | route gate, `routeAuth001AiContent*` | Live (#245) | — | CLOSED |
| SEC91-D1b | P1 | AI guard per-IP key from the client-written first XFF hop | OPEN | FIXED: trusted client IP | d/b15f27d | `sec91DAiRouteSpend` | Not deployed | Non-Vercel deployments set `TRUSTED_CLIENT_IP_HEADER` | CLOSED |
| SEC91-D1c | P1 | Direct AI routes not user-keyed; guard errors failed open | OPEN | FIXED: userId/companyId passed; guard error ⇒ 503 | d/b15f27d | `sec91DAiRouteSpend` | Not deployed | — | CLOSED |
| SEC91-D1d | P2 | Gateway calls from HTTP routes classified "background" — no route ever passed the user id (`enterWith` inside awaited guards) | OPEN (SEC-D §6.2) | FIXED (attribution, observe-only by default) via the `ai-guard-principal` flag (`shadow`) | w2a/e039da2, w2a/ea3bdf6 | `sec91W2APrincipalAttribution` | Not deployed | Operator: ≥ 7 days of shadow data, tune limits, then `ROLLOUT_AI_GUARD_PRINCIPAL_MODE=enforce` (or per tenant) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-D2 | P2 | Credit guard shadow-only; enforcement would block billed calls (the handle was lost between check and gateway) | OPEN | FIXED: handle carried in AsyncLocalStorage for `runBilledAiCompletion` and (integration) `executeWithCredits`, org-bound | d/17d869b, int/1ee812c | `sec91DGatewaySpend`, `sec91IntExecuteWithCreditsHandle` (4; 2 fail on base) | Not deployed | Owner: ≥ 7 days of `untracked_ai_call_blocked` review, migrate/allowlist, then `BILLING_REQUIRE_AI_HANDLE=true` in Vercel **and** Railway (SEC91_D §7.1) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-D3 | P2 | claude-chat platform mode: any user spent the platform key unattributed; gpt-chat moderated before checking BYOK | OPEN | FIXED: 403 `PLATFORM_MODE_DISABLED`; key check before moderation | d/b15f27d | `sec91DAiRouteSpend` | Not deployed | Product: build platform chat as a billed gateway operation if wanted | CLOSED |
| SEC91-D4 | P2 | Keyless BYOK config got the platform key + its chosen model (skipping plan/cost gates) | OPEN | FIXED: company model honoured unconditionally only on the company's own key | d/17d869b | `sec91DGatewaySpend`, `sec91DByokKeyResolution` | Not deployed | — | CLOSED |
| SEC91-D4-R | P3 | BYOK 429/overload falls back onto the platform key | OPEN | Not changed (behaviour change: degrade vs surface the error); patch proposed | — | — | Live | Owner decision (SEC91_D §7.4) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-D5 | P3 | Direct provider paths without timeouts; abandoned image calls kept retrying; render reference fetch not SSRF-guarded | OPEN | FIXED: AbortSignal timeouts, cancellation, embeddings timeout; reference download via `safeFetch` (W2F-4) | d/139871e, w2f/242a6cf | `sec91DProviderHardening`, `sec91DImageProviderCancel`, `sec91W2FSsrfAlias` | Not deployed | — | CLOSED |
| SEC91-D6 | P3 | AI cache / coalescing keys omitted whose credential produced the answer | OPEN | FIXED: BYOK scoped `byok:<companyId>`; platform-key keys byte-identical (by design) | d/17d869b | `sec91DGatewaySpend` | Not deployed | — | CLOSED |
| SEC91-D7 | P3 | Prompt-injection hardening opt-in; chat moderation fails open | OPEN | Fail-open now counted; ACCEPTED: moderation is a content filter and no LLM tool execution exists | d/17d869b | `sec91DGatewaySpend` | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-D8 | P3 | Gemini API key in the URL query | OPEN | FIXED: `x-goog-api-key` header | d/139871e | `sec91DProviderHardening` | Not deployed | — | CLOSED |
| SEC91-D9 | P3 | Missing timeouts; SDK retries nested under gateway retries | OPEN | FIXED; SDK retries zeroed whenever the gateway owns transient retries | d/b15f27d, d/17d869b | `sec91DAiRouteSpend`, `sec91DGatewaySpend` | Not deployed | Optional `AI_GATEWAY_RETRY_TRANSIENT=1` | CLOSED |

## E. API / network / input / rate limit (SEC-E, W2-B, W2-E)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-E1 | P2 | SSRF + credential forwarding: `propose-frequency-rebalance` fetched the caller's `Origin` with Authorization/Cookie | OPEN | FIXED: computed in-process, no outbound call; SSRF `KNOWN_OPEN` retired | e/3728785, int/71d971f | `sec91EProposeRebalanceSsrf` (4), `sec91FSsrfScanner` | Not deployed | — | CLOSED |
| SEC91-E1b | — | Header-derived OAuth `redirect_uri` builders | REPORT | Closed by W2B-2 | w2b/229b5b6 | `sec91W2BRedirectOrigin` | Not deployed | see W2B-2 | CLOSED |
| SEC91-E2 | P2 | Rate limiter fell back to 50/window for every limit on Redis failure | OPEN | FIXED: per-limit failure mode; sensitive limits `strict` by default, `closed` opt-in | e/9270e6d | `sec91ERateLimitFailMode` (19) | Not deployed | Optional: `RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE=closed` after an Upstash quota review | CLOSED |
| SEC91-E2b | P2 | Client IP from the first XFF hop (~50 files) | OPEN | FIXED: canonical `getTrustedClientIp`; auth routes (W2B-3); remaining readers (W2-E) | e/9270e6d, w2b/bc6a8ee, W2-E | `sec91EClientIp` (10), `sec91W2BAuthClientIp`, W2-E suite | Not deployed | Non-Vercel deployments set `TRUSTED_PROXY_HOPS` | CLOSED |
| SEC91-E3 | P3 | Credentials in URLs leaked via SSRF errors, metric labels, vendor/SERP messages | OPEN | FIXED: central URL redaction | e/6a4634e | `sec91ESecretRedaction` (11), `sec91ESerpSecretRedaction` (2) | Not deployed | — | CLOSED |
| SEC91-E3b | P3 | Provider keys that must stay in the URL (SerpAPI, ScaleSERP, Pixabay, BuiltWith, Stack Exchange, Hunter, Google Places) | OPEN | ACCEPTED: provider requirement; redacted everywhere they could surface | — | E3 tests | Live | Verify Hunter/Places header auth in staging before moving (SEC91_E §7.5) | ACCEPTED — DOCUMENTED |
| SEC91-E3c | P3 | Meta access tokens in query strings | OPEN | Not logged on these paths; header-only needs one live Graph call per surface | — | — | Operator | Verify header auth in staging, then move (SEC91_E §7.4) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-E4 | P3 | GA4/GSC/Razorpay calls without timeouts; Google error bodies logged | OPEN | FIXED: 15 s timeouts; summarised, redacted errors | e/ee4cb89 | `sec91EOutboundTimeouts` (9) | Not deployed | — | CLOSED |
| SEC91-E5 | P3 | Guessable object names in public buckets; public URL stored for the private RPA bucket | OPEN | FIXED: 128-bit object stems; 1 h signed RPA URL, none persisted | e/d8ab3c0 | `sec91EStorageObjects` (5) | Not deployed | Operator: verify `rpa-artifacts` is private; optionally null dead `public_url`s; pre-change objects keep old names (SEC91_E §7.2–7.3) | CLOSED — MANUAL OPERATION REQUIRED |
| SEC91-E5-R | P3 | Creator image bucket public, content-addressed 48-bit names | OPEN (SEC-E §6) | ACCEPTED: paths also carry company/campaign/user UUIDs; 2^48 per path is infeasible over HTTP; randomness would break content dedupe | — | — | Live | Revisit with signed URLs if the bucket becomes sensitive | ACCEPTED — DOCUMENTED |
| SEC91-E6 | P3 | `upload-media-direct` existence/content-type oracle before authentication | OPEN | FIXED: authenticate first; format checks after `enforceCompanyAccess` | e/da4027e | `sec91EUploadExistenceOracle` (4) | Not deployed | — | CLOSED |
| SEC91-E7 | P3 | Ad-hoc input validation (no schema library in `pages/api`) | OPEN | DOCUMENTED: no broad refactor (per brief); touched routes validated | — | — | Live | — | ACCEPTED — DOCUMENTED |
| SEC91-E8 | P3 | `health/config` verbose to anyone | OPEN | FIXED: production returns status only (codes unchanged) | e/1276d42, int/71d971f | `sec91EHealthConfig` (4) | Not deployed | — | CLOSED |
| SEC91-E9 | P3 | SSRF scanner allowed host-position template interpolation | REPORT | Closed by SEC-F3 | f/7a913b6 | `sec91FSsrfScanner` | CI-only | — | CLOSED |
| SEC91-W2E-1 | P3 | Server code outside `pages/api/auth/**` took the client IP from the client-written first `x-forwarded-for` hop (rate-limit keys incl. the admin limiter and env-credential bootstrap limiter, stored IP hashes, audit fields) — 21 reads in 19 files | OPEN (SEC-E E2b residual, SEC-D §6.1, W2-B proposal 3) | FIXED: all 19 files use `getTrustedClientIp` / `getTrustedClientIpOrNull`, each site's `'unknown'` / `null` / `''` contract kept; `TenantGuard.ts` applied at integration; repo-wide source pin added to the CI gate runner | w2e/973ca00, w2e/18249ad, int (TenantGuard + runner) | `sec91W2EClientIpAdoption` (35; 21 fail with the sites reverted) | Not deployed (on Vercel the value is identical: `x-real-ip` = edge-set first hop; no session is IP-bound) | Non-Vercel deployments set `TRUSTED_PROXY_HOPS` | CLOSED |

## F. Security gates / verification (SEC-F, W2-F)

| ID | Severity | Finding | Original status | Current status | Fix/PR | Tests | Production status | Remaining action | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| SEC91-F1 | P2 | Route-auth gate decided R1 per file, not per HTTP method | OPEN | FIXED: R1-METHOD (260 dispatching routes); 0 method exemptions remain | f/365f3f5, int/202c246 | `sec91FRouteAuthMethod` (23) | CI-only | — | CLOSED |
| SEC91-F2 | P2 | Migration gate: earlier-timestamp bypass; definer EXECUTE by `authenticated`; views/MVs; GRANT/DEFAULT PRIVILEGES/DISABLE RLS/ALTER POLICY; `TO authenticated USING (true)`; DO-block tables | OPEN | FIXED: ordering snapshot (415, floor `20261026000000`) + rules (a)–(f), extended with (b2) at integration | f/892f046, int/7fa2885 | `sec91FMigrationQuality`, `migrationQualitySecurityRules` (53 total) | CI-only | — | CLOSED |
| SEC91-F3 | P3 | SSRF scanner coverage gaps (lib/**, dynamic hosts, host-fixing consts) | OPEN | FIXED; `KNOWN_OPEN` empty since E1 | f/7a913b6, int/71d971f | `sec91FSsrfScanner` (16), `ssrfCiGuard` | CI-only | — | CLOSED |
| SEC91-F4 | P2 | No secret-pattern gate | OPEN | FIXED: blocking gate over tracked files, fingerprint-pinned allowlist (1 entry), values never printed | f/f4635c4 | `sec91FSecretsGate` (23) | CI-only | Git history is not rewritten — see B3 | CLOSED |
| SEC91-F5 | P3 | `check-tenant-authz.js` blind spots | OPEN | DOCUMENTED: superseded by the route-auth gate, retained as blocking | f/8f2dc02 | `sec91FGateHardening` F5 | CI-only | — | ACCEPTED — DOCUMENTED |
| SEC91-F6 | P2 | 31 dormant routes could regress silently | OPEN | FIXED: verdict pins + 9 pre-3AH-85 shape fixtures | f/244fcf2 | `sec91FDormantRoutes` (41) | CI-only | — | CLOSED |
| SEC91-F7 | P2 | New gates not guaranteed blocking | OPEN | FIXED: steps run in job "Non-regression TypeScript baseline", which **is a required status check on `main`** (verified via the branch-protection API) | f/244fcf2, w2f/c1d9418 | `sec91FGateHardening` F7, `sec91W2FCiWiring` (10) | CI-only | — | CLOSED |
| SEC91-W2F-1 | P2 | Route gate skipped routes that re-export their handler | OPEN (SEC-A §6) | FIXED: re-exports followed (≤ 4 hops); unresolvable ⇒ R1 | w2f/bf3108f | `sec91W2FRouteAuthReExport` (22) | CI-only | — | CLOSED |
| SEC91-W2F-2 | P3 | No gate for timing-unsafe secret compares; 3 sites | OPEN (SEC-C §6) | FIXED: blocking gate; 3 sites converted; `KNOWN_OPEN` empty | w2f/3c2c90e, w2f/6c1e221, int/b286744 | `sec91W2FConstantTime` (27) | CI-only / Not deployed | — | CLOSED |
| SEC91-W2F-3 | P3 | R4 accepted secret checks open outside production | OPEN (SEC-C §6) | FIXED: R4-ENV; no R4-ENV remains on the tree | w2f/bf3108f, int/b286744 | `sec91W2FR4Env` (14) | CI-only | — | CLOSED |
| SEC91-W2F-4 | P3 | SSRF gate missed fetch aliases; render reference fetch unguarded | OPEN (SEC-D §6.5) | FIXED | w2f/242a6cf | `sec91W2FSsrfAlias` (13) | Not deployed | — | CLOSED |
| SEC91-W2F-5 | — | Wire the new checks into CI | — | FIXED: "Constant-time secret comparison gate" step; suites in the pinned runner | w2f/c1d9418 | `sec91W2FCiWiring` (10) | CI-only | — | CLOSED |

## Verification (integration head)

All runs are hermetic: faked DB and identity provider in unit tests, the local Supabase stack (`127.0.0.1:54321`) for integration tests, and no production access.

**Gates**, all PASS on the final tree:
- `check-route-auth`: 1,326 routes, 0 method exemptions, 0 `knownOpen`.
- `check-tenant-authz`: 8 grandfathered, 0 new.
- `check:ssrf`: `KNOWN_OPEN` empty.
- `check-migration-quality`: includes the new (b2) rule.
- `check-withrbac-binding`, `check-orgaccess-binding`.
- `check-secrets`.
- `check-constant-time-secrets`: `KNOWN_OPEN` empty.
- `check:route-policy`.
- `check-membership-validity`.
- `check-auth-integrity-invariants`.
- `check:governance-docs`, `governance:verify-baseline:reports`.
- `run-gate-tests`: 15 suites / 349 tests.

**Full unit regression** against base `f44b1387` (same invocation as the baseline):
- Base: 1,711 suites / 22,889 tests, 58 failing.
- Branch: 1,787 suites / 24,394 tests.
- 5 tests failed on the branch that pass on base:
  - 3 in `membershipValidityDetector001`: a ledger line moved when W2-E edited `access/request.ts`. The ledger was re-pointed and the suite now passes 25/25.
  - 2 performance-bound tests (`companyRepresentativeTenantParity` U4B.3, `contentArchitectConsumer` U3·C2) failed under concurrent external CPU load. Both suites pass on re-run (9/9, 10/10).
- 0 new suite-level errors.
- The 8 "absent" tests are the renamed super-admin characterization tests (owner decision A2-a).

**Integration regression** against base:
- 900 tests; base 51 failing, branch 45; 8 tests fixed relative to base.
- 2 tests newly failed (`campaign_ai_plan_theme_to_weekly_simulation`). The cause was an incomplete fixture: the partial `rbacService` mock and a missing `companies` row, both exposed by the W2A-5a/W2G-4 company-status check. Both tests now pass after a fixture-only fix (no assertion changed).

**TypeScript:**
- `typecheck:ci` 0/0.
- Worker `tsc`: exit 0.
- `typecheck-certification`: backend 0/0, backend-tests 260/260 baseline. The first run found 3 net-new TS2556 errors, all in the integration N1/N2 test's mocks; they were fixed (`f0e21b0`) and it passes.

**PR #245 protections:**
- The `routeAuth001*` suites pass in the full run.
- The dormant-route pins (`sec91FDormantRoutes`, 41) pass.
- The route gate still enforces R1–R4 plus R1-METHOD and R4-ENV.

**Production unchanged:**
- `main` and the live build report `f44b13875a8ce60da575197c516fa75bca946d4b` (GitHub API, and `GET /api/health/version` on production).
- 0 files changed under `supabase/`.
- No env/secret change, no deploy, no rotation.
- Config-type files touched: the CI workflow, `Dockerfile.cron` (not deployed), and `config/env.schema.ts` (description text only).
