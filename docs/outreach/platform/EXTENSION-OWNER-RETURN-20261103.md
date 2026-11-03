# Extension containment, community governance and 1.5.0: owner return (2026-11-03)

Written for the owner. This answers the "Immediate return" list of the 2026-11-03 decision.

Three streams are kept separate:
- **A. Containment**: R-1, R-3 and 1.4.1.
- **B. Community governance**: D-01, D-03 and L-3.
- **C. 1.5.0.**

Nothing has been pushed, merged, deployed, published or run against production.

---

## 1. R-1: events signing. Compatibility proof and deployment plan

**Branch:** `sec/extension-events-signed` at `68a15f96d`, built on `main` = `5025f51d`, which is the commit in production.
- **Runtime change:** one file, `pages/api/extension/events.ts`.
- **Tests:** three test files.
- **Preserve ref:** `refs/preserve/sec-extension-events-signed`.

| Condition | Proof |
|---|---|
| 1. Every token-accepting route enforces the signature | `extensionRouteSignatureCoverage` (33 of 33 pass) checks all 12 `pages/api/extension` routes.<br>• The 9 token-accepting routes call `requireExtensionAuth` and return on failure before any database access. Each one, given a valid token with no signature, answers 401 having touched the database zero times.<br>• The 3 others (`bootstrap`, `redeem`, `session`) never accept an extension token.<br>• No code outside the auth middleware verifies a token by itself. |
| 2. Replayed and invalid signatures are rejected | `extensionEventsSignedIngest` (8 of 8) rejects each of these with its own reason code:<br>• missing headers<br>• wrong key<br>• changed body<br>• stale timestamp<br>• replayed nonce<br>• Supabase JWT instead of an extension token |
| 3. 1.4.0 compatibility, tested explicitly | `extensionEventsSigned140Compat` (3 of 3) uses the published 1.4.0 code, unmodified, end to end:<br>• It pairs through the real `validate` route.<br>• Its content script's `sendSyncEvents()` goes through its own worker signer to the real signed `events` route: 200, event ingested.<br>• Replaying that same 1.4.0 request is refused. |
| 4. No legitimate client is broken | The route's only caller is the extension's own collector, and 1.4.0 signs those requests (proof 3).<br>• The web app never calls it.<br>• Nothing calls `GET /api/extension/session`. The tokens it issues carry no HMAC nonce, so they could never pass a signature check; before R-1 they were accepted on this route. |
| 5. Only the reviewed change is deployed | The branch is production plus 2 commits: 1 runtime file and 3 test files. `origin/main` was still `5025f51d` when checked. |
| 6. Rollback | See below. |

**Typecheck:** the root project and `tsconfig.backend.json` are clean. `tsconfig.backend-tests.json` already had 153 errors, none in these files.

**The apparent contradiction, resolved.**
- 1.4.0's service worker signs every `/api/extension/*` request except `bootstrap` and `redeem` (`serviceWorker.js`, `requiresSignature`).
- Content scripts can reach the backend only through that worker.
- So the old bearer-only acceptance never served a genuine 1.4.0 client. It served only callers holding a bare token without the secret: page scripts that 1.4.0 leaked the token to, and tokens issued by `/api/extension/session`.

**Deployment plan.** Each step happens only on your go.
1. Push `sec/extension-events-signed` and open a PR to `main` titled "security(extension): signed /api/extension/events (R-1)". The diff is exactly the 4 files above.
2. CI must be green. Merge only that PR, with nothing else queued behind it.
3. Run `predeploy-check` on the merged `origin/main` and deploy that commit. Railway redeploys about 5 s after merge, and this change is web-only.
4. **Before deploying,** record the current production deployment ID as the rollback target.
5. **After deploying, verify:**
   - an unsigned `POST /api/extension/events` with a bearer token returns 401 `SIGNATURE_INVALID`;
   - `/api/extension/health`, `/commands` and `/validate` behave as before;
   - logs show no rise in 401s from genuine extension sessions.
6. **Rollback:**
   - promote the recorded previous deployment;
   - then revert the merge commit on `main` through a PR.
   - There is no migration, so rollback is clean either way.

---

## 2. R-3: block legacy upload routes. Exact scope and impact

