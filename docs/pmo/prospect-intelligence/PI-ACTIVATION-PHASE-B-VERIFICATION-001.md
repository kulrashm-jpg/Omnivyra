# PI ACTIVATION — PHASE B VERIFICATION 001

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes`
**Target:** production project `klkiseupptzbecbxwrky`
**Method:** read-only. `SELECT` only — no DDL, no DML, no `NOTIFY`, no cache reload, no repair.

---

## 8. Final verdict

# PHASE B BLOCKED

**The migration has not been applied.** All six columns are absent, all three constraints are absent, the
ledger holds no record of it, and the `42703` failure reproduces exactly.

This is **not** a stale-cache false negative — that hypothesis was explicitly tested and ruled out (§2).

Nothing was repaired, and no application code was touched.

---

## 1. Migration state

| Property | Finding |
|---|---|
| Migration | `20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` |
| Applied to `klkiseupptzbecbxwrky`? | **NO** |
| `supabase_migrations.schema_migrations` rows matching `20261013%` | **0** |
| Production data altered? | **No** — nothing ran |

---

## 2. Six-column verification — and why the cache hypothesis was tested first

A first pass through PostgREST reported all six columns `ABSENT`. That alone would have been **insufficient
evidence to declare BLOCKED**: PostgREST caches the schema, so a column added minutes earlier can still answer
`42703` through the REST API while existing perfectly well in the catalog. Reporting BLOCKED on that would be
a false negative and would have sent the database owner chasing a migration they had already applied.

So the check was repeated against the **Postgres catalog directly**, over `SUPABASE_POOLER_DB_URL`, bypassing
PostgREST entirely.

### Catalog result — `information_schema.columns`

| Column | State |
|---|---|
| `unified_persons.authority` | **ABSENT** |
| `unified_persons.influence` | **ABSENT** |
| `unified_persons.buying_role` | **ABSENT** |
| `prospect_accounts.market` | **ABSENT** |
| `prospect_accounts.business_model` | **ABSENT** |
| `prospect_accounts.growth_stage` | **ABSENT** |

Both methods agree. The catalog is authoritative, and the two sources agreeing removes cache staleness as an
explanation. **The DDL genuinely did not run.**

---

## 3. Constraint verification — `pg_constraint`

| Constraint | State |
|---|---|
| `prospect_accounts_ws6_attributes_not_blank` | **ABSENT** |
| `unified_persons_ws7_attributes_not_blank` | **ABSENT** |
| `unified_persons_buying_role_valid` | **ABSENT** |

Consistent with §2 — the migration is a single transaction, so partial application was never expected, and
none is observed. There is no half-applied state to reconcile.

---

## 4. Schema parity result — the documented verifier CANNOT RUN

`docs/migration-discipline.md` step 4 prescribes `node scripts/verify-schema-parity.js`. It was run, exactly
as documented. **It cannot verify anything against this project.**

```
{"event":"schema_parity.error","reason":"information_schema_query_failed",
 "table":"bolt_execution_runs",
 "supabase_error":"Could not find the table 'public.information_schema.columns' in the schema cache",
 "hint":"Expose information_schema to service_role or use direct SQL via Supabase Studio."}
exit: 0
```

**Two findings, recorded rather than repaired:**

1. **The verifier queries `information_schema` through PostgREST, which does not expose it.** Its own hint
   says to use direct SQL instead — which is exactly the method §2 and §3 used. The catalog checks above are
   therefore the working substitute for this step, not a shortcut around it.
2. **⚠ It exits `0` while failing.** A caller treating the exit code as the verdict would read "parity
   verified" from a run that verified nothing. This is the same class of trap as `next build` exiting 0 on
   failure. Not fixed here — out of scope — but it materially weakens the documented protocol's step 4 and
   should be raised with the migration-discipline owner.

---

## 5. Pre / post row counts — data preserved

| Table | Pre (Phase A/B report) | Now | Δ |
|---|---|---|---|
| `unified_persons` | 23 | **23** | 0 ✅ |
| `canonical_leads` | 18 | **18** | 0 ✅ |
| `prospect_accounts` | 0 | 0 | 0 |
| `source_records` | 0 | 0 | 0 |
| `source_assertions` | 0 | 0 | 0 |
| `outreach_tasks` | 0 | 0 | 0 |
| `outreach_outcomes` | 0 | 0 | 0 |

Counts obtained by `SELECT count(*)` — no row contents were read. **No row was modified by anything in this
verification, and none was modified between the two reports.**

---

## 6. Account Intelligence query verification

The exact select shape used by `backend/services/prospectIdentity/accountIntelligence.ts:335-341` was executed
read-only, against a deliberately non-existent tenant/account pair so that no production row could be
returned:

```sql
SELECT id, job_title, department, seniority, authority, influence, buying_role
  FROM public.unified_persons
 WHERE company_id = $1 AND account_id = $2 LIMIT 1;
