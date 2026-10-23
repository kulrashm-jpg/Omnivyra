# ENG-004-RUNTIME — VERIFICATION REPORT

**Every required runtime check passed, on a real PostgreSQL 17.6, with Docker never
started.** ENG-004 is **technically ready for closure** — §22. I do not authorize
ENG-005.

**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`, 437 migrations. Repository
unchanged.

---

## 1. Environment

| Item | Value |
|---|---|
| PostgreSQL | **17.6** on x86_64-windows (`PostgreSQL 17.6 ... compiled by msvc-19.44.35213, 64-bit`) — matches the platform runtime (production 17.6.1.005, e2e 17.6.1.155) |
| Provenance | portable EDB binaries, `postgresql-17.6-1-windows-x64-binaries.zip`, 314.6 MB, zip integrity verified (23 044 members, `testzip()` clean) |
| Install location | scratchpad only: `…/scratchpad/pgsql` — outside the repository |
| Data directory | `…/scratchpad/pgdata` — created by `initdb`, empty, disposable |
| Connection target | `127.0.0.1:55432`, `listen_addresses = 127.0.0.1` (loopback only) |
| Isolation mechanism | a standalone OS process, started and stopped by `pg_ctl`. **Not Docker, not WSL, not the compose project** |
| Process identifier | own `postgres.exe` from the scratchpad; stopped at the end (`pg_isready` → "no response") |
| Databases built | `tmpl_pre`, `main`, `abort1`, `abort2`, `abort3`, `final` |

No secrets are recorded here. The instance used a throwaway local role.

**Why not the repo's Docker harness.** It needs the Docker daemon, and starting that
daemon auto-starts `omnivyra-worker`, which points at the managed production host and was
observed running production crons on 2026-09-11. §2 forbids that route, and the brief's
preferred solution is a completely separate disposable instance. There was no PostgreSQL
anywhere on this machine — no binary, no scoop/chocolatey/winget package, and the only WSL
distro is the stopped `docker-desktop` one — so a portable install was the only way to get
a real engine without touching Docker. One network download; nothing else left the host.

---

## 2. Isolation proof

| Check | Evidence |
|---|---|
| Docker daemon never started | before and after: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine … The system cannot find the file specified` |
| `omnivyra-worker` never ran | process scan for `omnivyra|dockerd|com.docker|vpnkit` → **0 matches**, before and after |
| no production cron executed | no worker, no scheduler, no `npm run dev`, no application process at all |
| no production Supabase URL | the engine takes no URL; the only connection string used was `127.0.0.1:55432` |
| no production credentials | shell scan for `SUPABASE|klkiseupptzbecbxwrky|AWS_|EMAIL_FROM` matched exactly one line, and it was **`PATH`** (its value contains a matching substring). No Supabase URL, no key, no AWS credential, no `EMAIL_FROM` |
| no production network dependency | loopback-only listener; port 54322 (the certenv stack) was never listening |
| port 6379 | **Memurai**, PID 4588 — a Windows-native Redis *service*, not a container, unrelated to Supabase |

---

## 3. Source / migration hashes

| File | Hash | Expected (ENG-004 report) | Result |
|---|---|---|---|
| `20261117000000_eng004_engagement_message_tenant.sql` | `c3c5930edcd14a0a` | `c3c5930edcd14a0a` | **MATCH** |
| `20261118000000_eng004_close_platform_message_tenant_scope.sql` | `ceae2ad8a984295c` | `ceae2ad8a984295c` | **MATCH** |

No drift, so no STOP condition. Neither migration was modified before, during or after
testing — re-hashed at the end, both unchanged. `scripts/ci/schema-bootstrap.sql`
`080ed570c335782a` and `supabase/_schema/baseline.sql` `638e73a036c6ef6e` are also
unchanged.

**One test-only file outside the repository.** The repo bootstrap does
`CREATE EXTENSION vector`, and pgvector is absent from the vanilla EDB build (the Docker
harness uses `pgvector/pgvector:pg17`). Rather than edit repo source, I copied the
bootstrap to `…/scratchpad/bootstrap-novector.sql` and wrapped that one statement in an
exception handler. Nothing this gate verifies depends on pgvector: the baseline declares
no `vector(` column, and neither engagement table uses one. **The repo file is
byte-identical** (`080ed570c335782a`).

