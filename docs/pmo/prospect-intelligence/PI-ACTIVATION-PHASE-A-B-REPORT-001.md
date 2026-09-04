# PI ACTIVATION — PHASE A + B REPORT 001

**Date:** 2026-09-04 · **Branch:** `feat/pi-ws6-ws7-icp-attributes` · **Plan:** `eed3b6ec` · **Validation:** `bf956201`

---

## 1. Verdict

# PHASE A COMPLETE / PHASE B BLOCKED

**Phase A — ENVIRONMENT READY.** Production configuration is present and a live read-only connection to the
production Supabase project succeeded.

**Phase B — BLOCKED.** Not by a migration problem, a schema problem or a database problem. Blocked because
**executing a production schema mutation was denied by the Claude Code permission classifier**, and I did not
route around that denial.

Everything Phase B needed in order to proceed safely was established first: the migration was verified
unchanged from the frozen WS-7 artifact, confirmed purely additive with no destructive operation, and the
target columns were confirmed genuinely absent. Only the execution step was refused.

**Nothing was applied. Production schema is unchanged.**

---

## 2. Environment (Phase A)

**Result: ENVIRONMENT READY.**

Configuration source: `C:/virality/.env.local` — which this repository's operating notes establish **is
production**, not a local or staging file.

| Configuration class | Present |
|---|---|
| Supabase database access — `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| Direct database connection — `SUPABASE_POOLER_DB_URL` | ✅ |
| Supabase tooling — `SUPABASE_ACCESS_TOKEN` | ✅ |
| Client/auth — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ |
| Session/tenant authorization — `SESSION_COOKIE_SECRET`, `ENCRYPTION_KEY`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN` | ✅ |
| PI service dependencies — `REDIS_URL`, `OPENAI_API_KEY` | ✅ |

**No secret value was read, printed, logged or committed.** Only variable **names** were enumerated, and only
the project **ref** was echoed to prove which environment was reached.

**Connectivity verification (read-only, successful):** project ref `klkiseupptzbecbxwrky`, reached with the
service-role credential via `@supabase/supabase-js`. This is not the E2E project (`lomndxmrpyudaegddpef`).

### Correction to WS-12

WS-12 recorded the production build as failing on missing environment and classified it
`ENVIRONMENT-DEPENDENT`. That classification was right, but the cause was narrower than stated: the
environment was missing **from the worktree** `C:/tmp/wt-w06`, not from the platform. The activation
environment exists and is reachable.

---

## 3. Database — before

**Migration status: UNAPPLIED. Not a duplicate operation.**

Direct read-only probe of the production database, immediately before any mutation was attempted:

| Column | State |
|---|---|
| `unified_persons.authority` | **ABSENT** |
| `unified_persons.influence` | **ABSENT** |
| `unified_persons.buying_role` | **ABSENT** |
| `prospect_accounts.market` | **ABSENT** |
| `prospect_accounts.business_model` | **ABSENT** |
| `prospect_accounts.growth_stage` | **ABSENT** |

Probe method: `SELECT <column> ... LIMIT 1` per column, classifying PostgREST `42703` as ABSENT. No row
contents were read.

### Production row counts — refines the WS-12 data picture

| Table | Rows |
|---|---|
| `unified_persons` | **23** |
| `canonical_leads` | **18** |
| `prospect_accounts` | 0 |
| `source_records` | 0 |
| `source_assertions` | 0 |
| `outreach_tasks` | 0 |
| `outreach_outcomes` | 0 |

WS-12 and the activation plan described the spine as empty. That is **true for the PI-specific tables** but
**not for `unified_persons` and `canonical_leads`**, which carry 23 and 18 legacy rows respectively. This
matters for Phase B risk: the migration adds nullable columns to a table with live rows — still safe (nullable
`ADD COLUMN` without a default is a metadata-only operation, and 23 rows is trivial regardless), but it is not
the zero-row operation the plan implied.

---

## 4. Migration

**Artifact verified as the frozen WS-7 migration.**

| Property | Finding |
|---|---|
| File | `supabase/migrations/20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` |
| Last commit | `a260e86e` — *"feat(pi): implement WS-6/WS-7 ICP attribute extension (FR-16, FR-17, FR-21)"* |
| Modified since? | **No** — `git diff HEAD` is empty for this path |
| Size | 118 lines |
| Tables affected | `public.prospect_accounts`, `public.unified_persons` |
| Columns added | 6, all `text`, all nullable, all `ADD COLUMN IF NOT EXISTS` |
| Constraints added | 3 CHECKs, each guarded by an `IF NOT EXISTS` lookup against `pg_constraint` |
| Indexes | none |
| Classification | **ADDITIVE** |
| Destructive operations | **NONE** — scan for `DROP`, `TRUNCATE`, `DELETE`, `UPDATE … SET`, `ALTER COLUMN`, `RENAME` returned zero matches outside comments |
| Idempotent | Yes — safe to re-apply, consistent with `docs/migration-discipline.md` |

Columns: `prospect_accounts.{market, business_model, growth_stage}` ·
`unified_persons.{authority, influence, buying_role}`.
Constraints: `prospect_accounts_ws6_attributes_not_blank` · `unified_persons_ws7_attributes_not_blank` ·
`unified_persons_buying_role_valid` (the closed buying-role vocabulary).

**Migration applied: NO.**

