# Grants consumer matrix — release gate (Agent C)

| | |
|---|---|
| Base | `5a451b4d` (orchestration-engine-adapters integration), branch `gate/grants-consumers` |
| Nature | Read-only analysis. No grant, policy, migration or app code was changed. No production database, log store, Management API or CLI was contacted. |
| Evidence classes | **[repo]** read from files at the base commit · **[disposable]** run on a throwaway copy (`w6_grants`, PostgreSQL 17.6, bootstrap schema — NOT Supabase default privileges, NOT production) and dropped afterwards · **[memory]** an operator-reported production fact recorded in project memory, not re-verified here · **[prod-needed]** must be obtained by an authorized operator (§7) |
| Companion files | `scripts/release/grants-acl-check.sql` (read-only catalog snapshot), `scripts/release/api-log-queries.sql` (log queries) |

## 0. Corrections to the brief

- **Update (gate 4, 2026-10-29):** the release branch has since been rebased onto `main` (`c4e4e9bb`, then `acde8b7a`, then `3e84f3ae`), so PR #349's migrations `20261223000000/01` now exist in the tree; `scripts/release/grants-acl-check.sql` covers both tables and was re-validated on a disposable database rebuilt at the rebased tree (both resolve; RLS on, 1 policy each, anon/authenticated/PUBLIC hold nothing). The statements below describe the state at base `5a451b4d`. The plan's per-scope expected anon state (`release-gate-production-verification-plan.md` §C1) supersedes "no anon privilege on any in-scope table".
- **PR #349 is MERGED** (`gh pr view 349`: state MERGED, head `3b203a18`, merged 2026-10-28T20:02:59Z, merge commit `c4e4e9bb` on `origin/main`). It is **not** an ancestor of this base (`git merge-base --is-ancestor 3b203a18 HEAD` → false), so its two migration files do not exist in this worktree; they were read with `git show 3b203a18:<path>`. Memory `project_pr349_readiness_approvals.md` records that the user applied both by hand in the SQL Editor and a read-only verification passed 28/28; ledger rows absent. **[memory]**
- **The "12 RLS-only stack tables" are 10.** Of the 18 tables the stack creates, exactly 10 enable RLS without any `REVOKE` (§1.3). The other 8 revoke explicitly. Four of the 10 (`execution_plans`, `execution_plan_steps`, `execution_tasks`, `outreach_bridge_handoffs`) have **no policy at all**.
- **The stack is not on `origin/main`** (`git show origin/main:supabase/migrations/` lists none of `20261127000000`, `20261226…`–`20261231…`). Production status of every stack file is UNKNOWN (`docs/release/orchestration-engine-adapters-migration-runbook.md:10-13`).

## 1. Migration / PR → object matrix

Role shorthand: `arwdDxtm` = INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN.

### 1.1 `close_anon` — `supabase/migrations/20261026000000_close_anon_rls_exposure.sql` (#239; applied in prod 2026-09-13 per memory `project_prod_rls_anon_exposure.md`)

