# COMPANY_IDENTITY_WRITE_PATH_AUDIT.md

Final governance audit of every code path that writes `companies.website`,
`companies.website_domain`, or `companies.admin_email_domain`. **Audit only — no
code changes.**

Canonical identity model = `validateCompanyIdentity()` at signup → verdict persisted
on the signup intent → consumed by `resolveValidatedWebsite()` at creation
(setup-company). A write is **SAFE** only when its values originate from that
validated identity.

## Headline

Of **6** runtime write paths to the identity columns, **only 1** (`setup-company`)
flows through the canonical identity model. **5 paths bypass it** — they write
`website` / `website_domain` / `admin_email_domain` from user input, admin override,
access-request data, or synthetic placeholders **without identity validation**.

| Classification | Count |
|---|---|
| SAFE | 1 |
| VIOLATION | 5 |
| REVIEW_REQUIRED (operational / historical) | 3 |

---

## Write paths

### ✅ SAFE

| File | Function | Write op | Trigger | Source of values |
|---|---|---|---|---|
| [pages/api/onboarding/setup-company.ts:450](pages/api/onboarding/setup-company.ts#L450) | `handler` | `companies.insert` (`website`, `website_domain`, `admin_email_domain`, `domain_claimed_at`) | self-serve onboarding `POST /api/onboarding/setup-company` | **Validated identity.** `website` = `resolveValidatedWebsite()` (signup-validated intent → email-derived fallback); `website_domain` = `extractDomain(canonicalWebsite)`; `admin_email_domain` = `extractDomain(user.email)`. Drift telemetry also runs here. |

> Note: `setup-company.ts` lines 557 / 646 / 647 write `website_domain` inside the
> `company_profiles.report_settings` JSON, not the `companies` identity columns — not
> a governance surface.

### ⛔ VIOLATION

| File | Function | Write op | Trigger | Source of values | Why |
|---|---|---|---|---|---|
| [pages/api/onboarding/complete.ts:190](pages/api/onboarding/complete.ts#L190) | `handler` | `companies.insert` (`website`, `admin_email_domain`) | `POST /api/onboarding/complete` (work-email path) | `website = https://${emailDomain}` **or `https://example.com`** fallback; `admin_email_domain = emailDomain`; **no `website_domain`** | Parallel self-serve creation that bypasses `validateCompanyIdentity` entirely — no live-website / canonical / forwarding / claimed / free-email checks, weak name-based dedup, writes a placeholder website, and leaves `website_domain` NULL (instant drift). |
| [pages/api/admin/create-company.ts:87](pages/api/admin/create-company.ts#L87) | `handler` | `companies.insert` (`website`, `website_domain`) | `POST /api/admin/create-company` (SUPER_ADMIN) | `website` = `body.website`; `website_domain` = `domainList[0]` parsed from `body.website`/`body.domains`; **no `admin_email_domain`** | Admin override. Values from admin user input; admin "asserts" the domain (`verification_status:'verified'`) with no `validateCompanyIdentity` / `resolveDomain`. |
| [pages/api/super-admin/companies.ts:130](pages/api/super-admin/companies.ts#L130) | `handler` POST | `companies.insert` (`website`) | super-admin dashboard `POST /api/super-admin/companies` | `website` = `normalizeWebsite(body.website)`; **no `website_domain`, no `admin_email_domain`** | Admin override from user input; only string normalization, no identity validation. Leaves both domain columns NULL → drift. (Drift telemetry now *observes* this — detection, not validation.) |
| [pages/api/admin/access-requests/approve.ts:106](pages/api/admin/access-requests/approve.ts#L106) | `handler` | `companies.insert` (`website`, `admin_email_domain:null`) | admin approves an access request | `website` = `request.website_url` (**user-submitted** in the access-request form); `admin_email_domain` = `null`; no `website_domain` | Admin override + user-supplied website with no identity validation; inconsistent identity by construction. |
| [pages/api/external-apis/access.ts:383](pages/api/external-apis/access.ts#L383) | `handler` POST | `companies.upsert` (`website`) | external-apis access when the `companies` row is missing (FK guard) | `website = https://company-${companyId}.local` (**synthetic placeholder**); no domains | Background/defensive stub writes an invalid `.local` website with no domains and no validation. |

### ⚠️ REVIEW_REQUIRED (operational / historical — not runtime request paths)

| File | Function | Write op | Trigger | Source of values | Note |
|---|---|---|---|---|---|
| [scripts/backfill-company-identity-10c.ts](scripts/backfill-company-identity-10c.ts) | `main` | `companies.update` (`website`, `website_domain`) | manual operator run | values from prior audits, hard-coded allowlist, 5 guards, idempotent compare-and-set | Controlled & human-approved; bypasses runtime validation by design but is guarded. Keep operator-gated. |
| [scripts/backfill-company-website.ts](scripts/backfill-company-website.ts) | `main` | `companies.update` (`website`) | manual operator run | approved allowlist + guards | Superseded by 10C; same controlled posture. |
| `supabase/migrations/20260321_*.sql`, `20260325_*.sql` | migration | `companies.update website_domain` | one-time migration | derived from existing `companies.website` (regex), not validated identity | Historical, already applied; future migrations touching these columns should be flagged. |

---

## Risk analysis

- **The governance refactor (Phases 1–9) secured exactly one path** — signup →
  `setup-company`. Every other creation path predates or sidesteps it.
- **`onboarding/complete.ts` is the most severe**: a fully parallel, unauthenticated-
  to-the-identity-model self-serve creation path that can mint companies with
  placeholder/`example.com` websites and NULL `website_domain`. If reachable from the
  current client, it defeats the entire canonical model.
- **Admin paths** (`admin/create-company`, `super-admin/companies`,
  `access-requests/approve`) trust admin/user input and routinely leave one or both
  domain columns NULL — the exact drift the Phase-10 telemetry now detects but does
  not prevent.
- **`external-apis/access.ts`** writes a structurally invalid website (`.local`).
- Drift **telemetry** covers only `setup-company` (A) and `super-admin/companies` (C);
  the other 3 violations are currently **unmonitored**.

## Recommendation (not implemented — audit only)

Route every `companies` identity write through a single guarded writer that calls /
consumes the canonical identity model (or, for admin overrides, records an explicit
override reason + still derives `website_domain` so rows are never half-populated).
At minimum, extend the Phase-10 drift monitor to the 4 unmonitored write paths so no
identity write is silent. No changes made in this audit.
