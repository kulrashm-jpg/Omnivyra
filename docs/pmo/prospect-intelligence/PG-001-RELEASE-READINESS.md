# PG-001 — FINAL READINESS REVIEW AND MIGRATION HANDOFF

**Read-only review. No repository file, migration, database, Git or deployment state was modified.**

Repository `C:/tmp/r1-ctx` · branch `fix/r1-profile-context` · HEAD `29fea38a2d1642c1c2fd957e5151f6be81415774`
Product: Omnivyra (Prospect Intelligence / Unified Outreach). Date: 2026-10-15.

---

## 1. Baseline verification — PASS

| Check | Result |
|---|---|
| Path / branch / HEAD | All match |
| Worktree | **91 entries (54 M / 37 ??)**, staged = 0 — matches the Batch C report |
| PG-001 file hashes (14) | All **identical** to the Batch C report, including migration `10524c866dbecfc4` and rollback `b8de4801e2cdcb93` |
| Preservation snapshots | Both present and untouched: `pg001-preservation/` (288,305 + 115,310 + 12,049 B) and `post-batch-c/` (303,771 + 123,194 + 11,472 B) |
| `C:/virality` | Not inspected, not modified. No symlink or junction followed |

---

## 2. Migration and rollback review

### 2.1 Identity and ordering

| Item | Value |
|---|---|
| Migration | `supabase/migrations/20261126000000_pg001_contact_purpose_scope.sql` (138 lines) |
| Rollback | `supabase/migrations/rollbacks/pg001_contact_purpose_scope_rollback.sql` (68 lines) |
| Hard dependency | `20261003000000_li3_contact_governance.sql` — creates `contact_governance_records` and `uq_contact_governance_identity`. The preflight `DO` block **RAISEs** if either is absent |
| Timestamp ordering | Later than every existing migration (previous latest: `20261125000000`). The repo's own gate reports no ordering violation for this file (`ordering_floor 20261026000000`) |

### 2.2 Schema objects changed — four

1. `ADD COLUMN IF NOT EXISTS purpose_scope text` (nullable, no default).
2. `CONSTRAINT contact_governance_purpose_scope_valid` — value vocabulary.
3. `CONSTRAINT contact_governance_purpose_scope_scopeable_type` — which types may be scoped.
4. `uq_contact_governance_identity` — **dropped and recreated** with the scope term. Plus a `COMMENT ON COLUMN`.

### 2.3 Index: existing vs proposed

```
EXISTING (LI-3B, 20261003000000)
  UNIQUE (organization_id, channel, governance_type,
          coalesce(person_id::text, target_normalized))
  WHERE revoked_at IS NULL

PROPOSED (20261126000000)
  UNIQUE (organization_id, channel, governance_type,
          coalesce(person_id::text, target_normalized),
          coalesce(purpose_scope, 'all'))
  WHERE revoked_at IS NULL
```

### 2.4 Does `COALESCE(purpose_scope,'all')` preserve idempotency for unlabelled rows? — PASS by source, UNVERIFIED against a live server

Yes, and this is the load-bearing choice. In a `UNIQUE` index PostgreSQL treats NULLs as **DISTINCT**, so a *bare* `purpose_scope` column would make two unlabelled rows non-colliding and destroy the replay idempotency ADR §13 depends on. The `COALESCE` form maps every unlabelled row to the single value `'all'`, so the key is **equivalent to today's** for all existing rows and a repeat insert still collides as `already_present`.

Source-level only. `UNVERIFIED` against a real PostgreSQL — no database was queried.

### 2.5 The two CHECKs

| Combination | Result |
|---|---|
| `purpose_scope IS NULL`, any `governance_type` | **ALLOWED** — both CHECKs short-circuit on NULL |
| `'outreach'` or `'account'` + `unsubscribe` / `consent_withdrawn` / `complaint` | **ALLOWED** |
| `'outreach'` or `'account'` + `dnc_permanent` / `dnc_channel` / `bounce_hard` / `invalid_contact` / `deferred` / `campaign_exclusion` | **REJECTED** by `…_scopeable_type` |
| `'all'`, `'ALL'`, `'Outreach'`, `''`, or any other string | **REJECTED** by `…_valid` — `'all'` is deliberately not storable (DR-10) |

### 2.6 Can pre-existing rows violate the new constraints? — PASS, by construction

