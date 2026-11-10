# PI actor-FK fixes: integration proposal

**Status: proposal. Nothing merged.** The files remain uncommitted in `C:/tmp/pi-actor-fk-migrations` (`fix/pi-actor-fk-migrations`, at main 5025f51d). All testing used copies on disposable databases. Copies with checksums are in the orchestration evidence archive, because these files exist nowhere else.

## Recommendation

Merge the four actor-FK migrations as one PR, in the order below, **together with** the PI writer change in section 3. Keep the H-3 file out of that PR. Author one more migration for the list tables (section 4). Apply all of it before `WORKFLOW_ORCHESTRATION_ENABLED` is turned on anywhere real.

## 1. What is there

| File | Fixes | Foreign key or constraint | Behaviour change |
|---|---|---|---|
| `20270116000001` source assertions | Deleting an actor aborts with 23514 | Drops the actor FK; keeps the CHECK | Recorded actor outlives the user |
| `20270116000002` archive recommendations | 23514 when confirmed or rejected; **silent actor loss** when superseded | Drops the actor FK; keeps the CHECK | Same |
| `20270116000003` lifecycle transitions | 42501 on delete, reading as a permissions error | Drops the actor FK; append-only triggers untouched | **Not neutral: see section 3** |
| `20270116000004` `reports.user_id` | 23502; 4 production users undeletable, the only live instance | Drops NOT NULL; **keeps** the FK | Report becomes company-owned |
| `20270116000000` H-3 media | Unrelated to actors | See section 5 | Separate decision |

Each of the four has fail-closed preflight and postconditions and a rollback. Each must be applied with `psql`: the Supabase console's splitter cuts dollar-quoted blocks and discards the guards, which already happened in production on 2026-11-01.

## 2. Measured results

Run on disposable PostgreSQL 17.6 with pgvector, against both the recovery schema and the release-candidate combination.

| Check | Recovery | With RC |
|---|---|---|
| Apply in order | Pass | Pass |
| Replay (idempotent) | Pass | Pass |
| Delete a user who is an actor and a report owner | Succeeds | Succeeds |
| Ledger row keeps the erased actor's id | Yes | Yes |
| Report survives with no owner | Yes | Yes |
| Rollback in reverse order, tables without dangling data | Pass | Pass |
| Re-apply after rollback | Pass | Pass |
| Rollback once an actor dangles (lifecycle, reports) | **Refuses**, with a count | Not run separately |
| A fictional actor uuid is now accepted by the database | **Yes, confirmed** | **Yes, confirmed** |
| Migration-quality gate with the four files added | Pass | Not run separately |
| Full real-schema suite with the four files added | 67/68 suites, 1 test fails | Not run |

The one failure is exactly what the migration's header predicted: `b3_outcome_lifecycle.test.ts`, "a fictional operator is refused". `sec91FMigrationQuality`, `piWscProspectLifecycleWriter` and `verifySchemaParityCoverage` all pass with the files added.

## 3. Required in the same PR: actor validation

`20270116000003` removes the only enforcer that `actor_user_id` names a real user. Neither `lifecycleWriter.ts` nor `outcomeLifecycleProducer.ts` checks anything except presence. Shipping the DDL alone silently downgrades a guarantee, and no preflight can detect that.

**Owner: PI.** Changes needed, not yet written:

1. In `validate` or `attemptTransition` in `lifecycleWriter.ts`: when `origin = 'human'`, read the actor and confirm they exist and are a member of the tenant; otherwise throw `ProspectLifecycleWriteError` with a named code such as `actor_not_found`.
2. Widen `b3_outcome_lifecycle.test.ts:438` to that named reason.
3. Decide what "member" means for a platform admin acting on a tenant. The operator outcomes route admits one through `requireTenantAccess`, so a pure membership check would refuse a legitimate actor. **This needs a PI decision.**

**Orchestration impact:** none directly. Journey writes are `derived` and carry no actor. A human actor reaches the writer only through `outreach_outcomes.metadata.recordedByUserId`.

## 4. Gap: actors these migrations do not cover

A census of the combined schema, with the four applied, still shows these `ON DELETE SET NULL` actors. None aborts a delete. Each **silently loses attribution**, the defect class `20270116000002` calls the worse one:

| Column | Note |
|---|---|
| `prospect_list_members.added_by_user_id` | Live in production, empty at last measurement |
| `prospect_list_members.removed_by_user_id` | Same; its CHECK does not bind the actor |
| `prospect_lists.created_by_user_id` | Same |
| `capability_assignments.granted_by` | Existing security table on main; a separate owner should decide |
| `production_certification_reports.generated_by` | Internal; likely acceptable |

**Proposal:** PI authors `20270116000005_pi_prospect_list_actor_fk_removal`. It **cannot sit on main until `20261127000000` lands**, because main has no such tables, so it must ship with or after the orchestration stack. The other four have no such dependency.

No `NOT NULL` under `SET NULL` remains anywhere once `reports` is fixed; that census came back empty.

## 5. H-3 is a separate decision

`20270116000000` and the RC's `20270111000004` are the same SQL under two version numbers. The RC's header says "not applied anywhere real". The PI file's header says **partially applied in production on 2026-11-01**: the private `media-quarantine` bucket was created and the four deny policies were not. The PI copy is the accurate one.

Only one may land, or the file runs twice under two ledger rows. **Decision needed:** keep the PI number and drop it from the RC, or the reverse. Re-running is safe by design and is what completes the partial state. Recommendation: one version number, with the PI file's corrected header.

## 6. Dependencies and order

```
main 5025f51d
 ├─ 20270116000001..4  no dependency on orchestration or RC; passes on both
 ├─ PI writer validation            same PR as 0003
 ├─ orchestration stack             brings 20261127 lists to main
 │    └─ 20270116000005 (to author) needs the lists tables
 └─ WORKFLOW_ORCHESTRATION_ENABLED  only after all of the above, in that environment
```

**Why the last line matters.** `prospect_lifecycle_transitions` is empty in production. Orchestration writes its first rows. Today's rollback is two-way only because no row exists; once an actor is erased it becomes one-way, and a dangling value on this table cannot even be repaired because the table is append-only.

Version numbers are safe: `20270116*` sorts after the RC's `20270115` and before orchestration's `20270120*`. The order was tested with the four applied before the 20270120 files, and in version order.

## 7. Rollback summary

Reverse order: `0004` → `0003` → `0002` → `0001`. All two-way while the tables hold no dangling references, which is the production state at last measurement. After any actor or report owner is erased, the affected rollback refuses with a count, and the correct action is to stay forward. No rollback nulls or deletes evidence.

## 8. Test coverage

**None of the four ships with a test.** Everything above came from my disposable-clone scripts, not repo suites. Before merge, PI should add a real-schema suite per table, following `backend/tests/realschema/` precedent for PPO: delete succeeds, actor survives, CHECK still binds, rollback refuses with dangling data. My scripts are in the evidence archive as a starting point.

## Decisions needed

| # | Decision | Owner |
|---|---|---|
| F-1 | Approve merging 0001..0004 as one PR with writer validation | Owner |
| F-2 | What counts as a valid human actor, including platform admins | PI |
| F-3 | One version number for H-3 | Owner |
| F-4 | Author 0005 for list actors, and whether `capability_assignments.granted_by` is in scope | Owner, security |