| Step | Objects (exact list in file) | Statement | Roles |
|---|---|---|---|
| 1 | 177 tables, array `protected_tables` lines 84-262 (`active_lead_runs` … `whatsapp_templates`) | `ENABLE ROW LEVEL SECURITY` (no policy added) + `REVOKE ALL … FROM anon, authenticated` (lines 269-270); absent tables skipped (265-267) | anon, authenticated |
| 2 | 29 SECURITY DEFINER functions, array `definer_functions` lines 281-311 (exact signatures, e.g. `apply_credit_transaction_v2(…)`, `security_get_secret(uuid)`, `reap_community_ai_action_leases()`) | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` (315-316) | PUBLIC, anon, authenticated, service_role |
| 3a | 29 owner-rights views, lines 326-356 | `REVOKE ALL … FROM anon, authenticated` (370) | anon, authenticated |
| 3b | 8 security_invoker views, lines 357-366 | `REVOKE ALL FROM anon`; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER FROM authenticated` (374-375) — authenticated keeps SELECT, subject to underlying RLS | anon, authenticated |
| 4 | 11 policies on 9 tables, lines 385-397 (`blog_analytics.owner_select`, `blog_analytics.tracker_insert`, `blog_analytics_daily.service_all_daily`, `blog_intelligence_settings.service_all`, `blog_post_likes."Public read blog likes"`, `campaign_design_systems.cds_company_rw`, `company_blog_read_sessions` ×2, `creator_template_collections.ctc_company_rw`, `creator_user_template_versions.cutv_company_rw`, `creator_user_templates.cut_company_rw`) | `ALTER POLICY … TO service_role` (400); the 9 tables (lines 408-417): `REVOKE ALL FROM anon, authenticated` (428) | policy roles {public}→{service_role} |
| 5 | 4 public-read tables `blog_relationships`, `blog_series`, `blog_series_posts`, `content_type` (419-423) | `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated` (433); SELECT policies kept | anon, authenticated |
| 5b | every table/partitioned table in `public` at apply time | `REVOKE TRUNCATE FROM anon, authenticated` (437-450) | anon, authenticated |
| 6 | default privileges, objects created by `postgres` | 453 `IN SCHEMA public REVOKE ALL ON TABLES FROM anon`; 454 `REVOKE TRUNCATE ON TABLES FROM authenticated`; 455 `REVOKE ALL ON SEQUENCES FROM anon`; 456 `REVOKE EXECUTE ON FUNCTIONS FROM anon`; 457 (global) `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` | anon, authenticated, PUBLIC |
| 7 | self-verification over all of the above (459-759) | aborts if anything still reachable | — |

Not touched: `service_role` table grants and its default privileges; FORCE RLS (never set); publications. Rollback: `supabase/migrations/rollbacks/close_anon_rls_exposure_rollback.sql`.

### 1.2 FIX3 — `20261212000000_content_quality_collaboration_tenant_consistent.sql` + out-of-repo revoke

| Object | RLS / force | Policy | Grants in repo |
|---|---|---|---|
| `content_quality`, `content_block`, `content_recommendation`, `content_approval_history` (created 660-699) | ENABLE (2868-2871), not FORCE (comment 2809-2811) | `<t>_company_rw`, ALL, PERMISSIVE, TO PUBLIC, USING/WITH CHECK `company_id IN (SELECT company_id FROM user_company_roles WHERE user_id = auth.uid() AND status = 'active')` (2959-2963); a pre-existing same-name policy is shape-checked then recreated (2873-2965) | **none** — file states it issues no GRANT/REVOKE/ALTER DEFAULT PRIVILEGES (190-200, 2815-2818) |
| 8 Phase-A tables: `content`, `content_variant`, `content_asset`, `content_revision` (`20260718000000_canonical_content_foundation.sql:130-160`); `content_memory`, `content_originality`, `brand_memory` (`20260718000001_content_intelligence_originality.sql:97-118`); `publication_lineage` (`20260718000003_content_learning_performance.sql:116-131`) | ENABLE, not FORCE | `<t>_company_rw`, ALL, TO PUBLIC, same predicate | none in repo |
| Out-of-repo action | — | — | `REVOKE … FROM authenticated` on the 8 Phase-A tables; service_role keeps CRUD **[memory `project_fix3_verified_prod_20261028.md`]**. **No migration, script or doc in this base or on `origin/main` records it** (`git grep -nE "REVOKE[^;]*(brand_memory|publication_lineage)" origin/main` → no match). Fresh environments and replays therefore differ from production. |

Functions: `set_content_updated_at` is referenced (Phase A triggers); FIX3 does not create or replace functions (its comments: "no function is ever replaced", ~186). It was absent from the disposable copy.