---

## 4. Migration application

Schema built the way the repo harness builds it: bootstrap → `baseline.sql` → replay every
migration above the ledger floor `20260916000000`.

```
bootstrap           ok
baseline loaded     857 tables
pre-ENG-004 replay  59 migrations applied, 0 failed to apply cleanly
organization_id present before migration: 0        ← correct starting state

20261117000000 → APPLIED
   NOTICE: ENG-004 backfill validated: 0 orphans, 0 untenanted, 0 mismatches.
   NOTICE: trigger "…tenant_matches_thread" does not exist, skipping   (the idempotent DROP)
20261118000000 → APPLIED
```

Both migrations applied on the first attempt, in filename order, with no modification.

---

## 5. Fixture design

Synthetic only. No production data, no copied rows, no production ids.

```
org A  aaaaaaaa-…a1          org B  bbbbbbbb-…b1
thread A (org A)             thread B (org B)
message A (thread A)         message B (thread B)
parent A (thread A)  ←  child A (thread A, parent_message_id = parent A)
```

**`organization_id` was deliberately NOT supplied on any fixture insert.** That is itself
the first proof the trigger runs — had it not, the `NOT NULL` column would have rejected
every row. Observed:

| message | org matches thread | org not null | has parent |
|---|---|---|---|
| pm-a | **t** | **t** | f |
| pm-b | **t** | **t** | f |
| pm-child-a | **t** | **t** | **t** |
| pm-parent-a | **t** | **t** | f |

---

## 6. organization_id verification

Catalog: `information_schema.columns.is_nullable` = **NO**.

Query results on live data: **0 mismatches** between message and thread tenant, and
**0 untenanted** messages.

An insert with a NULL thread and NULL tenant was rejected — by the trigger, with
`engagement_messages.organization_id cannot be derived: thread <NULL> has no tenant`,
rather than by `23502`. The trigger fires first and refuses an unattributable row before
the constraint is reached. My written expectation was `23502`; the actual behaviour is an
earlier and clearer refusal. **Recorded as observed, not as expected.**

---

## 7. Thread composite FK

**Rejected, and proven twice.**

Trigger path:
```
ERROR: engagement_messages.organization_id bbbbbbbb-…b1 does not match
       thread 11111111-…a2 tenant aaaaaaaa-…a1
CONTEXT: PL/pgSQL function engagement_messages_tenant_from_thread() line 25 at RAISE
```

Then the same insert **with the trigger disabled**, to prove the FK is not merely masked
by it:
```
ERROR:  insert or update on table "engagement_messages" violates foreign key
        constraint "engagement_messages_thread_org_fkey"
DETAIL: Key (thread_id, organization_id)=(11111111-…a2, bbbbbbbb-…b1)
        is not present in table "engagement_threads".
SQLSTATE: 23503
```

This is the "BEFORE triggers mask CHECKs" concern answered with evidence: **both layers
reject independently.**

---

## 8. Parent composite FK — the critical inbound boundary

**Rejected by PostgreSQL itself.** An org-A child naming an org-B parent:

```
ERROR:  insert or update on table "engagement_messages" violates foreign key
        constraint "engagement_messages_parent_org_fkey"
DETAIL: Key (parent_message_id, organization_id)=(bbbb2222-…b3, aaaaaaaa-…a1)
        is not present in table "engagement_messages".
SQLSTATE: 23503
```

Stored definition:
```
FOREIGN KEY (parent_message_id, organization_id)
  REFERENCES engagement_messages(id, organization_id)
  ON DELETE SET NULL (parent_message_id)
```

**Positive control (§10): the correct parent succeeds.** An org-A child naming the org-A
message inserted without error, so the negative is not vacuous.

This is the boundary inbound email depends on, since `In-Reply-To`/`References` will be
attacker-supplied. It is now a database guarantee, not an application convention.

