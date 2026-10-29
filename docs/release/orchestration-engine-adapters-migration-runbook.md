# Release runbook — orchestration engine adapters: migration chain

| | |
|---|---|
| Stack | the engine-adapters release branch `feat/orchestration-engine-adapters`; originally integrated as `aa5e6966` against `main` `d51360b0` |
| Scope | the 19 forward migrations and 11 rollback files this stack adds (`git diff --name-only 3e84f3ae HEAD -- supabase/migrations` on the rebased branch; `d51360b0..aa5e6966` before the rebases) |
| Rebases | 2026-10-29: rebased onto `c4e4e9bb` (PR #349), then onto `acde8b7a` (PR #350), then onto `3e84f3ae` (PRs #351–#354), each with `--rebase-merges`, no conflicts, tree equal to `git merge-tree`. `d51360b0..acde8b7a` touches only execution approvals (`executionApprovalService.ts`, migrations `20261223000000/01`, 3 tests) and the readiness-snapshot intent gate (`intentExecutionService.ts` `ALWAYS_RUN_JOBS`, a CI workflow, 1 test); `acde8b7a..3e84f3ae` touches only AI-visibility, citation-intelligence and technical-readiness services and their tests (44 files, no migrations, no file shared with this branch). None of it touches RPA sessions, community actions, the lease reaper or engagement paths, so every "old code (`d51360b0`)" statement below also holds for `3e84f3ae`. Which commit production actually runs is owner-reported (memory: Vercel and Railway on `c4e4e9bb`; Railway auto-deploys `main`, so it may now run `acde8b7a`) — confirm with `/api/health/version` before the deploy steps. |
| Audience | the operator/engineer performing the release with separately authorized production access |
| Nature | READ-ONLY document. Nothing here has been run against production. Every SQL query in §3, §4, §7 and §8 was run against a disposable PostgreSQL 17.6 copy (see §12). |

> **Production migration status is currently UNKNOWN.** No query in this document has been run against
> production. The production migration ledger is desynced from the schema
> (`docs/PRODUCTION-DEPLOY-GOVERNANCE.md:120-122`, `docs/migration-discipline.md:22-51`), so the ledger
> cannot answer "is it applied?". The §3 preflight, run against the live schema, is the only source of
> truth. Do not start §4 until the §3 results are recorded and reviewed.

Conventions: connection parameters come from the operator's separately authorized session (libpq
environment or service file). They never appear in this document, in shell history or in files. `$M` is
the `supabase/migrations` directory of a clean checkout of the release commit. `-X` skips `~/.psqlrc`.

---

## 0. Hard rules (read first)

1. **Never run `supabase db push`** or any bulk "apply pending" command against production. The ledger is
   desynced (`docs/migration-discipline.md:13-18`, `docs/PRODUCTION-DEPLOY-GOVERNANCE.md:120-122`). Apply
   **one file at a time**, in the order in §2, with the command in §4.0.
2. **`20261127000000_pi_prospect_lists.sql` sorts BEFORE migrations that are already on `main`**
   (`20261128000000` … `20261223000001`, 15 files, including PR #349's two `20261223…` files, which are
   applied in production). Ledger-based tooling would treat it as out of order or skip it. Apply it by hand as an individual file, like every other file here.
3. **Frozen history.** `scripts/migrations/historical-baseline.txt` (353 files) and
   `scripts/migrations/ordering-baseline.txt` (frozen snapshot, floor `20261026000000`) list migrations that
   must never be edited (`scripts/check-migration-quality.js:13-19, 56-63, 72`). All 19 stack files sort
   after the floor and are not in either list, so the quality gate validates them.
   `node scripts/check-migration-quality.js` on `aa5e6966`: `OK — 109 new migration(s) valid; 353
   historical frozen; ordering floor 20261026000000`, 0 violations (on the tree rebased onto `3e84f3ae`: 111 new,
   0 violations). Never edit an applied migration. Fix
   forward with a new file.
4. **One file = one transaction.** Every forward file is free of `BEGIN`/`COMMIT`/`CONCURRENTLY`/`VACUUM`,
   so `psql -1` wraps it in a single transaction. Any error rolls the whole file back.
5. **STOP rule (applies to every step).** If a command exits non-zero, prints `ERROR`, or a verification
   query differs from the expected result: **stop. Do not apply the next migration. Do not deploy code.**
   Record the output and escalate. The failed file has rolled back as a whole (rule 4).
6. Migrations go in **before** code (§5). The one unsafe ordering is deploying code before `…000002` (§5.1).
7. Do not select `rpa_sessions.storage_state` whole, anywhere, ever (§7). Counts only.

---

## 1. Release sequence at a glance

| Phase | What | Gate to the next phase |
|---|---|---|
| P0 | §3 read-only preflight (separately authorized) | results recorded; §3.4 decision says "apply" or "already applied, shape OK" for each file |
| P1 | §4: 18 migrations `20261127000000` … `20261231000009`, one at a time, in §2 order | each file's verification query matches |
| P2 | §5: ship web (Vercel) **and** worker (Railway) from the same commit; confirm builds | §5.3 checks pass |
| P3 | §7: `20261231000010` (RPA plaintext invalidation), then §8 `VACUUM FULL`, then the legacy-file purge | §7.3 checks pass |
| — | §9 rollback is only for a failed P1 step or an explicit decision; prefer rolling back code only (§9.1) | — |

Why `…000010` is in P3 and not P1: see §5.2. If the release owner nevertheless applies it in P1, **re-run
it in P3** (it is idempotent; a re-run against an already-scrubbed table changes nothing, see §12).

---

## 2. Migration inventory and dependency order

Apply in exactly this order. "Precondition" cites the file's own guard block (each one `RAISE`s and aborts
if unmet). "Implicit" lists objects the file needs that its guard does not name: the file fails with a less
specific error when they are missing. §3 checks them all.