Policy semantics **[disposable]**: `authenticated` has no grant on `user_company_roles` (`has_table_privilege` → f); with a simulated grant on `content_quality` a SELECT as `authenticated` fails with `permission denied for table user_company_roles`; with a simulated grant on `user_company_roles` too, it returns 0 rows (its only policy is `service_role_full_access TO service_role`). Either way the company_rw policies deny client roles, as the file says (2805-2808).

### 1.3 Stack — `20261127000000` + `20261226000000` … `20261231000010`

Tables:

| Table | File:line (RLS) | Policy | Explicit REVOKE / GRANT |
|---|---|---|---|
| `prospect_lists` | 20261127000000:268 | `prospect_lists_service_role` ALL TO PUBLIC USING/CHECK `auth.role() = 'service_role'` (278-279) | **none** |
| `prospect_list_members` | 20261127000000:269 | `prospect_list_members_service_role`, same (287-288) | **none** |
| `prospect_campaigns` | 20261226000000:149 | `prospect_campaigns_service_role`, same (158-160) | **none** |
| `workflows` | 20261227000000:565 | `workflows_service_role`, same (575-577) | **none** |
| `workflow_versions` | 20261227000000:566 | `workflow_versions_service_role`, same (585-587) | **none** |
| `execution_instances` | 20261228000000:397 | `execution_instances_service_role`, same (406-408) | **none** |
| `execution_plans` | 20261228000001:158 | **no policy** | **none** |
| `execution_plan_steps` | 20261228000001:222 | **no policy** | **none** |
| `execution_tasks` | 20261228000001:296 | **no policy** | **none** |
| `outreach_bridge_handoffs` | 20261229000000:194 | **no policy** | **none** |
| `execution_engine_requests` | 20261230000000:104 | `…_service_role` ALL TO service_role USING true (107-108) | `REVOKE ALL FROM anon, authenticated` (110) |
| `prospect_campaign_lists` | 20261231000000:185 | ALL TO service_role (187-188) | REVOKE anon, authenticated (189) |
| `prospect_campaign_targets` | 20261231000000:276 | SELECT TO service_role (278-279); INSERT TO service_role (281-282) | REVOKE anon, authenticated (283) |
| `community_action_journey_links` | 20261231000003:121 | ALL TO service_role (124-125) | REVOKE anon, authenticated (127) |
| `rpa_auth_token_redemptions` | 20261231000005:352 | none | REVOKE PUBLIC (358), anon (362), authenticated (365); GRANT SELECT, INSERT, DELETE TO service_role (368) |
| `identity_verification_attestations` | 20261231000007:238 | ALL TO PUBLIC USING `auth.role()='service_role'` (240-241) | REVOKE anon, authenticated (243) |
| `engagement_request_idempotency` | 20261231000008:116 | none | REVOKE PUBLIC/anon/authenticated (117-119); GRANT SELECT, INSERT, UPDATE, DELETE TO service_role (120) |
| `rpa_session_invalidation_audit` | 20261231000010:55 | none | REVOKE PUBLIC, anon, authenticated (56) |

No stack file sets FORCE RLS, changes default privileges or touches a publication.

Functions (27, all `public`): EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role for `publish_workflow_version` (20261227000000:546-560; restated 20261231000004:167-181), `create_execution_instance` (20261228000000:378-392), `create_execution_plan` (20261228000001:603-606), `execution_step_anchor` (20261228000002:252-255), `advance_execution_plan` (382-385), `cancel_execution_run` (447-450), `bridge_execution_task` (20261229000000:395-398), and the three SECURITY DEFINER functions `reap_community_ai_action_leases`, `claim_community_ai_browser_command`, `record_community_ai_late_dispatch_result` (20261231000005:88-304, 398-403). Revoked with no service_role grant (trigger functions): `identity_verification_attestations_guard` (20261231000007:244), `community_action_journey_links_identity_proof_guard` (307), `community_ai_actions_reap_uncertain_guard` (20261231000009:139). **Not revoked:** 13 trigger guards (`prospect_campaigns_guard`, `workflows_guard`, `workflow_versions_guard_immutable`, `execution_instances_guard`, `execution_plans_guard`, `execution_plan_steps_guard`, `execution_tasks_guard`, `outreach_bridge_handoffs_guard`, `execution_engine_requests_guard`, `prospect_campaigns_targeting_guard`, `prospect_campaign_targets_guard`, `community_action_journey_links_guard`, `community_action_journey_links_identity_guard`) and `community_identity_normalize_external_id(text)`. Only the three in 20261231000005 are SECURITY DEFINER. A trigger function cannot be called through `/rest/v1/rpc` ("trigger functions can only be called as triggers"); `community_identity_normalize_external_id` is the only un-revoked, directly callable stack function — invoker rights, a normalizer.