---

## 9. Trigger tests

**Derives a missing tenant.** Insert with no `organization_id` on thread A →
`derived_org_is_A = t`.

**Rejects an explicitly wrong tenant.** `UPDATE … SET organization_id = org B` on an org-A
message:
```
ERROR: engagement_messages.organization_id bbbbbbbb-…b1 does not match
       thread 11111111-…a2 tenant aaaaaaaa-…a1
```
It did **not** silently rewrite B to A. The follow-up `SELECT` then reported
`current transaction is aborted` — which is the expected consequence of the raise and is
itself confirmation that the statement did not succeed.

Catalog: `tgname = engagement_messages_tenant_matches_thread`, `tgenabled = O` (enabled).

---

## 10. Parent deletion

Deleting parent A, then inspecting child A:

| platform_message_id | parent_nulled | org_still_A | org_not_null |
|---|---|---|---|
| pm-child-a | **t** | **t** | **t** |

The child row survives, `parent_message_id` is NULL, and `organization_id` is **still
org A and still non-null**.

This is the specific validation the ENG-004 report asked for. A bare
`ON DELETE SET NULL` on that composite FK would have tried to null the `NOT NULL`
`organization_id` and the delete would have errored; the column list confines the action
to the pointer. The PostgreSQL 15+ syntax is accepted, stored and behaves as intended on
17.6.

Worth noting: the pre-existing `engagement_threads_person_tenant_fk` already uses the same
construct (`ON DELETE SET NULL (unified_person_id)`), so this pattern was already in the
governed schema.

---

## 11. Thread deletion

Existing CASCADE intact: deleting thread A left **0** of its messages. No new deletion
policy was invented — the new composite FK carries `ON DELETE CASCADE`, matching the
pre-existing `engagement_messages_thread_id_fkey`.

---

## 12. Wrong-tenant update

**Rejected.** Moving an org-A message onto thread B:
```
ERROR: engagement_messages.organization_id aaaaaaaa-…a1 does not match
       thread 22222222-…b2 tenant bbbbbbbb-…b1
```

**And a non-identity update cannot silently mutate ownership:** `UPDATE … SET content`
succeeded (`content = touched`) with `org_unchanged = t`. The trigger is scoped to
`UPDATE OF thread_id, organization_id`, so ordinary edits are unaffected — which is why
the two by-id UPDATE paths closed in ENG-004-CLOSE needed application predicates as well.

---

## 13. G-23 runtime verification

**My first attempt at this test was wrong, and I corrected it.** Both duplicate rows went
into the *same thread*, so the pre-existing `UNIQUE (thread_id, platform_message_id)`
caught them and the new org-scoped index was never exercised:

```
ERROR: duplicate key value violates unique constraint
       "idx_engagement_messages_platform_thread"     ← the OLD index, not mine
```

Claiming G-23 proven on that evidence would have been false. Corrected to **two threads in
the same org**, so only the org-scoped index can fire:

**12a — same tenant, different threads, same provider id → REJECTED by the new index:**
```
ERROR:  duplicate key value violates unique constraint
        "idx_engagement_messages_org_platform_message_unique"
DETAIL: Key (organization_id, platform, platform_message_id)=
        (aaaaaaaa-…a1, email, ses-msg-xyz) already exists.
```

**12b — different tenants, same provider id → ALLOWED:** 2 rows, **2 distinct tenants**.
This is the fix working: two tenants may now hold the same provider message id.

**The counterfactual, which is the decisive evidence.** With those two rows present, I
tried to recreate the old global index:
```
ERROR:  could not create unique index "tmp_old_global"
DETAIL: Key (platform, platform_message_id)=(email, ses-msg-shared) is duplicated.
```
The old index **cannot coexist** with two tenants holding one provider id. That is direct
proof it would have blocked the second tenant's ingest — the harm G-23 described, observed
rather than argued.

**Index inventory:** `idx_engagement_messages_org_platform_message_unique` present;
`idx_engagement_messages_platform_message_global` **absent**;
`idx_engagement_messages_platform_thread` retained (every upsert conflicts on it);
the redundant `idx_engagement_messages_org_platform_message` dropped as intended.

