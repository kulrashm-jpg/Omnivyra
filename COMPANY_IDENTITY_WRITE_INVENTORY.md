# COMPANY_IDENTITY_WRITE_INVENTORY.md

Phase 11A · Phase 1 — every runtime write touching `companies.website`,
`companies.website_domain`, or `companies.admin_email_domain`. (Reads excluded.)

## Runtime write paths (application routes)

| # | File | Function | Operation | Kind | Columns written | Caller |
|---|---|---|---|---|---|---|
| 1 | [pages/api/onboarding/setup-company.ts:450](pages/api/onboarding/setup-company.ts#L450) | `handler` | `companies.insert` | create | `website`, `website_domain`, `admin_email_domain` | `POST /api/onboarding/setup-company` ← `/onboarding/company` (company.tsx) — **canonical, live** |
| 2 | [pages/api/onboarding/complete.ts:188](pages/api/onboarding/complete.ts#L188) | `handler` | `companies.insert` | create | `website`, `admin_email_domain` (no `website_domain`) | **none** — no UI/API caller (dormant; direct-API only) |
| 3 | [pages/api/admin/create-company.ts:87](pages/api/admin/create-company.ts#L87) | `handler` | `companies.insert` | create | `website`, `website_domain` (no `admin_email_domain`) | **none from UI** — SUPER_ADMIN API only; 0 usage |
| 4 | [pages/api/super-admin/companies.ts:130](pages/api/super-admin/companies.ts#L130) | `handler` (POST) | `companies.insert` | create | `website` (no `website_domain`/`admin_email_domain`) | super-admin dashboard (`CompanyUsersTab` POST) — **live (admin)** |
| 5 | [pages/api/admin/access-requests/approve.ts:106](pages/api/admin/access-requests/approve.ts#L106) | `handler` | `companies.insert` | create | `website`, `admin_email_domain:null` (no `website_domain`) | `pages/admin/access-requests.tsx` (admin approve) — live, unused (0 requests) |
| 6 | [pages/api/external-apis/access.ts:383](pages/api/external-apis/access.ts#L383) | `handler` (POST) | `companies.upsert` | create (FK stub) | `website` (synthetic `.local`) | external-APIs hooks — defensive stub branch (0 stub rows) |
| — | [pages/api/super-admin/companies.ts:251](pages/api/super-admin/companies.ts#L251) | `handler` (PATCH) | `companies.update` | update | `status` only | **not an identity write** (listed for completeness) |

## Operational / historical writes (not request paths)

| File | Operation | Kind | Columns | Trigger |
|---|---|---|---|---|
| [scripts/backfill-company-identity-10c.ts](scripts/backfill-company-identity-10c.ts) | `companies.update` | update | `website`, `website_domain` | manual operator run (guarded allowlist) |
| [scripts/backfill-company-website.ts](scripts/backfill-company-website.ts) | `companies.update` | update | `website` | manual operator run (superseded) |
| `supabase/migrations/20260321_*.sql`, `20260325_*.sql` | `UPDATE` | update | `website_domain` | one-time migration (derived from `website`) |

## Notes
- `setup-company.ts` lines 557 / 646 / 647 write `website_domain` inside the
  `company_profiles.report_settings` JSON — **not** the `companies` identity columns
  (not a governance surface).
- Only path #1 currently produces an internally consistent identity triple. Paths
  #2–#6 each omit at least one column → the partial-write drift the Phase-11A writer
  is designed to prevent. (Empirically, paths #2–#6 have created 0 companies.)