### 1.4 PR #349 — `20261223000000` / `20261223000001` (read from `3b203a18`)

| Table | RLS | Policy | Grants |
|---|---|---|---|
| `customer_readiness_snapshots` | ENABLE (000000:97) | `DROP POLICY IF EXISTS` + `customer_readiness_snapshots_service_role` ALL TO service_role USING/CHECK true (99-101) | `REVOKE ALL FROM PUBLIC, anon, authenticated` (104); `GRANT SELECT, INSERT TO service_role` (106) |
| `execution_approvals` | ENABLE (000001:81) | `execution_service_role` ALL TO service_role true (83-85) | `REVOKE ALL FROM PUBLIC, anon, authenticated` (88); `GRANT SELECT, INSERT, UPDATE TO service_role` (90) |

No functions. Memory: production service_role holds full privileges via the default ACL (a superset of the explicit grant). **[memory]**

## 2. Consumer trace

| Channel | Finding | Evidence |
|---|---|---|
| Browser, publishable key | The only browser Supabase client is `getSupabaseBrowser()` (`lib/supabaseBrowser.ts:29-55`, the sole `createBrowserClient` site, enforced by `eslint.config.js:100-102`). Its uses are auth (`getUser`, `signOut`, `setSession`, `refreshSession`, `onAuthStateChange`) and one realtime channel. **No `.from(`, `.rpc(` or `.channel(` against a table in browser code except `lib/swr/creditsRealtime.ts:30-38`** (postgres_changes INSERT on `public.credit_transactions`). The search over `components hooks lib pages(non-api) store utils` found `.from(` only in `lib/anomaly/*`, `lib/blog/*` (all import the secret key or `backend/db/supabaseClient`) and `lib/thread/threadNodePersistence.ts` (receives a client from its caller). |
| Browser → Storage | `components/activity-workspace/creatorMediaUploadHandlers.ts:224,309,403` and `pages/activity-workspace/ActivityWorkspacePrimaryBrief.tsx:214,372` send the publishable key to `/storage/v1/upload/resumable`. Storage RLS is on `storage.objects`, none of the in-scope `public` objects. |
| Server, user JWT / SSR | **None found.** No server `createClient` with a user `Authorization` header, no `createServerClient` (only comments: `pages/api/feature-completion.ts:53`, `pages/api/readiness-score.ts:131` say the old SSR client was removed). Every server `createClient` uses the secret key: `backend/db/supabaseClient.ts:94`, `backend/services/featureCompletionService.ts:17-20`, `featureCompletionSyncService.ts:74-77`, `lib/anomaly/{baselineService,detectionEngine,sweepDetector}.ts`, `lib/auth/auditLog.ts:21-25`. |
| Server, service role | Stack: `backend/services/{prospectLists/store,prospectCampaigns/prospectCampaignStore,workflows/workflowStore,executionInstances/executionInstanceStore,executionPlans/executionPlanStore,outreachBridge/outreachBridgeStore,workflowExecution/stepProgressionStore}.ts` via `ownedDbTable` (`backend/db/writeOwner.ts:1,8` → service-role client) or `supabase` from `backend/db/supabaseClient`. Stack RPCs: `backend/scheduler/cron.ts:736` (`reap_community_ai_action_leases`), `pages/api/extension/commands.ts:320`, `pages/api/extension/action-result.ts:95`, `backend/services/rpaWorker/rpaAuthTokens.ts:184`. Content/FIX3: `backend/services/content/{contentService,approvalService,collaborationService,qualityService,contentMemoryService,publicationLineageService}.ts` all `import { supabase } from '../../db/supabaseClient'`; none is imported by a client component. PR #349: `backend/services/customerReadinessSnapshotService.ts:75`, `customerEvolutionService.ts:169`, `customerOutcomeIntelligenceService.ts:143`; `execution/executionApprovalService.ts` via `ownedDbTable`. |
| Edge Functions | One: `supabase/functions/send-transactional-email` — authenticates callers with `SUPABASE_SECRET_KEYS` (index.ts:25, 462), refuses the publishable key; no table access to in-scope objects found. Invoked server-side only (`emailService.ts:167`, `domainReminderService.ts:81`, `leadOutreachExecution/emailTransport.ts:111`, `pages/api/cron/email-jobs.ts:160`). |
| Realtime | Browser: only `credit_transactions` (above). Server: `backend/services/realtimePublisherService.ts:130` sends **broadcast** on `org:<id>:<topic>` with the service-role client — not table-bound. No migration in scope touches a publication. Memory (2026-09): no public table was in any publication, so the `credit_transactions` subscription never delivered. **[memory; re-check with S09]** |
| Direct DB connections (names only) | `SUPABASE_DB_URL` (36 refs), `SUPABASE_POOLER_DB_URL` (15), `DATABASE_URL` (12), `TEST_DATABASE_URL` (1). Users: `scripts/{ops,operator,audit,ci,security,_core}`, `scripts/verify-schema-parity.js`, `scripts/apply-bolt-*`, `scripts/bolt-*`, `db-utility/db-inspector.js`, `lib/env/namespace.ts`, `backend/tests`. **No runtime API/worker path uses a DB URL.** These connect as the URL's login role, not anon/authenticated, so anon/authenticated revokes do not affect them unless that role is a member of one (S01 lists memberships). |
| Operator anon-key scripts | `db-utils/supabase-util-client.js:5-9` builds a client from `NEXT_PUBLIC_SUPABASE_ANON_KEY`; used by `db-utils/{db-inspector,quick-check,validate-database}.js` (generic `.from(tableName)` and `.rpc('exec_sql')`). Manual diagnostics, not a product path; already blocked by close_anon for its 177 tables. |
| BI / third-party | No BI, n8n, Metabase, Looker, Retool, Airbyte, Fivetran or Hightouch connector in config or code; "Zapier"/"Metabase"/"Looker" appear only as vocabulary strings (`competitorDiscovery.ts:58`, `opportunityClassifierService.ts:243`, audit fixtures). `wordpress-plugin/` and `public/` contain no Supabase reference. External tools connecting with their own DB credentials are invisible to the repo. **[prod-needed: Q5 + owner]** |