### Constraint inventory, as PostgreSQL stores it

```
engagement_messages_id_org_unique    u  UNIQUE (id, organization_id)
engagement_messages_parent_org_fkey  f  FOREIGN KEY (parent_message_id, organization_id)
                                        REFERENCES engagement_messages(id, organization_id)
                                        ON DELETE SET NULL (parent_message_id)
engagement_messages_thread_org_fkey  f  FOREIGN KEY (thread_id, organization_id)
                                        REFERENCES engagement_threads(id, organization_id)
                                        ON DELETE CASCADE
engagement_threads_id_org_unique     u  UNIQUE (id, organization_id)
```

---

## 14. Migration abort-path verification

Three independent databases, each cloned from the pre-ENG-004 template and seeded with one
invalid condition. **All three abort**, with exact counts:

**A — orphaned message** (thread_id references nothing; the existing thread FK was dropped
in that clone only, to make the state constructible):
```
ERROR: ENG-004 ABORTED — … orphaned_messages=1, messages_without_tenant=1,
       tenant_mismatches=0. First offending ids: dddd0001-…dd01.
```
And the column was left nullable — `NOT NULL` was never set (checked: 0).

**B — untenanted thread** (`organization_id IS NULL`):
```
ERROR: ENG-004 ABORTED — … orphaned_messages=0, messages_without_tenant=1,
       tenant_mismatches=0. First offending ids: dddd0002-…dd02.
```

**C — message/thread tenant mismatch:**
```
ERROR: ENG-004 ABORTED — … orphaned_messages=0, messages_without_tenant=0,
       tenant_mismatches=1. First offending ids: (none).
```

**Destructive-cleanup check: 0** occurrences of `DELETE FROM public.engagement_messages`,
`DROP TABLE` or `TRUNCATE`. The migration assigns no invented tenant, deletes no row and
repairs no mismatch — it stops and reports.

**One cosmetic shortcoming, reported not fixed.** In case C the message says
`First offending ids: (none)` because the sample sub-query selects only untenanted and
orphaned rows, not mismatched ones. The **count is correct** (`tenant_mismatches=1`), so
the abort is sound and the operator is told what is wrong — they just are not handed an
example id for that one condition. §22 forbids silently editing the migration, so it
stands as-is; it is a message-quality improvement for whoever next touches the file.

---

## 15. Final clean migration

A freshly recreated database, both migrations applied from the authoritative set, so no
aborted test run could contaminate the result:

```
20261117000000 → APPLIED
20261118000000 → APPLIED

org_not_null | thread_fk | parent_fk | trigger | new_uniq | old_global
     1       |     1     |     1     |    1    |    1     |     0
```

Every structural object present; the old global index absent. **Clean migration PASS.**

---

## 16. Test matrix

| Test | Expected | Actual | Result |
|---|---|---|---|
| migration 20261117000000 | applies | APPLIED, `NOTICE: 0 orphans, 0 untenanted, 0 mismatches` | **PASS** |
| migration 20261118000000 | applies | APPLIED | **PASS** |
| organization_id NOT NULL | enforced | `is_nullable = NO`; unattributable insert refused | **PASS** |
| message org = thread org | enforced | 0 mismatches, 0 untenanted over live rows | **PASS** |
| cross-tenant thread FK | reject | trigger raise; **and** `23503` on `engagement_messages_thread_org_fkey` with the trigger disabled | **PASS** |
| cross-tenant parent FK | reject | `23503` on `engagement_messages_parent_org_fkey` | **PASS** |
| correct parent | allow | insert succeeded | **PASS** |
| missing tenant trigger | derives | `derived_org_is_A = t` | **PASS** |
| wrong tenant trigger | reject | raise, no silent correction | **PASS** |
| parent deletion | parent_id NULL only | `parent_nulled=t, org_still_A=t, org_not_null=t` | **PASS** |
| thread deletion | existing cascade | 0 messages remained | **PASS** |
| wrong-tenant update | reject | raise; non-identity update preserved ownership | **PASS** |
| G-23 cross-tenant same provider ID | allow | 2 rows, 2 distinct tenants | **PASS** |
| G-23 same-tenant duplicate | reject | `23505` on `idx_engagement_messages_org_platform_message_unique` (after correcting the test — §13) | **PASS** |
| old global platform uniqueness | absent | absent; and **cannot be recreated** on the data | **PASS** |
| orphan migration fixture | abort | aborted, `orphaned_messages=1`, NOT NULL never set | **PASS** |
| NULL-thread migration fixture | abort | aborted, `messages_without_tenant=1` | **PASS** |
| mismatch migration fixture | abort | aborted, `tenant_mismatches=1` | **PASS** |

