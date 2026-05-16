# Billing Production Schema Activation — Final Status Report (Phase G)

**Date:** 2026-05-16
**Target:** production Supabase `klkiseupptzbecbxwrky` (= `.env.local` =
`.env.vercel.production`; no separate dev DB)
**Final verdict:** **HOLD GA** → **SUPERSEDED 2026-05-16: schema applied;
now READY FOR LIMITED GA** — see the
[Post-Activation Update](#post-activation-update-2026-05-16) and the
live-validation addendum in
[final-enterprise-billing-certification.md](./final-enterprise-billing-certification.md).

---

## 1. Pre-migration status

The billing schema is **entirely absent** from production: **0 of 26**
billing objects exist (8 critical, 7 high, 11 medium). Direct `pg`
introspection confirms `credit_action_approvals`,
`payment_provider_events`, `billing_operations`, the 5 billing RPCs, all
billing views — none exist in any schema. `SELECT … FROM
public.credit_action_approvals` → `relation does not exist`.

The user's recurring error — *"Could not find the table
'public.credit_action_approvals' in the schema cache"* — is **real and
correct**, not a cache artefact.

> The first probe run reported "24 present / 2 missing". That was a
> **false positive** from a verification defect (below), corrected
> mid-phase. The true state is 0/26.

## 2. Applied migrations

**None.** One safe-runner apply of `20260663` was attempted against
production; it failed its dependency check (`payment_provider_events`
absent) and **rolled back atomically**. Production schema and data were
not modified. Full log: [billing-migration-execution-report.md](./billing-migration-execution-report.md).

`supabase db push` was deliberately **not** run — see §8.

## 3. Objects activated

**None.** No DDL committed.

## 4. PostgREST synchronization status

Not synchronized — there is nothing to synchronize (schema absent). A
secondary discovery: the PostgREST cache holds **phantom** entries — it
answered `head:true` count probes with success for tables that do not
exist, which is what produced the false "24 present". Real fetches
correctly return `PGRST205`.

## 5. Billing endpoint verification

Not performed against production — endpoints would (correctly) fail with
`PGRST205`/`BILLING_SCHEMA_NOT_READY` because the schema is absent.
Endpoint *logic* is unit-certified (26/26 in
`billingSchemaVerification.test.ts`).

## 6. Approval-flow verification

Not possible — `credit_action_approvals`, `credit_action_approval_signatures`,
`required_approvals_for_action`, `sign_credit_action_approval` all absent.
This is precisely the user-visible failure being investigated.

## 7. Health endpoint verification

Not exercised live (needs an authenticated FINANCE_AUDITOR session).
Logic-certified; against current production it would return HTTP 503,
`overall: critical_missing`, all readiness `false`.

## 8. Remaining operational risks

| Risk | Severity | Note |
|---|---|---|
| **Migration-ledger desync** | **Critical** | 145 migration files vs **4** recorded applied; core tables exist anyway. `supabase db push` would attempt 141 migrations over a populated production DB → conflict/corruption risk on any non-idempotent migration. Must be operator-reconciled with a backup first. |
| Billing prerequisites absent | High | `20260663` needs `payment_provider_events` (`20260625`) and the monetization chain — none vetted like the 3 billing files. |
| Production = "dev" assumption | High | Earlier work framed this as a dev DB. It is production. Any apply needs a backup + maintenance window. |
| Phantom cache entries | Medium | Mitigated in tooling (probe fixed); operationally, always reload cache after DDL and verify with `to_regclass`. |
| Prober false-positive (historical) | Resolved | Fixed + 26/26 regression tests; verification stack now trustworthy. |

## 9. Final production readiness verdict

### HOLD GA

**Rationale.** The billing application code, migrations (3 vetted
idempotent files), verification tooling (now corrected), boot validator,
health endpoint and tests are correct and production-grade. The blocker
is **not** code — it is that the **production database was never built
from this repo's migration history** (4 of 145 migrations recorded) and
the billing schema is entirely absent. Activating it safely requires a
deliberate, operator-owned database operation — ledger reconciliation +
ordered chain application against production, with a backup and
maintenance window — which must not be performed autonomously.

**This is not a regression of the billing implementation.** Once the
operator remediation below is done, re-running Phase A/E should flip to
`overall: ok` with no code changes.

### Path to GA (operator-owned)

1. **Back up production** (PITR snapshot / `pg_dump`). Non-negotiable.
2. **Reconcile the migration ledger**: `supabase migration repair
   --status applied <version>` for every migration whose objects already
   exist, so the ledger reflects reality and `db push` will target only
   genuinely-missing migrations.
3. In a **maintenance window**, apply the pending chain in version order
   (monetization prerequisites `20260625…` → billing `20260663/64/65`).
   Prefer `supabase db push` after step 2; otherwise hand-apply the
   vetted billing trio + identified prerequisites idempotently.
4. `NOTIFY pgrst, 'reload schema';` then verify with `to_regclass` that
   the cache no longer holds phantoms.
5. Re-run `npx tsx scripts/audit/verify-billing-schema.ts` (now
   trustworthy) → expect `overall: ok`, 26 present.
6. `GET /api/admin/billing/health` (FINANCE_AUDITOR) → `overall: ok`,
   all readiness `true`.
7. Execute Phase D billing-flow activation tests (grant/revoke/approval/
   freeze/ledger/portal/export/idempotency/anomaly/reconciliation).
8. Re-issue this report → expected verdict **READY FOR FULL GA**.

## 10. Work delivered this phase (in-scope, safe, complete)

- **Fixed a critical verification-integrity defect** in `probeTable`
  (head-count false-positive that masked 21 absent critical tables);
  regression-covered (26/26).
- Honest, evidence-backed reporting: corrected
  [pre-migration-schema-status.md](./pre-migration-schema-status.md),
  [billing-migration-execution-report.md](./billing-migration-execution-report.md),
  [post-migration-health-certification.md](./post-migration-health-certification.md)
  (FAIL — not certified), runbook updates
  ([postgrest-schema-remediation.md](./postgrest-schema-remediation.md)
  §7–8,
  [billing-schema-remediation.md](./billing-schema-remediation.md) §10),
  and this report.
- Production was **not** modified (the one apply attempt rolled back
  atomically).

All mandatory constraints honored: no destructive DB operations,
production data preserved, no silent schema mismatch (the masking defect
was eliminated), fail-fast on the critical gap, no TODO placeholders,
strongly typed, immutable financial history untouched.

---

## Post-Activation Update (2026-05-16)

The HOLD above is **resolved**. The operator applied the
schema-alignment prelude + activation bundle (SECTION 1–5) to production.

**Activation result**
- `verify-billing-schema.ts` → `overall: ok`, **26/26 present**, 0 missing.
- `to_regclass` confirms `credit_action_approvals`, `billing_operations`,
  `currency_exchange_rates` are real relations (not stale-cache
  phantoms); 5/5 billing RPCs present; FX identity seed = 7 rows.
- Original error *"Could not find the table
  'public.credit_action_approvals' in the schema cache"* — **resolved**.

**Two defects fixed during activation (permanent, in-repo)**
1. `action_pricing_config.updated_at` missing (needed by
   `v_pricing_catalog`) → additive prelude
   ([billing-schema-alignment-prelude.sql](./billing-schema-alignment-prelude.sql)).
2. `20260665` FX identity-seed SQL bug (`AS t` → `AS b(t)`) → fixed at
   source in the migration file.

**Live validation** — 25/25 production-safe checks + 30/30 code tests.
See the live-validation addendum in
[final-enterprise-billing-certification.md](./final-enterprise-billing-certification.md).

### Updated verdict: READY FOR LIMITED GA

Billing schema/engine certified on live production. FULL GA after the
operator-gated in-app acceptance smoke (one small grant + revoke via UI,
`GET /api/admin/billing/health` → 200/ok, one export, one reconciliation
job) — confirmations, not blockers. The repo-wide migration-ledger
desync remains a separate tracked item and does not affect billing.

**2026-05-16 hotfix + full-GA pass:** HOTFIX-001 applied (grant/revoke
unblocked); APIs normalized; terminal UX + abort-timeout shipped;
`validate-billing-live` 26/26; unit 35/35; health all-green; **zero
systemic reconciliation drift** (read-only sweep). FULL-GA gate is now
the authenticated A–H operator smoke
([billing-operator-smoke-checklist.md](./billing-operator-smoke-checklist.md))
plus a reconcile-or-accept decision on **one pre-ledger legacy org**
(`4bdbec26…`, not introduced by this work). Verdict unchanged:
**READY FOR LIMITED GA → FULL GA on operator sign-off.** Full detail:
[final-enterprise-billing-certification.md](./final-enterprise-billing-certification.md)
§8d, [billing-hotfix-001-remediation.md](./billing-hotfix-001-remediation.md).