**No.** The column is new, so every pre-existing row holds NULL, and both CHECKs permit NULL unconditionally. Independently, adding a column to a unique key can only make it **more permissive**, so no existing row can violate the new index and the rebuild cannot fail on existing data. This holds regardless of how many rows exist or what they contain — which matters, because row counts are `NOT AUTHORIZED` and none is claimed.

### 2.7 Transactionality and partial failure — PASS

The migration is wrapped `BEGIN; … COMMIT;`. PostgreSQL runs `ALTER TABLE`, `ADD CONSTRAINT`, `DROP INDEX` and `CREATE INDEX` transactionally, so a failure at any statement rolls the whole thing back: no column, no CHECKs, and **the original index restored**. There is no state in which the table is left without an identity key.

### 2.8 Does the rollback restore the previous definition? — PASS

Yes. It recreates the LI-3B index **verbatim** (anchor coalesce only, no purpose term), drops both CHECKs, then drops the column — in that order. The ordering is deliberate and documented: dropping the column first would drop the expression index with it, leaving the table with no identity key mid-transaction. Asserted by `pg001ContactPurposeContract` test 22, which requires the rollback to contain `CREATE UNIQUE INDEX uq_contact_governance_identity` and **not** contain `coalesce(purpose_scope`.

### 2.9 Rollback when narrow-scope rows exist — PASS (refuses)

A `DO $guard$` block counts `purpose_scope IS NOT NULL` and **RAISEs an exception**, aborting the rollback rather than discarding recorded decisions. Under the ratified baseline this guard never fires, because DR-1 forbids writing a narrow scope until LQ-1 — every row is NULL. The guard exists for the state *after* LQ-1.

### 2.10 Lock, availability and version assumptions

| Assumption | Detail |
|---|---|
| Lock | The `DROP INDEX` / `CREATE UNIQUE INDEX` pair takes **ACCESS EXCLUSIVE** on `contact_governance_records` for the index build. Deliberately **not** `CONCURRENTLY`, because the index must be atomic with the CHECKs in one transaction |
| Availability | During that window, reads and writes to that one table block. Duration scales with row count, which is `NOT AUTHORIZED` to determine — the operator should expect it to be brief on a small table and must not assume it |
| PostgreSQL version | **No version-specific feature used.** `COALESCE` was chosen over `NULLS NOT DISTINCT` precisely so the migration is version-agnostic (the latter needs PG15+) |
| Extensions | None required |

### 2.11 Is migration-before-deployment ordering operationally enforceable? — BLOCKED

**Documented, but not enforceable by any repository mechanism.** Repo-proven evidence:

- `vercel.json` sets `"git": { "deploymentEnabled": false }` — no git-triggered deploy.
- `Dockerfile.worker` / `Dockerfile.cron` CMDs run `node dist/...` directly; **no migration step**.
- No workflow in `.github/workflows/` pushes migrations (`grep` for `db push` / `db:push` / `psql -f migrations` returned nothing).
- The only apply path is `npm run db:push` → `scripts/operator/db/db-push.sh`, classified `SCRIPT_CLASSIFICATION: OPERATOR`, `SAFE_FOR_CI: NO`, `REQUIRES_EXPLICIT_OPERATOR_INTENT: YES`.

So **nothing stops the application being deployed before the migration is applied**, and the consequence is §3's old-schema/new-app row. Ordering must be enforced by operator procedure.

### 2.12 Retry safety — PASS functionally, with one policy violation (see D-4)

Both files are atomic, so a failed run leaves no residue and can be retried. However the forward migration's `CREATE UNIQUE INDEX` lacks `IF NOT EXISTS`, which **fails the repository's own migration-quality gate** — see the defect in §5.

---

## 3. Application / schema compatibility matrix

The new column is read in **three** queries — `contactGovernanceRepository.loadGovernanceRecords`, `…loadTenantGovernanceRecords`, and `personErasure.loadPersonAnchoredGovernance` — which sit beneath **the entire governance read surface**:

| Consumer | Path | On read failure |
|---|---|---|
| `contactGovernanceEvaluation` → `suppressionService` | **Path A** | `GovernanceStageError` → fail closed |
| `contactGovernanceEvaluation` → `governanceService` | **Path B** (live send gate) | `failClosed('governance_lookup_failed_failclosed')` |
| `prospectOutreach/readiness` | **Path C** | `readiness: 'not_ready'`, `missing: readable_suppression_state` |
| `leadIntelligenceReadService` | **Path D** export | `DISCLOSE_NOTHING` |
| `whatsappBroadcastService` | **Path D** WhatsApp | nothing in the batch is sent |
| `suppressionService` (R3-A′ release) | legacy release | fail closed |
| `personErasure` | erasure | `PersonErasureError('governance_unreadable')` — the person is **not** deleted |