**18 / 18 PASS.** Every row is PostgreSQL output. No application mock was used for any
database-constraint claim, and every negative has a positive control.

---

## 17. Production safety verification

| Requirement | Status |
|---|---|
| no production Supabase URL used | **confirmed** — the engine takes none; only `127.0.0.1:55432` |
| no production database connection | **confirmed** |
| no production credentials loaded | **confirmed** — the only pattern match in the shell was `PATH` |
| no `omnivyra-worker` running | **confirmed** — 0 matching processes, before and after |
| no production cron executed | **confirmed** — no application process ran at all |
| no SES/SNS/DNS touched | **confirmed** |
| no deployment | **confirmed** |
| no Git push, no PR | **confirmed** — nothing committed; HEAD still `7febdb28` |
| **Docker never started** | **confirmed** — daemon unreachable before and after |

No production-connected process started at any point, so no STOP was triggered.

**Repository integrity:** both migrations, `schema-bootstrap.sql` and `baseline.sql`
re-hashed identical after the run. The only test-only artefact is outside the repository
(§3). 437 migrations, unchanged.

---

## 18. IMPLEMENTED

An isolated PostgreSQL 17.6 instance from portable binaries in the scratchpad (no Docker,
loopback-only, disposable) · the repo's own schema pipeline reproduced against it
(bootstrap + 857-table baseline + 59-migration replay) · a 13-test psql invariant suite ·
three abort-path databases · a corrected G-23 test plus its counterfactual · a final clean
migration run. The instance has been stopped.

## 19. VERIFIED

**By PostgreSQL, at runtime:** both migrations apply · `organization_id` is NOT NULL ·
`message.org = thread.org` across live rows · the thread composite FK rejects cross-tenant
attachment **independently of the trigger** · the parent composite FK rejects a
cross-tenant parent · the correct parent is allowed · the trigger derives a missing tenant
· the trigger raises on an explicit wrong tenant without silently correcting it ·
`ON DELETE SET NULL (parent_message_id)` nulls only the pointer and leaves the tenant
intact · thread deletion still cascades · wrong-tenant updates are rejected while ordinary
edits are not · two tenants may share a provider message id · one tenant may not duplicate
it · the old global index is gone and cannot be recreated · all three migration abort paths
fire with correct counts and perform no destructive cleanup.

## 20. BLOCKED

Nothing.

## 21. UNVERIFIED

Real production data counts for orphans, untenanted threads and mismatches — no production
read is authorized, and the abort paths were proven on synthetic fixtures instead. **If
production holds any untenanted thread, migration `20261117000000` will abort there**;
that is by design, and the counts remain unknown until someone with authorization looks.
Also unverified: pgvector-dependent migrations (one bootstrap statement was made optional
in a scratchpad copy — no engagement object depends on it), and the behaviour of the 59
replayed migrations beyond their applying cleanly.

---

## 21b. Reproducibility — the verification was run twice, independently

The brief was re-issued after the first run completed. Rather than restate the first
result, I rebuilt the environment **from an empty cluster** and re-ran everything: `pgdata`
deleted, fresh `initdb`, fresh bootstrap, fresh baseline, fresh 59-migration replay, both
ENG-004 migrations, the full invariant suite, all three abort databases, the final clean
run, and the corrected G-23 test. A verification that has only ever run once is weak
evidence; this one now reproduces.