| # | File | Precondition block | Creates / changes | Postcondition (asserted in-file) | Rollback file |
|---|---|---|---|---|---|
| 1 | `20261127000000_pi_prospect_lists.sql` | **none (no guard block).** Implicit: `companies`, `users` (FKs at lines 117, 129, 158, 173, 177), `canonical_leads` + unique index `idx_canonical_leads_id_company` (composite FK lines 228-230, header lines 31-34), function `omnivyra_touch_updated_at()` (lines 260-263), `auth.role()` (policies 271-289) | tables `prospect_lists`, `prospect_list_members`; indexes `uq_prospect_lists_id_org`, `idx_prospect_lists_org_status_created`, partial unique `uq_prospect_list_members_active`, 2 more; trigger `trg_prospect_lists_updated_at`; RLS + 2 service-role policies | none in-file. Use §4 V-1127 | **none** |
| 2 | `20261226000000_pi_prospect_campaigns.sql` | lines 84-91 (`companies`) | `prospect_campaigns`, `uq_prospect_campaigns_id_org`, guard trigger, RLS, policy | lines 179-239 | **none** |
| 3 | `20261227000000_pi_workflow_definitions.sql` | lines 87-93 (`companies`); re-run capture of an existing `publish_workflow_version` at lines 370-393 (refuses an unreadable channel list) | `workflows`, `workflow_versions` (+ `uq_workflow_versions_id_org`, `uq_workflow_versions_one_published`), 2 guard triggers, `publish_workflow_version(uuid,uuid,uuid)` (11 channels; re-run keeps a wider installed list, lines 510-541), session TEMP table `wf032_publish_prior` | lines 633-784. **Implicit:** indexes `outreach_tasks_identity_unique` (line 767) and `uq_prospect_icp_versions_one_ratified` (line 777) must exist | **none** |
| 4 | `20261228000000_pi_execution_instances.sql` | lines 83-105 (`workflows`, `workflow_versions`, `prospect_campaigns`, `canonical_leads`, `leads`, three `(id, organization_id)` companion keys) | `execution_instances`, `uq_execution_instances_active` (partial), guard trigger, `create_execution_instance(...)`, RLS | lines 445-563 (accepts 4 FKs, or 5 after #9, lines 498-506). Implicit: `outreach_tasks_identity_unique` (line 560) | **none** |
| 5 | `20261228000001_pi_execution_plans.sql` | lines 77-93 | `execution_plans`, `execution_plan_steps`, `execution_tasks`, 3 guard triggers, `create_execution_plan(...)` | lines 609-741 | **none** |
| 6 | `20261228000002_pi_execution_step_scheduling.sql` | lines 79-89 | `execution_plan_steps` + `ready_at`, `started_at`, `settled_at`, `completed_at`; `ix_execution_plan_steps_pending`; replaces step guard; `execution_step_anchor`, `advance_execution_plan`, `cancel_execution_run` | lines 453-583 | **none** |
| 7 | `20261229000000_pi_outreach_bridge.sql` | lines 60-74 (036 substrate, `outreach_tasks`, `unified_persons`) | `uq_execution_tasks_id_org`; `outreach_bridge_handoffs` (+ guard); `bridge_execution_task(...)` | lines 401-535 | **none** |
| 8 | `20261230000000_orchestration_engine_requests.sql` | lines 29-38 | `execution_engine_requests` (engine CHECK = `whatsapp` only; per-task unique), guard trigger, RLS, policy | lines 115-132 | **none** |
| 9 | `20261231000000_orchestration_campaign_targeting.sql` | lines 34-57 (#1, #2, #4, ICP model `prospect_icp_versions`, `prospect_score_evaluations`, six companion keys incl. `idx_canonical_leads_id_company`) | `prospect_lists.icp_id` (+ FK); `prospect_campaigns` targeting columns + guard; `prospect_campaign_lists`; `prospect_campaign_targets` (+ guard); FK `execution_instances_target_tenant_fk` | lines 300-323; **refuses if a table `prospect_list_memberships` exists** (lines 318-321) | `orchestration_campaign_targeting_rollback.sql` |
| 10 | `20261231000001_orchestration_engine_requests_engines.sql` | lines 18-24 (#8) | engine CHECK widened to `whatsapp, social_publish, community, browser` | lines 32-45 | `orchestration_engine_requests_engines_rollback.sql` |
| 11 | `20261231000002_community_execution_safety.sql` | lines 40-66 (`community_ai_actions` with `status, tenant_id, organization_id, cancel_requested_at`; `rpa_retry_queue`; claim column types) | `community_ai_actions_status_check` rewritten to the 12-value vocabulary (widen only; refuses to narrow, lines 99-114; prior definition stored in the constraint comment, lines 123-125); `rpa_retry_queue.claim_token`, `.claimed_at`, CHECK `rpa_retry_queue_claim_pair`, 2 partial indexes | lines 160-191 | `community_execution_safety_rollback.sql` |
| 12 | `20261231000003_community_journey_link.sql` | lines 52-74 (#5, #7, #8, `community_ai_actions.organization_id uuid`) | `uq_community_ai_actions_id_org` (**non-concurrent unique index on `community_ai_actions`**); `community_action_journey_links` + guard; RLS, policy | lines 202-264 (accepts 3 FKs, or 4 after #16, lines 222-230) | `community_journey_link_rollback.sql` |
| 13 | `20261231000004_social_publish_step_channel.sql` | lines 25-31 (#3) | `publish_workflow_version` replaced: 12 channels (`+ social_post`) and the `social_post.scheduled_post_id` rule | lines 183-190 | `social_publish_step_channel_rollback.sql` |
| 14 | `20261231000005_extension_dispatch_safety.sql` | lines 43-85 (`community_ai_execution_metric_events`, `community_ai_platform_policy`, 15 named action columns, **CHECK must already allow `uncertain` (#11)**) | `reap_community_ai_action_leases()` replaced (lapsed claims and executing timeouts become `uncertain`, lease kept); new `claim_community_ai_browser_command(...)`, `record_community_ai_late_dispatch_result(...)` (all SECURITY DEFINER, service_role only); table `rpa_auth_token_redemptions` | lines 405-456 | `extension_dispatch_safety_rollback.sql` |
| 15 | `20261231000006_community_identity_link.sql` | lines 55-94 (#12 table + guard, `identity_claims`, `uq_unified_persons_id_company`, `community_ai_discovered_users`, `community_ai_actions.discovered_user_id`, `leads`/`canonical_leads.unified_person_id`, `execution_tasks.subject_kind`) | link columns `person_id`, `identity_claim_id` (NOT NULL), FK `community_action_journey_links_person_fk`, index, `community_identity_normalize_external_id`, identity guard. **Refuses while any link lacks a person (lines 102-110). Apply it straight after #12, before code is deployed, so no link can exist.** | lines 306-338 | `community_identity_link_rollback.sql` |
| 16 | `20261231000007_identity_verification.sql` | lines 34-69 (#15 guard and function, CHECKs `identity_claims_verified_coherent`, `identity_claims_evidence_object`) | `identity_verification_attestations` (+ guard, RLS, policy); evidence guard trigger on links | lines 310-349 | `identity_verification_rollback.sql` |
| 17 | `20261231000008_engagement_request_idempotency.sql` | lines 35-52 (`companies`, `community_ai_actions`, CHECK allows `uncertain` (#11)) | `engagement_request_idempotency` (RLS on, no policies, service_role only) | lines 125-147 | `engagement_request_idempotency_rollback.sql` |
| 18 | `20261231000009_migration_rerun_safety.sql` | lines 55-77 (6 action columns, CHECK allows `uncertain`) | `community_ai_actions_reap_uncertain_guard()` (SECURITY INVOKER) + `CREATE OR REPLACE TRIGGER trg_community_ai_actions_reap_uncertain_guard` (**needs PostgreSQL ≥ 14**) | lines 141-186 | `migration_rerun_safety_rollback.sql` |
| 19 | `20261231000010_rpa_legacy_session_invalidation.sql` | **none (no guard block).** Implicit: `rpa_sessions` with `storage_state jsonb NOT NULL`, `account_tier`, `expires_at`, `updated_at`; roles `anon`, `authenticated` (line 56) | `rpa_session_invalidation_audit` (RLS, no policies); **data change:** every non-envelope `storage_state` overwritten with the invalidation marker (lines 65-122) | lines 124-149 (0 unscrubbed rows) | `rpa_legacy_session_invalidation_rollback.sql` — **always refuses** |

Dependency summary: 1→9; 2→4→5→6; 5→7→8→10, 12; 3→4, 13; 11→14, 17, 18; 12→15→16. Files #11, #13, #14,
#17, #18 do not depend on the PI chain (#1-#10). They still go in the §2 order, which was verified on
real PostgreSQL (§12).

Supabase-specific statements: #14 (lines 398-403), #17 (lines 117-120), #18 (line 139) and #19 (line 56)
`REVOKE`/`GRANT` to the roles `anon`, `authenticated`, `service_role` unconditionally and fail if a role is
missing. §3 P0 checks this.

Lock notes (every file holds its locks until its single transaction commits):
- #11: `DROP`/`ADD CONSTRAINT … CHECK` on `community_ai_actions` takes ACCESS EXCLUSIVE and scans the table
  to validate. Two non-concurrent `CREATE INDEX` on `rpa_retry_queue` take SHARE (block writes).
- #12: non-concurrent `CREATE UNIQUE INDEX uq_community_ai_actions_id_org` takes SHARE on
  `community_ai_actions`, blocking writes while it builds.
- #18: `CREATE OR REPLACE TRIGGER` on `community_ai_actions` takes SHARE ROW EXCLUSIVE.
- #19: row locks (`FOR UPDATE`) on `rpa_sessions`, batches of 500.

Use the `lock_timeout` in §4.0 so a lock wait fails fast and rolls back. Do not let it queue behind a long
transaction and block the application. Check sizes with §3 P12.

---

## 3. Mandatory READ-ONLY preflight (separately authorized)

Authorization for this section is separate from the apply authorization. Every query is a catalog read,
an aggregate count, or a `to_regclass` / `pg_get_*def` lookup. None reads row contents. The session is
forced read-only.

### 3.1 How to run

```bash
psql -X -v ON_ERROR_STOP=1 \
  -c "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY" \
  -f preflight.sql            # paste the P-queries below into preflight.sql
```

Record the full output in the release ticket. **Expected results below are what the queries return
before and after the chain** (both shapes were produced on the disposable database, §12).

### 3.2 Queries

**P0: target, version, roles.** Expect `in_recovery = f` (primary), `server_version_num ≥ 140000`
(required by #18), and roles `{anon,authenticated,service_role}`. Any other result means STOP.

```sql
SELECT current_database()                                   AS db,
       current_user                                         AS role,
       pg_is_in_recovery()                                  AS in_recovery,
       current_setting('server_version_num')::int           AS server_version_num,
       current_setting('server_version_num')::int >= 140000 AS create_or_replace_trigger_ok,
       (SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles
         WHERE rolname IN ('anon', 'authenticated', 'service_role')) AS supabase_roles;
```

**P1: ledger (advisory only; it is desynced).** For information. Never conclude "applied" or "absent"
from this table alone.

```sql
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version >= '20261100000000'
 ORDER BY version;
```

**P2: stack objects (tables and indexes) per migration.** Fully applied stack: 27 rows, all `t`. Pre-stack
DB: `f` for the objects of every file not yet applied.

```sql
SELECT m.migration, m.object, to_regclass(m.object) IS NOT NULL AS present
  FROM (VALUES
    ('20261127000000', 'public.prospect_lists'),
    ('20261127000000', 'public.prospect_list_members'),
    ('20261127000000', 'public.uq_prospect_list_members_active'),
    ('20261226000000', 'public.prospect_campaigns'),
    ('20261226000000', 'public.uq_prospect_campaigns_id_org'),
    ('20261227000000', 'public.workflows'),
    ('20261227000000', 'public.workflow_versions'),
    ('20261228000000', 'public.execution_instances'),
    ('20261228000000', 'public.uq_execution_instances_active'),
    ('20261228000001', 'public.execution_plans'),
    ('20261228000001', 'public.execution_plan_steps'),
    ('20261228000001', 'public.execution_tasks'),
    ('20261228000002', 'public.ix_execution_plan_steps_pending'),
    ('20261229000000', 'public.outreach_bridge_handoffs'),
    ('20261229000000', 'public.uq_execution_tasks_id_org'),
    ('20261230000000', 'public.execution_engine_requests'),
    ('20261231000000', 'public.prospect_campaign_lists'),
    ('20261231000000', 'public.prospect_campaign_targets'),
    ('20261231000002', 'public.idx_rpa_retry_queue_due_unclaimed'),
    ('20261231000002', 'public.idx_rpa_retry_queue_claimed'),
    ('20261231000003', 'public.community_action_journey_links'),
    ('20261231000003', 'public.uq_community_ai_actions_id_org'),
    ('20261231000005', 'public.rpa_auth_token_redemptions'),
    ('20261231000006', 'public.ix_community_action_journey_links_person'),
    ('20261231000007', 'public.identity_verification_attestations'),
    ('20261231000008', 'public.engagement_request_idempotency'),
    ('20261231000010', 'public.rpa_session_invalidation_audit')
  ) AS m(migration, object)
 ORDER BY m.migration, m.object;
```

**P3: stack functions.** Fully applied: 18 rows, `overloads = 1` each. `reap_community_ai_action_leases`
pre-exists on main (`1` before #14 as well), so use P6 for its body.

```sql
SELECT m.migration, m.fn, count(p.oid) AS overloads
  FROM (VALUES
    ('20261226000000', 'prospect_campaigns_guard'),
    ('20261227000000', 'publish_workflow_version'),
    ('20261228000000', 'create_execution_instance'),
    ('20261228000001', 'create_execution_plan'),
    ('20261228000002', 'advance_execution_plan'),
    ('20261228000002', 'cancel_execution_run'),
    ('20261229000000', 'bridge_execution_task'),
    ('20261230000000', 'execution_engine_requests_guard'),
    ('20261231000000', 'prospect_campaigns_targeting_guard'),
    ('20261231000003', 'community_action_journey_links_guard'),
    ('20261231000005', 'reap_community_ai_action_leases'),
    ('20261231000005', 'claim_community_ai_browser_command'),
    ('20261231000005', 'record_community_ai_late_dispatch_result'),
    ('20261231000006', 'community_action_journey_links_identity_guard'),
    ('20261231000006', 'community_identity_normalize_external_id'),
    ('20261231000007', 'identity_verification_attestations_guard'),
    ('20261231000007', 'community_action_journey_links_identity_proof_guard'),
    ('20261231000009', 'community_ai_actions_reap_uncertain_guard')
  ) AS m(migration, fn)
  LEFT JOIN pg_proc p
    ON p.proname = m.fn AND p.pronamespace = 'public'::regnamespace
 GROUP BY m.migration, m.fn
 ORDER BY m.migration, m.fn;
```

**P4: added columns.** Fully applied: 8 rows `t`.

```sql
SELECT m.migration, m.tbl, m.col,
       EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'public' AND c.table_name = m.tbl
                  AND c.column_name = m.col) AS present
  FROM (VALUES
    ('20261228000002', 'execution_plan_steps',           'ready_at'),
    ('20261228000002', 'execution_plan_steps',           'completed_at'),
    ('20261231000000', 'prospect_lists',                 'icp_id'),
    ('20261231000000', 'prospect_campaigns',             'targeting_mode'),
    ('20261231000002', 'rpa_retry_queue',                'claim_token'),
    ('20261231000002', 'rpa_retry_queue',                'claimed_at'),
    ('20261231000006', 'community_action_journey_links', 'person_id'),
    ('20261231000006', 'community_action_journey_links', 'identity_claim_id')
  ) AS m(migration, tbl, col)
 ORDER BY 1, 2, 3;
```

**P5: constraint definitions**, including `community_ai_actions_status_check`.

```sql
SELECT c.conrelid::regclass                    AS tbl,
       c.conname,
       pg_get_constraintdef(c.oid)             AS definition,
       obj_description(c.oid, 'pg_constraint') AS comment
  FROM pg_constraint c
 WHERE (c.conrelid, c.conname) IN (
         (to_regclass('public.community_ai_actions'),           'community_ai_actions_status_check'),
         (to_regclass('public.rpa_retry_queue'),                'rpa_retry_queue_claim_pair'),
         (to_regclass('public.execution_engine_requests'),      'execution_engine_requests_engine_valid'),
         (to_regclass('public.execution_instances'),            'execution_instances_target_tenant_fk'),
         (to_regclass('public.community_action_journey_links'), 'community_action_journey_links_person_fk'))
 ORDER BY 1, 2;
```

Expected shapes:
- Before #11: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'executed'::text, 'failed'::text, 'skipped'::text])))`
  with an empty comment. That is the production baseline according to #11's header, lines 9-13. The
  migration-built shape (11 values, no `uncertain`) is also accepted by #11.
- After #11: 12 values ending in `'uncertain'::text`. The comment starts
  `community_execution_safety prior_definition: CHECK ((status = ANY (…` and holds the previous definition
  verbatim. **The #11 rollback depends on this comment. Never drop or edit it.**
- Any other shape (not `CHECK ((status = ANY (…`, or values outside the 12) means #11 will refuse. STOP and
  escalate.
- `execution_engine_requests_engine_valid`: `CHECK ((engine = 'whatsapp'::text))` before #10, and the
  4-engine `ANY (ARRAY[…])` form after.

**P6: lease reaper body markers.** `marks_failed = t, marks_uncertain = f` means the legacy body (before
#14; the duplicate-send hazard). `marks_failed = f, marks_uncertain = t, records_may_have_acted = t` means
the #14 body.

```sql
SELECT p.oid::regprocedure                         AS fn,
       p.prosecdef                                 AS security_definer,
       p.prosrc ~ 'status\s*=\s*''failed'''        AS marks_failed,
       p.prosrc LIKE '%''uncertain''%'             AS marks_uncertain,
       p.prosrc LIKE '%''may_have_acted''%'        AS records_may_have_acted,
       left(obj_description(p.oid, 'pg_proc'), 40) AS comment_prefix
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.reap_community_ai_action_leases()');
```

**P7: re-run guard trigger (#18).** 0 rows before #18. After it: 1 row with `tgenabled = O` and
`security_definer = f`.

```sql
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = to_regclass('public.community_ai_actions')
   AND NOT t.tgisinternal
   AND t.tgname = 'trg_community_ai_actions_reap_uncertain_guard';
```

**P8: `publish_workflow_version` channel list.** NULL before #3. After #3: 11 channels
`{community,content,discord,email,github,internal,linkedin,phone,slack,sms,whatsapp}`. After #13: 12
channels, adding `social_post`.

```sql
SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) AS publish_channels,
       count(DISTINCT m[1])                   AS n_channels
  FROM regexp_matches(
         substring(pg_get_functiondef(to_regprocedure('public.publish_workflow_version(uuid,uuid,uuid)'))
                   FROM $re$\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)$re$),
         $re$'([a-z_]+)'$re$, 'g') AS m;
```

**P9 / P9b: `rpa_sessions` by format, counts only.** Never select `storage_state`. Record both results:
they are the "before" numbers for §7.

```sql
SELECT CASE
         WHEN COALESCE(jsonb_typeof(storage_state) = 'object'
                       AND storage_state->>'format' = 'omnivyra.rpa_session.v1'
                       AND storage_state->>'alg' = 'aes-256-gcm'
                       AND jsonb_typeof(storage_state->'ciphertext') = 'string'
                       AND (storage_state->>'ciphertext') ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$',
                       false)                                            THEN 'envelope_v1'
         WHEN COALESCE(jsonb_typeof(storage_state) = 'object'
                       AND storage_state->>'format' = 'omnivyra.rpa_session.invalidated',
                       false)                                            THEN 'invalidated_marker'
         ELSE 'legacy_or_malformed'
       END                                                               AS class,
       count(*)                                                          AS sessions,
       count(DISTINCT organization_id)                                   AS orgs,
       count(*) FILTER (WHERE expires_at IS NULL OR expires_at > now())  AS unexpired
  FROM public.rpa_sessions
 GROUP BY 1
 ORDER BY 1;

SELECT CASE
         WHEN jsonb_typeof(storage_state) IS DISTINCT FROM 'object' THEN '(not an object)'
         WHEN storage_state->>'format' IS NULL                       THEN '(no format key)'
         WHEN storage_state->>'format' IN ('omnivyra.rpa_session.v1',
                                           'omnivyra.rpa_session.invalidated')
                                                                     THEN storage_state->>'format'
         ELSE '(other format value)'
       END      AS format,
       count(*) AS sessions
  FROM public.rpa_sessions
 GROUP BY 1
 ORDER BY 1;
```

The `class` predicate is the exact one #19 uses (lines 74-86), so `legacy_or_malformed` is the number of
rows #19 will overwrite. P9b never echoes an unexpected `format` value. It buckets it as
`(other format value)`.

**P10: `community_ai_actions` status counts.** #11 refuses if any row holds a status outside the 12-value
vocabulary (lines 110-114).

```sql
SELECT status, count(*) AS actions
  FROM public.community_ai_actions
 GROUP BY status
 ORDER BY status;
```

**P11 / P11b: dependencies the stack needs from main.** Every row must be `t`, and P11b must read
`t, 2, 17, 3, 2`. A `f` means the main-branch migration that creates that object is not applied. STOP:
applying that migration is a separate decision outside this runbook.

```sql
SELECT m.needed_by, m.object, to_regclass(m.object) IS NOT NULL AS present
  FROM (VALUES
    ('20261127 / 20261231000000',  'public.canonical_leads'),
    ('20261127 / 20261231000000',  'public.idx_canonical_leads_id_company'),
    ('all',                        'public.companies'),
    ('20261127',                   'public.users'),
    ('20261228000000',             'public.leads'),
    ('20261227 / 20261228000000',  'public.outreach_tasks_identity_unique'),
    ('20261227',                   'public.uq_prospect_icp_versions_one_ratified'),
    ('20261229000000',             'public.outreach_tasks'),
    ('20261229000000',             'public.unified_persons'),
    ('20261231000000',             'public.prospect_icps'),
    ('20261231000000',             'public.prospect_icp_versions'),
    ('20261231000000',             'public.prospect_score_evaluations'),
    ('20261231000000',             'public.uq_prospect_icps_id_org'),
    ('20261231000000',             'public.uq_prospect_icp_versions_identity'),
    ('20261231000000',             'public.uq_prospect_score_evaluations_id_org'),
    ('20261231000002/3/5/8/9',     'public.community_ai_actions'),
    ('20261231000002',             'public.rpa_retry_queue'),
    ('20261231000005',             'public.community_ai_execution_metric_events'),
    ('20261231000005',             'public.community_ai_platform_policy'),
    ('20261231000006 / 7',         'public.identity_claims'),
    ('20261231000006 / 7',         'public.uq_unified_persons_id_company'),
    ('20261231000006 / 7',         'public.community_ai_discovered_users'),
    ('20261231000010',             'public.rpa_sessions')
  ) AS m(needed_by, object)
 ORDER BY 1, 2;

SELECT to_regprocedure('public.omnivyra_touch_updated_at()') IS NOT NULL AS touch_fn_present,
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = to_regclass('public.identity_claims')
           AND conname IN ('identity_claims_verified_coherent', 'identity_claims_evidence_object')
           AND contype = 'c')                                     AS identity_claims_checks_of_2,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
           AND column_name IN ('id', 'organization_id', 'tenant_id', 'status', 'execution_mode',
                               'execution_result', 'execution_correlation_id', 'dispatch_lease_id',
                               'dispatch_lease_expires_at', 'dispatch_lease_holder_id',
                               'dispatch_acknowledged_at', 'cancel_requested_at', 'approved_at',
                               'requires_human_approval', 'risk_level', 'updated_at',
                               'discovered_user_id'))             AS community_ai_actions_cols_of_17,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy'
           AND column_name IN ('execution_enabled', 'require_human_approval', 'updated_at'))
                                                                  AS policy_cols_of_3,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'unified_person_id'
           AND table_name IN ('leads', 'canonical_leads'))        AS unified_person_id_cols_of_2;
```

Also required: a competing list table must be absent, or #9 refuses (lines 318-321). Expect `t`.

```sql
SELECT to_regclass('public.prospect_list_memberships') IS NULL AS competing_list_table_absent;
```

**P12: sizes for lock planning.**

```sql
SELECT c.oid::regclass                               AS tbl,
       c.reltuples::bigint                           AS est_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
  FROM pg_class c
 WHERE c.oid IN (to_regclass('public.community_ai_actions'),
                 to_regclass('public.rpa_retry_queue'),
                 to_regclass('public.rpa_sessions'),
                 to_regclass('public.workflow_versions'))
 ORDER BY 1;
```

**P13: stack triggers.** Fully applied: the 6 rows listed in the query.

```sql
SELECT t.tgrelid::regclass AS tbl, t.tgname
  FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('trg_community_action_journey_links_guard',
                    'trg_community_action_journey_links_identity_guard',
                    'trg_community_action_journey_links_identity_proof_guard',
                    'trg_identity_verification_attestations_guard',
                    'trg_prospect_campaigns_targeting_guard',
                    'trg_execution_engine_requests_guard')
 ORDER BY 1, 2;
```

### 3.3 Is `20261127000000` already in production?

It may be. The file is byte-identical in every commit that carries it (blob `2968f493`). Check P2 rows
`20261127000000`. If they are present, run the shape check below. The file uses `CREATE TABLE IF NOT
EXISTS`, so a differently shaped pre-existing table would be **silently kept**, and #9 checks only that it
exists.

```sql
SELECT c.conrelid::regclass AS tbl, c.conname, c.contype
  FROM pg_constraint c
 WHERE c.conrelid IN (to_regclass('public.prospect_lists'), to_regclass('public.prospect_list_members'))
 ORDER BY 1, 2;

SELECT table_name, string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS columns
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('prospect_lists', 'prospect_list_members')
 GROUP BY table_name
 ORDER BY table_name;
```

Expected after #1 and before #9:
- 14 constraints: `prospect_lists_{created_by_user_id_fkey, name_not_blank, organization_id_fkey, pkey, status_valid}`
  and `prospect_list_members_{added_by_user_id_fkey, added_via_not_blank, list_fk, organization_id_fkey, pkey, prospect_fk, removal_coherent, removed_by_user_id_fkey, status_valid}`.
  #9 adds a 15th, `prospect_lists_icp_tenant_fk`.
- `prospect_lists` columns: `id, organization_id, name, description, status, created_by_user_id, created_at, updated_at`
  (#9 appends `icp_id`).
- `prospect_list_members` columns: `id, organization_id, list_id, prospect_id, status, added_via, added_at, added_by_user_id, removed_at, removed_by_user_id, removal_reason`.

Decision: if both tables are absent, apply #1. If both are present with exactly this shape, re-applying #1
is harmless (idempotent), and skipping it is acceptable. If they are present with a different shape, or
only one table exists, **STOP**. That is drift, and it is outside this runbook.

### 3.4 Decision per file

For each file, P2 to P8 and P13 put it in one of three states:

| State | Meaning | Action |
|---|---|---|
| all of its markers absent | not applied | apply (§4) |
| all present and shapes as expected (P5/P6/P8) | applied | re-applying is safe: all 19 files re-ran cleanly on an applied DB (§12). Still run its verification query |
| some present | partial or drifted | **STOP**, escalate. Do not "complete" it by hand |

---

## 4. Apply (P1), one file at a time

### 4.0 Command (same for every file)

```bash
psql -X -v ON_ERROR_STOP=1 -1 \
  -c "SET LOCAL lock_timeout = '5s'" \
  -f "$M/<file>.sql"
```

- `-1` with `-c` and `-f` runs both inside one `BEGIN … COMMIT`: `SET LOCAL` applies to the migration and
  is discarded at commit (validated, §12). Pick a `lock_timeout` that suits production. 5 s is a starting
  point.
- Exit code 0 and no `ERROR` means the file committed. `NOTICE … already exists, skipping` is normal on a
  re-run.
- Any `ERROR` (including `canceling statement due to lock timeout`) means **nothing from that file
  committed**. STOP (rule 5). A lock-timeout failure is safe to retry as-is once the blocker is gone. Any
  other error is not a retry case: escalate.
- Then run the file's verification query below. A mismatch means STOP.
- Use a direct, session-level connection. #3 creates a session TEMP table (lines 369-374, dropped at line
  786). Within one `-1` transaction that is fine even through a transaction pooler. Whether the Supabase
  SQL editor runs a whole script as one transaction is UNKNOWN — verify. Prefer `psql -1`.
- Ledger: recording each file in `supabase_migrations.schema_migrations` is optional project practice
  (`docs/migration-discipline.md:59-68`). Do it only if the release owner decides to. It is not part of
  this runbook's success criteria.

### 4.1 Steps and verification

Every verification query below was run on the disposable DB. "Expect" is the result it returned there.

**#1 `20261127000000_pi_prospect_lists.sql`** (only per §3.3). Verify V-1127. Expect
`t, t, 5, t, t, 2` (5 = member FKs: org, added_by, removed_by, list, prospect).
```sql
SELECT to_regclass('public.prospect_lists') IS NOT NULL                    AS lists,
       to_regclass('public.prospect_list_members') IS NOT NULL             AS members,
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = to_regclass('public.prospect_list_members') AND contype = 'f') AS member_fks,
       (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.prospect_lists'))        AS lists_rls,
       (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.prospect_list_members')) AS members_rls,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
         AND policyname IN ('prospect_lists_service_role', 'prospect_list_members_service_role')) AS policies_of_2;
```
Recovery: safe to re-run. No rollback file exists. Never drop these tables while #9 objects or list data
exist.

**#2 `20261226000000_pi_prospect_campaigns.sql`.** Verify V-1226. Expect `t, t, t`.
```sql
SELECT to_regclass('public.prospect_campaigns') IS NOT NULL           AS campaigns,
       to_regclass('public.uq_prospect_campaigns_id_org') IS NOT NULL AS companion_key,
       (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.prospect_campaigns')) AS rls;
```

**#3 `20261227000000_pi_workflow_definitions.sql`.** Verify V-1227 (expect `t, t, t, f, f`) and P8 (11
channels).
```sql
SELECT to_regclass('public.workflows') IS NOT NULL                          AS workflows,
       to_regclass('public.workflow_versions') IS NOT NULL                  AS versions,
       to_regclass('public.uq_workflow_versions_one_published') IS NOT NULL AS one_published,
       has_function_privilege('anon', to_regprocedure('public.publish_workflow_version(uuid,uuid,uuid)'), 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', to_regprocedure('public.publish_workflow_version(uuid,uuid,uuid)'), 'EXECUTE') AS auth_exec;
```
Recovery: safe to re-run, including after #13. On a re-run it re-installs the wider installed body and
emits `NOTICE … kept the installed wider publish_workflow_version vocabulary`.

**#4, #5, #6 `20261228000000` / `…000001` / `…000002`.** Apply in that order. Verify after #6. Expect
`t, 5, 4`.
```sql
SELECT to_regclass('public.uq_execution_instances_active') IS NOT NULL AS active_uniqueness,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('create_execution_instance', 'create_execution_plan',
                         'advance_execution_plan', 'cancel_execution_run', 'execution_step_anchor')) AS fns_of_5,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name = 'execution_plan_steps'
         AND column_name IN ('ready_at', 'started_at', 'settled_at', 'completed_at'))                  AS timing_cols_of_4;
```
(After #4 alone, P2's `20261228000000` rows must already be `t`.)

**#7, #8 `20261229000000`, `20261230000000`.** Verify after #8. Expect `t, t, t, t`.
```sql
SELECT to_regclass('public.outreach_bridge_handoffs') IS NOT NULL       AS handoffs,
       to_regclass('public.uq_execution_tasks_id_org') IS NOT NULL      AS task_companion_key,
       to_regclass('public.execution_engine_requests') IS NOT NULL      AS engine_requests,
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = to_regclass('public.execution_engine_requests')
                  AND conname = 'execution_engine_requests_task_unique') AS per_task_unique;
```

**#9 `20261231000000_orchestration_campaign_targeting.sql`.** Verify V-0000. Expect `t, t, t`.
```sql
SELECT to_regclass('public.prospect_campaign_lists') IS NOT NULL   AS campaign_lists,
       to_regclass('public.prospect_campaign_targets') IS NOT NULL AS campaign_targets,
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = to_regclass('public.execution_instances')
                  AND conname = 'execution_instances_target_tenant_fk') AS instance_target_fk;
```

**#10 `20261231000001_orchestration_engine_requests_engines.sql`.** Verify V-0001. Expect
`CHECK ((engine = ANY (ARRAY['whatsapp'::text, 'social_publish'::text, 'community'::text, 'browser'::text])))`.
```sql
SELECT pg_get_constraintdef(oid) AS engine_check
  FROM pg_constraint
 WHERE conrelid = to_regclass('public.execution_engine_requests')
   AND conname = 'execution_engine_requests_engine_valid';
```

**#11 `20261231000002_community_execution_safety.sql` (MUST precede code).** Before applying, P10 must
show only statuses inside the 12-value vocabulary. Verify V-0002. Expect
`{acknowledged,approved,blocked,dispatched,executed,executing,failed,pending,scheduled,sent_unverified,skipped,uncertain}`,
`community_execution_safety prior_definition:`, `2`, `t`.
```sql
SELECT (SELECT array_agg(m[1] ORDER BY m[1])
          FROM regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m) AS allowed_statuses,
       left(obj_description(c.oid, 'pg_constraint'), 44) AS rollback_comment_prefix,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name = 'rpa_retry_queue' AND column_name IN ('claim_token', 'claimed_at')) AS claim_cols_of_2,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.rpa_retry_queue')
                AND conname = 'rpa_retry_queue_claim_pair') AS claim_pair
  FROM pg_constraint c
 WHERE c.conrelid = to_regclass('public.community_ai_actions')
   AND c.conname = 'community_ai_actions_status_check';
```
Recovery: a re-run is a no-op (`NOTICE … already is the complete vocabulary`). If it refuses with "allows
… which the new vocabulary lacks" or "rows hold a status outside the vocabulary", STOP. Do not edit the
constraint by hand.

**#12 `20261231000003_community_journey_link.sql`.** Verify V-0003. Expect `t, t, 3, f` right after #12,
and `link_fks = 4` once #15 is in.
```sql
SELECT to_regclass('public.community_action_journey_links') IS NOT NULL AS links,
       to_regclass('public.uq_community_ai_actions_id_org') IS NOT NULL AS action_companion_key,
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = to_regclass('public.community_action_journey_links') AND contype = 'f') AS link_fks,
       has_table_privilege('anon', to_regclass('public.community_action_journey_links'), 'SELECT') AS anon_select;
```

**#13 `20261231000004_social_publish_step_channel.sql`.** Verify V-0004 (expect `t`) and P8 (12 channels).
```sql
SELECT position('''social_post''' IN pg_get_functiondef(
         to_regprocedure('public.publish_workflow_version(uuid,uuid,uuid)'))) > 0 AS accepts_social_post;
```

**#14 `20261231000005_extension_dispatch_safety.sql` (MUST precede code).** Verify V-0005. Expect 3 rows
`t, t, f, f, t`, then `t, f, t`. P6 must read `f, t, t`.
```sql
SELECT f.sig,
       to_regprocedure(f.sig) IS NOT NULL                                       AS present,
       (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f.sig))         AS security_definer,
       has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')  AS service_exec
  FROM (VALUES ('public.reap_community_ai_action_leases()'),
               ('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)'),
               ('public.record_community_ai_late_dispatch_result(uuid,uuid,text,text,jsonb)')) AS f(sig);

SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.rpa_auth_token_redemptions')) AS redemptions_rls,
       has_table_privilege('anon', to_regclass('public.rpa_auth_token_redemptions'), 'SELECT')          AS anon_select,
       has_table_privilege('service_role', to_regclass('public.rpa_auth_token_redemptions'), 'INSERT')  AS service_insert;
```
Effect on the running (old) worker: its 30 s reaper cron (`backend/scheduler/cron.ts:725-752`) calls the
same RPC name, which has the same `jsonb` return shape, so it keeps working. From this point, lapsed claims
become `uncertain` instead of `failed`. That is the intended safety change. How main's code treats
`uncertain` rows: its `TERMINAL_ROW_STATUSES` (`backend/services/communityAiExecutionResultService.ts:36`
at `d51360b0`) does not include `uncertain`. Old-code behaviour on such rows is UNKNOWN — verify. Keep the
window between #14 and the code deploy short.

**#15 `20261231000006_community_identity_link.sql`.** Apply immediately after #12 to #14, before any code
deploy. Verify after #16.

**#16 `20261231000007_identity_verification.sql`.** Verify V-0006/7. Expect `2, t, t, f`.
```sql
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name = 'community_action_journey_links'
         AND column_name IN ('person_id', 'identity_claim_id') AND is_nullable = 'NO') AS not_null_person_cols_of_2,
       to_regclass('public.identity_verification_attestations') IS NOT NULL         AS attestations,
       (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.identity_verification_attestations')) AS attestations_rls,
       has_table_privilege('authenticated', to_regclass('public.identity_verification_attestations'), 'SELECT') AS auth_select;
```

**#17 `20261231000008_engagement_request_idempotency.sql` (MUST precede code).** Verify V-0008. Expect
`t, 0, t, f, t`.
```sql
SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.engagement_request_idempotency')) AS rls,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
         AND tablename = 'engagement_request_idempotency')                                 AS policies,
       to_regclass('public.uq_engagement_request_idempotency_key') IS NOT NULL             AS natural_key,
       has_table_privilege('anon', to_regclass('public.engagement_request_idempotency'), 'SELECT')          AS anon_select,
       has_table_privilege('service_role', to_regclass('public.engagement_request_idempotency'), 'INSERT')  AS service_insert;
```

**#18 `20261231000009_migration_rerun_safety.sql`.** Verify V-0009 (expect
`trg_community_ai_actions_reap_uncertain_guard, O, f, f`). Then re-run the whole §3 preflight and compare
with the fully applied shapes (P2 all `t`, P3 all `1`, P4 all `t`, P6 `f,t,t`, P7 1 row, P8 12 channels,
P13 6 rows).
```sql
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = to_regclass('public.community_ai_actions')
   AND t.tgname = 'trg_community_ai_actions_reap_uncertain_guard' AND NOT t.tgisinternal;
```

**#19 `20261231000010`**: in P3, see §7.

### 4.2 Recovery guidance (all P1 files)

- **Safe to retry:** any file whose transaction failed (nothing committed). Also any fully applied file:
  every forward file is idempotent. The full chain re-ran cleanly, in one transaction, on a DB where it was
  already applied (§12).
- **Do not "fix" a refusal by editing SQL or catalog state.** Refusals are designed: wrong prior CHECK
  shape, rows outside the vocabulary, links without a person, competing list table, missing dependency.
  Escalate.
- **Do not roll back committed P1 files to "clean up" after a later failure.** Every P1 file is additive
  and compatible with the old code still running (§5.1). Leave committed files in place, stop, and fix
  forward or decide on §9 deliberately.
- Rolling back is never required to retry a failed file.

---

## 5. Code / plane compatibility and deploy (P2)

### 5.1 What must precede the code deploy, and why

All of P1 must be applied before code. The ordering is: migrations, then web and worker together, then
P3. The code dependencies:

| Migration | Code that depends on it | Without it (code deployed first) |
|---|---|---|
| `…000002` (#11) | executor writes `executing` / `uncertain` / `sent_unverified` / `blocked` (`backend/services/communityAiActionExecutorContracts.ts:569-575, 590, 637, 666`; `backend/services/communityAiActionExecutorRuntime.ts:472-483`); RPA retry flush CAS on `claim_token` (`backend/services/rpaWorker/rpaRetryQueue.ts:147-156, 203-208`) | **THE UNSAFE PATH.** The old CHECK (`pending/approved/executed/failed/skipped`, #11 lines 9-13) rejects `uncertain`. A may-have-acted outcome cannot be recorded as `uncertain`, so the row stays claimed/`executing`. The old reaper body (still installed without #14) then marks it `failed` with `EXECUTING_TIMEOUT` / `DISPATCH_LEASE_EXPIRED*`, which reads as "not acted". A deterministic action id can revive it to `pending`: **possible duplicate send** (#18 header lines 4-17). The retry flush selects on a missing column and processes nothing (fails closed). |
| `…000005` (#14) | `pages/api/extension/commands.ts:320-330` (claim RPC; on error, command not offered), `pages/api/extension/action-result.ts:95-104` (late result RPC; 500 on error), `backend/services/rpaWorker/rpaAuthTokens.ts:184-196` (token redemption insert; 503 `TOKEN_REDEMPTION_UNAVAILABLE`), reaper semantics relied on by `backend/services/engagementDispatchRecoveryService.ts:239-249` | browser-extension dispatch halts (fails closed); late results 500; RPA login impossible (503); old reaper keeps marking possibly-delivered rows `failed` |
| `…000008` (#17) | `pages/api/engagement/reply.ts:820`, `pages/api/engagement/like.ts:166`, `pages/api/engagement/message/bulk-like.ts:153` → `reserveEngagementRequest` (`backend/services/engagementRequestIdempotency.ts:264-267, 350, 404`) | reply / like / bulk-like return **503 `IDEMPOTENCY_UNAVAILABLE`**, nothing sent |
| `…000009` (#18) | none (defence in depth: converts any `failed` reaper write on a claimed row to `uncertain`) | the safety net is absent. Apply anyway |
| `20261127` … `…000001`, `…000003`, `…000004`, `…000006`, `…000007` | new capability-gated routes, live on deploy: `pages/api/prospect-lists/*`, `pages/api/prospect-campaigns/*`, `pages/api/workflows/*`, `pages/api/execution-instances/*` (incl. `community-link.ts`), `pages/api/identity-verification/attestations.ts`; `social_post` is in `WORKFLOW_STEP_CHANNELS` (`backend/services/workflows/workflowStore.ts:101`) | those routes error on missing relations. Publishing a version with a `social_post` step is refused by the DB (`wf_publish:invalid_step`) without #13 |
| `…000010` (#19) | **none found.** New code classifies every non-envelope row as `reauth_required` whether or not the marker is present (`backend/services/rpaWorker/rpaSessionStore.ts:78-100`; `backend/services/platformHealth/platformHealthService.ts:142, 156`; `pages/api/rpa/auth/callback.ts:59-68`). Only the reason label differs (`legacy_plaintext` vs `invalidated`) | see §5.2 |

Every P1 file is additive for the **old** code (`d51360b0`): the old code never reads the new tables or
RPCs; the wider CHECK accepts all old statuses; the replaced reaper keeps its name and return shape;
`publish_workflow_version` keeps its signature. So the window "P1 done, old code still running" is safe,
apart from the UNKNOWN noted under #14 in §4.1.

### 5.2 Why `…000010` goes after the deploy (discrepancy with the brief for this runbook)

The brief for this runbook listed `…000010` as pre-deploy. The code does not support that:
- Old code (`d51360b0`) **writes plaintext** on every RPA login (`saveRpaSession` upserts `storage_state:
  state` and also writes a plaintext file under `$RPA_SESSION_DIR || tmp/rpa-sessions`). Its loader **falls
  back to that file** when the DB row is expired (`git show d51360b0:backend/services/rpaWorker/rpaSessionStore.ts`,
  `loadRpaSession` / `loadFromFs`). #19 clamps `expires_at` to now, so old code would silently fall back to
  the plaintext file, and any login before the deploy recreates a plaintext row that #19 has already
  passed.
- New code refuses plaintext rows with or without #19 (table in §5.1).

So apply #19 in P3, after **both** planes run the new code. If it was applied in P1, re-run it in P3. A
re-run on a scrubbed table writes 0 rows and 0 audit rows (§12).

### 5.3 Shipping web and worker together

Sources: `docs/PRODUCTION-DEPLOY-GOVERNANCE.md:6-17, 53-95`.

- **Worker (Railway):** auto-deploys on push to `main` (`docs/PRODUCTION-DEPLOY-GOVERNANCE.md:11`),
  building `Dockerfile.worker` (`railway.json`). **So P1 must be complete before the stack is merged to
  `main`**: the merge itself deploys the worker. Whether auto-deploy is currently enabled is UNKNOWN —
  verify in the Railway dashboard before merging.
- **Web (Vercel):** manual. Run `npm run deploy:prod` (= `scripts/predeploy-check.js`, which requires a
  clean tree at the exact `origin/main` tip, then `vercel --prod --skip-domain` with
  `VERCEL_GIT_COMMIT_SHA` injected by `scripts/vercel-deploy-prod.js`). Then
  `npm run verify:deployment -- <url>`, then `vercel promote <url>`, then
  `npm run verify:deployment -- --alias`.
- The two planes cannot switch atomically. Do the Vercel deploy immediately after the worker deploy and
  keep the gap short. Mixed-version effects: a login on the old web writes a plaintext session that the new
  worker refuses, so that org re-logs in after the web deploy. Old-web extension claims bypass the new
  claim RPC until the web deploy.
- **Build confirmation:**
  - Web: `GET /api/health/version` → `build` must equal the full 40-character release commit SHA
    (`pages/api/health/version.ts:26-31`; `build` = `VERCEL_GIT_COMMIT_SHA`, from
    `backend/security/startup/bootFingerprint.ts:99-103`).
  - Worker: the worker's `/health` (`backend/workers/healthServer.ts:138-149`) reports **no build
    identity**. The boot log line `auth_boot_fingerprint` carries `deployment_id` = `RAILWAY_DEPLOYMENT_ID`
    (`bootFingerprint.ts:99-103, 126-135`), which is a Railway deployment id, not a git SHA. Map that
    deployment id to the commit in the Railway dashboard. Precise procedure: UNKNOWN — verify.
- Both planes must run with the identical `ENCRYPTION_KEY` (§6). Web seals RPA sessions
  (`pages/api/rpa/auth/complete.ts:83`, `pages/api/rpa/auth/save-session.ts:76`) and checks decryptability
  for platform health. The worker decrypts them (`backend/services/rpaWorker/rpaPlaywrightRunner.ts:178`).
  A mismatch makes every session undecryptable, so every org would need to re-login, again.

---

## 6. Environment variables (names only)

| Name | Plane | Required format / rule | Where validated | Fail-closed behaviour |
|---|---|---|---|---|
| `ENCRYPTION_KEY` | web **and** worker, **identical** | **exactly 64 lowercase hex characters** (schema regex `^[a-f0-9]{64}$`) | `config/env.schema.ts:215-218` (`validateEnv`, line 389; a non-test process exits on failure, lines 555-560). Re-checked at use by `backend/auth/credentialEncryption.ts:22-35` (accepts mixed-case hex, 32 bytes; base64 refused) | boot exits. `saveRpaSession` throws rather than store cleartext (`rpaSessionStore.ts:31`) |
| `RPA_AUTH_SECRET`, else `AUTH_SECRET` | web (token issue/verify) | any non-blank value. First one set wins (`backend/services/rpaWorker/rpaAuthTokens.ts:43-51`, via `backend/auth/signingSecrets.ts:55-66`) | not in the env schema. Resolved at use | neither set: issuing throws, verifying is refused with 503 `SIGNING_SECRET_UNAVAILABLE` (`rpaAuthTokens.ts:170-174`) |
| `CRON_SECRET` | web | bearer token. Optional in schema (`config/env.schema.ts:374-375`, "Required in production for /api/cron/*") | per route | unset: 401 (`pages/api/cron/workflow-execution-progression.ts:53-60`) |
| `WORKFLOW_ORCHESTRATION_ENABLED` | web | must be exactly `true` (case-insensitive) to enable. **Default off** | `pages/api/cron/workflow-execution-progression.ts:62-64` | anything else: 200 `{enabled:false}`, no sweep |
| `OMNIVYRA_EXTENSION_ROOT` | **tests only**. Not a production variable | path to the external extension source | `backend/tests/helpers/extensionSourceRoot.ts:6-21` | unset: those test blocks are skipped; set but invalid: suite fails |
| `RPA_SESSION_DIR` (optional) | web, worker, purge script | directory of legacy plaintext files. Default `tmp/rpa-sessions` under cwd | `backend/services/rpaWorker/rpaSessionStore.ts:103-105` | — |

Check that each is present in Vercel (production) and Railway (worker service) environment settings by
name. Never print values.

---

## 7. `rpa_sessions` plaintext invalidation — `20261231000010` (P3)

### 7.1 What it does and the user impact
- Every `rpa_sessions` row whose `storage_state` is not the valid encrypted envelope and not already the
  marker gets the marker `{format:'omnivyra.rpa_session.invalidated', reason:'legacy_plaintext',
  invalidated_at}`. `account_tier` is set to NULL and `expires_at` is clamped to now (lines 91-99).
  Batches of 500, with a hard cap of 10,000 iterations (lines 70-120). One audit row is written per (org,
  platform, batch), holding counts only.
- **User impact:** every organization with a legacy plaintext RPA session must log in to that platform
  again. Platform health and the callback report `reauth_required` with reason `invalidated`. The next
  login writes a fresh envelope over the marker. The plaintext is not copied anywhere and **cannot be
  restored** (rollback refuses, §9).

### 7.2 Apply
1. Confirm both planes run the release build (§5.3).
2. Record P9/P9b "before" counts.
3. Apply with the §4.0 command, `-f "$M/20261231000010_rpa_legacy_session_invalidation.sql"`. Its
   postcondition raises if any unscrubbed row remains (lines 126-149), so a non-zero exit means nothing
   committed.

### 7.3 Verify (counts only)

```sql
-- V010-a audit totals for this migration
SELECT count(*)                                    AS audit_rows,
       count(DISTINCT (organization_id, platform)) AS org_platform_pairs,
       count(DISTINCT organization_id)             AS orgs,
       COALESCE(sum(rows_invalidated), 0)          AS rows_invalidated,
       min(invalidated_at)                         AS first_at,
       max(invalidated_at)                         AS last_at
  FROM public.rpa_session_invalidation_audit
 WHERE migration_version = '20261231000010';

-- V010-b per platform
SELECT platform,
       count(DISTINCT organization_id) AS orgs,
       sum(rows_invalidated)           AS rows_invalidated
  FROM public.rpa_session_invalidation_audit
 WHERE migration_version = '20261231000010'
 GROUP BY platform
 ORDER BY platform;

-- V010-c remaining unscrubbed rows: MUST be 0
SELECT count(*) AS remaining_legacy_or_malformed
  FROM public.rpa_sessions s
 WHERE NOT (
         COALESCE(jsonb_typeof(s.storage_state) = 'object'
                  AND s.storage_state->>'format' = 'omnivyra.rpa_session.v1'
                  AND s.storage_state->>'alg' = 'aes-256-gcm'
                  AND jsonb_typeof(s.storage_state->'ciphertext') = 'string'
                  AND (s.storage_state->>'ciphertext') ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$',
                  false)
         OR COALESCE(jsonb_typeof(s.storage_state) = 'object'
                     AND s.storage_state->>'format' = 'omnivyra.rpa_session.invalidated',
                     false));

-- V010-d marker rows hold no tier, are expired, carry no cookie keys
SELECT count(*)                                                             AS marker_rows,
       count(*) FILTER (WHERE account_tier IS NOT NULL)                     AS with_account_tier,
       count(*) FILTER (WHERE expires_at IS NULL OR expires_at > now())     AS not_expired,
       count(*) FILTER (WHERE storage_state ?| ARRAY['cookies', 'origins']) AS with_cookie_keys
  FROM public.rpa_sessions
 WHERE storage_state->>'format' = 'omnivyra.rpa_session.invalidated';

-- V010-e audit table is service-role only
SELECT c.relrowsecurity                                                            AS rls_on,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'rpa_session_invalidation_audit') AS policies,
       has_table_privilege('anon', c.oid, 'SELECT')                                AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT')                       AS authenticated_select
  FROM pg_class c
 WHERE c.oid = to_regclass('public.rpa_session_invalidation_audit');
```

Pass criteria:
- V010-c = 0.
- V010-d: `with_account_tier = 0`, `not_expired = 0`, `with_cookie_keys = 0`.
- V010-e = `t, 0, f, f`.
- Reconciliation: V010-a `rows_invalidated` (first run) = P9 "before" `legacy_or_malformed`, minus rows
  overwritten by a fresh login in between.
- P9 "after": `legacy_or_malformed` row absent, and `invalidated_marker` grown by that number.
- Re-run P9 later. Markers decreasing while `envelope_v1` grows shows orgs logging back in.

Recovery: the migration is idempotent and safe to re-run. A re-run after a successful run adds 0 audit
rows. Rollback always refuses (§9).

### 7.4 Legacy plaintext files on disk

Old code also wrote `<org>__<platform>.json` plaintext files under `$RPA_SESSION_DIR || tmp/rpa-sessions`.
Operator script, dry run by default. It never opens file contents and prints counts only:

```bash
node -r ts-node/register scripts/purge-legacy-rpa-session-files.ts                 # dry run: counts
node -r ts-node/register scripts/purge-legacy-rpa-session-files.ts --apply         # delete
node -r ts-node/register scripts/purge-legacy-rpa-session-files.ts --apply --max-files=500
```

(`scripts/purge-legacy-rpa-session-files.ts:8-14`.) It deletes only top-level regular files matching
`^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+\.json$`, does not follow symlinks, does not recurse, and is capped at
1,000 files per run by default and 10,000 hard (`backend/services/rpaWorker/rpaLegacySessionFilePurge.ts:13-31`).
It exits 0 on success (including "directory absent") and 1 on any failure. Run it on every host or volume
that ever ran the RPA auth routes or the worker with a local tmp directory. Whether the production worker
image ships `ts-node` and whether any persistent volume exists on Railway or Vercel are UNKNOWN — verify.

---

## 8. `VACUUM rpa_sessions`: removing superseded plaintext tuple versions

Both the #19 scrub and every later login leave the old row version (with its plaintext) as a **dead
tuple** in the table's heap (and in its TOAST table, where large `jsonb` values live) until it is
vacuumed (#19 operator note, lines 151-156).

| | `VACUUM` (plain) | `VACUUM FULL` |
|---|---|---|
| Lock | SHARE UPDATE EXCLUSIVE: reads and writes continue. Conflicts only with DDL, other VACUUMs and similar | ACCESS EXCLUSIVE: blocks **all** reads and writes on `rpa_sessions` for the duration |
| What it does to dead tuples | marks their space reusable inside the existing file. Page compaction moves live tuples, but PostgreSQL does not zero the freed bytes, so old tuple bytes can persist in the file until they are overwritten. The file is not rewritten (only trailing empty pages may be truncated) | writes the live rows into a **new** heap file and a new TOAST file, rebuilds the indexes, and unlinks the old files at commit |
| Removes plaintext from the table's data files | **not guaranteed** | **yes** (old files are unlinked; what the storage layer does with unlinked blocks is provider territory: verify with Supabase) |
| Cost here | negligible | the table is small (check P12). Needs temporary disk equal to the table size. The lock is held briefly, but acquiring it waits for every open transaction touching the table, and everything queued behind it waits too, so use `lock_timeout` |

**Recommendation:** `VACUUM FULL`, after #19 commits and after the horizon checks below, in a quiet
period.

On the disposable DB (§12), plain VACUUM left the heap file unchanged (same filenode, same 48 kB).
`VACUUM FULL` produced new heap and TOAST filenodes (heap 48 kB → 16 kB).

### 8.1 Pre-checks (read-only)

A dead tuple that is still visible to some snapshot is "recently dead". Plain VACUUM cannot remove it, and
**VACUUM FULL copies it into the new file**. So clear the xmin horizon first.

```sql
-- owner (VACUUM FULL requires table owner or a role with privileges over it) and indexes (none should cover storage_state)
SELECT c.relowner::regrole AS owner, pg_has_role(current_user, c.relowner, 'MEMBER') AS can_vacuum_as_owner
  FROM pg_class c WHERE c.oid = 'public.rpa_sessions'::regclass;
SELECT indexrelid::regclass, pg_get_indexdef(indexrelid)
  FROM pg_index WHERE indrelid = 'public.rpa_sessions'::regclass;

-- xmin horizon holders (no query text is selected)
SELECT pid, usename, application_name, state, backend_xmin,
       now() - xact_start AS xact_age
  FROM pg_stat_activity
 WHERE backend_xmin IS NOT NULL AND pid <> pg_backend_pid()
 ORDER BY xact_start NULLS LAST;

-- replication slots / prepared transactions that pin the horizon
SELECT slot_name, slot_type, active, xmin, catalog_xmin FROM pg_replication_slots;
SELECT count(*) AS prepared_xacts FROM pg_prepared_xacts;

-- logical publication of the table (a subscriber keeps its own copy)
SELECT pubname FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'rpa_sessions';

-- settings relevant to residual copies
SELECT name, setting FROM pg_settings
 WHERE name IN ('autovacuum', 'hot_standby_feedback', 'wal_level', 'archive_mode',
                'log_statement', 'log_min_duration_statement');
```

Proceed only when no long-lived `backend_xmin` predates the #19 commit, and no slot or prepared
transaction pins an older horizon. If an `rpa_sessions` index other than `rpa_sessions_pkey`,
`idx_rpa_sessions_expires` (`expires_at`) or `uq_rpa_sessions_org_platform` exists, escalate: index pages
could also hold old values.

### 8.2 Run (cannot run inside a transaction block; do not use `-1`)

```bash
psql -X -v ON_ERROR_STOP=1 \
  -c "SET lock_timeout = '5s'" \
  -c "VACUUM (FULL, VERBOSE OFF) public.rpa_sessions" \
  -c "VACUUM (VERBOSE OFF, ANALYZE) public.rpa_sessions"
```

The second (plain) VACUUM refreshes statistics. On the disposable DB, `VACUUM FULL` did **not** update
`last_vacuum` / `n_dead_tup`. A lock-timeout error is safe to retry later.

### 8.3 Verify

```sql
-- capture BEFORE and AFTER: heap and toast filenodes MUST change; size reflects live rows only
SELECT c.oid::regclass AS rel, pg_relation_filenode(c.oid) AS filenode,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap_size,
       c.reltoastrelid::regclass AS toast_rel,
       CASE WHEN c.reltoastrelid <> 0 THEN pg_relation_filenode(c.reltoastrelid) END AS toast_filenode
  FROM pg_class c
 WHERE c.oid = 'public.rpa_sessions'::regclass;

-- dead tuples / vacuum timestamps for heap and toast
SELECT s.relid::regclass AS rel, s.n_live_tup, s.n_dead_tup,
       s.last_vacuum, s.last_autovacuum, s.vacuum_count, s.autovacuum_count
  FROM pg_stat_all_tables s
 WHERE s.relid IN (SELECT c.oid FROM pg_class c WHERE c.oid = 'public.rpa_sessions'::regclass
                   UNION ALL
                   SELECT c.reltoastrelid FROM pg_class c
                    WHERE c.oid = 'public.rpa_sessions'::regclass AND c.reltoastrelid <> 0);

-- if VACUUM FULL is waiting: who blocks whom
SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by
  FROM pg_stat_activity
 WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

Pass: both filenodes changed, and after the follow-up plain VACUUM, `n_dead_tup` is about 0 with
`last_vacuum` set.

**Autovacuum interplay:** autovacuum (and opportunistic page pruning) may already have run plain-vacuum
work on `rpa_sessions`. That reclaims space but gives no guarantee the bytes were overwritten. It does not
replace the explicit `VACUUM FULL`. Autovacuum never performs `VACUUM FULL`.

### 8.4 What NEITHER removes

`VACUUM` and `VACUUM FULL` act only on the current table files. Plaintext that was written before #19 also
exists in, and stays in:
- **WAL** (original inserts and updates, plus full-page images of pages that held them) and **WAL
  archives / PITR** storage;
- **backups / snapshots** taken before #19 + VACUUM FULL;
- **replicas' history.** Physical standbys replay the VACUUM FULL, but their WAL and backups are
  separate. A logical subscriber (check `pg_publication_tables`) holds its own copy;
- **logical decoding / replication slots** that have not yet consumed that WAL;
- **log files** (database logs if statements or parameters were logged, application logs).

Handling:
1. **Retention.** Backups and PITR/WAL archives age out under the project's Supabase retention. The
   retention period, whether point-in-time recovery is enabled, read replicas, and whether any copy can be
   purged early are all provider-specific: **verify with Supabase support/docs.** Until they age out,
   restoring an old backup restores plaintext. Treat any restore of a pre-#19 backup as re-exposure and
   re-run #19 + VACUUM FULL after it.
2. **Rotation.** The stored cookies are live platform credentials. #19 invalidates them in Omnivyra, but
   copies in backups or WAL stay usable at the platform until those platform sessions end. Every affected
   org must log in again anyway (§7.1). Ending the old platform sessions on the platform side (for example
   a "sign out of all sessions" control) is what makes leaked copies useless. Availability differs per
   platform: verify per platform. This is an operator and customer-communication decision, outside the
   database.
3. Logs: check whether production database logging captured statement parameters (`log_statement`,
   `log_min_duration_statement` above) and the provider's log retention: verify with Supabase.

---

## 9. Rollback

### 9.1 Prefer code rollback, keep the schema

Every P1 file is additive for the old code (§5.1). If the release fails after P2, roll back **code only**:
- Web: `vercel promote <previous-known-good-deployment>`, then
  `npm run verify:deployment -- --alias` (`docs/PRODUCTION-DEPLOY-GOVERNANCE.md:87-95`).
- Worker: redeploy the previous Railway deployment. Exact procedure UNKNOWN — verify (repo docs describe
  only auto-deploy on push to `main`, line 11).
- Leave the migrations in place. Database rollback is a separate, deliberate decision.

### 9.2 Database rollback: preconditions

- **Deploy the prior application code first.** Current code fails closed without these objects: #14
  rollback header lines 24-26; #17 rollback header lines 19-21.
- **Never reverse while dependent data exists.** The rollback files enforce this by refusing. Do not work
  around a refusal by deleting data unless the release owner decides it explicitly:
  - journey links (`community_action_journey_links`: 0006, 0007, 0003 refuse);
  - identity attestations (`identity_verification_attestations`: 0007 refuses; audit records, export
    before any decision);
  - live idempotency reservations (`engagement_request_idempotency` in `reserved`/`uncertain`, or
    `completed` inside the 24 h replay window: 0008 refuses; window =
    `ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS`, `backend/services/engagementRequestIdempotency.ts:82`);
  - `uncertain` / `executing` action rows, or claimed `rpa_retry_queue` rows (0002 refuses);
  - unexpired redeemed RPA tokens (`rpa_auth_token_redemptions.token_expires_at > now()`: 0005 refuses;
    token TTL is 30 min, `rpaAuthTokens.ts:23`);
  - `social_post` steps in any workflow version (0004 refuses);
  - engine requests for engines other than `whatsapp` (0001 refuses);
  - execution instances referencing campaign targets (0000 refuses).
- **0000 rollback deletes campaign selection history.** It drops `prospect_campaign_targets` and
  `prospect_campaign_lists` even when they hold rows. It refuses only when an execution instance references
  a target (`orchestration_campaign_targeting_rollback.sql:3-25`).

### 9.3 Order (verified)

`0009 → 0008 → 0007 → 0006 → 0003 → 0004 → 0005 → 0002 → 0001 → 0000`, as stated in each rollback file
header (e.g. `migration_rerun_safety_rollback.sql:3-4`). Validated end to end on the disposable DB (§12).

| Step | Rollback file (`$M/rollbacks/`) | Refuses when | Command |
|---|---|---|---|
| 0009 | `migration_rerun_safety_rollback.sql` | installed reaper still marks `failed` (lines 8-16, 20-33) | `-1` |
| 0008 | `engagement_request_idempotency_rollback.sql` | `reserved`/`uncertain` rows; `completed` rows inside the replay window unless `SET LOCAL omnivyra.engagement_request_idempotency_drop_replay_window = 'i-accept-replay-loss'` (lines 8-17, 25-44) | `-1` |
| 0007 | `identity_verification_rollback.sql` | any attestation row; any link row (lines 9-30) | `-1` |
| 0006 | `community_identity_link_rollback.sql` | 0007 still installed; any link row (lines 6-29) | `-1` |
| 0003 | `community_journey_link_rollback.sql` | 0006 still installed; any link row (lines 13-31) | **no `-1`** (file has its own `BEGIN`/`COMMIT`) |
| 0004 | `social_publish_step_channel_rollback.sql` | any workflow version with a `social_post` step (lines 9-27) | **no `-1`** |
| 0005 | `extension_dispatch_safety_rollback.sql` | unexpired redeemed tokens (lines 11-41). **Keeps the uncertain-outcome reaper by default** (lines 47-54) | `-1` |
| 0002 | `community_execution_safety_rollback.sql` | 0009 guard installed; reaper writes `uncertain`; 0008 table exists; rows with statuses the prior CHECK forbids; claimed retry rows; prior definition not recorded (lines 3-23, 26-84) | `-1` |
| 0001 | `orchestration_engine_requests_engines_rollback.sql` | non-`whatsapp` engine requests (lines 3-15) | **no `-1`** |
| 0000 | `orchestration_campaign_targeting_rollback.sql` | instances reference targets (lines 3-25). **Destroys selection history** | **no `-1`** |

Commands: `-1` means `psql -X -v ON_ERROR_STOP=1 -1 -f "$M/rollbacks/<file>"`. "No `-1`" means
`psql -X -v ON_ERROR_STOP=1 -f "$M/rollbacks/<file>"`. Those four files contain their own
`BEGIN;`/`COMMIT;`, and psql documents that `-1` does not behave as intended with such scripts. Every
refusal raises and changes nothing. A refusal means STOP.

**Consequence of the default (safe) path:** because the 0005 rollback keeps the uncertain-outcome reaper,
**the 0002 rollback then refuses** (verified, §12). That is by design: keep 0002 (and therefore 0001 and
0000 can still be rolled back, since they do not depend on 0002). The full order to 0000 completes only if
the failed-marking reaper is restored. **Do not do that** (next paragraph).

**`i-accept-duplicate-send-risk`: DO NOT USE.** Two opt-ins restore or tolerate the reaper that marks
possibly-delivered actions `failed` (the duplicate-send path):
`SET LOCAL omnivyra.extension_dispatch_safety_restore_failed_reaper = 'i-accept-duplicate-send-risk'`
(0005 rollback, lines 15-19, 47-180) and
`SET LOCAL omnivyra.migration_rerun_safety_drop_guard = 'i-accept-duplicate-send-risk'` (0009 rollback,
lines 13-15). Using either requires an explicit, documented owner decision. This runbook does not
authorize it.

### 9.4 No rollback exists for

- `20261231000010`: its rollback **always refuses** (`rpa_legacy_session_invalidation_rollback.sql:13-22`).
  Plaintext is never restored, and the audit table is kept.
- `20261127000000`, `20261226000000`, `20261227000000`, `20261228000000`, `20261228000001`,
  `20261228000002`, `20261229000000`, `20261230000000`: no rollback file. Undoing them would be new,
  separately reviewed work.

---

## 10. Feature flags and kill switches: what becomes live when

| Item | Default | Live on migration | Live on deploy |
|---|---|---|---|
| `WORKFLOW_ORCHESTRATION_ENABLED` | **off** (`pages/api/cron/workflow-execution-progression.ts:24-28, 62-64`) | — | the cron route exists but is inert unless `true`, and is **not scheduled** (no `vercel.json` entry, lines 27-28). `sweepWorkflowExecutionProgression` has no other caller. Automatic journeys therefore do not run on deploy |
| Manual orchestration routes (`pages/api/prospect-lists/*`, `prospect-campaigns/*`, `workflows/*`, `execution-instances/*`, `identity-verification/attestations.ts`) | no flag; capability-gated (`PROSPECT_ICP_MANAGE` / `PROSPECT_INGEST` / tenant access) | — | **live on deploy.** The progression route only advances state: "Nothing here dispatches … or contacts a provider" (`pages/api/execution-instances/[id]/progression.ts:35`) |
| Community platform kill switch `community_ai_platform_policy.execution_enabled` | **no row = enabled** (#14 lines 254-267) | `claim_community_ai_browser_command` enforces it atomically from #14 onward (called only by new code) | new code claims browser commands only through the RPC |
| Lease reaper outcome `uncertain` | — | **live on #14** (existing worker cron calls the replaced function) | — |
| Reaper re-run guard trigger | — | **live on #18** | — |
| Engagement request idempotency (reply/like/bulk-like) | always on in new code | table only | **live on deploy** (503 if the table is absent) |
| Single-use RPA auth tokens | always on in new code | table only | **live on deploy** |
| RPA plaintext refusal | always on in new code | #19 scrubs at rest (P3) | **live on deploy**: new code refuses plaintext rows with or without #19 |
| `LEAD_OUTREACH_EMAIL_ENABLED` | off (referenced at `workflow-execution-progression.ts:20-22`) | — | unchanged by this stack |

---

## 11. Checklist

- [ ] §3 preflight authorized, run read-only, output recorded; P0 shows the primary, version ≥ 14, all 3 roles
- [ ] P11/P11b all present; competing list table absent; §3.3 decision for 20261127 recorded
- [ ] P5 status CHECK is one of the accepted shapes; P10 has no out-of-vocabulary status
- [ ] P9/P9b "before" counts recorded
- [ ] Release owner confirms Railway auto-deploy state; merge to `main` held until P1 completes
- [ ] P1 files #1 to #18 applied one by one with §4.0; each verification matches; full §3 re-run matches "fully applied"
- [ ] Env names present on both planes; `ENCRYPTION_KEY` identical (§6)
- [ ] Merge to `main` (worker deploys); Vercel `deploy:prod` → verify → promote → verify alias
- [ ] `/api/health/version` `build` = release SHA; worker deployment mapped to the same commit
- [ ] #19 applied; V010-a…e pass; reconciliation with P9 "before" recorded
- [ ] §8.1 horizon clear; `VACUUM FULL` run; filenodes changed
- [ ] Purge script dry run, then `--apply`, on every relevant host/volume
- [ ] Supabase backup/PITR retention and platform-side session rotation decisions recorded (§8.4)

---

## 12. Validation record (disposable database only)

Target: local disposable PostgreSQL 17.6 + pgvector, database `w6_runbook` (integration copy with every
stack migration applied through `20261231000010`). No production access.

| What | Result shape |
|---|---|
| §3 P0–P13, run in a `READ ONLY` session on the applied DB | P0: primary, 170006, 3 roles. P1: 0 rows (ledger empty in the copy). P2: 27×`t`. P3: 18×`1`. P4: 8×`t`. P5: 5 rows (12-value CHECK + `prior_definition` comment holding the 5-value baseline CHECK; claim pair; target FK; 4-engine CHECK; person FK). P6: `t,f,t,t`. P7: 1 row `O,f`. P8: 12 channels. P9/P9b/P10: 0 rows (empty tables). P11: 23×`t`. P11b: `t,2,17,3,2`. P12: 4 rows. P13: 6 rows. Competing list table absent: `t` |
| §3 P0–P8 after rolling back 0009…0000 inside a transaction that was then rolled back | P2: `f` for every 20261231000000–…000008 object, `t` for 20261127–20261230 and the 0010 audit table. P3: `0` for the new functions. P4: `f` for 0000/0002/0006 columns. P5: 5-value CHECK with no comment, `whatsapp`-only engine CHECK. P6: `t,f,f,f` (legacy body). P7: 0 rows. P8: 11 channels |
| §3.3 shape queries | 15 constraints / 9 + 11 columns (after #9) |
| §4.1 V-queries (V-1127 … V-0009) | exactly the "Expect" values quoted in §4.1 |
| `psql -1 -c "SET LOCAL lock_timeout…" -f …` | `SET LOCAL` values visible to the last `-c`: one transaction |
| Rollback chain 0009→…→0000 in one transaction, then rolled back | completed. 0010 rollback refused. 0002 rollback refused while the 0009 guard was installed, and refused again after the default 0005 rollback (reaper kept). 0002→0001→0000 completed only with the 0005 opt-in (test only). Outer ROLLBACK restored the state (V-queries re-checked) |
| Rollback chain then forward re-apply 0000→0010 in one transaction, then rolled back | all 11 forward files applied cleanly; P6/P8/V-0003 back to the applied shapes |
| All 19 forward files re-applied on the already-applied DB in one transaction, then rolled back | 0 errors. NOTICEs only: #3 "kept the installed wider … vocabulary", #11 "already is the complete vocabulary" |
| #19 with 4 synthetic rows (3 legacy/malformed across 2 orgs, 1 envelope), in a transaction then rolled back | P9 before: `envelope_v1 1`, `legacy_or_malformed 3/2 orgs/3 unexpired`. After: `invalidated_marker 3/2/0`. V010-a `3,3,2,3`. V010-b linkedin `2/2`, twitter `1/1`. V010-c `0`. V010-d `3,0,0,0`. V010-e `t,0,f,f`. Re-run added 0 audit rows. 0 residual rows after rollback |
| §8 VACUUM sequence with 50 synthetic rows (rows and audit removed afterwards) | after scrub: `n_dead_tup 57`. Plain VACUUM: `n_dead_tup 0`, same filenode, same 48 kB. VACUUM FULL: new heap and TOAST filenodes, 16 kB, `last_vacuum` unchanged. §8.1 queries: 0 xmin holders, 0 slots, 0 prepared, 0 publications |

Not validated anywhere: anything against production; Supabase SQL-editor transaction semantics; Railway
and Vercel steps; the purge script on a real host.

---

## 13. Discrepancies and UNKNOWNs found while writing this runbook

Discrepancies (stack files and code):
1. `…000010` is **not** a code prerequisite, contrary to the brief. Applying it before the deploy leaves a
   window where old code re-creates plaintext rows and falls back to plaintext files (§5.2).
2. `20261231000006` header lines 47-49 say that re-running `…000003` after `…000006` fails its FK-count
   postcondition. `…000003` lines 222-230 now accept 4 FKs, and the re-run succeeded (§12). The header
   note is stale.
3. The #19 operator note (lines 151-156) prescribes plain `VACUUM`. That does not guarantee physical
   removal of the plaintext bytes; `VACUUM FULL` does (§8).
4. `20261127000000` and `20261231000010` have no precondition block. `20261227000000` / `20261228000000`
   reference `outreach_tasks_identity_unique` and `uq_prospect_icp_versions_one_ratified` only in
   postconditions (via `::regclass`), so a missing dependency surfaces as a generic "relation does not
   exist" (§3 P11 covers these).
5. `ENCRYPTION_KEY` validation differs: schema lowercase-only (`config/env.schema.ts:217`) vs. use-site
   mixed case (`backend/auth/credentialEncryption.ts:27`). The effective rule is lowercase.
6. Four stack rollback files carry their own `BEGIN`/`COMMIT` and six do not. The run commands differ
   (§9.3).
7. `orchestration_campaign_targeting_rollback.sql` drops selection history without refusing when
   `prospect_campaign_targets` has rows (it only warns in comments).
8. `scripts/verify-schema-parity.js` (named in `docs/migration-discipline.md`) has no entries for any
   object of this stack.
9. Many file headers still say "NOT applied anywhere yet". That is informational only; production status
   is UNKNOWN.

UNKNOWN — verify:
- Production state of every file (§3 is the only way to establish it).
- Whether Railway auto-deploy on `main` is enabled now; the worker rollback procedure; how to map
  `RAILWAY_DEPLOYMENT_ID` to a commit.
- Supabase backup/PITR retention, read replicas, log retention, early-purge options.
- Whether the Supabase SQL editor runs a script as one transaction.
- Old-code (`d51360b0`) behaviour on `uncertain` rows during the #14 → deploy window.
- Whether the worker image has `ts-node` for the purge script; whether any persistent volume holds legacy
  files.
- Per-platform availability of "end all sessions" for rotation.
