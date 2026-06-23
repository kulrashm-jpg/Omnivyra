# DOMAIN_GOVERNANCE_MATRIX.md

Phase 1 inventory for the Signup Domain Governance refactor. Every code path involved in
signup, onboarding, setup-company, and domain/website/eligibility/canonical/forwarding/
company-matching validation. **No code has been changed.** Keep / Modify / Remove columns
are *proposals* pending the design decisions noted at the bottom.

Legend — Current Status: ✅ active · ⚠️ active-but-duplicated · 💤 dead/disabled

---

## A. Signup gate (pre-account-creation)

| File | Function | Purpose | Current Status | Keep | Modify | Remove |
|---|---|---|---|---|---|---|
| pages/api/auth/signup.ts | `handler` | Pre-signup gate run **before** client calls `supabase.auth.signUp`. Eligibility, ACCOUNT_EXISTS/RESUME_SIGNUP, orphaned auth.users, CLAIMED_DOMAIN, upsert `signup_intents`. Returns `{proceed:true}`. Accepts body `{email, companyName}` only — **no website field**. | ✅ | | ✅ becomes the authoritative `validateCompanyIdentity` call site; add website-existence + domain-match + persist verdict to `signup_intents` | |
| pages/api/auth/signup.ts | `maskEmail` | Mask admin email for CLAIMED_DOMAIN screen | ✅ | ✅ | | |
| pages/api/auth/signup.ts | eligibility try/catch (L86–96) | On eligibility error, **logs and proceeds** (fail-open) | ✅ | | ✅ must fail-closed → manual-review queue (Phase 5) | |
| *client signup form* (renders email+companyName, POSTs `/api/auth/signup`, then `supabase.auth.signUp`) | — | Collects signup input | ✅ | | ✅ add website input **iff** decision D2 = "user-entered website" | |

## B. Post-verification sync (creates public.users)

| File | Function | Purpose | Current Status | Keep | Modify | Remove |
|---|---|---|---|---|---|---|
| pages/api/auth/sync-supabase-user.ts | `handler` | Creates/updates `public.users` after email verify; MFA gate; session mint; credit reconcile | ✅ | ✅ | ✅ promote `signup_intents.validated_*` → `users`/`companies` (system-of-record, Phase 6) | |
| sync-supabase-user.ts | `validateWorkEmail` use (L174–178) | **Skips** work-email block for invited users | ✅ | ✅ (this is the invite carve-out — see decision D1) | | |
| sync-supabase-user.ts | `bootstrapCompanyFromSignupIntent` | Auto-create company from intent | 💤 disabled (logs + returns ok) | | ✅ candidate home for post-verify company creation if creation moves out of setup-company | |
| sync-supabase-user.ts | `tryFlipInvitedToActive` | invited→active lifecycle | ✅ | ✅ | | |
| sync-supabase-user.ts | `reconcileInitialFreeCreditForUser` | self-heal credit grant | ✅ | ✅ | | |
| sync-supabase-user.ts | `notifyAdminAndProspectOfClaimedDomain` (local copy) | claimed-domain emails | ⚠️ duplicate of shared service | | ✅ collapse onto `claimedDomainNotifyService` | |

## C. Onboarding UI + preview

| File | Function | Purpose | Current Status | Keep | Modify | Remove |
|---|---|---|---|---|---|---|
| pages/onboarding/company.tsx | `deriveWebsiteFromEmail` | Client re-derives `www.<emailDomain>` | ⚠️ re-derivation | | | ✅ replace with read of `validated_website_url` |
| pages/onboarding/company.tsx | `guessCompanyName` | Guess name from URL | ✅ | ✅ | | |
| pages/onboarding/company.tsx | `normaliseUrl` | Prefix `https://` | ⚠️ | | | ✅ once website is read-only |
| pages/onboarding/company.tsx | `CompanySetupPage` (website prefill / `readOnly` / hidden-when-empty L455–481, 127–134) | Renders website field | ⚠️ business logic in UI | | ✅ website becomes display-only from validated identity; never hidden | |
| pages/onboarding/company.tsx | `handleWebsiteNext` (L213–243) | Client-side public-website validation (mirror of `validatePublicWebsite`) | ⚠️ duplicate validation | | | ✅ remove (validation owned by signup) |
| pages/api/onboarding/company-domain-check.ts | `handler` | Preview "company already exists" by email domain | ✅ | ✅ (read-only preview, no decision) | | |