The write side is **not** affected: the writer sets `purpose_scope` only when a narrow value is passed, and no caller passes one, so the INSERT payload is byte-identical to before the change.

| Database schema | Application version | Expected behaviour | Safe to serve traffic? |
|---|---|---|---|
| **Old** (no column) | **Old** | Unchanged. Current production behaviour | **YES** |
| **New** (column present) | **Old** | Old code never names `purpose_scope`; the extra column is ignored. Its writes omit the column → NULL → `coalesce` → `'all'`, so the widened index behaves exactly like the old one. **This is what makes migration-first safe** | **YES** |
| **New** | **New** | Intended state. Purpose is read and threaded; every stored scope is NULL, so every verdict is identical to today | **YES** (behaviourally neutral) |
| **Old** | **New** | PostgREST returns **`42703 undefined column`** on all three queries → `ok: false` → **every** governed send blocked, exports disclose nothing, readiness `not_ready`, erasure aborts | **NO — fail-closed outage** |

**The failure direction is safe** (nothing is sent that should not be) but it is a **total functional outage of the governed surface**, not a degradation. A schema rollback performed while the new code is still deployed produces the **identical** failure, because it recreates the old-schema/new-app combination.

**Safest rollout:** apply the migration **first** — provably safe with the old application still running (row 2) — then deploy the application.
**Safest rollback:** revert the **application first**, then the schema only if required. Reverting schema-first while new code runs is the one unsafe transition.

---

## 4. Release gates

Distinct statuses, deliberately not collapsed.

| Gate | Status | Evidence available | Missing evidence | Required action | Authorization | Blocks |
|---|---|---|---|---|---|---|
| Implementation complete | **PASS** | Batch A/B/C: 10 source files + migration + rollback; B1–B5, B7 | — | — | — | — |
| Locally verified | **PASS** | 23 suites **686/686**, exit 0; typecheck **3/3** EXIT=0; mutations **4/4 killed** | — | — | — | — |
| Migration review | **PASS with one defect** | This report §2 | — | Fix **D-4** (§5) | Source edit | local readiness |
| Repo migration-quality gate | **BLOCKED** | `npm run check:migrations` → **EXIT=1, 2 violations** | — | Fix D-4; D-5 is pre-existing and another programme's | Source edit + owner | local readiness |
| Database-backed migration certification | **NOT RUN** | — | Column, CHECKs, index definition applied against a real server | Apply in cert env | **NOT AUTHORIZED** | db migration |
| CHECK + uniqueness/idempotency verification | **UNVERIFIED** | Source reasoning (§2.4–2.6); test 22 asserts migration *text* | Real PostgreSQL behaviour; replay collision under the new key | Cert-env run | **NOT AUTHORIZED** | db migration |
| RLS and trigger verification | **UNVERIFIED** | — | Whether the rebuilt index/column interacts with existing policies | Cert-env run | **NOT AUTHORIZED** | db migration |
| Test-file typechecking | **NOT RUN** | — | Types of `backend/tests/**` | Add a tests-only tsconfig project | Source edit | local readiness (minor) |
| `lead_outreach` allow-list gap | **BLOCKED** | 4C-5A/5B: `KNOWN_TYPES` omits `lead_outreach` | — | Edge Function change + deploy | **NOT AUTHORIZED** | production verification |
| LQ-1 unsubscribe scope | **BLOCKED** | D1 audit §6 | Legal determination | Legal decision | Legal | behavioural activation |
| LQ-4 account-communication policy | **BLOCKED** | D1 audit §6; 4C-5B category 2b | Legal determination | Legal decision | Legal | behavioural activation, E2/E5 |
| Shadow evaluation | **NOT RUN** | — | — | Separate phase | **NOT AUTHORIZED** | behavioural activation |
| Runtime enforcement | **NOT RUN** | — | — | Separate phase | **NOT AUTHORIZED** (+ LQ-4) | behavioural activation |
| Legacy retirement | **NOT RUN** | DR-8/DR-9 preserve both stores | — | Separate gates | **NOT AUTHORIZED** | final release |
| Full application suite | **NOT RUN** | — | Whole-repo result | Run at the release gate | Deployment-bound | final release |
| Deployment ready | **BLOCKED** | — | Migration applied first (§2.11 unenforceable) | Operator sequence | **NOT AUTHORIZED** | app deployment |
| Behaviourally activated | **NOT RUN** | Intentionally neutral; every scope NULL | — | LQ-1 | Legal | — |
| Production verified | **NOT RUN** | — | — | — | **NOT AUTHORIZED** | final release |
| Preservation snapshot durability | **UNVERIFIED** | Two verified same-disk snapshots, reverse-check OK, 36/36 hash match | Off-machine copy | Copy ~427 KB off-machine | Operator | — |

