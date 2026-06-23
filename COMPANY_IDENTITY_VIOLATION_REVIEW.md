# COMPANY_IDENTITY_VIOLATION_REVIEW.md

Review of the 5 violation paths from COMPANY_IDENTITY_WRITE_PATH_AUDIT.md.
**Audit only — no code changes, no migrations, no fixes.**

## Evidence basis & caveat

- **Reachability** — from frontend grep (callers in `components/`, `hooks/`, `pages/`).
- **Usage / 90-day counts** — true per-route HTTP counts require APM/request logs
  (not available here). The proxy below is **DB creation-signature counts** (companies
  whose stored values match each path's write signature) over all-time and the last 90
  days (cutoff 2026-03-25), plus `company_domains.created_via` and `access_requests`.
  This counts *company-creating* invocations, not GET/no-op hits.

Empirical result (production DB, 38 companies):

| signature | all-time | last 90d |
|---|---|---|
| `*.local` website (external-apis stub) | 0 | 0 |
| `https://example.com` (complete fallback) | 0 | 0 |
| `https://<domain>` no-www + website_domain NULL + admin_email_domain set (complete work-email) | 0 | 0 |
| `domain_claimed_at` set (setup-company canonical) | 5 | 5 |
| `company_domains.created_via='admin'` (admin/create-company) | 0 | 0 |
| `access_requests` approved-with-org (access-requests/approve) | 0 | 0 |

→ **Every company in this DB was created by the canonical setup-company path.** None of
the 5 violation paths has produced a company (all-time, in this instance).

---

## 1. `pages/api/onboarding/complete.ts` — PRIORITY 1

| Question | Answer |
|---|---|
| 1. Reachable from production UI? | **Yes** — called from `/onboarding/profile` & `/onboarding/phone`; a rate-limited canonical route (`RedisEfficiencyPanel`, `canonicalApiRegistry`). |
| 2. Actively used? | **Yes as a credit/profile endpoint**; its **company-CREATE branch is dormant** — get-or-create by name finds the setup-company row first (0 companies match its create signature). |
| 3. 90-day count | Company creations: **0** (signature). Endpoint hits (credit/profile): not measured (no APM). |
| 4. Can create a company? | **Yes** (get-or-create branch, lines 187–198). |
| 5. Can modify website / website_domain / admin_email_domain? | `website` ✅ · `website_domain` ❌ (never set) · `admin_email_domain` ✅ |
| 6. Can bypass validateCompanyIdentity / claimed / duplicate? | `validateCompanyIdentity` **bypassed** ✅ · claimed-domain **bypassed** ✅ · duplicate **partial** (name `ilike` only, not domain). Does gate public-email via `checkDomainEligibility`. |
| **Disposition** | **B — Route through canonical identity model** (or remove the now-dormant create branch and require the company to already exist). It duplicates setup-company without its guards and writes placeholder websites + NULL `website_domain`. Highest priority because it is live and self-serve. |

## 2. `pages/api/admin/access-requests/approve.ts` — PRIORITY 2

| Question | Answer |
|---|---|
| 1. Reachable from production UI? | **Yes** — `pages/admin/access-requests.tsx` (admin approves). |
| 2. Actively used? | **No** — `access_requests` table is empty (0 total / 0 approved); never exercised in this DB. |
| 3. 90-day count | **0**. |
| 4. Can create a company? | **Yes** (insert, line 106). |
| 5. Can modify fields? | `website` ✅ (from user-submitted `request.website_url`) · `website_domain` ❌ · `admin_email_domain` → written `null` by design (public-email, per-email approval). |
| 6. Can bypass checks? | `validateCompanyIdentity` **bypassed** ✅ · claimed-domain **bypassed** ✅ · duplicate **not checked** (new org per approval). |
| **Disposition** | **C — Keep as admin override** (legitimate: approving a public-email user who can't self-register), **but harden**: validate/derive from `website_url`, set `website_domain`, record an override reason. Currently creates a structurally inconsistent identity. |

## 3. `pages/api/super-admin/companies.ts` (POST) — PRIORITY 3

| Question | Answer |
|---|---|
| 1. Reachable from production UI? | **Yes** — heavily (super-admin dashboard, `CompanyUsersTab`, free-credits, consumption, etc.). Most callers are GET (list); **POST create** is reachable from `CompanyUsersTab`. |
| 2. Actively used? | **Yes for listing**; POST-create usage is low/unobserved (no distinct admin-created companies found). |
| 3. 90-day count | GET: frequent (not measured). Company creations via this POST: **0** observed. |
| 4. Can create a company? | **Yes** (POST insert, line 130). PATCH only flips `status` (not an identity write). |
| 5. Can modify fields? | `website` ✅ (`normalizeWebsite(body.website)`) · `website_domain` ❌ · `admin_email_domain` ❌ |
| 6. Can bypass checks? | `validateCompanyIdentity` **bypassed** ✅ · claimed-domain **bypassed** ✅ · duplicate **partial** (`eq('website')` uniqueness only). |
| **Disposition** | **C — Keep as admin override**, but harden to derive `website_domain` (and record override) so it never leaves both domain columns NULL. Already covered by Phase-10 drift telemetry (detection), so drift here is at least visible. |

## 4. `pages/api/admin/create-company.ts` — PRIORITY 4

| Question | Answer |
|---|---|
| 1. Reachable from production UI? | **No** — no frontend caller found (only the route file). API/script-only, SUPER_ADMIN-gated. |
| 2. Actively used? | **No** — `company_domains.created_via='admin'` = 0 (this route's signature); never used. |
| 3. 90-day count | **0**. |
| 4. Can create a company? | **Yes** (insert, line 87) + `company_domains` via `saveDomainRecord`. |
| 5. Can modify fields? | `website` ✅ · `website_domain` ✅ (parsed from input) · `admin_email_domain` ❌ |
| 6. Can bypass checks? | `validateCompanyIdentity` **bypassed** ✅ · claimed-domain **bypassed** (admin asserts `verification_status:'verified'`) ✅ · duplicate **checked** against `company_domains.final_domain`. |
| **Disposition** | **A — Remove entirely** (unreachable from UI + 0 usage, superseded by super-admin/companies and setup-company). If a programmatic admin-create is still wanted, consolidate into one canonical admin writer instead of a second divergent path. |

## 5. `pages/api/external-apis/access.ts` (FK stub) — PRIORITY 5

| Question | Answer |
|---|---|
| 1. Reachable from production UI? | **Yes** — external-APIs feature hooks (`useExtApisAccess`, `useExternalApisState`, etc.). But the **company-create branch is defensive** (only when the `companies` row is missing for an existing `companyId`). |
| 2. Actively used? | Endpoint: yes. **Stub-create branch: no** — 0 `*.local` companies exist. |
| 3. 90-day count | Stub creations: **0**. |
| 4. Can create a company? | **Yes** (defensive `upsert`, line 383) — but only a stub for an already-known `companyId`. |
| 5. Can modify fields? | `website` ✅ (synthetic `https://company-<id>.local`) · `website_domain` ❌ · `admin_email_domain` ❌ |
| 6. Can bypass checks? | All **bypassed** ✅ (it is an FK-ensure stub, not an identity creator). |
| **Disposition** | **D — Keep as operational system path** (defensive FK guard), **but harden**: stop writing an invalid `.local` website (use the profile name / a NULL-safe minimal row) so it can't seed drift. The company it ensures should already exist via the canonical path. |

---

## Disposition summary

| # | Path | Reachable | Used (creates) | 90d creations | Disposition |
|---|---|---|---|---|---|
| 1 | onboarding/complete.ts | Yes | Dormant create branch | 0 | **B — route through canonical** (or remove create branch) |
| 2 | access-requests/approve.ts | Yes (admin) | No | 0 | **C — admin override (harden)** |
| 3 | super-admin/companies.ts | Yes (admin) | Low/none | 0 | **C — admin override (harden)** |
| 4 | admin/create-company.ts | No | No | 0 | **A — remove entirely** |
| 5 | external-apis/access.ts | Yes (feature) | No (stub) | 0 | **D — operational (harden placeholder)** |

## Bottom line

All 5 violation paths exist in code but are **empirically inert for company creation**
in this database — the canonical setup-company path created every company. Risk is
**latent, not active**: any of these could mint or mutate an unvalidated identity if
exercised. Priority order for remediation matches the prompt — `onboarding/complete`
first (live, self-serve, bypasses the most), then the admin/override and operational
paths. No changes were made.