```

```
AI_SELECT: FAILED code=42703 column "authority" does not exist
```

**The `42703` failure condition is NOT resolved. It reproduces exactly.**

Consequence, unchanged from the activation plan: `loadContacts` throws → `aggregateAccountIntelligence`
throws → `GET /api/prospects/:id` returns `account.state: "failed"`. Account intelligence, the buying-committee
roster, WS-6 `relationships` and account-side ICP fit all remain unavailable.

**No Account Intelligence result was fabricated**, and none could be: the query does not reach the row stage.
Separately — and independently of the schema — `prospect_accounts` holds **0 rows**, so even once the
migration lands, account intelligence will correctly return empty until Phase C populates the spine. Those are
two distinct blockers and are not conflated here.

---

## 7. Tenant / security verification

No schema change occurred, so no isolation surface changed. Baseline captured read-only for comparison after
the migration eventually lands:

| Table | RLS enabled | Policies | Tenant column |
|---|---|---|---|
| `unified_persons` | **true** | 1 | `company_id` |
| `prospect_accounts` | **true** | 1 | `organization_id` |

| Repository check | Result |
|---|---|
| `npm run check:migrations` | exit 0 |
| `node scripts/check-tenant-authz.js` | **PASS — no NEW tenant-authz violations** |
| Authorization code modified | **No** |

The migration, when applied, adds only nullable columns and CHECK constraints — no policy, grant, view or
function — so it cannot widen access. That remains true and re-verifiable against this baseline.

---

## Stop condition triggered

Per the task's §6, **three** stop conditions are met:

1. Expected columns are absent (all six)
2. Schema parity could not be verified (the documented verifier cannot run)
3. The Account Intelligence query still produces `42703`

Row counts are unchanged and tenant isolation is unaffected, so those two conditions did **not** trigger.

**Nothing was repaired. Phase C was not begun.**

---

## What is needed to close Phase B

The migration still needs to be applied to `klkiseupptzbecbxwrky`. Unchanged from the Phase A/B report:

**Option 1 — documented protocol.** The database owner opens the Supabase Studio SQL editor for
`klkiseupptzbecbxwrky`, pastes the full contents of
`supabase/migrations/20261013000000_pi_ws6_ws7_icp_attribute_extension.sql`, and runs it.

⚠ **The file is on branch `feat/pi-ws6-ws7-icp-attributes`, not on `main`.** It will not be present in a
checkout of the default branch — a plausible reason the apply may not have happened.

⚠ **Do not rely on `scripts/verify-schema-parity.js` to confirm it** (§4). Verify by catalog query instead:

```sql
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (
     ('unified_persons','authority'), ('unified_persons','influence'),
     ('unified_persons','buying_role'), ('prospect_accounts','market'),
     ('prospect_accounts','business_model'), ('prospect_accounts','growth_stage'));
```

Six rows means applied.

**Option 2 — grant the agent the execution permission.** The prepared script applies only that one file, in a
single transaction, aborting on any `DROP`/`TRUNCATE`/`DELETE`.

The migration remains additive, idempotent (`IF NOT EXISTS` throughout) and safe to run against the current
state — including the 23 live `unified_persons` rows, since a nullable `ADD COLUMN` without a default is a
metadata-only operation.

---

## Git

- Documentation only. No code, schema, migration, flag, provider, import, merge or deploy.
