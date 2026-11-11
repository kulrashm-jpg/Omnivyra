# S release window: Outreach smoke-test checklist (input to virality-55's plan)

Scope: ONLY what Outreach (virality-6f) puts into S: extension 1.5 server, U1, the submit gate, the capture handler, and migrations 20270207000000/01/02. Orchestration, PI and release items belong to their owners' sections. Everything here is read-only or a refused probe: **no step sends anything to a platform and nothing writes tenant data**, except the migration apply itself, which is owner-authorised in 83's tab.

Expected state after S: every new Outreach surface is DARK.
- `EXTENSION_V15_COMMAND_INGESTION_ENABLED = false` (R-3 not lifted for 1.5).
- `DM_COLLECTION_ISSUABLE = false` (E-3 / B-7).
- `SALESNAV_CAPTURE_ISSUABLE = false` (E-2).
- The 1.4 extension routes behave as before for 1.4 clients.

## 0. Before the pause
- [ ] Record the baseline (read-only SQL, Management API):
  - `SELECT count(*) FROM community_ai_actions WHERE status='pending' AND execution_mode='browser' AND dispatch_lease_id IS NULL;` (pending browser work);
  - `SELECT count(*) FROM community_ai_actions WHERE dispatch_lease_id IS NOT NULL AND status IN ('pending','dispatched','acknowledged');` (in-flight leases);
  - `SELECT count(*) FROM extension_commands WHERE status IN ('pending','executing');`
- [ ] The in-flight leases should drain or be reaped before apply: the U1 trigger fires on every UPDATE of `community_ai_actions`, so the fewer moving rows at apply, the better.

## 1. Pause (Orchestration owns the community pause; Outreach's part)
- [ ] Nothing extra. 1.4 extension clients keep polling `GET /api/extension/commands`; with the community pause in force, the claim RPC refuses, so nothing goes out. No Outreach switch needs flipping.

## 2. Apply (83, owner-authorised; in version order)
1. `20270207000000_extension_account_binding_and_submit_evidence.sql`
2. `20270207000001_extension_submit_gate.sql`
3. `20270207000002_extension_v15_delivery_path.sql` (its backfill must touch **0 rows**: no thread has `ingested_via='extension_v15'` in prod)

`20270204000000_rpa_tables_client_privileges_revoked.sql` is **already applied in prod** (R-1, 2026-11-10). Do not re-apply it; confirm its ledger handling with 83.

Each file RAISEs on its own postconditions. A clean `COMMIT` is the first check. Then, read-only:
- [ ] `SELECT to_regclass('public.extension_account_bindings') IS NOT NULL;` → t
- [ ] `SELECT relrowsecurity FROM pg_class WHERE oid='public.extension_account_bindings'::regclass;` → t
- [ ] `SELECT has_table_privilege('authenticated','public.extension_account_bindings','SELECT'), has_table_privilege('anon','public.extension_account_bindings','SELECT');` → f, f
- [ ] `SELECT to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)') IS NOT NULL;` → t
- [ ] `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)');` → f, `{search_path=public, pg_temp}`
- [ ] `SELECT position('NOT_V15_DELIVERY' IN prosrc) > 0 FROM pg_proc WHERE oid = to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)');` → t (the 000002 form)
- [ ] `SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.community_ai_actions'::regclass AND tgname='community_ai_actions_delivery_path';` → O
- [ ] `SELECT count(*) FROM community_ai_actions WHERE delivery_path IS NOT NULL;` → 0
- [ ] `SELECT has_function_privilege('authenticated', to_regprocedure('public.community_ai_actions_set_delivery_path()'), 'EXECUTE');` → f
- [ ] The extension_commands CHECKs carry the 1.5 values and are validated: `SELECT conname, convalidated FROM pg_constraint WHERE conrelid='public.extension_commands'::regclass AND conname IN ('extension_commands_action_type_check','extension_commands_status_check');` → both t

## 3. Merge and deploy (55 / 83)
- [ ] Deploy only the clean merge commit (predeploy-check). Check the worker and web commit hashes match.

## 4. Verify (probes: expected answers; none of them acts)
Unauthenticated probes against the deployed host:
- [ ] `GET /api/extension/v15/commands` → **401**, no body detail
- [ ] `POST /api/extension/bind-account` → **401**
- [ ] `POST /api/extension/v15/authorize-submit` → **401**
- [ ] `POST /api/extension/v15/commands/ack` and `/v15/commands/result` → **401**
- [ ] `POST /api/extension/v15/events/comments` → **410 `BROWSER_SYNC_SUSPENDED`**: refused BEFORE auth while R-3 holds for 1.5
- [ ] `GET /api/extension/commands` (1.4) → **401**

As a test company admin (a test account, never a customer's):
- [ ] `POST /api/engagement/extension/commands` body `{organization_id, action:'li.collect.own_post_comments'}` → **403 `BROWSER_SYNC_SUSPENDED`**
- [ ] the same with `action:'li.collect.own_inbox'` → **403 `BROWSER_SYNC_SUSPENDED`** (DM issuance is also off)
- [ ] the same with `action:'li.salesnav.capture_saved_leads'` → **403 `SALESNAV_CAPTURE_DISABLED`**
- [ ] `SELECT count(*) FROM extension_commands WHERE payload->>'v15' = 'true';` → 0 (nothing was issued)

1.4 clients unaffected (with a 1.4.x test extension session, no 1.5 binding):
- [ ] `GET /api/extension/commands` → 200 and the same offer behaviour as before. With no marked rows, the U1 query filter (`delivery_path IS NULL`) changes nothing. Check the logs show no `COMMANDS_QUERY_FAILED`: the route selects `delivery_path` now, and a missing column would fall back, but after apply it must not.

## 5. Resume
- [ ] Resume the community pause (55). Then within one tick:
  - `SELECT count(*) FROM community_ai_actions WHERE delivery_path IS NOT NULL;` stays 0 (no v15 threads exist);
  - pending browser work is offered and claimed as before (compare with the step-0 baseline);
  - no `[extension/commands] supabase error` lines in the logs.

## 6. Rollback triggers (Outreach)
- A probe in section 4 answers 200, or acts → stop and investigate (a dark switch is not dark).
- `COMMANDS_QUERY_FAILED` on the 1.4 route after apply → the U1 read is failing. Roll back the app first. The migration rollbacks are `rollbacks/extension_v15_delivery_path_rollback.sql` (restores the 000001 submit gate) and then the 000001 / 000000 rollbacks, in reverse version order, each owner-authorised.