**Branch:** `sec/extension-ingest-suspended`, stacked on R-1, because both change `events.ts`. Deploy it as its own second operation after R-1 is verified.

**Switch:** a code constant, `EXTENSION_BROWSER_INGESTION_SUSPENDED = true`, in `backend/services/extensionIngestionSuspension.ts`. It is not an environment flag. Turning browser ingestion back on needs a reviewed code change after the F-1 approvals.

| Endpoint or path | With R-3 |
|---|---|
| `POST /api/extension/events` | 410 `BROWSER_SYNC_SUSPENDED`, before auth, parsing or any database access |
| `POST /api/extension/events/dms` | Same |
| `POST /api/extension/events/comments` | Same |
| `POST /api/engagement/platform-sync` | 410. It queues no `sync_dm_inbox` or `sync_comments_inbox` browser commands |
| `GET /api/extension/commands` | Never offers or claims a `sync_*_inbox` row. Rows already queued stay `pending` and untouched. Other commands are unaffected |
| Web app: `triggerPlatformSync` | Throws the suspension notice without sending anything to the extension |
| Web app: inbox "Check latest messages" | Shows "Browser sync is suspended. The Chrome extension no longer collects LinkedIn, X, Facebook or Instagram messages and comments…" with status `warning`, not "failed" |

**Not affected:**
- official-API ingestion;
- inbox reads;
- `GET /api/engagement/platform-sync`, the freshness read;
- `/api/engagement/sync`, which stores nothing and only returns a time window;
- every action, command, health, validate and pairing route.

**Effect on users:**
- **The inbox** receives no items collected through the browser. Items arriving through official APIs are unchanged.
- **Users still on 1.4.0** keep reading pages in the background until Chrome updates them, but every upload now gets 410.
  - On X, Facebook and Instagram, 1.4.0 shows its red "Omnivyra sync failed" toast containing the server message ("Omnivyra browser sync is suspended. Nothing collected in the browser was stored.").
  - Publishing 1.4.1 ends this.

**Tests:** `extensionIngestionSuspended`, 9 tests. Every block has a positive control: the same input with the suspension switched off goes through. That shows a pass is not just some other gate refusing.

**On this branch:**
- The R-1 coverage test expects 410 on the three upload routes, and 401 on the other six token-accepting routes.
- The two signing suites run with the suspension switched off, so they still prove the signature layer that protects these routes if ingestion is ever re-enabled.
- Together with `eng004`: 5 suites, 108 of 108 pass.
- Commit `551756836`: 13 files, 276 lines added, 2 removed.
- Typecheck: `tsconfig.json` and `tsconfig.backend.json` both clean, with 0 errors.

---

## 3. Corrected 1.4.1 test evidence

**Artifact:** the zip SHA-256 `de4239a29b1bbe98e8173b47d410c57470e36332dec5d218fee662a3b97d5600` was re-verified today.
- Every file in it is byte-identical to tag `v1.4.1-rc1` (`ff3e357`); the manifest differs only by the stripped `update_url`.
- Permissions are unchanged from 1.4.0.
- Since the tag, only `docs/` and the packaging script have changed, and the package leaves `docs/` out.

**Version-pin fix:** branch `release/extension-1.4.1-pin` at `86dd45eb5`, built on `main`. It is test-only.
- On `main`, the extension-source suites read a hard-coded path from another machine, so they cannot run here whatever the version. That is why the earlier "66 pass" came from the integration branch.
- This branch brings over only the test-portability hunks of `b3b9f929f` for these suites, plus the pin change to `1.4.1`.
- **Result against the 1.4.1 source:** 3 suites, 67 passed, 1 skipped by design.

**Extension repository suite:** 27 of 27 pass on 1.4.1. On 1.4.0, 22 fail, each naming its defect.

**Real Chromium:** a clean 1.4.1 run, alongside the control run in which 1.4.0 misbehaved. Details are in `RELEASE-1.4.1.md`.

**Publication plan** (a separate release operation, after R-1 is verified):
1. Merge the pin branch.
2. Recompute the zip SHA.
3. Upload.
4. Record the store item version.
5. Verify `verified_contents.json` on a test profile.