## D. Company creation (setup-company)

| File | Function | Purpose | Current Status | Keep | Modify | Remove |
|---|---|---|---|---|---|---|
| pages/api/onboarding/setup-company.ts | `handler` | Create `companies` + admin role + profile + credits | ✅ | ✅ (creation stays) | ✅ strip legitimacy re-validation | |
| setup-company.ts | `validatePublicWebsite(canonicalWebsite)` (L180–183) | Website shape check | ⚠️ duplicate of signup | | | ✅ remove (Phase 8) |
| setup-company.ts | `checkDomainEligibility` re-run (L186–190) | Re-run eligibility | ⚠️ duplicate | | | ✅ remove (Phase 8) |
| setup-company.ts | PUBLIC_EMAIL → invite/access-request branch (L194–292) | Public-email teammates join via invite/approved request | ✅ **critical** | ✅ (this is the invite path — D1) | | |
| setup-company.ts | `resolveDomain` Rule 4 canonical/forwarding probe (L463–532) | Live-website + canonical + forwarding gate | ✅ **the late blocker** | | | ✅ remove (moves to signup, Phase 8) |
| setup-company.ts | existing membership / `findMatchingCompany` / domain-first lookup / 23505 race (L304–453, 547–580) | Idempotency + duplicate-org + race protection | ✅ | ✅ (Phase 8 explicitly keeps these) | | |
| setup-company.ts | `deriveWebsiteFromEmail` / `fetchAdminName` / `notifyClaimedDomain` | helpers | ⚠️/✅ | partial | ✅ consume validated identity instead of re-deriving | |
| setup-company.ts | `grantInitialFreeCredit`, role insert, profile upsert, referral | side effects | ✅ | ✅ | | |

## E. Domain / website / eligibility services

