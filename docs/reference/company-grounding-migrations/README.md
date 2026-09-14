# Company grounding migrations — REFERENCE ONLY (not applied, not a migration)

These six SQL files are preserved verbatim from the obsolete branch
`feat/company-profile-grounding-and-report1` (commit `72f3aebc`, CPG-001..012), which
was audited in STEP 3AH-73 and closed without merging in STEP 3AH-74.

**They are not migrations.** They live under `docs/`, so neither the migration runner,
`scripts/check-migration-quality.js` nor the real-schema replay ever reads them. Do not
copy them into `supabase/migrations/` as they are.

## Why they are kept

Main already carries the company-profile grounding code (PR #241, `d05a19ae`), including
`backend/services/companyProfile/grounding/persistence/postgresGroundingStore.ts`, which
targets these tables. Production deliberately does not set `GROUNDING_STORE_DSN`, so
`pages/api/company-grounding/[companyId].ts` uses the in-memory store and never touches
Postgres. These files are the schema that store expects if persistence is ever enabled.

| file | source blob |
|---|---|
| `20260910_company_profile_grounding_claims.sql` — creates `company_grounding_claims`, `company_grounding_fields`, `company_grounding_history` (RLS enabled, tenant-scoped policies) | `54dd16f8` |
| `20260911_company_grounding_claims_extraction.sql` | `46f5d442` |
| `20260912_company_grounding_adjudication.sql` | `fbe45185` |
| `20260913_company_grounding_identity.sql` | `200b7bac` |
| `20260914_company_grounding_registry.sql` | `d4040adb` |
| `20260915_company_grounding_registry_generic.sql` | `ce6eb04f` |

Verified in STEP 3AH-73: all six apply cleanly, in order, onto main's replayed schema
(disposable database; nothing was applied to production). None of these tables exist in
production.

## Before they can ever become real migrations

1. Re-create them under new 14-digit versions after the current ledger head (the 8-digit
   legacy names are rejected by the migration-quality gate and skipped by replay).
2. Re-review the policies against the current security model. They are tenant-scoped via
   `user_company_roles` and the application reaches them only through the server, so
   consider `service_role`-only access. The migration-quality gate's RLS and definer
   rules then apply.
3. Apply them only together with an explicit, authorized decision to set
   `GROUNDING_STORE_DSN` for the grounding endpoint.