The rollback and containment notes are in `RELEASE-1.4.1.md`. Rollback means publishing a higher version; unlisting revokes nothing.

**Standing blockers, as you ruled:** 1.4.1 still stores the token where the extension's own scripts can read it, and its capability gate fails open. The queued browser-execution path must not be activated until 1.5.0.

---

## 4. D-03: six conditions and the proposed diff

**Conditions** (Outreach's, as sent to Orchestration):
1. **Fail closed:** `handoff_missing`, `journey_state_unreadable` and any unknown state all hold. Only a definite `active` proceeds.
2. **Write nothing:** `resolveJourneyHold` only reads. The `deferred_journey` path writes no decision row, claim, quota, attempt or `blocked_prior_attempt`, and leaves the task's status unchanged.
3. **Exactly once on resume:** after reactivation the same task dispatches once, with one attempt and one provider call. The recovery sweep does not treat a deferred task as stuck or failed, does not spend retry budget, and does not loop.
4. **Non-journey tasks unchanged:** the existing ws3 tests pass without edits.
5. **Placement:** after the transport guard and before governance. The channel-neutrality test passes without being loosened.
6. **Never a refusal:** `deferred_*` maps to "wait" in the engine adapter. No path maps `deferred_journey` to a refusal or to `needs_human`.

**Status: the diff is not yet received.** Orchestration has been asked for:
- the diff file and its SHA-256;
- its tests;
- every affected execution path with file and line: activate route, recovery sweep, adapter, `dispatchInternalOutreachTask`, and anything else that passes through `dispatch.ts`.

**Update: diff received and reviewed (peer-approved, NOT committed).**
- **Diff:** `C:/tmp/orch-w1-pause` at `5e84210c5`, sha256 `ab58d18a7a07a7ac4df1980a303e89bfe73e6a296b9eaa9b8ffcb8eed37994d8`. I verified it independently.
- **Files:** 7, with 810 lines added and 3 removed.
  - Runtime: `emailExecutionContext.ts` gains `resolveJourneyHold`, read-only, 74 lines. `dispatch.ts` gains 13 lines: the import, the `deferred_journey` outcome, and the hold placed after the transport guard and before governance.
  - Tests: 35 new unit tests, 12 new real-schema tests, and a 3-line fixture change.
  - Pins: the `dispatch.ts` hash pins in two tests move from `c0683963a248bbc3` to `e70abcfe13d3cc93`. I verified both values and signed off the change for exactly this diff.
- **Affected paths:** `activate.ts` → `leadOutreachActivation.ts:221`; the recovery sweep at `:166`; the engine adapter's email path (`engineAdapters:250` → `workflowEmailDispatch:117`) and internal path (`:261`). All go through `dispatchInternalOutreachTask`.
- **Orchestration's results:** unit 65 suites, 2,344 passed, 0 failed; real-schema 16 suites, 322 passed, 3 skipped; typecheck clean; mutants 10 of 10 killed.
- **The six conditions:** met against the code.
  - Runs in `created` or `queued` state are held. I accept that as fail-closed.
  - A recorded follow-up, not a blocker: tasks whose journey has ended stay queued and held indefinitely. That is safe, but they should be disposed of.

**RULING CONFLICT, needs you.** Orchestration says its owner message authorised Agent B to edit `dispatch.ts` under these conditions. Your message to me says "Do not implement yet". Orchestration is writing the diff in its own worktree, `C:/tmp/orch-w1-pause`, uncommitted and on no shared branch. Nothing will be committed until you say which ruling stands.

---

## 5. L-3: worktree and implementation plan

**Worktree:** `C:/tmp/omp-l3`, branch `outreach/l3-community-recipient-recheck`, at `4f8359114`, the D-01 baseline.

**Every path that can reach a platform call** (mapped on `4f8359114`):

| Entry point | Reaches the platform through | Recheck placed |
|---|---|---|
| Manual execute (`pages/api/community-ai/actions/execute.ts:235`) | `executeAction` → `runExecution` | In `runExecution` |
| Scheduler (`communityAiScheduler.ts:430`; not wired into cron) | Same | Same |
| RPA retry flush (`cron.ts:871-897` → `rpaWorkerService.ts:122-131`) | Same | Same |
| Auto-rule (`communityAiAutoRuleService.ts:542`) | Same | Same |
| Orchestration adapter (`communityEngineAdapter.ts:813`) | Same | Same |
| Browser dispatch and chain steps (`pages/api/extension/commands.ts`, claim at :320) | Extension claim, bypassing `runExecution` | In `commands.ts`, before the claim |
| Ad-hoc like, reply and bulk (`auto_insert`) | Refused by D-01; never reach the platform | None needed |

**Edits:**
1. **New read-only module** `backend/services/community/communityRecipientRecheck.ts`: `recheckCommunityRecipient({ organizationId, action })`.
   - Resolves the recipient:
     - `discovered_user_id` → `community_ai_discovered_users(platform, external_user_id)`;
     - otherwise `target_id` → `engagement_messages`, filtered by platform and tenant → `author_id` → `engagement_authors.platform_user_id`;
     - if available, the person is resolved through `communityIdentityProof`.
   - A like or reply on the tenant's **own** post, matched in `scheduled_posts.platform_post_id`, has no third-party recipient.
   - Asks `evaluateCanonicalGovernance({ organizationId, channel: platform, personId?, target })`, the canonical `contact_governance_records`. No new tables.
2. **`runExecution`:** one call immediately before `switch (executionMode)` (about :627), after the D-01 gates. A refusal returns `skipped`, `may_have_acted: false`, logs `skipped` with a reason, writes no attempt and never retries.
3. **`commands.ts`:** the same call between payload validation and the claim. A refused row is recorded as terminal `skipped` and never claimed.
4. **Not touched:** `executeAction`'s auto-insert and dedup block, `requiresApproval`, `AutoRuleService`, `execute.ts`, `approve.ts`, the claim RPC.

**Order with Orchestration:** L-3 lands first, then Orchestration's race-fix lock rebases onto it. Orchestration has agreed.

**Tests:**
- For every entry point in the table, an opt-out recorded **after** approval means zero connector calls and no claim.
- An unresolved recipient is refused, an unreadable consent store is refused, and an own-post like with no third party proceeds.
- **Positive control:** with no opt-out, the action proceeds.
- The D-01 suites pass unchanged.

**Two facts you need to decide on:**
- **No writer exists for social-platform opt-outs.** `contact_governance_records` is written only for email, phone and WhatsApp (by unsubscribe, the SES events, the WhatsApp STOP handler, erasure, and suppression). So, until something records "this LinkedIn person opted out", the recheck will find nothing.
  - **Decision L3-1:** approve a minimal writer, an operator "do not engage this person" action that writes `contact_governance_records` with `channel = 'linkedin'`, as separate work.
- **An unresolvable recipient is refused by default (fail closed).** This blocks replies and likes whose author can't be identified.
  - **Decision L3-2:** confirm this, or allow likes on the tenant's own posts only.

---

## 6. 1.5.0: P0/P1 contracts, migration and dependencies

**P0: prerequisites before server and client work run in parallel**

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Lock the signed command envelope | Coordinator | Drafted below |
| 2 | Account-binding evidence agreed with PI | PI + coordinator | **Open, and a design gap:** `social_accounts.platform_user_id` is the OIDC `sub`, an opaque ID (`auth/linkedin/callback.ts:217`). A LinkedIn page shows a profile URN, not that ID. Binding needs either a LinkedIn API call at pairing that returns both IDs, or an attested link stored by PI. |
| 3 | Approval and result mapping agreed with Orchestration | c7 | Open. D-01 is accepted; result mapping is not yet agreed |
| 4 | The approval-record database fix | c7 | **Blocked by a schema gap.** `community_ai_actions` has no `approved_by` column in the production snapshot (ledger 20260916), yet `approve.ts` writes it. Whether production has it now is unknown; production check **H0** answers this exactly. Orchestration proposes a forward migration adding the column if missing and tightening the claim function (P-A). |
| 5 | Migration and shared-file ownership | Coordinator | Below |
| 6 | Billing treatment | Billing | Open. No billable execution until it is decided |
| 7 | The approval lock on the auto-rule path | c7 (Agent C), after L-3 | Held until L-3 is committed |

**P1: the signed command envelope v2** (coordinator-owned; verified by the extension before acting):
```
{ v: 2, command_id, chain_index, idempotency_key: sha256(command_id:chain_index),
  org_id, user_id, extension_session_id, social_account_id, acting_member_urn,
  action: 'li.comment.reply' | 'li.reaction.like', target: { post_urn, parent_comment_urn? },
  text_sha256?, approval: { approved_at, approved_by, approval_log_id },
  issued_at, expires_at (≤ 120 s), sig: HMAC(session secret, canonical JSON) }
```
- **Before submitting:** `POST /api/extension/dispatch/authorize-submit`, which replaces `renew`.
  - The server rechecks the kill switch, approval, role, the L-3 recipient check, platform and action permissions, and usage.
  - On success it atomically writes `submit_attempted_at`. Only then may the extension act.
- **Results:**
  - `executed` only with new-object evidence;
  - a refusal before `submit_attempted_at` gives `refused` / `not_begun`;
  - anything ambiguous after it gives `uncertain`, which is never retried.

**P1 migration** (one migration, coordinator-owned; a draft, not in `supabase/migrations`, applied nowhere):
- `extension_sessions`. The table has no `CREATE TABLE` in any migration; it exists only in production. So the migration first creates it if missing, matching what `commands.ts` writes. It then adds `token_hash`, `social_account_id`, `acting_member_urn`, `revoked_at` and `client_version`.
- `community_ai_actions`: adds `submit_attempted_at`, `acting_account_id`, `pre_submit_evidence jsonb` and `post_submit_evidence jsonb`. `approved_by` comes from Orchestration's migration (P0 #4) and is not duplicated.
- It is written only after H0 shows the real production columns.

**Dependency order:**
```
P0 #1, #5 (now) ─┐
P0 #2 PI binding ─┼─► P1 contract + migration ─► P2 server ║ P3 extension ─► P4 adapter ─► P5 executor ─► P6 T1/T2
P0 #3, #4, #7 ────┘                                     (L-3 committed and the approval lock land before P5)
P0 #6 Billing ─────────────────────────────────────────► before any charged action
```

---

## 7. Ownership and release register

| Item | Accountable | Implementer | Branch or location | Head | State |
|---|---|---|---|---|---|
| Extension capability | Outreach Engines | — | — | — | — |
| Integration contract, shared backend, coordination | Outreach coordinator | — | — | — | — |
| Extension client | Outreach Engines | **To be named (C-1)** | `C:/tmp/omvx-ext` (private repository pending) | `a6bfed1` | Local |
| Web Store publisher account and release | Owner | — | **Publisher account to be recorded by the owner (P-1)** | — | — |
| 1.4.0 baseline | Coordinator | — | tag `baseline-1.4.0` | `3ea5031` (tree `20714ce9`) | Preserved |
| 1.4.1 release candidate | Coordinator | Extension owner | tag `v1.4.1-rc1` | `ff3e357` (zip `de4239a2…`) | Awaiting R-1 verification |
| 1.4.1 version pin | Coordinator | — | `release/extension-1.4.1-pin` | `86dd45eb5` | Local |
| R-1 events signing | Coordinator | — | `sec/extension-events-signed` | `68a15f96d` | Ready; awaiting your deploy go |
| R-3 ingestion block | Coordinator | — | `sec/extension-ingest-suspended` | `551756836` (stacked on R-1) | Ready; deploy only after R-1 is verified. 5 suites, 108 of 108 pass |
| D-01 auto-rules | Orchestration | — | `orch/w1-community-default-off` | `4f8359114` | Accepted baseline |
| Approval lock | Orchestration (Agent C) | — | After L-3 | — | Held |
| Claim SQL fix | Orchestration | — | `orch/w1-community-claim-safety` | — | Blocked: `approved_by` gap |
| D-03 journey pause | Outreach (`dispatch.ts`) | Orchestration (Agent B) | `C:/tmp/orch-w1-pause` | — | Ruling conflict |
| L-3 recipient recheck | Outreach | — | `outreach/l3-community-recipient-recheck` | `4f8359114` | Worktree ready; implementation next |
| 1.5.0 | Outreach Engines | — | Plan above | — | P0 open |
| Production checks H0–H4 | Owner runs | — | `EXTENSION-1.4.1-1.5.0-PLAN.md` §H | — | On hold. H0 now also settles the `approved_by` question |
| Release history | Coordinator | — | Extension repository tags, plus `docs/RELEASE-<version>.md` | — | — |

---

## Decisions needed

| # | Decision |
|---|---|
| R-1 | Go to push, PR, merge and deploy (plan §1) |
| D-03 | Which ruling stands |
| L3-1 | Approve a writer for social-platform opt-outs |
| L3-2 | Confirm fail-closed when the recipient can't be resolved |
| R-4 | Release H0 alone: one schema-only `SELECT` that settles `approved_by` and the 1.5.0 migration |
| P-1 | Record the Web Store publisher account |
| C-1 | Name the extension client owner |

---

## Round 3: execution of the 2026-11-03 control-tower rulings

### R-1: DEPLOYED and verified

**Release**
- PR #366, merged as `e04d827f`.
- Its head was `d0567baa3`, not the authorised `68a15f96d`. CI's non-regression job required two non-runtime commits:
  - `c27b5b185` removes the stale `events.ts` route-auth allow-list exception, which the gate itself demanded;
  - `d0567baa3` replaces a fabricated JWT-shaped test literal that the secrets gate flagged.
- Neither commit changes runtime code. Both were disclosed on the PR.

**Deployed**
- Web: `www.omnivyra.com` = `dpl_GYDw56tqCHoQGYMvR4Nm5XDFU3Rt` at `e04d827f`.
- Worker: Railway `fe90d9b7`, boot `gitSha e04d827f`.

**Verified in production**
- `/api/extension/events` moved from the old `{"error":"Unauthorized"}` to the middleware's `INVALID_SESSION`.
- Forged bearer tokens, and forged tokens sent with forged signature headers, are refused with 401.
- Other extension routes are unchanged against the pre-deploy baseline.
- The homepage returns 200.
- The render-parity gate passes.

**Not verifiable in production within the boundary** (proven by tests on the deployed SHA instead): a valid token without a signature, nonce replay, and 1.4.0 compatibility. Each needs a real production session, which means pairing as a logged-in user.

**predeploy-check:** passed. Two gates were skipped (the critical-env check and schema parity) because they need the production `.env.local`, which was not read. Neither applies to this change: no environment change, no migration.

**Rollback reference:** web `dpl_5xv4EYP8q8kiQnd5aoebDfAaQSCS`; worker `5c4ae72a`; both at `5025f51d`.

**Tag:** `deploy/omnivyra-20261103-2146-r1`, local only.

### R-3: DEPLOYED and verified

**Release**
- PR #367, one commit `9ecc56b0d`, rebased onto merged `main`, merged as `23a0a586`.
- All 13 CI checks passed on the first run.

**Deployed**
- Web: `www` = `dpl_7Lr3iaMLrdxJFadxkeRGWwotc3iZ` at `23a0a586`.
- Worker: Railway `7ee96a2c`, boot `gitSha 23a0a586`.

**Verified in production**
- `POST /api/extension/events`, `/events/dms` and `/events/comments` return **410** `BROWSER_SYNC_SUSPENDED` with the suspension message. They returned 401 before.
- `platform-sync` (POST and GET), `commands`, `engagement/sync` and `health` answer exactly as in the pre-R-3 baseline.
- The homepage returns 200, and render parity passes.

**Verified by tests only** (each needs a signed-in session):
- `platform-sync` POST returning 410;
- `commands` never issuing sync commands;
- the Command Center warning;
- the inbox read paths.
These are proven in `extensionIngestionSuspended` with positive controls.

**Expected containment effect:** users still on 1.4.0 see the red "Omnivyra sync failed" toast on X, Facebook and Instagram, with the server's suspension message.

**Rollback reference:** web `dpl_GYDw56tqCHoQGYMvR4Nm5XDFU3Rt` (R-1); worker `fe90d9b7`; both at `e04d827f`.

**Tag:** `deploy/omnivyra-20261103-2259-r3`, local only.

### 1.4.1
Not published, as ruled. The pin branch `release/extension-1.4.1-pin` (`86dd45eb5`) stays separate.

### R-4 / H0: BLOCKED, stopped as instructed
- The approved read-only path is `run-readonly.js`: `BEGIN READ ONLY`, a URL with no password, the password taken from `pgpass`.
- It failed before authentication (`SASL: client password must be a string`), because `pgpass` holds no password for this host. Nothing was read.
- No other credential was looked for, `.env.local` was not read, and no role was created.
- The exact query is ready, for you to run in the Supabase SQL editor:
  `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('community_ai_actions', 'extension_sessions') ORDER BY table_name, ordinal_position`
- Expected output: one row per column. The rows that settle the open questions are `community_ai_actions.approved_by`, whether present and uuid, and the `extension_sessions` columns.

### L-3 and L3-1: IMPLEMENTED, local
**Commit:** `f4d7a2e8f` on `outreach/l3-community-recipient-recheck`, built on D-01 `4f8359114`. Preserve ref `refs/preserve/outreach-l3-recipient-recheck`.

**Recheck**
- Deterministic and read-only: exact keys only. Any ambiguity, missing identity or read failure refuses.
- Consent comes from the canonical store, and only an explicit "allowed" proceeds.

**Enforcement points**
- `runExecution`, immediately before dispatch. This covers manual execute, the scheduler, retry flush, auto-rule and the adapter.
- `commands.ts`, before the claim. This covers browser dispatch and chain steps.

**Writer**
- A thin adapter over PI's `recordContactGovernance`, so no new store.
- PI contract gaps, all failing safe:
  - **G1:** no actor column;
  - **G2:** social identifiers are lower-cased;
  - **G3:** a channel "do not engage" cannot be narrowed to community engagement only.
- These need PI sign-off. No PI session was available.

**Tests**
- 9 suites, 205 of 205 pass. These include an opt-out written after approval blocking the action on every executeAction source and on the browser claim.
- The broad community, engagement, RPA and extension-dispatch set passes: 57 suites.
- Five existing suites received an "allowed recipient" stub, with no assertion changed.

**Typecheck:** the root and backend projects show 0 errors. The test config's errors are all outside L-3's files.

**Next:** Orchestration's race-fix lock now builds on `f4d7a2e8f`, and its diff comes to Outreach before commit.

### D-03: hold relayed; conflict persists
- Orchestration committed D-03 **locally** as `9a8dab9a` on a direct owner ruling it received, before my relay of the hold arrived. It is not pushed or merged.
- Its evidence pack for items 2–5 is at `.../scratchpad/w1/B-d03-evidence.md`, sha256 `611909ec…ee92`, with 7 of 7 new real-schema tests passing.
- You need to confirm which ruling stands. If it is HOLD, the commit stays local and unmerged.

### P-A: claim-function fix, reviewed (test-database only, uncommitted)
- **Diff:** sha256 `a8853bb1…5159`. I peer-approved it for the test database only.
- **What it does:** the claim now requires `approved_at`, `approved_by` and the approval route's own log entry. The AI, risk and policy waiver is removed.
- **Open for you:**
  1. The 7-day approval expiry: enforce it in the claim, or leave it to D-02.
  2. The kill switch fails open when no policy row exists.
  3. The approval-policy rulings relayed to Orchestration conflict with yours on B (approver roles) and D (self-approval).

### P-1 and C-1: need you
- **P-1:** please give the controlling Google account or publisher ID for Web Store item `khlballmijciomdbigljpafliajdekbg`. Nothing has been inferred from the listing's display name.
- **C-1:** please nominate the individual technical owner for the extension client.

---

## Round 4: joint ruling of 4 November 2026 (recorded verbatim in substance)

### Decision register

| # | Ruling | Outreach status / evidence |
|---|---|---|
| 1 | **D-03 GO**, under six invariants: an active run plus a valid handoff; HOLD on any missing, unreadable, paused or non-active state; a hold consumes no attempt, decision, quota or retry; approval, retry and worker paths cannot bypass it; resume revalidates journey state and execution authorisation; resume executes exactly once. The race fix is approved for local commit and test-database use only. Order: L-3 → atomic claim → platform call. Manual Execute returns 409 when the extension holds the action. | **Accepted as the `dispatch.ts` owner.** D-03 is committed locally by Orchestration as `9a8dab9a`. Its mapping of invariants 4 and 5 to code and named tests has been received: the hold returns at `dispatch.ts:219`, ahead of governance, quota, attempt and send, and the resume tests cover the kill switch, quota, approval and prior attempts. The prior-attempt test file stays uncommitted, held for separate review. The race fix is committed locally as `ddc9735a` on top of L-3 `f4d7a2e8f`, and I reviewed it: L-3 recheck at :668, claim at :693, dispatch at :702. |
| 2 | **B:** stranded legacy actions need a fresh approval bound to the exact action and content. No grandfathering. | Recorded. P-A (`80b5254a`, local) requires `approved_at`, `approved_by` and the approval route's own log entry, and removes the waiver. |
| 3 | **D:** a dry run needs no approval only if it cannot mutate external state or consume an execution authorisation. | Recorded. The `manual` simulation mode is the only no-approval path in the executor, and the L-3 recheck skips only that mode. |
| 4 | **Approval invariant:** approved state; an authenticated, authorised human approver; a server-side record; binding to the exact action and content; fresh execution authorisation immediately before the action. AI risk never waives approval. | Recorded. D-01, P-A, the race claim and L-3 together implement it locally. |
| 5 | **Release NO-GO** for product. R-1 and R-3 stand as containment. 1.4.1 publication, 1.5.0, real browser execution, autonomous dispatch, provider sends and unapproved migrations all remain prohibited. | R-1 and R-3 stay live. Nothing else has been released. |
| 6 | **1.4.1 is containment only.** Close and test the client hardening gaps; inventory the third gap. | **Done locally as `v1.4.1-rc2`** (`3c07931`, zip `8e5611ba…bb15`): token and secret isolated to worker-only session storage, capabilities fail closed, platform pages silent. The third gap (shipped collector code) is inventoried and shown unreachable, but not removed; removing it needs your go. 37 of 37 tests pass; 9 of 10 of the new tests fail on rc1; real Chromium confirms the storage layout. Evidence: `C:/tmp/omvx-ext/docs/RELEASE-1.4.1.md`. |
| 7 | **Race follow-ups**, tracked to closure: the recheck→claim window; the losing-claim metric; guarding or removing `advanceCommandChain`. | All three recorded in this register. Owner: Orchestration. Must close before the 1.5.0 gate. |
| 8 | **Both workstreams record this same ruling.** Local commit or test-database authorisation is not permission to push, merge, deploy, publish or execute. | Recorded here. **Discrepancy to note:** Orchestration reports that **the joint-ruling text never reached its session**. It holds a direct ruling that agrees on points 1–5 and adds three further points (below). |

### Points Orchestration holds that are not in the joint text

Raised so the control tower can confirm them for both sessions:
- **Manual Execute:** 409 only for a genuine conflict (already claimed, or executing). An action the extension never picked up gets a distinct "not ready" response.
- **Missing policy row:** fail closed when a tenant's policy row is absent.
- **Approval expiry:** the 7-day expiry is enforced at the final claim, owned by D-02.

### Evidence references

| Item | Reference |
|---|---|
| R-1 | PR #366 → `e04d827f`; web `dpl_GYDw56tqCHoQGYMvR4Nm5XDFU3Rt`; worker `fe90d9b7`; tag `deploy/omnivyra-20261103-2146-r1` (local) |
| R-3 | PR #367 → `23a0a586`; web `dpl_7Lr3iaMLrdxJFadxkeRGWwotc3iZ`; worker `7ee96a2c`; tag `deploy/omnivyra-20261103-2259-r3` (local) |
| Production probes | Session scratchpad files `prod-probe-baseline.txt`, `prod-probe-postdeploy.txt`, `prod-probe-pre-r3.txt`, `prod-probe-post-r3.txt` |
| L-3 | `f4d7a2e8f`, `refs/preserve/outreach-l3-recipient-recheck` |
| 1.4.1 rc2 | `v1.4.1-rc2` (`3c07931`) in `C:/tmp/omvx-ext`; zip `8e5611ba…bb15`; app pin branch `86dd45eb5` (67 of 67 against rc2) |
| D-03 / race / P-A (Orchestration, local) | `9a8dab9a` / `ddc9735a` / `80b5254a`, with preserve refs in Orchestration's worktrees |
