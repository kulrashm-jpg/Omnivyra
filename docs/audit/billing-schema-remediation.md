# Billing Schema Remediation Report (Phase H)

Final report for the **Supabase Billing Migration + Schema Verification**
work. This is a verification / hardening effort, **not a redesign** — no
billing architecture, table shape, or RPC contract was changed. The work
adds detection, safe remediation, fail-fast at boot, an operator health
surface, and tests, so the failure the user hit can never again present
as a silent hang.

---

## 1. Root cause

The user repeatedly hit, after a long "Submitting…" hang on a credit
action:

```
Could not find the table 'public.credit_action_approvals' in the schema cache
```

**This was never a code bug.** Migrations `20260663`, `20260664`,
`20260665` exist as files in `supabase/migrations/` but were **never
applied to the user's dev database** (`npm run db:push` / `supabase db
push` was not run there). The billing endpoints called PostgREST, which
404'd the missing table; the UI had no fail-fast, so it hung on
"Submitting…" until the raw PostgREST error surfaced.

Two distinct failure modes share this symptom and have **opposite fixes**:

| Symptom | Postgres/PostgREST signal | Root cause | Fix |
|---|---|---|---|
| Object never created | `42P01 relation … does not exist` | migrations not applied to this DB | apply migrations **then** reload cache |
| Object exists, API 404s it | `PGRST205` / `PGRST202`, "schema cache" | stale PostgREST schema cache after DDL | reload cache only (`NOTIFY pgrst, 'reload schema'`) |

The new tooling **classifies** which one you have instead of guessing.

---

## 2. Missing objects (as specified — actual set is environment-dependent)

The authoritative, per-migration object inventory is in
[`billing-schema-inventory.md`](./billing-schema-inventory.md) and the
machine-readable spec
[`billingSchemaSpec.ts`](../../backend/services/billing/bootstrap/billingSchemaSpec.ts)
(21 tables/views, 7 RPCs, 5 opaque trigger/index groups).

The CRITICAL objects whose absence produced the user's error:

- `credit_action_approvals`, `credit_action_approval_signatures`,
  `credit_action_approval_thresholds` (approval chain)
- `billing_operations` (orchestrator / reconciliation)
- `job_execution_registry` (queue exactly-once)
- RPCs `sign_credit_action_approval`, `required_approvals_for_action`,
  `claim_job_execution`, `advance_job_execution`
- `credit_transactions` immutability triggers

The exact missing set for a given database is produced on demand by:

```bash
npx tsx scripts/audit/verify-billing-schema.ts
# or  GET /api/admin/billing/health  →  .missingObjects
```

> Applying the migrations is an **operator action** (it requires DB
> credentials and writes to the user's Supabase). It is not performed by
> this codebase change. The tooling detects the gap, applies safely when
> the operator runs it with a direct DB URL, and fails fast everywhere
> else.

---

## 3. Verification results (this change)

| Check | Result |
|---|---|
| New/changed file typecheck (`tsc --noEmit`) | clean (no errors in `billing/health.ts`, `billingSchemaSpec.ts`, `billingBootstrapValidator.ts`, `billingSchemaVerification.test.ts`) |
| `backend/tests/unit/billingSchemaVerification.test.ts` | **26 / 26 passing** |
| `backend/tests/unit/billingAlertCounts.test.ts` | passing (unchanged, re-confirmed) |
| Destructive-DDL scan of `20260663/64/65` | none (no DROP TABLE / TRUNCATE / DELETE FROM / DROP COLUMN / DROP SCHEMA) |
| RLS / GRANT / REVOKE in billing migrations | none (service-role + app-layer isolation, by design) |
| Idempotency of migrations | confirmed (`IF NOT EXISTS` / `OR REPLACE` / `DROP TRIGGER IF EXISTS … CREATE`) |

Test coverage breakdown (Phase G):

- missing-table detection — `PGRST205` schema-cache **and** `42P01`
  "does not exist" both → `missing`
- present detection — no error → `present`; non-fatal RLS/perm error →
  `present` (object resolved)
- read-only RPC live-probed; mutating RPC **not called**, inferred from
  sibling critical table (asserted `supabase.rpc` never invoked)
- opaque trigger/index inference + `verifySql` passthrough
- partial-migration detection (same migration: present + missing)
- migration dependency order fixed (`20260663 → 64 → 65`)
- bootstrap validator: process-cache, critical-missing classification,
  `assertBillingSchemaReady` → `503 BILLING_SCHEMA_NOT_READY`,
  connection-refused → `degraded` (not false `critical_missing`), hard
  build failure → `probe_unavailable`
- health endpoint: 405 / 403 RBAC / 200 healthy / 503 degraded /
  cache-miss vs genuinely-missing discrimination / partial-migration
  surfaced as `state:"partial"` / `probe_unavailable`

---

## 4. Schema synchronization status

No schema was modified by this change. Synchronization between
environments is now **observable and reconcilable** rather than silent:

- run `verify-billing-schema.ts` (or `GET /api/admin/billing/health`)
  per environment and compare counts + partial-migration report
  (procedure: [`postgrest-schema-remediation.md` §4](./postgrest-schema-remediation.md)).
- reconcile a lagging environment **only** by applying the missing
  migrations via the safe runner / `db:push` — never by hand-patching.

Current operator action still required on the user's dev DB: apply the
three migrations (see §8).

---

## 5. PostgREST cache guidance

Full runbook: [`postgrest-schema-remediation.md`](./postgrest-schema-remediation.md).
Key points:

- After **any** DDL apply, the cache is stale by definition — reload it
  (`NOTIFY pgrst, 'reload schema';`, zero-downtime) or restart the
  Supabase API. Skipping this reproduces the exact `PGRST205` symptom and
  looks like "the fix didn't work".
- The health endpoint classifies the failure: `readiness.postgrest`
  reports `schemaCacheMissCount` vs `genuinelyMissingCount` and prints
  the matching remediation (reload-only vs apply-then-reload).

---

## 6. Bootstrap additions

`backend/services/billing/bootstrap/billingBootstrapValidator.ts`
(Phase E) — runs once per process, process-cached
(`resetBillingBootstrapCache()` for tests), concurrent first callers
share one probe (`inflight`).

- **DEV**: loud, unmissable `console.error` block naming the missing
  objects and the exact migrations to run.
- **PROD**: structured `logger.error('billing_bootstrap_critical_missing')`
  + degraded health; **does not `process.exit()`** — a billing-only
  schema gap must not take down unrelated app functionality.
- DB unreachable at boot → `probe_unavailable` (distinct from
  schema-missing) — boot is not blocked.
- `assertBillingSchemaReady()` lets billing endpoints short-circuit with
  a clean `503 { code: 'BILLING_SCHEMA_NOT_READY', remediation }`
  instead of hanging on a PostgREST cache miss — this is the direct fix
  for the user's "Submitting…" hang.

All four consumers (CI guard, safe runner, boot validator, health
endpoint) share the **single** prober
`billingSchemaSpec.buildBillingSchemaReport()` — no drift between what CI
checks and what the app reports.

---

## 7. Health endpoint additions

`pages/api/admin/billing/health.ts` (Phase F) —
`GET`, FINANCE_AUDITOR-gated, read-only, **zero mutation** (mutating RPCs
inferred, never called). Returns in one call:

- `status` — overall `ok | degraded | critical_missing` + counts;
  HTTP **200 when ok, 503 otherwise** (a probe/LB treats a billing gap
  as degraded without parsing the body).
- `migrations` — per-migration `applied | partial | missing | unknown`.
- `missingObjects` — exact `{object, kind, severity, migration}` list.
- `triggers` — opaque trigger/index status + `verifySql` for definitive
  manual checks.
- `readiness.{reconciliation, approvals, postgrest, rollout}` —
  subsystem-level green/red with the precise blocking objects, plus
  cache-miss-vs-unmigrated classification and remediation text.
- `bootstrap` — the cached boot-validator view (same state startup saw).

---

## 8. Remaining operational actions

These require DB credentials / write access to the user's Supabase and
are **not** performed by this code change:

1. **Apply the billing migrations to the dev DB** (root-cause fix):

   ```bash
   npx tsx scripts/audit/run-billing-migrations.ts --dry-run
   SUPABASE_DB_URL="postgres://…:5432/postgres" \
     npx tsx scripts/audit/run-billing-migrations.ts
   # or:  npm run db:push
   ```

2. **Reload the PostgREST schema cache** (mandatory after step 1):

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

3. **Verify**:

   ```bash
   npx tsx scripts/audit/verify-billing-schema.ts          # → OK
   curl -s "$APP_URL/api/admin/billing/health" | jq '.status,.readiness'
   ```

   Expect `status.overall: "ok"`, all `readiness.*.ready: true`, all
   `migrations[].state: "applied"`, boot log `billing_bootstrap_ok`.

4. **Retry the original credit action** — it must complete without the
   "Submitting…" hang or the schema-cache error.

5. **CI**: wire `STRICT_BILLING_SCHEMA=true npx tsx
   scripts/audit/verify-billing-schema.ts` into the deploy pipeline (set
   `SKIP_BILLING_SCHEMA_CHECK=true` only in credential-less CI) so a
   future missing-migration is caught before release, not by a user.

---

## 9. Constraints honored

No destructive migrations · production data preserved · idempotent only ·
strongly typed · no TODO placeholders · no silent schema mismatch
(`unverified` never treated as present) · no cross-org leakage
(FINANCE_AUDITOR gate, read-only) · immutable financial history preserved
(no trigger reversed) · no client-side billing authority · no fake
projections · rollback-safe (additive, dormant-safe via feature flags) ·
billing architecture preserved (verification only, no redesign) ·
fail-fast on missing critical schema · RBAC + org isolation preserved.

---

## 10. Update — production activation attempt (2026-05-16)

Activation against production (`klkiseupptzbecbxwrky`) surfaced two facts
that supersede §2's earlier framing:

1. **The prober had a false-positive defect.** A `head:true` count probe
   returned `error: null` for absent tables (stale-cache phantom). Fixed
   in `probeTable` (relation-touching `select('*').limit(1)`); 26/26
   regression tests green. Corrected verification shows **0/26 billing
   objects present** — the schema is entirely absent, not a 2-RPC gap.
   See [postgrest-schema-remediation.md §7](./postgrest-schema-remediation.md).

2. **Migration-ledger desync.** 145 migration files, **4** recorded
   applied; core non-billing tables nonetheless exist. `supabase db push`
   is therefore unsafe (it would attempt 141 migrations over a populated
   production DB). Ledger reconciliation by an operator is a hard
   precondition. See
   [postgrest-schema-remediation.md §8](./postgrest-schema-remediation.md)
   and [billing-migration-execution-report.md](./billing-migration-execution-report.md).

The Phase B safe-runner attempt rolled back atomically on the missing
`payment_provider_events` prerequisite — production was not modified.

**Net:** the billing *code and verification stack* are correct and now
trustworthy; the *production database* requires operator-driven migration
reconciliation before billing can be activated. Verdict: **HOLD GA**
(full rationale + plan in
[billing-production-schema-activation.md](./billing-production-schema-activation.md)).