**8 Phase-A content tables:** no browser path, no user-JWT path, no SSR client, no realtime subscription, no edge-function access was found. Every reader and writer is a service-role server module. On this evidence the out-of-repo `authenticated` revoke could not have broken an in-repo consumer and cannot break one later. Not covered: anything outside the repo (§7 P4, P5).

## 3. Effective privileges — the 10 RLS-only stack tables

### 3.1 Derivation for production (not measured)

Inputs: Supabase's default privileges for objects created by `postgres` in `public` grant `arwdDxtm` to anon, authenticated and service_role, plus EXECUTE on functions. close_anon lines 453-457 remove anon's table/sequence/function defaults, TRUNCATE for authenticated, and PUBLIC function EXECUTE. Memory (`project_pr349_readiness_approvals.md`, prod preflight 2026-10-29) observed the production `public` default ACL for postgres granting authenticated `arwdxtm`, which agrees.

If a stack file is applied in production by `postgres` (SQL Editor or psql as postgres), each of the 10 tables gets:

| Role | Table grant | RLS outcome |
|---|---|---|
| anon | none | `permission denied` |
| authenticated | `arwdxtm` (no TRUNCATE) | SELECT/UPDATE/DELETE see 0 rows; INSERT refused. 6 tables: the policy `auth.role()='service_role'` is false for a user JWT. 4 tables (`execution_plans`, `execution_plan_steps`, `execution_tasks`, `outreach_bridge_handoffs`): no policy, so deny. REFERENCES, TRIGGER and MAINTAIN are not governed by RLS, but PostgREST cannot issue DDL/VACUUM, so they are reachable only by a direct login as `authenticated`. |
| service_role | `arwdDxtm` | BYPASSRLS: full access |