| File | Function | Purpose | Current Status | Keep | Modify | Remove |
|---|---|---|---|---|---|---|
| backend/services/domainEligibilityService.ts | `checkDomainEligibility` | Email-stage engine: override→whitelist→cache→blocked→pattern→public→disposable→MX→forwarding-MX | ✅ | ✅ becomes a **step** inside `validateCompanyIdentity` (A+B+G) | | |
| domainEligibilityService.ts | `checkMxRecords` | MX + forwarding-MX detect | ✅ | ✅ | | |
| domainEligibilityService.ts | cache helpers (`getCachedResult`/`setCachedResult`/`normalizeStoredResult`/`invalidateDomainCache`) | 24h `domain_eligibility_cache` | ✅ | ✅ | | |
| backend/services/domainCanonicalService.ts | `resolveDomain` | HTTPS/HTTP probe, redirect chain, SSRF, forwarding | ✅ | ✅ becomes the **website-existence/reachability/canonical step** (C+D+F) of `validateCompanyIdentity` | | |
| domainCanonicalService.ts | `normalizeDomain`, `registrableRoot` | normalization | ✅ | ✅ reuse as basis for `normalizeCompanyDomain` (Phase 3) | | |
| domainCanonicalService.ts | `classifyHost`/`followChain`/`SafeAgent`/SSRF | hardened fetch | ✅ | ✅ | | |
| backend/services/companyMatchService.ts | `extractDomain` | domain from email/URL (strips www) | ✅ | ✅ | | |
| companyMatchService.ts | `isFreeEmailDomain` (`FREE_EMAIL_DOMAINS`, 23) | free-provider set | ⚠️ **list #3** | | ✅ consolidate to one list | |
| companyMatchService.ts | `validatePublicWebsite` | website shape | ✅ | ✅ (used by signup engine) | | |
| companyMatchService.ts | `findMatchingCompany` / `getCompanyAdmins` / `notifyCompanyAdminsOfSelfJoin` / `normaliseName` | company matching | ✅ | ✅ (G — existing-company check) | | |
| lib/auth/domainEligibilityModel.ts | result codes, `ELIGIBILITY_MESSAGES`, `httpStatusFor`, `eligibleResults`, `reviewableResults` | SSOT vocabulary/copy | ✅ | ✅ extend with new codes (NO_WEBSITE_FOUND, DOMAIN_MISMATCH) | | |
| lib/auth/serverValidation.ts | `isPersonalEmailDomain`, `validateWorkEmail` (`BLOCKED_DOMAINS`, 19) | personal-email block | ⚠️ **list #1** | | ✅ keep as single source; point others here | |
| lib/auth/domainValidation.ts | `validateEmailDomain`, `getBlockedDomainName` (`BLOCKED_DOMAINS`, 19) | personal-email block (pre-magic-link) | ⚠️ **list #2 (duplicate)** | | | ✅ remove or re-export from serverValidation |
| pages/onboarding/company.tsx | `FREE_DOMAINS` (14) | client personal-email set | ⚠️ **list #4 (shortest)** | | | ✅ remove once website is read-only |
| lib/auth/rateLimit.ts | `DOMAIN_RESOLUTION_LIMIT`, `EMAIL_LINK_LIMIT` | rate limits | ✅ | ✅ (rate-limit the probe at signup) | | |
| backend/services/companyMembershipIntegrityService.ts | `selectCompatibleCompanyRole`, `SELF_REGISTERED_JOIN_SOURCE` | role compatibility | ✅ | ✅ | | |
| backend/services/claimedDomainNotifyService.ts | `notifyAdminAndProspectOfClaimedDomain` | claimed-domain emails (shared) | ✅ | ✅ | | |
| backend/services/domainEventLogger.ts | `logDomainEvent` | domain telemetry | ✅ | ✅ | | |

## F. Personal-email blocklist duplication (consolidation target)

Four divergent definitions of "free/personal provider":
1. `lib/auth/serverValidation.ts` `BLOCKED_DOMAINS` — 19 entries
2. `lib/auth/domainValidation.ts` `BLOCKED_DOMAINS` — 19 entries (copy)
3. `backend/services/companyMatchService.ts` `FREE_EMAIL_DOMAINS` — 23 entries (superset)
4. `pages/onboarding/company.tsx` `FREE_DOMAINS` — 14 entries (subset; client)

→ Collapse to one server-side source consumed everywhere.

---

## OPEN DESIGN DECISIONS (block Phases 2–8)

**D1 — Invited / public-email teammates.** Today, gmail/personal-email users legitimately
sign up **as invited teammates** (`sync-supabase-user` skips work-email validation for them;
`setup-company` routes them through the invite/access-request branch). If signup becomes an
authoritative hard block on personal email (business rule #1), invited teammates can never
create accounts. → The "single authoritative flow" must still expose an invite/approved-access
bypass. This is a legitimate second path, not "dual validation."

**D2 — Website source at signup.** The signup form currently collects only `{email,
companyName}` — there is **no website field**. The DOMAIN_MISMATCH rule (`acme.in`/`acme.net`
BLOCK) only has meaning if the user enters a website that can differ from the email domain.
Two options: **(a)** add a website input to signup and validate match; or **(b)** keep deriving
`website = www.<emailDomain>` (then match is automatic and rule #4 collapses into rule #3 =
"the email domain hosts a live website"). This decides the whole shape of `validateCompanyIdentity`.

**D3 — Where company creation actually happens.** Supabase creates the auth account
**client-side**, and `public.users` is created only **after email verification** by
`sync-supabase-user`. So "create/validate at signup" really means: validate at the pre-signup
gate, persist the verdict to `signup_intents`, and create the company post-verification
(re-enable `bootstrapCompanyFromSignupIntent`, or keep creation in `setup-company` consuming the
validated identity). Literal "company created at signup" is not possible in this architecture.
