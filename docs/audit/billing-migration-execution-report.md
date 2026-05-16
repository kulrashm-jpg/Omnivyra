# Billing Migration Execution Report (Phase B)

## Summary

**One apply was attempted against production. It failed its dependency
check and rolled back cleanly. No schema or data was modified.** No
further apply was performed — investigation proved the safe runner cannot
remediate this state and that bulk `db push` is unsafe here.

## Attempt log

| Field | Value |
|---|---|
| Tool | `npx tsx scripts/audit/run-billing-migrations.ts` (safe runner) |
| Target | production (`klkiseupptzbecbxwrky.supabase.co` via `SUPABASE_DB_URL`) |
| Start | `2026-05-16T06:04:16Z` |
| End | `2026-05-16T06:04:31Z` |
| Plan | `20260663`, `20260665` (runner's pre-probe; later proven wrong by the corrected prober) |
| Migration `20260663` | `BEGIN` → execute → **`ROLLED BACK`** |
| Failure | `relation "public.payment_provider_events" does not exist` |
| Migration `20260665` | **not attempted** (runner stops — later files depend on earlier) |
| Objects created | **0** |
| Data modified | **0** (atomic per-file transaction; full rollback) |
| Verification after | re-probe → unchanged |
| Rollback notes | Automatic `ROLLBACK` on first error; per-file `BEGIN/COMMIT` guaranteed no partial application. Production untouched. |

## Why it failed (correctly)

`20260663_ledger_immutability_and_governance.sql` installs immutability
triggers on `public.payment_provider_events` near the top of the file.
That table is created by `20260625_monetization_invariant_hardening.sql`,
which has **not** been applied to production. The billing-only runner
intentionally does not apply non-billing prerequisites — it stopped and
rolled back rather than proceed in a broken order. This is correct,
safe behaviour.

## What investigation then proved

Direct read-only `pg` introspection (see
[pre-migration-schema-status.md](./pre-migration-schema-status.md)):

1. **The schema is entirely absent** — 0 of 26 billing objects exist
   (the earlier "24 present" was a probe false-positive, now fixed).
2. **`payment_provider_events` does not exist** — confirming the
   rollback reason.
3. **Migration ledger desync**: 145 migration files in the repo, only
   **4** recorded as applied (`20260321/22/23, 20260643`); 141 "pending".
   Yet `companies`, `credit_transactions` etc. exist. Production was not
   built from this migration history.

## Why no further apply was performed

| Option | Verdict |
|---|---|
| `run-billing-migrations.ts` (3 files) | **Cannot work** — prerequisites (e.g. `payment_provider_events`) are outside its scope; it correctly refuses. |
| `npm run db:push` / `supabase db push` | **Unsafe here** — the desynced ledger makes it attempt **141 migrations** over an already-populated production DB. Non-idempotent migrations among them would conflict/fail mid-run against live financial data. This is a hard-to-reverse, outward-facing production operation and was **not** executed autonomously. |
| Hand-apply the billing chain + prerequisites | Possible but pulls in unvetted monetization migrations and still requires ledger reconciliation; **operator-gated**. |

Mandatory constraints were honored: no destructive DB operations, no
silent schema mismatch (the masking defect was found and fixed),
production data preserved, fail-fast on the dependency gap, immutable
financial history untouched (nothing was applied).

## Required operator remediation (not performed here)

1. **Take a fresh production database backup / PITR snapshot.**
2. **Reconcile the migration ledger with actual schema.** The 4-entry
   ledger vs 145 files means `db push` is unusable as-is. An operator
   must baseline the migration history (`supabase migration repair` /
   mark already-present migrations as applied) so `db push` will apply
   **only** genuinely-missing migrations.
3. After reconciliation, in a maintenance window, apply the pending
   chain **in version order** (this includes the monetization
   prerequisites `20260625…` then the billing `20260663/64/65`).
4. `NOTIFY pgrst, 'reload schema';` (Phase C).
5. Re-run `verify-billing-schema.ts` (now trustworthy) and
   `GET /api/admin/billing/health` → expect `overall: ok`.
6. Run the Phase D billing-flow activation tests.

Until step 2–3 are done by an operator with a backup, **GA is HOLD**.