Run 2 matched run 1 on every load-bearing result:

| Result | Run 1 | Run 2 |
|---|---|---|
| baseline tables | 857 | **857** |
| pre-ENG-004 migrations replayed / failed | 59 / 0 | **59 / 0** |
| `organization_id` before migration | absent | **absent** |
| `20261117000000` | APPLIED, `0 orphans, 0 untenanted, 0 mismatches` | **APPLIED, same NOTICE** |
| `20261118000000` | APPLIED | **APPLIED** |
| fixture: org derived for all 4 messages | t / t / t | **t / t / t** |
| mismatches, untenanted | 0, 0 | **0, 0** |
| thread FK with trigger disabled | `engagement_messages_thread_org_fkey` | **same constraint** |
| parent FK | `engagement_messages_parent_org_fkey` | **same constraint** |
| parent delete (`parent_nulled, org_still_A, org_not_null`) | t, t, t | **t, t, t** |
| thread cascade | 0 messages remained | **0** |
| abort paths fired | 3 of 3 | **3 of 3** |
| final clean run | `1|1|1|1|1|0` | **`1|1|1|1|1|0`** |
| G-23 same-tenant duplicate | rejected by `idx_engagement_messages_org_platform_message_unique` | **same index** |
| G-23 cross-tenant | 2 rows, 2 tenants | **2 rows, 2 tenants** |
| G-23 counterfactual | old global index cannot be created | **cannot be created** |

Migration hashes re-checked before run 2: `c3c5930edcd14a0a` and `ceae2ad8a984295c` —
**MATCH**, no drift.

Production safety held across both runs: Docker daemon unreachable before and after, zero
`omnivyra|dockerd|com.docker` processes, no production URL, credential, cron or provider
touched. The instance is now fully stopped — no PID file, no `postgres.exe`, no listener on
55432.

Repository re-verified identical after run 2: HEAD `7febdb28`, 437 migrations, both
migrations plus `schema-bootstrap.sql` (`080ed570c335782a`) and `baseline.sql`
(`638e73a036c6ef6e`) unchanged.

**One honest note on the shutdown.** `pg_ctl stop -m fast` printed
`server does not shut down` on its first attempt — that is pg_ctl's wait timeout, not a
failure: the shutdown completed moments later, and the follow-up confirmed the PID file
gone, 0 postgres processes and 0 listeners. Nothing was left running.

---

## 22. ENG-004 closure recommendation

**ENG-004 is technically ready for closure.**

| §13 criterion | Status |
|---|---|
| isolation-sensitive reads hardened or explicitly accepted | **MET** |
| G-19 cannot become an alternate reply/send path | **MET** — module retired |
| G-23 explicit architectural disposition | **MET** — fixed and now runtime-proven |
| G-24 explicit data disposition | **MET** — abort proven on all three invalid states |
| **migration runtime-verified in isolated PostgreSQL** | **MET** |
| **composite tenant FKs runtime-proven** | **MET** — both, the thread FK independently of the trigger |
| **tenant trigger runtime-proven** | **MET** — derive and reject |
| mutation probes pass | **MET** — 16/16 |
| production untouched | **MET** |
| G-22 explicitly tracked | **MET** — still **OWNER DECISION REQUIRED**, unratified, unchanged |

Two things remain outside this gate and are yours, not mine:

1. **Declare ENG-004 CLOSED.** I report it technically ready; the declaration is the
   owner's.
2. **G-22 remains OWNER DECISION REQUIRED** and has not been ratified here.

**I do not authorize ENG-005.** Inbound email, SES inbound, MX, email parsing, reply
correlation, conversation creation, unsubscribe, lifecycle, Engagement Intelligence and
sender identity all remain separate authorized gates.

**One operational note for whenever these migrations are applied for real:** the abort is
not hypothetical. `20261117000000` will refuse to apply if a single
`engagement_threads.organization_id` is NULL, and nobody has yet counted those rows.
Expect to need that count — and a decision about those threads — before the migration can
land anywhere with real data.