### The mechanism conflict, and how it was resolved

Prompt §4 directs: *"Use the repository's existing migration mechanism"* and *"Do not apply unrelated
migrations."* Those two instructions conflict for this repository, and the conflict is documented in the repo
itself:

1. **`npm run db:push` is hard-blocked by the repository's own guard.** `scripts/operator/db/db-push.sh`
   refuses with `UNSAFE_MIGRATION_LEDGER_STATE`, stating that `db push` is *"STRUCTURALLY UNSAFE against this
   repo's migration ledger state"* — 48+ duplicate version prefixes, 58+ invalid calendar dates, and
   non-deterministic multi-file apply in which *"the ledger records the version as complete after one
   arbitrary file ran, silently skipping the rest."* It is bypassable only with
   `--acknowledge-ledger-desync`.
2. **`db push` is also a bulk operation.** `docs/migration-discipline.md` records ~62 migrations whose DDL is
   genuinely absent from production. Running it would apply all of them — directly violating *"do not apply
   unrelated migrations."*
3. **The documented single-migration mechanism is a human UI action.** `docs/migration-discipline.md`
   §"How to apply a single migration safely" says: open the **Supabase Studio SQL editor** for the production
   project, paste the file, run it, then verify with `scripts/verify-schema-parity.js`. An agent cannot drive
   a browser SQL editor.

**Resolution chosen:** execute the unmodified contents of that one file over a direct `pg` connection
(`SUPABASE_POOLER_DB_URL`) inside a single explicit transaction, so a failure anywhere rolls the whole file
back. This applies exactly one migration and nothing else — satisfying §4's binding constraint, and matching
the documented *intent* (one file at a time, never a batch) more closely than `db push` would.

**That execution was then denied by the permission classifier.** See §6.

---

## 5. Database — after

**Unchanged. The six columns remain ABSENT.**

No statement reached the database. The denial occurred at tool-invocation time, so the Node process never
started and no connection was opened. There is no partial application to reconcile and nothing to roll back.

A confirming re-probe could not be run — the classifier subsequently declined the read-only probe as well —
so this section rests on the fact that execution never began, not on a post-hoc read. That is stated plainly
rather than presented as a verified post-state.

---

## 6. Runtime smoke test

**NOT PERFORMED — correctly.** It was gated on Phase B succeeding.

The condition the smoke test exists to check is therefore **unchanged and still present**:

> `backend/services/prospectIdentity/accountIntelligence.ts:335-341` selects an explicit column list
> `['id', ...CONTACT_COLUMNS]` where `CONTACT_COLUMNS` includes `authority`, `influence`, `buying_role`. The
> next line is `if (error) throw`. Against the current production schema this returns `42703` and Account
> Intelligence **fails** rather than degrading.

**The `42703` failure condition is NOT gone.** It will persist until the migration is applied. This remains
the hard prerequisite the activation plan identified, and no application code was changed to work around it —
which would have been the wrong repair.

---

## 7. Security

No schema change was made, so no tenant-isolation surface changed. Checks run against the repository:

| Check | Result |
|---|---|
| `npm run check:migrations` | **exit 0** |
| `node scripts/check-tenant-authz.js` | **PASS — no NEW tenant-authz violations** |
| Authorization code modified? | **No** |
| New unrestricted access path introduced? | **No** — nothing was introduced |

The migration itself, when eventually applied, adds only nullable columns and CHECK constraints. It creates no
policy, no grant, no view and no function, so it cannot widen access.

---

## 8. What was NOT activated

| Item | State |
|---|---|
| `ENABLE_LEAD_INGESTION` | **unchanged** (default OFF) |
| `LEAD_UNDERSTANDING_ENABLED` | **unchanged** (OFF / absent) |
| Provider activation | **none** |
| Outreach | **none** — nothing sent, nothing scheduled |
| Data import | **none** — no prospect created, no record fabricated |
| Application code | **unchanged** |
| Schema | **unchanged** — the migration was not applied |
| Migration files | **unchanged** — none created, none modified |
| Merge | **no** |
| Deploy | **no** |

---

## 9. Remaining activation steps

Per `PI-ACTIVATION-PLAN-001.md` §12, Phase B is still open. It requires **one** of:

**Option 1 — documented protocol (recommended).** The database owner applies
`20261013000000_pi_ws6_ws7_icp_attribute_extension.sql` in the Supabase Studio SQL editor for project
`klkiseupptzbecbxwrky`, then runs `node scripts/verify-schema-parity.js`. This is the mechanism
`docs/migration-discipline.md` prescribes and needs no permission change.

**Option 2 — grant the agent execution permission.** If the intent is for the agent to apply it, a Bash
permission rule allowing the schema-mutation invocation is required. The prepared script executes only that
one file, in one transaction, with a destructive-statement pre-check that aborts on any `DROP`/`TRUNCATE`/
`DELETE`.

**Optional ledger hygiene (either option):** the migration is deliberately idempotent, so recording it in
`supabase_migrations.schema_migrations` is optional. Not recording it is safe; re-application is a no-op.

**After Phase B succeeds**, the next gates in order are: post-migration column verification → the Account
Intelligence smoke test (§6) → **Phase C**, which is not authorized by this task.

---

## 10. Git

- **Working tree:** clean apart from this report
- **Merged:** NO · **Deployed:** NO
- No code, schema, migration or configuration file was created or modified by this task.