Un-revoked functions (13 guards + `community_identity_normalize_external_id`): EXECUTE for authenticated and service_role; none for anon or PUBLIC.

Caveats: the outcome depends on who creates the table. A creator other than `postgres` (e.g. `supabase_admin` via the dashboard Table Editor) has its own default ACL. Whether the stack tables exist in production at all is unknown.

### 3.2 Disposable-copy evidence **[disposable — NON-PRODUCTION]**

Script: rolled-back transaction on `w6_grants` (`CREATE DATABASE w6_grants TEMPLATE w6`, dropped afterwards).

- **As-is (bootstrap, tables owned by `w6super`, no Supabase default ACL):** all 10 tables have `relacl` NULL. anon, authenticated and service_role hold **no** privileges (`has_table_privilege` all f). The only `pg_default_acl` row is `postgres` functions `{postgres=X/postgres}`, and there are no publications. **This differs from production**, so this harness cannot show production's authenticated grants. It also shows service_role NONE on the revoke-only tables, which production's service_role default ACL covers.
- **Simulated production ACL** (GRANT authenticated `SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN`; service_role ALL), one row seeded each in `prospect_lists` and `execution_plans` with replication-role bypass:

| Probe | Result |
|---|---|
| anon SELECT `prospect_lists` | `ERROR: permission denied for table prospect_lists` |
| authenticated (claim role=authenticated) SELECT `prospect_lists` / `execution_plans` | 0 / 0 rows (1 row exists) |
| authenticated UPDATE `prospect_lists` / DELETE `execution_plans` | `UPDATE 0` / `DELETE 0` |
| authenticated INSERT `prospect_lists` | `new row violates row-level security policy` |
| authenticated INSERT `execution_plans` | refused by the BEFORE guard trigger (`instance … does not exist`; the guard's lookup is itself RLS-filtered) before RLS WITH CHECK |
| authenticated TRUNCATE | `permission denied` |
| DB role authenticated with claim `role=service_role` | `prospect_lists` **1 row**, `execution_plans` 0 |
| service_role | 1 / 1 rows (BYPASSRLS) |
| After `REVOKE ALL … FROM PUBLIC, anon, authenticated` in the same transaction | authenticated: `permission denied`; service_role still 1 row |

The claim-keyed probe shows that the 6 policies key on the JWT **claim**, not the database role. Through PostgREST the database role is taken from that same claim, so this is not reachable with a user JWT. It does mean these policies are weaker than `TO service_role`, the form used by the later stack files.

## 4. Recommendation (not implemented)

An explicit `REVOKE ALL ON <10 tables> FROM PUBLIC, anon, authenticated` plus `GRANT SELECT, INSERT, UPDATE, DELETE ON … TO service_role` is **appropriate**. It brings these tables to the convention of the later stack files and #349: no client grant, closing REFERENCES/TRIGGER/MAINTAIN and dependence on policy correctness. Optionally also retarget the 6 `auth.role()` policies `TO service_role` and REVOKE EXECUTE on the un-revoked guard functions. The code trace found no consumer that needs anon/authenticated on any of them, and the disposable simulation shows service_role unaffected.

Explicit `GRANT … TO service_role` is required, not cosmetic: the revoke-only stack tables rely on service_role's default ACL, which the disposable copy does not have (S04 there: NONE).

Required before a migration is written:
1. The consumer trace (§2) — done for the repo; owner confirmation of no out-of-repo consumer (P5).
2. The production ACL snapshot from `grants-acl-check.sql` (P1), proving existence, owner, `relacl` and `pg_default_acl` for the creating role.
3. The API-log check from `api-log-queries.sql` Q1-Q3 over the full retention window with zero non-service_role hits (P3). This is necessary, not sufficient.
4. The realtime publication check (S09 + Q4) showing none of the tables in `supabase_realtime` (P2).
5. Run as a separately authorized migration after the stack files, never via `db push` (runbook §1).

The same reasoning applies to the 4 FIX3 tables, which also issue no REVOKE (§1.2). The 8 Phase-A tables need their production revoke **recorded as a migration** so replays match production (P6).

## 5. close_anon — current-state questions

The migration self-verifies at apply time. Since then, tables created by `postgres` regain authenticated `arwdxtm` by default. RLS stays on, but any later `DISABLE ROW LEVEL SECURITY` or broad policy would reopen authenticated access. S02/S04 of the ACL check re-verify all 177+9+4 tables, 37 views and 29 functions today. `scripts/security/verify-anon-exposure.{js,sql}` is the original verifier.

## 6. Prepared files and validation

- `scripts/release/grants-acl-check.sql`: one SELECT inside `BEGIN … READ ONLY … ROLLBACK`, sections S01-S11. Object lists for close_anon were extracted mechanically from the migration's arrays (counts 177/29/29/8/9/4 match its header). **Validated on `w6_grants` [disposable]:** exit 0, 1,882 rows. All in-scope objects resolve except the two #349 tables (absent at this base) and `set_content_updated_at`. MAINTAIN is checked only when `server_version_num >= 170000`.
- `scripts/release/api-log-queries.sql`: Logs Explorer / Management API queries Q1-Q5. **Not executed anywhere.** The BigQuery-dialect field paths are unverified and must be checked against the Logs Explorer schema pane. The limitations are stated in the file header.

## 7. Facts still requiring production evidence or owner confirmation

| # | Fact | How to obtain |
|---|---|---|
| P1 | Existence, owner, RLS/FORCE, `relacl`, effective privileges of every in-scope table/view/function; production `pg_default_acl` for `postgres` (and `supabase_admin`) | `scripts/release/grants-acl-check.sql` S02-S08 |
| P2 | Whether any in-scope table (or `credit_transactions`) is in `supabase_realtime` | `grants-acl-check.sql` S09; `api-log-queries.sql` Q4 |
| P3 | Non-service_role REST/RPC/GraphQL hits on in-scope objects over full retention | `api-log-queries.sql` Q1-Q3, day-sliced; record each slice |
| P4 | Direct-DB / external-tool sessions as client roles; permission-denied errors after the Phase-A revoke | `api-log-queries.sql` Q5; `grants-acl-check.sql` S01 memberships |
| P5 | No out-of-repo consumer (BI, spreadsheets, Zapier, partner keys, manual SQL users) of the 10 stack tables, 4 FIX3 tables, 8 Phase-A tables | owner confirmation |
| P6 | The exact SQL of the out-of-repo Phase-A `authenticated` revoke (statement, privileges, whether anon/PUBLIC touched), and a decision to record it as a migration | owner / SQL Editor history; compare with S03 for the 8 tables |
| P7 | Which stack files are applied in production | runbook `docs/release/orchestration-engine-adapters-migration-runbook.md` §3 preflight |
| P8 | Ledger rows for 20261223000000/01 (absent per memory) | separate approval, per memory |
| P9 | Plan retention and Logs Explorer/Management API row and window limits | Supabase project plan page / docs at run time |