---

## 5. Source-level defects found by this review

### D-4 — my migration fails the repository's own migration-quality gate. **Severity: medium. NOT FIXED — awaiting authorization.**

```
20261126000000_pg001_contact_purpose_scope.sql:129
  ✗ CREATE INDEX must use IF NOT EXISTS
    CREATE UNIQUE INDEX uq_contact_governance_identity
```

- **Affected path:** `supabase/migrations/20261126000000_pg001_contact_purpose_scope.sql`, line 129.
- **Why it matters:** `npm run check:migrations` exits **1**, so any pipeline or review step gated on it fails. The functional risk is low — the statement is preceded by `DROP INDEX IF EXISTS` inside one transaction, so a retry is atomic and safe — but the repo's discipline (`docs/migration-discipline.md`) requires the guard, and the rollback file carries the same pattern.
- **Smallest fix:** add `IF NOT EXISTS` to the one `CREATE UNIQUE INDEX` in the migration (line 129), and, for consistency, to the matching statement in the rollback. Two words. Note that test 22 matches on `CREATE UNIQUE INDEX uq_contact_governance_identity`, so the rollback assertion would need its regex relaxed to tolerate the inserted keywords — otherwise that test turns red.

### D-5 — pre-existing violation, **not** from PG-001. **Severity: medium. Another programme's file.**

```
20261121000000_pi_prospect_discovery_attempts.sql:67
  ✗ table public.prospect_discovery_attempts must ENABLE ROW LEVEL SECURITY
    in the same migration (authenticated is granted ALL by default)
```

This migration predates PG-001 and belongs to the PI discovery programme. **The migration-quality gate was therefore already failing on this branch before Batch A.** It is reported for completeness and is an owner decision for that programme, not something PG-001 should fix.

### Also worth recording

`scripts/operator/db/apply-migration-and-test.js` is **not** a general single-migration applier — it is hardcoded to a legacy file and prints `[schema-governance] Refusing to apply db-utils/complete-integration-migration.sql`. It must not be used for this migration. Consequently the only apply path is `supabase db push`, which is **bulk** — see the handoff warning below.

---

## 6. Operator handoff checklist — PREPARED, NOT EXECUTED

**Nothing in this checklist is currently authorized.** Database use, migration application, deployment and production verification each require separate approval. Commands are given only where verified in the repository; everything else is labelled as a procedure needing confirmation.

### 6.1 Preconditions

1. Resolve **D-4** (or accept the gate failure in writing). `npm run check:migrations` should exit 0 for the PG-001 file.
2. Copy both preservation snapshots **off-machine** (~427 KB).
3. Confirm the target by **project ref**, never by Studio project name.
4. **⚠ BULK-APPLY WARNING.** `npm run db:push` wraps `supabase db push`, which applies **every** pending migration, not just this one. At least one other unapplied migration sits in the same directory — `20261125000000_pi_relationship_evidence_detachment.sql`, which is **untracked** and belongs to the P3 programme; it sorts *before* this one and alters `source_assertions` foreign keys and constraints. A bulk push would apply it too. Enumerating exactly which migrations are pending requires reading the remote ledger, which is **NOT AUTHORIZED** here and must be established by the operator before any push. *Operator procedure requiring confirmation: determine the pending set and decide whether applying it wholesale is acceptable; if not, a single-migration path must be agreed, because the repository does not provide one.*
5. Confirm no narrow-scope rows exist (trivially true today — nothing writes them).

### 6.2 Backup and recovery evidence

*Operator procedure requiring confirmation* — the repository provides no backup command. Capture before applying: a point-in-time recovery marker or snapshot id for the target project; the current definition of `uq_contact_governance_identity`; and confirmation that `supabase/migrations/rollbacks/pg001_contact_purpose_scope_rollback.sql` is on hand.

### 6.3 Apply order

1. **Dry run first** (verified, default when no intent flag is passed):
   `npm run db:push -- --target-env=<local|staging|production>`
2. **Apply, non-production** (verified): `npm run db:push -- --target-env=local --apply`
3. **Apply, production** (verified form): `npm run db:push -- --target-env=production --apply --confirm-production-impact`
   The wrapper also recognises `--acknowledge-ledger-desync`; whether it is required depends on the target's ledger state, which is not established here.

Apply the migration **before** deploying the application (§3, row 2 is safe; row 4 is an outage).

### 6.4 Post-migration checks

*Operator procedure requiring confirmation — these are what to verify, not verified commands:*
- `purpose_scope` exists on `contact_governance_records`, type `text`, nullable, no default.
- Both CHECKs exist: `contact_governance_purpose_scope_valid`, `contact_governance_purpose_scope_scopeable_type`.
- `uq_contact_governance_identity` is unique, partial on `revoked_at IS NULL`, and its definition contains `coalesce(purpose_scope, 'all')`.
- No row has a non-NULL `purpose_scope` (rollback precondition).

### 6.5 Controlled verification in an authorized certification environment

Per the Batch C report, no database-backed evidence exists. In an authorized cert environment, verify: a CHECK rejection for `('outreach', 'bounce_hard')` and for `purpose_scope = 'all'`; **replay idempotency** — the same unlabelled restriction inserted twice still collides as `already_present`; and **fail-closed behaviour** — that a deliberately unreadable store blocks on Paths A–D rather than allowing. Note that the project's cert stack rejects `sb_secret_*` keys via local PostgREST (use JWTs), and that migration replay cannot rebuild the schema from history — use the baseline plus newer migrations.

### 6.6 Stop / rollback criteria

Stop and roll back if: the preflight RAISEs; any CHECK fails to create; the index rebuild fails; the post-migration index definition lacks the coalesce term; or governed sends begin failing closed after deployment. **Rollback order: application first, then schema** (§3).

### 6.7 Application deployment order

After the migration is confirmed applied: deploy web and worker planes. *Per the project's standing release discipline, deploy only a clean `origin/main` through the normal predeploy check — and note that PG-001 is currently **uncommitted**, so no deployable artifact exists yet.*

### 6.8 Preventing governed sends from meeting an absent column

Only ordering prevents it; there is no code-level fallback, and that is deliberate — a fallback would be a silent-degradation path on the exact query that decides whether someone may be contacted. Mitigations: apply the migration first; never roll back the schema while the new code is deployed; and treat `governance_lookup_failed_failclosed` plus `readable_suppression_state` appearing together across tenants as the signature of this misordering.

### 6.9 Evidence for the release record

HEAD and the 14 PG-001 file hashes from §1; the Batch C test and typecheck exits; the 4/4 mutation results; `check:migrations` exit 0 after D-4; the pending-migration set that was actually applied; post-migration object checks (§6.4); cert-env results (§6.5); and the two preservation snapshot manifests.

---

## 7. Authorization boundaries

**AUTHORIZED:** read-only inspection and this report.
**NOT AUTHORIZED:** database use or queries, migration application or reversal, backfill, shadow evaluation, enforcement activation, legacy retirement, commit, push, deployment, production verification, provider calls, message sending, and any edit to source, tests, migration, rollback or either snapshot.

---

## 8. No-mutation attestation

This review was read-only. No application file, test, migration, rollback or documentation file was created, modified or deleted. Neither preservation snapshot was refreshed or overwritten. No database query or mutation, no Supabase operation, no provider call, no message sent. No commit, push, branch or worktree change, no deployment. `C:/virality` was not inspected or modified; no symlink or junction was followed, and the `node_modules` junction was not accessed.

Two commands were executed, both read-only and non-mutating: `npm run check:migrations` (the repository's own migration-quality gate, which reports and exits) and source/hash inspection. No test suite was rerun.

Final state: branch `fix/r1-profile-context`, HEAD `29fea38a…5774`, **91 entries (54 M / 37 ??), 0 staged** — unchanged from the Batch C report.

**Stopping here. D-4 is reported, not fixed; it awaits separate authorization.**
