# Outreach foundation: four-closure completion register

Owner mandate: "Outreach Foundation & Intelligence Completion", 2026-11-04. Coordinator: Outreach Engines lead (session `virality-52`). This register is the single source for the status of closures A–D. It is updated at every checkpoint.

**Release status: NO-GO.**
- R-1 (PR #366) and R-3 (PR #367) are authorized containment deployments. They stay live.
- Nothing in this register is pushed, merged, deployed or applied to a real database.

## Stage 0: reconciliation (evidence read 2026-11-04)

### Integration lines found

| Line | Tip | Contains | Owner |
|---|---|---|---|
| `origin/main` | `23a0a586` | 5025f51d, R-1 and R-3. **No orchestration engine, no email engine, no outreach engine fixes** | — |
| Outreach integration `integration/outreach-engines-20261102` | `dfe53ce6` | Code `d682ab13`: orchestration `c74404c7` (contract 0.2.0), five engine fix branches, outreach docs | Outreach |
| Orchestration W1 | `ddc9735a` (D-01 `4f835911` → L-3 `f4d7a2e8` → atomic claim); P-A `80b5254a`; D-03 `9a8dab9a` | Built on `feat/orchestration-recovery`. **Lacks Outreach WS-3 G-3/G-8** (`54a6cdd3`, `5e3457a3`) | Orchestration (`virality-c7`) |
| D-02 approval binding | uncommitted in `C:/tmp/orch-w1-pause` on `9a8dab9a` | Approval binding, expiry, revocation, passkey. F1 fix and `approval.revoked` in progress | Orchestration (`virality-c7`) |
| Execution programme round 3 `integration/fixes-r3-on-main-23a0a586` | `110a3423` | Main plus sec, billing, PI and egress fixes. Includes WhatsApp sender ownership, blocked status, the scheduled-post publish backport, and community/RPA policy fixes | Execution programme (another session) |

### Foundation base (coordinator, local)

`outreach/foundation-base-20261104` at `a14002d0` (worktree `C:/tmp/omp-foundation`), built as `dfe53ce6` with these merged in:

| Merge | Result |
|---|---|
| W1 `ddc9735a` | Clean |
| P-A `80b5254a` | Clean |
| D-03 `9a8dab9a` | `dispatch.ts` conflict, resolved by the dispatch owner. Order: G-8 disabled-transport guard → D-03 hold → governance. Dispatch re-pinned to `5251d7b70cb5b033` |
| `origin/main 23a0a586` | `commands.ts` conflict, imports only. Both sets kept |

All Stage 1 agent branches are cut from this base. D-02 has been asked to rebase onto it.

### Conflicting duplicate implementations (must be reconciled before integrating)

Execution-programme round 3 (`110a3423`) against the W1 chain: the same safety capabilities were implemented twice.

| File | Round 3 | W1 (stricter) | Proposed resolution |
|---|---|---|---|
| `communityAiPlatformPolicyService.ts` | Missing policy row → `require_human_approval: false` | `true`, fail closed (D-01) | W1 |
| `communityAiAutoRuleService.ts` | `autoExecute` path, defers when not true | A rule never approves; the action is left `pending` for a human | W1 |
| `communityAiActionExecutorRuntime.ts` | `auto` / `scheduler` checks, with approval waivable by policy | `approved_at` always required, plus the atomic `claim` | W1, keeping round 3's auto-source audit event if wanted |
| `rpaWorker/rpaWorkerService.ts` | Retry gate re-checks the policy; no claim | Retry runs through the executor after an atomic claim of the retry row and the action row | W1 |
| `whatsappBroadcastService.ts` | Status update with no CAS | `.eq('status','pending')` CAS | W1 |
| `pages/api/extension/commands.ts` | Policy gate before the R-3 imports | DM safety and the L-3 recheck before the claim | Both: union |

Decision needed from the owner and the execution-programme owner (CR-X-01).

## Current Work Reconciliation Matrix

| Closure | Existing implementation (preserved) | Work already underway | Missing work | Dependencies | Proposed owner |
|---|---|---|---|---|---|
| **A Content Intelligence** | `lib/content/platformAdaptationProfiles.ts` (social); deterministic email renderer and the 041-D allow-list `PERSONALIZATION_FIELDS` (`emailEngine/emailContentGenerator.ts:37`); `content/runtime/generationRuntime.ts` (flags off, fixed content types); canonical `content*` tables, with writes blocked by `canonicalPersistencePolicy.ts`; AI Gateway plus `runBilledAiCompletion` | None. No branch has touched these files since 2026-10-30. `C:/virality` (`preserve/creator-canonical-template-pool`) may touch `content_*` (unconfirmed) | `lib/outreach/channelContent/` does not exist. Missing: channel formatters and validators; personalization guard; campaign → approved revision link; outreach content types in canonical persistence | C-CP-1 (Content Platform owner **not named**), SC-3 (Orchestration), C-AI-1 (cache) | Agent A (channel layer). Content Platform owns persistence |
| **B Engagement Intelligence** | `engagement_threads` / `engagement_messages`; `conversationMemoryService`; 3 classifiers (`conversationTriageService`, `engagementConversationIntelligenceService`, `responsePolicyEngine`); `engagementAiAssistantService` suggestions; `/engagement` UI | None | One vocabulary (none of the 3 has STOP, unsubscribe, OOO, wrong recipient, meeting or support); a deterministic governance pre-classification; a suggestion contract (rationale, confidence, escalation); email inbound | SC-7 (vocabulary with PI and Orchestration), C-AI-1 (suggestions must bypass the cache), C-PI-1 (`unified_person_id` writer) | Agent B (classification). Suggestions follow C-AI-1 |
| **C Governance and response execution** | On the base: D-01, L-3, atomic claim, P-A, D-03; live: R-1, R-3 | D-02 (c7, uncommitted). Race follow-ups (c7) | `/api/response/generate` `execute` path bypasses `automationService`; 3 auto-reply switches, with `engagementGovernanceService.auto_reply_enabled` defaulting to **true**; inbox reply route approval (needs D-02's binding and passkey); direct-provider `gpt-chat.ts` / `claude-chat.ts`; round 3 duplicate safety code | D-02 (c7), CR-X-01, C-AI-1 | c7 (D-02 and the race follow-ups); Agent C (response route, Mode 3 default, entry-path authority inventory); coordinator (CR-X-01) |
| **D Engine readiness** | Email: G-1..G-9a on the base. WhatsApp: WA-5/6/11/13/20 and B-17 on the base; sender ownership, blocked status and k1 readers on round 3 only. Social: publish authorization on the scheduled-post cron (base and round 3; **not on main**). Community: D-01, L-3, claim. Browser: R-1/R-3 live; 1.4.1 rc2 local | None | Complaint recorded as evidence `delivered`; unsubscribe writes no outcome; SES inbound; L-4 and WhatsApp send-once; WA-1/2/3; `increment_wa_usage` undefined; non-WS-3 outcome association (SC-4); channel credit actions; per-engine D7 evidence | SC-4, C-BL-1, CR-X-01 (the WhatsApp file is in conflict), B-7, SES/Meta account actions | Agent D (email complaint and unsubscribe evidence, the D7 readiness matrix). WhatsApp code waits for CR-X-01 |

## Cross-workstream coordination register

| ID | Owner | Interface or decision required | Status | Blocking consequence | Evidence to close |
|---|---|---|---|---|---|
| CR-X-01 | Owner + execution programme + Orchestration | Reconcile round 3's duplicate community, RPA and WhatsApp safety code with W1 (table above) | RESOLVED LOCALLY 2026-11-04: `0679a5908` (W1 retained, owner ruling item 1); accepted by c7 against OD-1..OD-3. See Step D1 | WhatsApp send-once stays blocked (owner ruling); REL-07 renumber now gates migration-quality | Done locally; T3 needs REL-07 and the release process |
| CR-OR-D02 | Orchestration (c7) | D-02 rebased onto `a14002d0`, re-pinned there, F1 and `approval.revoked` included | REQUESTED 2026-11-04 | Inbox reply approval (C); approval invariants (C3) | Diff hash, my review, the owner's commit authorization |
| CR-OR-RACE | Orchestration (c7) | Opt-out-to-claim window; claim-loss metric; unused `advanceCommandChain` | REQUESTED | C5 closure; 1.5.0 | Tests per item |
| SC-3 | Orchestration | Journey step references `content_revision_id` | OPEN | A3 campaign → revision | Contract and migration on the base |
| SC-4 | Orchestration + Outreach | Outcome association for non-WS-3 engines | OPEN | Unsubscribe outcome; WhatsApp and community outcomes | Agreed contract plus one migration (coordinator) |
| SC-6 | Orchestration | Channel vocabulary (`phone` vs `voice`, STOP scope) | OPEN | SMS and voice profiles stay format-only | Contract text |
| SC-7 | Outreach (Engagement) → PI, Orchestration | One message-classification vocabulary with the deterministic governance classes | PRESENTED FOR RATIFICATION (D4, `c211e8c60`): 16 codes, §2.2 deterministic rules, Q-1..Q-5. PI technical read received; Orchestration acknowledgement outstanding | B closure | Owner ratification SC7-R; Orchestration answers Q-4 |
| C-CP-1 | Content Platform (**owner not named**) | Outreach content types plus channel metadata in canonical persistence | BLOCKED: owner needed | A3 | Named owner; policy change |
| C-AI-1 | Platform AI | Personalized and conversation ops bypass the cache; route or remove `gpt-chat` / `claude-chat` | OPEN | B3 suggestions; A personalization | Change to `aiResponseCache.ts` with a cross-recipient test |
| C-PI-1 | PI | Runtime writer of `engagement_threads.unified_person_id`; recipient consent store | OPEN. Consent assessed in D4: `contact_governance_records` reused; gaps CG-1 (no positive consent) and CG-2 (no action dimension); decisions CN-1..CN-3 | B1 cross-channel context; DMs | Writer plus test; CN-1..CN-3 |
| C-BL-1 | Billing | Channel credit actions | OPEN. D4: "Billing track" owns SF-08 (`milestones.json`) but **no lead is recorded**; CODEOWNERS gives billing code to the repository owner. CR-BL1 ready, unsent | Any charged send | Decision BL-A (appoint the lead or answer directly), then feature registry entries |
| C-PI-2 | PI + Outreach | Acting-account and tenant ownership proof (`proveActingAccount`, page URN vs OIDC sub) | OPEN | Community and 1.5.0 | Binding proof |

## Completion register

Status labels: NOT STARTED, IN PROGRESS, IMPLEMENTED LOCALLY, INTEGRATION REQUIRED, BLOCKED, VERIFIED T1, VERIFIED T2, SANDBOX VERIFIED, PRODUCTION VERIFIED.

| ID | Closure | Capability | Existing evidence | Change required | Owner | Dependency | T1 | T2 | Status |
|---|---|---|---|---|---|---|---|---|---|
| A-1 | A | Channel profiles, formatters, validators (email, WhatsApp, community, SMS-format, voice-format; social via existing profiles) | `4ce2d83ed` on `outreach/a-channel-content`: 10 new files, 0 existing files changed. Social delegates to `platformAdaptationProfiles` plus `promotionDraft` caps; SMS GSM-7/UCS-2 segments; no I/O. Policy numbers other than subject 200, WhatsApp 4096 and the GSM arithmetic are proposals (C-A-2) | **D3 done (`12c161305`):** only evidence-backed limits are hard (scheduled_posts CHECKs, email subject 200, WhatsApp 4096); every policy number is advisory; drift-tested. See `CONTENT-LIMITS-AUTHORITY.md`. Wiring into a send path remains | Agent A / coordinator | C-A-2 resolved by the evidence rule | 49/49 (with the boundary suite); focused tsc 0 | n/a (pure) | VERIFIED T1 (not yet wired into any send path) |
| A-2 | A | Personalization guard (041-D allow-list) and no engine import in generation | The allow-list is imported (same object); unauthorized, missing and not-permitted placeholders are refused; the boundary test passes, with 10 probes and transitive checks | — | Agent A | C-AI-1 for AI drafts | Included above | — | VERIFIED T1 |
| A-3 | A | Canonical save and revisions; campaign → approved revision | Tables exist; writes blocked | Policy change; link | Content Platform, Orchestration | C-CP-1, SC-3 | — | — | BLOCKED |
| A-4 | A | Shared generation through the gateway for outreach types | Gateway exists; runtime flags off | Generation request contract | Content Platform | C-CP-1 | — | — | BLOCKED |
| B-1 | B | One classification vocabulary plus deterministic STOP / unsubscribe / complaint | `c889087b9` on `outreach/b-engagement-classification`: `backend/services/engagementClassification/`, a 16-code vocabulary, the governance detector reusing `whatsappOptOut`, total mapping tables for 4 legacy producers, the `classifyMessage` entry point; additive edits to the 3 classifiers. **Not wired into any runtime path; canonical codes not persisted** | SC-7 agreement (Q-1..Q-5) and owner ratification, **presented in D4** (`SHARED-CONTRACTS-D4.md` §2, decision SC7-R). Columns migration `20270125000000` written and disposable-DB tested (`3926654ce`), not applied; any writer needs the two grant/exposure tests (MIGRATIONS-20270125.md) | Agent B | SC-7, C-AI-1 | 8/8 suites, 448/448, re-run by the coordinator; typecheck 3/3. Re-run 2026-11-05: classification suites 321/321 | — | VERIFIED T1 (draft contract; awaiting ratification) |
| B-2 | B | Suggestions with rationale, confidence, escalation, tone | `engagementAiAssistantService` | Extend | Agent B (later) | C-AI-1 | — | — | BLOCKED |
| B-3 | B | Inbox send boundary | `/api/engagement/reply` | Formatter, governance, approval | Agent C | CR-OR-D02 | — | — | BLOCKED |
| C-1 | C | D-01, L-3, atomic claim, P-A, D-03 | Committed locally; in the base | Integration verification | c7 / coordinator | — | base T1 pending | — | INTEGRATION REQUIRED |
| C-2 | C | D-02 approval binding | Rebuilt on the base `6e96f6680`; round 3 `5254a30f…0768d2` (F-1, L-1, L-2, P-1) **signed off by the dispatch owner 2026-11-04**. Committed locally by c7 as `19498a2e4` on `orch/c2-approval-binding` (preserve ref `refs/preserve/orch-c2-d02-19498a2e`). The coordinator re-verified the diff sha256 and patch-id `f2717242`. Real-schema 52/52, typecheck-ci at baseline, worker tsc and 10 gates clean on the coordinator's own build. `approval.revoked` follows as contract 0.3.0 | Integrated as `9c460a238` (Step D0); 0.3.0 event change; `20270120000011` never applied to production | c7 | CR-OR-D02 | VERIFIED T1 | VERIFIED T2 (real-schema slice) | IMPLEMENTED LOCALLY (integrated into the foundation branch) |
| C-3 | C | No independent execution from `/api/response/generate`; Mode 3 off by default; one switch | Bypass present. Application fails closed (`1b4d4ce57`); column default `true` → `false` in migration `20270125000003`, written and tested, not applied (existing rows unchanged) | Fold into the canonical authority; turning off existing tenants is an operator decision at apply time | Agent C | — | — | — | IN PROGRESS |
| C-4 | C | Inventory of entry-path authority (every route, worker, scheduler) | Executable inventory `executionAuthorityInventory.test.ts` (38 entries). Step C closed its two known gaps: super-admin thread resume now applies `authorizePostPublish` (409 `THREAD_NOT_AUTHORIZED`, audited); the direct LinkedIn/X reply in `social/comments` is removed (410 `REPLY_REMOVED`, no replacement API call). `KNOWN_GAPS` is empty | The inventory only covers the entries it lists; new entry paths must be added to it | Coordinator (owner ruling items 5, 6) | — | 9 suites 550/550; mutant (gate disabled): 5 refusal tests fail, 2 controls pass; typecheck-ci at baseline, worker tsc and 10 gates clean | T2 at `7f2ca186f`: no failure in its suites (whole-repo, integration, route-auth gate) | VERIFIED T2 |
| C-5 | C | Race follow-ups | Tracked | — | c7 | CR-OR-RACE | — | — | IN PROGRESS |
| C-6 | C | Cache bypass; gateway bypass routes | Present | Platform AI change | Platform AI | C-AI-1 | — | — | BLOCKED |
| D-1 | D | Email complaint state and unsubscribe evidence preserved | `25e1c8a96` on `outreach/d-engine-readiness`. **E-1:** delivery status only moves forward if unchanged since read (`advanceOutreachTaskDeliveryStatus`), so concurrent events can no longer overwrite each other. **E-2:** the complaint or hard-bounce restriction is written even when the evidence write fails (still 503, SNS retries). The complaint's `delivered` row is marked `deliveryInferredFrom: 'Complaint'`. Unsubscribe evidence is proven insert-only | Complaint as a business outcome needs CR-4 (migration `20270125000001` written and tested, not applied); unsubscribe outcome row needs SC-4 (`recipient_link` source, migration `20270125000002` written and tested, not applied). **D2 done (`3f1c405a2`):** failures exposed truthfully (`persistence`), recorded once per event in `outreach_provider_evidence_reconciliation` (migration `20270125000005`, not applied), idempotent audited reconciliation that never weakens a restriction. The reconciliation runner (cron or operator) is an owner decision | Agent D / coordinator | SC-4, CR-4 | 39 suites, 1231 passed / 5 skipped; D2: wp3 + D7 87/87, 3 mutants killed; migration disposable-DB 22 assertions as service_role, rollback round trip | T2 at `7f2ca186f`: real-schema 94/94; D2 `service_role` suite 9/9 (see "T2 at `7f2ca186f`") | VERIFIED T2 (disposable DB; migration unapplied to any real environment) |
| D-2 | D | Per-engine D7 readiness evidence (5 engines) | `docs/outreach/platform/ENGINE-READINESS-D7.md` (on the D branch). Email integrated; WhatsApp no path reaches Meta (WA-1/2/3 confirmed; usage RPCs undefined; journey `hasApproval` always false); Social integrated, but account ownership is not checked; Community `proveActingAccount` absent; Browser GAP-03 confirmed and `executed` comes from a client flag | WhatsApp fix plan (10 steps, CR-X-01 first) | Agent D | CR-X-01, C-BL-1, C-PI-2 | n/a (documentation) | — | IMPLEMENTED LOCALLY |
| D-3 | D | WhatsApp L-4, send-once, WA-1/2/3 | Open. WA-2 schema: migration `20270125000004` (client-ref columns, CHECKed against env-name exfiltration) written and tested, not applied | `resolveClientRef` code fix (allow-list + decrypt); WA-1, WA-3, L-4; WhatsApp stays blocked | Agent D (later) | CR-X-01 | — | — | BLOCKED |
| D-4 | D | Social publish authorization on main | Base and round 3 only | Part of release integration | Coordinator | Owner push | — | — | INTEGRATION REQUIRED |
| D-5 | D | Outcome association for non-WS-3; channel credits | Open | — | Orchestration, Billing | SC-4, C-BL-1 | — | — | BLOCKED |

## Checkpoint 1: Stage 3 integration (2026-11-04)

Integrated tip `1daf12601` on `outreach/foundation-base-20261104`. It merges A `4ce2d83ed`, B `c889087b9`, C `1b4d4ce57` and D `25e1c8a96` into the base. All four merges were clean.

**Results**

| Check | Result |
|---|---|
| typecheck | 3/3 clean, at `92221b95` |
| Combined targeted jest (all agents' suites, plus pins, D-03, L-3, D-01, P-A, R-1, R-3, WS-3, email, extension) | 53 suites: 52 passed, 1 skipped. 1648 tests: 1640 passed, 8 skipped |
| Gates | All pass: route-auth, route-policy, tenant-authz, orgaccess-binding, withrbac-binding, outbound-ssrf, db-conventions, secrets |
| T2 real-schema | **Not run at this tip** |

**Integration fixes (coordinator, `1daf12601`).** These are Outreach-owned tests, and only fixtures changed.
- `extensionDispatchSafety.routes`: a chain whose first step was `sync_*` is never leased under R-3. This failure was introduced by the main merge (found by bisect). The fixture now uses `like → reply`.
- `dmDispatchSafety.extension`:
  - adds the L-3 allow stub; this suite already failed at the W1 tip `ddc9735a`;
  - the read-only sync test now asserts "not leased, not claimed, left pending" instead of "dispatched", as R-3 requires.

**Closure status: none of A–D is complete.** What each closure is waiting on is listed in the completion register above. The integrated acceptance scenario has NOT been started, per the mandate.

## Owner ruling, Checkpoint 1 (2026-11-04), as given to the Outreach coordinator

1. Keep the stricter W1 implementation across all six files in the round-3 conflict. Reconcile the exact diff and hash, retain fail-closed behaviour, and keep WhatsApp blocked until its remaining verification is done.
2. Content Platform is the accountable owner of canonical content persistence, revisions, brand voice and generation integration.
3. Platform AI is the accountable owner of the personalized/conversation cache bypass and of fixing the `gpt-chat.ts` and `claude-chat.ts` direct-provider routes.
4. The five migrations may be written locally on the foundation branch and tested only on a disposable database, with rollbacks and an explicit mapping from each schema change to its migration file.
5. The super-admin thread-resume publish authorization fix is authorized.
6. Removing the direct LinkedIn/X reply action from the social-comments route is authorized. It must not be replaced with another direct API call.
7. The corrected complaint behaviour is approved: the restriction stays fail-closed even if saving the evidence fails. The failure must be exposed, never reported as a success, and a reconciliation path provided.
8. Content limits:
   - Validation rules come only from evidence-backed platform/provider limits and verified existing constraints; agent-proposed limits do not become mandatory rules.
   - `platformAdaptationProfiles.ts` is the canonical social source once its production authority is verified; the other competing sets are reconciled to it.
9. The four shared-contract requests may be sent to PI, Orchestration and Billing. No substitute stores or interfaces while waiting.

**Sequence:** A T2 at unmodified `1daf12601` (report before migrations) → B migrations → C route fixes → D reconcile cross-workstream responses → E register. No final acceptance scenario until the closures are genuinely complete.

**Scope:** local only. Release NO-GO.

## Step A: T2 baseline at unmodified `1daf12601` (2026-11-04)

- Detached worktree at `1daf12601`, tree `295f56601`. The tree was clean before and after the run.
- Disposable pg-sandbox PG17 cluster on loopback, stopped afterwards. No migration touched any real environment.

| Stage | Result |
|---|---|
| Schema build | bootstrap + baseline (1 expected `already exists`, 0 unexpected) + 105 migrations above ledgerMax `20260916000000`, all applied strictly |
| Real-schema jest | 75 suites: 73 passed, 2 failed. 1582 tests: 1571 passed, 3 skipped, 8 failed |
| typecheck-ci | PASS, at baseline |
| Worker tsc | clean |
| Gates (10) | all pass: route-auth, route-policy, migration-quality, schema-drift, tenant-authz, orgaccess-binding, withrbac-binding, outbound-ssrf, db-conventions, secrets |
| Whole-repo jest | 2338 suites, 40989 tests. 81 failures: 60 in the 31 Oct baseline, 21 not in it |

**Attribution: no failure comes from the foundation work (A–D or the coordinator fixes).**
- **8 real-schema failures** (`d01_claim_human_approval`, `w1_community_single_execution`):
  - reproduced exactly at `refs/scratch/w1-pair-diag` = `5a8b5ed04`, which is W1 `ddc9735a6` + P-A `80b5254a1` only;
  - cause: an interaction between those two sibling commits;
  - owner: Orchestration, Prompt 3 item 1 (accepted by c7).
- **21 whole-repo failures not in the baseline:**
  - all 21 reproduce at `5a8b5ed04`, which has no foundation or main code;
  - at main `23a0a586` the same suites have none of them;
  - the 20 Community-AI integration failures (`community_ai_action_connectors`, `_notifications_content_trends`, `_rbac`, `_rpa`, `_scheduling`) are suites that predate W1's community claim and approval gate (403, and a `.not` missing from their DB fake);
  - `safetyTestSuitesSelector` is ungated because of W1's own `communityL3RecheckEnforcement.test.ts`;
  - owner: Orchestration (W1).
- Also failing at main and at `5a8b5ed04`: `community_ai_scheduling … executes due actions and logs execution`. It is in the existing failure set and is not counted above.

Evidence: scratchpad `t2f/logs/` and `attr/` of the coordinator session.

## Coordination routing (2026-11-04)

- **PI:** session `virality-b6`. CR-SC7 and CR-PI1 delivered and queued. Technical findings:
  - CR-PI1(1) confirmed: no runtime writer of `engagement_threads.unified_person_id`. PI's `prospectEngagementIntelligence.loadThreads` is therefore severed.
  - CR-PI1(2): `contact_governance_records` is canonical, but every caller is email, SES, unsubscribe or erasure. Using it for social and community recipients is NOT PROVEN and is an owner decision.
  - CR-SC7 blocker: `stop` and `not_interested` are not `GOVERNANCE_TYPES`, and `recordContactGovernance` rejects them.
  - ~~Complaint is purpose-scoped, so its `*` scope is not a blanket block.~~ **Withdrawn by PI:** a complaint with NULL `purpose_scope` applies to every purpose (`contactPurpose.ts:125-132`, DR-10), so the §6 complaint row is correct.
  - `rejected` may reach PI only through the human decision path. The classifier must be structurally unable to emit it.
  - PI will not ratify §2–6 or Q-1..Q-5 while its delivery candidate is blocked; those are owner decisions.
- **Billing:** no owning session identified. Sessions `orch-integration-c8` and `virality-0b` own neither PI nor Billing. `virality-ed` is holding messages, so the question was not delivered. CR-BL1 is not sent.

## D-02 rebuilt on `6e96f6680`: peer review (2026-11-04)

c7's first staged diff `9bbbacd2…beaba` (45 files) was **not signed off**. Round 3 was (below).
- **What checked out:** hash; dispatch order and pins; the claim trigger as the only DB boundary into `dispatching`; passkey proof; S-03/S-04; no community files.
- **F-1 High, reproduced:** after an ambiguous external attempt (a timeout), the re-review edge `queued → awaiting_approval` plus a fresh approval skips `redispatchProblem`, and the task is sent a second time (provider calls `[1,2]`). The same edge was in r2, which the coordinator had signed off.
- **L-1:** the non-journey binding omits `explanation`. Latent.
- **L-2:** an operator approval naming no recipient reports success.
- **Round 2, `de5513ca`:** F-1 fixed twice over. (a) `redispatchProblem` now runs for every task. (b) The re-review writers refuse a task whose earlier attempt may have sent. L-1 and L-2 fixed.
- **Round 3, `5254a30f`:** adds P-1, found by Orchestration's independent security review: a double-send race in `dispatch.ts` that predates D-02. A dispatcher stalled between the prior-attempt check and the claim could send after another dispatcher's ambiguous attempt.
  - The dispatch owner chose to fold it into D-02, with six conditions.
  - The fix re-checks under the claim, before quota and attempt, and releases the claim by CAS.
  - Coordinator verification at `5254a30f`:
    - hash; interdiff = the hunk + 2 re-pins + test;
    - pins: dispatch `a23b5fbf0b38f5f2`, approval `657ae410108d32d5`, governance `0281c45fab33619e`, emailTransport `c6e86299a89dc60f`;
    - the coordinator's own F-1 repro passes; with fix (b) forced around, fix (a) alone blocks (1 provider call);
    - 20 affected unit suites, 702/702;
    - mutant with the post-claim check removed: the P-1 test fails, its control passes;
    - real-schema `d02_approval_binding` + `orch_pause_handoff` 52/52 on the coordinator's own sandbox.
  - typecheck-ci PASS (at baseline), worker tsc clean, all 10 gates rc=0, tree unchanged by the gates (45 dirty before and after).
  - **SIGNED OFF `5254a30f…0768d2` by the dispatch owner, 2026-11-04**, for a local commit by c7 on `6e96f6680`. No push, no merge, and `20270120000011` is never applied to production. c7 committed it as `19498a2e4` (parent `6e96f6680`). The coordinator re-verified: diff sha256 `5254a30f…`, and patch-id `f2717242…` is identical to the reviewed index.

## Owner delegation (2026-11-04): "do what is best for the omnivyra app"

Coordinator decisions, inside the standing limits (local only; no push, deploy, production change or real send):

1. Step B (migrations) proceeds: authorized in Checkpoint 1 item 4 once the T2 report was delivered.
2. Billing: no owner found, so CR-BL1 stays unsent and nothing substitutes for it. Charged sends stay blocked.
3. PI asked for a technical read of SC-7 only, with no ratification. The consent store is NOT extended to social or community recipients, because PI has not agreed to own that and building it would be the substitute the owner ruled out.
4. D-02 N1: the governance evaluation row a refusal writes is kept. It is audit evidence of the refusal, not an approval decision.

## Step B: migrations `20270125000000–04` (commit `3926654ce`)

Mapping, rationale and evidence are in `docs/outreach/platform/MIGRATIONS-20270125.md`. The disposable-database test covered forward, idempotent re-apply, unchanged privileges, every CHECK accepting and refusing by name, a rollback round trip identical to the pre-state, and refusals that protect append-only history.

New finding behind migration 4: `metaAuthService.resolveClientRef` would send any environment variable named in `auth_client_*_ref` to Meta. The DB CHECKs refuse such names. The code fix is a recorded follow-up; WhatsApp stays blocked.

## Step C: route fixes (owner items 5 and 6)

- **Item 5, super-admin thread resume:** `resumeThreadPublish` now applies `authorizePostPublish` before `publishThread`.
  - Refused: a campaign that is not active, a missing campaign, an unreadable campaign, and a root never released. Each returns `NOT_AUTHORIZED` with the predicate's code; the route audits it and answers 409.
  - A root already `published` counts as released, so a partly published thread still resumes.
  - Tests in `publishThreadUncertainOutcome.test.ts` (5 refusals, 2 controls). With the gate removed, the 5 refusals fail and the controls pass.
- **Item 6, `/api/social/comments`:** the reply action and its direct LinkedIn/X helpers are removed. A reply request answers 410 `REPLY_REMOVED`. No replacement call; no caller existed. Test `socialCommentsReplyRemoved.test.ts`.
- **Execution-authority inventory:** both entries move from gap to compliant and `KNOWN_GAPS` is empty. The non-vacuity guard moves from "at least one gap" to "the register covers more than 30 entry points" (it holds 38).
- **Affected suites:** 9 suites, 550/550.

## Step D0: D-02 integrated (commit `9c460a238`)

- `git merge --no-ff 19498a2e4` onto `086106170`. All 45 files are blob-identical to `19498a2e4`.
- Diff `086106170..9c460a238`: sha256 `5254a30f…0768d2`, patch-id `f2717242…`. Both match the reviewed D-02 diff.
- Focused T1: 19 suites, 618/618.

## Step D1: CR-X-01, round 3 reconciled (commit `0679a5908`)

**Commit**
- `0679a59083275ec4bf7609ab830232586af3d4b8` on `outreach/foundation-base-20261104` (fast-forwarded; the reconcile worktree is removed).
- Parents: `9c460a238` (foundation plus D-02) and `110a3423` (round 3, on main `23a0a586`).
- Tree `21a480e2c`. Diff from `9c460a238`: 189 files, sha256 `a9bd61c6…fa6c`.
- `19498a2e4` is an ancestor.

**Six conflict files: W1 retained (owner ruling item 1)**

Round-3 additions were merged only where they refuse more.
- `communityAiPlatformPolicyService`: W1's default policy (human approval required). Round 3's unreadable-policy fail-closed path and `auto_rules_enabled` are added.
- `communityAiAutoRuleService`: round 3's read-path deferral runs first. Then W1's D-01 path runs: pending, `approved_at`, claim. The deferral returns an existing row unchanged; c7 verified that it never resets a decided row.
- `communityAiActionExecutorRuntime`: round 3's auto and scheduler gates run, then W1's unconditional `approved_at` gate.
- `rpaWorkerService`: W1's claimed retry flush is kept. Round 3's unclaimed `checkRpaRetryAuthorised` is dropped, because it re-ran `failed` rows.
- `whatsappBroadcastService`: W1's journey tenant control runs, then round 3's sender-account ownership check. W1's pending compare-and-set is kept. WhatsApp stays blocked.
- `pages/api/extension/commands.ts`: W1's file, with 74242b572's policy gate re-applied. Read-only inbox syncs skip that gate but stay suspended under R-3.
- `capabilityRegistry.ts`: union of `OUTREACH_JOURNEY_APPROVE` (D-02) and `PROSPECT_PERSON_ERASE` (round 3).
  - **For the security owner:** `PROSPECT_PERSON_ERASE` enters the security-owned `SecurityCapabilities.ts` and `capabilityRegistry.ts` through round 3. It is not changed here (c7 note).

**Verification (T1 plus a real-schema T2 slice, disposable pg-sandbox only)**

| Check | Result |
|---|---|
| Focused unit (148 suites) | 147 passed, 1 skipped; 2490 passed, 17 skipped, 0 failed. Includes the RPA mutant: re-admitting `failed` fails exactly that case |
| Integration, community and WhatsApp (18 suites) at `0679a5908` | 126 tests: 100 passed, 26 failed. The 26 are 21 W1/P-A expectation failures owned by Prompt 3 (c7) and 5 baseline failures (`community_ai_core_apis` ×3, `community_ai_webhooks` ×2; these also fail at `9c460a238` and in the 31 Oct baseline). The new CR-X-01 GET-path test passes |
| Real-schema (6 suites: d01_claim, d01_community, d02, orch_pause, r3comm, w1) | 136 tests: 128 passed, 8 failed, 0 skipped. The 8 are c7's fixture failures (w1 ×7, browser rows seeded without `approved_at`; d01_claim ×1, `approved_by`). They are identical by name at `9c460a238`, where the same 2 suites give 76 tests and 8 failed |
| typecheck-ci | At baseline (0) |
| Worker tsc | 0 errors |
| Gates | 9 of 10 pass: route-auth, route-policy, schema-drift, tenant-authz, orgaccess, withrbac, outbound-ssrf, db-conventions, secrets |
| migration-quality | **23 violations** (0 at `9c460a238`). See below |

**Test changes (adapted to W1, plus CR-X-01 regression cases)**
- First run of the real-schema slice: 7 round-3 expectations conflicted with W1 and were adapted. None was a safety regression.
  - Auto-rule helpers pass `autoExecute: true`, the worker path.
  - With no policy row, approval is required.
  - An approved row with no `approved_at` is never claimed and stays `approved`.
  - The r3comm positive control mocks the L-3 recheck as allowed.
- Unit and integration tests were adapted the same way, with new CR-X-01 cases:
  - a read path never executes;
  - auto rules enabled but no `approved_at` means no execution;
  - the H-2 retry flush runs only claimed `approved` rows.

**migration-quality: REL-07, not a D1 code defect**
- The 23 violations are all foundation-line migrations: `20261127000000`, `20261226`–`20261231*`, `20270113000000` and `20270120000000`–`02`.
- They are flagged by round 3's new controls, `applied-boundary.json` (boundary `20270111000003`) and `version-reservations.json`.
- The fix is REL-07: the integration renumber under GD-4. It is blocked on GD-4 approval and clean production P1/P3 checks. Nothing was renumbered here.
- c7 uses `0679a5908` as the migration-quality baseline for Prompt 3.

**Follow-ups recorded, not changed**
- An `approved` row with no `approved_at` never becomes terminal, so the scheduler re-reads it every tick. It is never dispatched. This is in c7's Prompt 3 inventory.
- Orchestration branch `orch/c3-community-safety` is cut at `0679a5908` (c7).

**D1 regression found after commit (c7, 2026-11-05; confirmed by the coordinator from the code)**

The behaviour fails closed but consumes approvals.
- `communityEngineAdapter.ts` claims approved → executing (:800), then calls the executor with `source:'auto', auto:true, persist:true` (:812).
- Round 3's auto gate (`communityAiActionExecutorRuntime.ts:576`, absent at `9c460a238`) refuses whenever `auto_rules_enabled !== true`, which is the default.
- So a human-approved journey step ends terminal `skipped`. The adapter preflight does not check auto rules.
- No D1 suite covered it.
- **Owner: c7, Prompt 3.** Orchestration is not 'auto': it gets its own `source: 'orchestration'`, it requires a human approval of record, and policy refusals move before or into the claim. Regression test: with the default policy, an approved step is never `skipped` or consumed.

**Correction to the D1 results (2026-11-05):** `egressBypassCharacterisation.test.ts` (round 3, `572cfc2b2`) was outside the focused D1 list. At the foundation head it fails 10 of 20.
- All 10 are "CURRENT: sends to a suppressed recipient" characterisations whose bypass no longer exists.
- 8 community and extension rows: W1's L-3 already refuses. Prompt 3 rewrites them to assert `RECIPIENT_RESTRICTED`.
- 2 social/comments rows: step C removed the reply.
  - **Owner: coordinator.** Rewrite them to assert 410 `REPLY_REMOVED` with no fetch, keeping GD-3's PENDING rows.
  - c7 has been asked to fold this into the same file; otherwise the coordinator does it after Prompt 3.
- These are not D1 safety regressions.

**Other defects reported by c7, owned and fixed in Prompt 3 (migrations `20270126000000–03`)**
- The `community_ai_action_logs` `event_type` CHECK rejects `skipped_due_to_platform_policy`, so policy-refusal logs are dropped.
- `community_ai_platform_policy` has no tenant column.

**Coordinator approval:** a minimal D-02 `approvalPasskey.ts` extension (`subject: 'community_action'` changes only the digest domain), on these conditions:
- (a) a golden vector pinned before the edit;
- (b) domain-separation tests both ways;
- (c) a strict subject allow-list;
- (d) no change to exports, WebAuthn or the 48-byte challenge.

The diff hash comes to the coordinator for review before c7 commits.

## Steps D2–D4 (2026-11-05)

Authorized by the owner after the D1 checkpoint. Local commits on `outreach/foundation-base-20261104`. The chain is `a9894889f` → `3f1c405a2` (D2) → `12c161305` (D3) → `c211e8c60` (D4) → this register commit. Nothing was pushed, merged, deployed or applied.

### D2: complaint evidence failure (commit `3f1c405a2`)

Files:
- `supabase/migrations/20270125000005_outreach_provider_evidence_reconciliation.sql`, with its rollback in `rollbacks/`;
- `backend/services/providerEvents/sesEvidenceReconciliation.ts` (new);
- `backend/services/providerEvents/sesProviderEventIngestion.ts`;
- `pages/api/webhooks/ses.ts`;
- `backend/tests/unit/wp3SesWebhook.test.ts`.

Behaviour:
- **Restriction stays effective.** The D7 order is unchanged: the restriction is written whether or not the evidence write succeeds.
- **Failure is truthful.**
  - Every outcome reports `persistence`:
    - `evidence`: `recorded` | `failed`;
    - `restriction`: `in_force` | `partial` | `failed` | `not_applicable`;
    - `debt`: `recorded` | `unrecorded` | null.
  - Evidence is never reported as recorded when it was not.
  - A debt that cannot be saved either is reported as `unrecorded` and logged with ids only.
  - Status codes are unchanged (200 / 422 / 503), so SNS still retries.
- **Recorded once per provider event.** Any failure after the tenant resolved gets one row, keyed `(provider, provider_event_id)`, including terminal 422 failures that SNS never retries.
  - The row is address-free: the recipient is identified by the governance record ids.
  - It is not a suppression or consent store, and nothing reads it to decide contact.
  - A duplicate failing delivery refreshes the row; the first failure time is kept.
  - A full success closes it (`provider_retry`).
  - A resolved row is final, enforced by a trigger.
- **Reconciliation** (`reconcileSesEvidenceDebt`) is idempotent and audited: attempts, time and a reason code are recorded on every run.
  - It replays the evidence write, keyed on the provider event id.
  - For a complaint it adds the person anchor, which converges on the webhook's own person record.
  - It never revokes, narrows or rewrites a restriction, and it never widens a bounce to the person.
  - A missing ADDRESS anchor cannot be rebuilt without the address, so that debt stays open (`address_anchor_awaiting_redelivery`) and visible until the provider redelivers.

Verification:

| Check | Result |
|---|---|
| D2 unit cases (12, in wp3) | success; evidence failure; debt failure; duplicate failing events; recovery by SNS retry; recovery by reconciliation plus an idempotent second run; repeated failure; task-read failure; total restriction failure; bounce not widened; terminal 422; resolved is final. All pass |
| wp3 + D7 suites | 87/87 |
| Mutants | 3 of 3 killed: false "evidence recorded"; resolving a debt whose address anchor is missing; widening a bounce to the person |
| Migration, disposable pg-sandbox (PG17, loopback) | Pre-state: bootstrap, baseline and 119 migrations through `20270125000004`. Then: forward; idempotent re-apply; RLS on with exactly 1 policy; **22 assertions run as `service_role`** with real statements; rollback refuses while a debt is open and keeps the rows; rollback restores the pre-state; rollback idempotent; re-forward. The 22 assertions cover measured privileges (SELECT/INSERT/UPDATE only, no DELETE/TRUNCATE; anon and authenticated none), every CHECK, the guard and the duplicate key |
| Defect found and fixed during the test | The first rollback draft was not idempotent: `DROP TRIGGER … ON` a missing table, and a guard query planned against a missing table |

Not decided here: what runs reconciliation (a cron job, which must be added to `ALWAYS_RUN_JOBS` per the intent-gate finding, or an operator action). No job is scheduled. **Owner decision D2-R.**

### D3: content limits (commit `12c161305`)

See `docs/outreach/platform/CONTENT-LIMITS-AUTHORITY.md`.
- `platformAdaptationProfiles.ts` is proven to be the production authority for **style** through its actual imports: `platformVariantGenerator.ts:18` (content-generation queue), the delegated runtimes (flags off), and quality/prediction scoring. It defines no character limit.
- The only enforced social caps are the `scheduled_posts` CHECKs.
- In `lib/outreach/channelContent` (no runtime consumer), only evidence-backed limits are hard:
  - social caps from the DB constraint;
  - email subject 200 (`SUBJECT_MAX`);
  - WhatsApp 4096 (Meta documentation; CL-6 notes that the Cloud API page itself was not confirmed).
- Every policy number is now advisory.
- YouTube gains its enforced 5000; Threads loses an unbacked hard 500.
- No legacy registry is changed or deleted. CL-1..CL-6 are returned to their owners.

Verification: 49/49 (both channel-content suites), including drift tests that pin the hard caps to `baseline.sql`, the UCP map and `SUBJECT_MAX`, plus negative controls (required fields, subject line breaks and personalization still refuse).

### D4: shared contracts (commit `c211e8c60`)

See `docs/outreach/platform/SHARED-CONTRACTS-D4.md`.
- **Billing:** the Billing track exists (SF-08) but has no recorded lead (decision BL-A).
- **SC-7:** 16 codes and Q-1..Q-5 presented for ratification (decision SC7-R). The deterministic STOP/unsubscribe/complaint rules are unchanged (321/321).
- **Consent:** the existing `contact_governance_records` model is reused. The gaps are CG-1..CG-5 (decisions CN-1..CN-3).

No code, schema or store was added.

### Steps D2–D4 verification

| Check | Result |
|---|---|
| Focused T1, 27 suites (every unit suite referencing the changed modules, plus SC-7, entry-path inventory, route-auth and egress) | 1244 tests: 1232 passed, 12 failed. **None in a D2–D4 file**, see below |
| Focused tsc over the changed files and everything they import | 0 errors (under the shared lock) |
| Full typecheck-ci and worker tsc | **Not run:** 0.6–1.2 GB free throughout, against about 6 GB needed. Deferred to T2, not waited on |
| Gates | 9 of 10 pass. migration-quality: the same 23 violations as at D1; `20270125000005` is not flagged |

**The 12 failures (all pre-existing at the foundation head; none touches a D2–D4 file):**
- **10:** `egressBypassCharacterisation`, the documented baseline: 4 community/extension paths and social/comments, CURRENT and PENDING each. The 8 community/extension tests are rewritten by Prompt 3; the 2 social/comments tests are the coordinator's.
- **1:** `routeAuth001SocialOAuth` "reply: another tenant's accountId → denied" expects 403/404 and gets 410. **A Step C regression (`086106170`):** the reply was removed for everyone, and there is still no platform call.
- **1:** `routeAuthOrdering` "ordering findings are tracked": the known-open entry `external-call fetch() pages/api/social/comments.ts` in `scripts/route-auth-allowlist.json` is now stale because Step C removed the fetch. **A Step C regression:** the suite's own rule is to remove a fixed finding in the same change.
- Step C's verification did not include these 2 suites. The coordinator owns the fixes.
- **They are deferred until after Prompt 3 commits**, because c7's Prompt 3 diff edits the same hunk of `route-auth-allowlist.json`. They will be done with the 2 egress social/comments rows: assert 410 `REPLY_REMOVED` with no fetch; remove the stale known-open entry.

### migration-quality: the 23 violations and their impact (REL-07 / GD-4, unchanged)

The 23 files:
- `20261127000000_pi_prospect_lists`;
- `20261226000000`, `20261227000000`, `20261228000000`–`02`, `20261229000000` (PI campaigns, workflows, execution, outreach bridge);
- `20261230000000`, `20261231000000`–`10` (orchestration requests, targeting, community safety and journey link, social publish step, extension dispatch, identity, idempotency, rerun safety, RPA session invalidation);
- `20270113000000` (bridge handoffs erasure);
- `20270120000000`–`02` (journey decisions, PI email evidence, WhatsApp broadcast unique).

Each is a migration numbered at or below the attested applied boundary `20270111000003` that is not in the attestation. In other words, it would be inserted into already-applied history.

Impact:
- **No effect on local work.** Every disposable-database test applies them in order.
- **The CI migration-quality gate fails** for any branch carrying the foundation line, so that line cannot pass required checks or be merged as is.
- **Production:** none of them is applied. Applying them out of order behind the boundary is exactly what the gate exists to stop.
- The fix is REL-07: renumber them above the boundary under GD-4, after clean production P1/P3 checks.

Not renumbered, not suppressed, migration history not modified. **Owner decision GD-4.**

### Proposed T2 integration run (not started)

Run in this order on one head, after c7's Prompt 3 commit is integrated into the foundation branch:
1. **Integrate Prompt 3** (signed off at `40fbeee0…`) and verify that the commit's tree matches the signed hash.
2. **Coordinator follow-ups:** the 2 egress social/comments rows, `routeAuth001SocialOAuth` (expect 410, no fetch), the stale known-open entry. Test-only and registry-only.
3. **Real-schema harness** (pg-sandbox, fresh stamped w6 clone, migrations through `20270125000005` plus `20270126000000–03`):
   - the 6 D1 suites, Prompt 3's c3 suites, `orch_contract_journey`, `orch_response_matrix` (SES ingestion on the real schema);
   - **one new real-schema suite for D2 that connects as `service_role`**: debt insert, refresh, resolve and guard through the real writer. This is the precondition the governed-build grant finding sets for any new writer.
   - Expected: no failure outside the 8 documented c7 fixtures, which Prompt 3 should clear.
4. **Integration** community/WhatsApp suites (18) and **whole-repo unit jest**, compared by name against the D1 baseline. Known baseline: `community_ai_core_apis` ×3, `community_ai_webhooks` ×2.
5. **typecheck-ci and worker tsc** once ≥6 GB is free; no other typecheck running.
6. **10 gates.** Expected: 9 pass; migration-quality 23 until GD-4.

T3 (sandbox or production) is out of scope until GD-4, the ratifications and the release process.

### Closure status after D2–D4

**No closure is complete.**

| Closure | Done locally | Remaining (owner / dependency) |
|---|---|---|
| A Content | A-1, A-2, D3 evidence rule | A-3, A-4 blocked: Content Platform owner not named (C-CP-1); SC-3 |
| B Engagement | B-1 vocabulary and deterministic governance | Ratification SC7-R, Q-4 (Orchestration); persistence migration unapplied; B-2, B-3 |
| C Governance | C-1, C-2 (D-02), C-4, CR-X-01 | Prompt 3 commit and integration; C-3 operator decision; C-5; C-6 (Platform AI) |
| D Engine readiness | D-1 with D2, D-2 | D2-R runner; D-3 WhatsApp blocked; D-5 (SC-4, BL-A); D-4 release integration |

### Owner decisions open after D2–D4

| ID | Decision |
|---|---|
| GD-4 / REL-07 | Renumber the 23 foundation-line migrations above the applied boundary |
| D2-R | Reconciliation runner: cron job (with `ALWAYS_RUN_JOBS`) or operator-run |
| SC7-R | Ratify the 16 codes and §2.2; answer Q-1, Q-2, Q-3, Q-5 (Q-4 is Orchestration's) |
| BL-A | Appoint the Billing track lead, or answer CR-BL1 directly |
| CN-1 / CN-2 / CN-3 | Consent store confirmation; action-scoped restrictions; positive consent before DMs |
| C-CP-1 | Name the Content Platform owner |
| CL-1..CL-6 | Content-limit discrepancies, for their owners (no Outreach change) |
| Security owner | `PROSPECT_PERSON_ERASE` entering the security-owned capability files via round 3 |

## Prompt 3 integrated and FU-10 (2026-11-05)

- **Prompt 3** (c7, community execution safety): `47a8c5388d5b7fb08f387cf12b4c6bc26971f3a1` on `orch/c3-community-safety`, parent `0679a5908`, preserve ref `refs/preserve/orch-c3-community-47a8c538`.
  - The coordinator signed off three successive hashes: `40fbeee0`; `18605332` (a test-only stub fix); `4a6c4699` (the policy route order restored to rate limit → capability → validation).
  - Non-blocking notes N-1..N-3 are in c7's follow-up register.
  - Verified: `git diff --binary 0679a5908 47a8c538` = `4a6c4699…5f9a`; patch-id `d30489e8`.
- **Merge `b01ff5e5b`** (parents `59b47c90b` + `47a8c538`). No file overlaps D2–D4. The diff from `59b47c90b` hashes to the same `4a6c4699`, so the merge adds exactly the signed change. Migrations `20270126000000–03` are not applied anywhere.
- **FU-10 `5ee390cc6`** (coordinator, test and registry only): the Step C follow-ups:
  - egress social/comments is now a "removed" test (410, no fetch, plus a control);
  - `routeAuth001SocialOAuth` now expects 410, with an own-account case;
  - the stale allowlist effect `external-call fetch() pages/api/social/comments.ts` is removed.
- **Focused T1 on the combined head** (the same 27-suite list as D2–D4): **1247/1247 pass**. The 12 earlier failures are gone: Prompt 3 cleared 8, FU-10 cleared 4.
- c7's final runs at `4a6c4699`:
  - typecheck 0;
  - real-schema w1 53/53, c3b 10/10. The only full-run failure is `report1DurableHistoryEndToEnd`, which also fails at D1 (a harness DB-name issue);
  - unit failures are a subset of D1's by name;
  - `jevFlowAdoptionCli` passes alone (22/22).
- `refs/scratch/w1-pair-diag` (`5a8b5ed04`) is kept: it is the evidence that the Step A integration failures belonged to W1 + P-A.
- ~~Next: the proposed T2 run (Steps D2–D4 section), steps 3–6, on head `5ee390cc6`, awaiting the owner's go-ahead.~~ Done: see the next section.

## T2 at `7f2ca186f` (2026-11-05)

**Verdict: PASSES WITH DOCUMENTED EXCEPTIONS.** There are **zero newly introduced regressions**, and no failure is unexplained. Owner GO 2026-11-05.

**Frozen baseline.**
- Verified commit: `7f2ca186f57078841ff579120e6a72619b7b1f56` on `outreach/foundation-base-20261104`.
- The run script checked HEAD and a clean tree at the start and after each stage (A, B, C, end): identical and clean every time.
- No implementation or test file changed during the run.
- `refs/scratch/w1-pair-diag` = `5a8b5ed04`, kept.

**Results**

| Category | Result | By test name, against D1 / baselines |
|---|---|---|
| A. Real-schema, full project | 94/94 suites; 1930 tests: 1927 passed, 3 skipped, **0 failed** | D1's 8 failures (`d01_claim_human_approval`, `w1_community_single_execution`) are cleared by Prompt 3. `report1DurableHistoryEndToEnd` also passes here |
| A. D2 `service_role` suite | 9/9 | New; see below |
| B. Integration community/WhatsApp (the 18 D1 suites) | 15/18 suites; 126 tests: 120 passed, **6 failed** | All 6 are among D1's 26: `community_ai_core_apis` ×3 and `community_ai_webhooks` ×2 (registered baseline); `community_ai_scheduling` "executes due actions and logs execution" (also failing at main). Prompt 3 cleared the other 20 |
| B. Whole-repo unit jest (`--maxWorkers=2`) | 2388 suites; 42402 tests: 42266 passed, 73 skipped, **63 failed** | 60 are in the 31 Oct baseline (and in the Step A list). 3 are not: see exceptions |
| C. typecheck-ci | PASS, at baseline (1216 s) | Run with ≥6 GB free under the shared lock; no other typecheck running |
| C. Worker tsc | Clean | |
| D. Gates | 9/10 pass: route-auth, route-policy, schema-drift, tenant-authz, orgaccess-binding, withrbac-binding, outbound-ssrf, db-conventions, secrets. **migration-quality: 23 violations** | The 23 flagged files are identical, by name, to D1's. Not suppressed, not waived: GD-4 |

**Documented exceptions (the 3 whole-repo failures outside the 31 Oct baseline):**
1. `sec91FMigrationQuality` "check-migration-quality passes on the current migrations": runs the migration-quality gate, so it fails on the same 23. GD-4.
2. `govHMigrationControls` "RULE 6 … the committed attestation matches every file it pins": the same boundary violations, reported through the attestation rule. GD-4.
3. `snapshotReportService` "sorts actions and priorities by priority type then impact score": a 30 s timeout under whole-repo load.
   - It passes alone at the frozen head, at 29.6 s.
   - Neither the test nor the service changed between D1 `0679a5908` and `7f2ca186f`.
   - Owner: Reports, not Outreach. It is a timing-margin defect in that test, not a regression.

Exceptions 1 and 2 clear when GD-4 is decided, and not before.

**Database and migration replay.**
- A disposable pg-sandbox PG17 cluster on 127.0.0.1. The script refuses a non-loopback host and unsets every `PG*`, `DATABASE_URL`, `W6_*` and `SUPABASE*` variable first. The cluster was stopped afterwards.
- Build: bootstrap, then baseline (1 expected `already exists`, 0 unexpected), then 124 migrations above ledgerMax `20260916000000`, applied strictly, through `20270126000003`. That includes D2's `20270125000005` and Prompt 3's `20270126000000–03`.
- Real-schema ran on a stamped `w6` clone.
- **No production or shared environment was touched.** No migration was applied to any real environment, and no provider, send, publish, browser action or flag was used.

**D2 `service_role` suite: what it proves.**
- The real writer `sesEvidenceReconciliation.ts` runs as `service_role` (`SET LOCAL ROLE`, asserted by `current_user`) inside rolled-back transactions.
- Privileges:
  - `service_role` has SELECT, INSERT and UPDATE only; DELETE and TRUNCATE are refused (42501), and it is not a superuser;
  - `anon` and `authenticated` are refused every read and write.
- A debt is recorded address-free. An SNS retry refreshes the single open row: earliest failure kept, records widened.
- A later success resolves the row, and a resolved row is final: reopen and rewrite are refused (23514), delete is refused (42501), and a late duplicate leaves it unchanged.
- Tenant and event identity are immutable (23514).
- Evidence carrying an address is refused (`unrecorded`). Nothing is stored, and the address is not logged.
- **Tenant isolation:** a reconciliation scoped to tenant A examines only A's debts, and tenant B's row is byte-identical afterwards.
- The suite asserts the database URL host is loopback.
- No security or tenant-isolation defect was found.
- Scope: the debt table only. A replay that reaches a task needs grants that the governed build does not give `service_role` (see the governed-build grant finding); the unit suite covers that path.

**Provenance of the suite.**
- During the frozen run, the D2 suite ran from a **separate detached copy** of the same commit (`C:/tmp/omp-t2-d2rs`, one untracked file), so the frozen tree was never edited.
- Its first attempt did not start: a harness setup error (the copy's dependency link pointed one directory too high). It ran after the link was fixed, against the same disposable database: 9/9.
- **The committed file is subsequent evidence preservation, not part of the frozen T2 run.** The commit that adds it and this section is test and documentation only, on top of `7f2ca186f`.
- One change from the run copy: the test-only PostgREST adapter now converts only this table's two array columns (`governance_record_ids`, `failed_operations`) and quotes each element. That is what PostgREST does for an array column; a `jsonb` value keeps JSON. It catches no error, so a refused privilege still reaches the writer and fails the suite.
- The committed file (sha256 `ac43ae0853e6599c…`) was re-run from the foundation tree on a **fresh** disposable loopback cluster: same build, 124 migrations, **9/9**.
- Mutants, each on a fresh copy of that database:

| Mutant | Result |
|---|---|
| `REVOKE INSERT … FROM service_role` | 6 tests fail |
| `GRANT DELETE … TO service_role` | 2 tests fail |
| Guard trigger dropped | 2 tests fail |

**Closure status: unchanged, no closure is complete.** T2 covers the integrated code; the closures still wait on the owner decisions below.

**Owner decisions still open (unchanged, not resolved here):**
- GD-4 / REL-07 (also clears exceptions 1 and 2);
- D2-R;
- SC7-R (Q-1, Q-2, Q-3, Q-5);
- BL-A;
- CN-1..CN-3;
- C-CP-1;
- CL-1..CL-6;
- `PROSPECT_PERSON_ERASE` (security owner).

Release remains **NO-GO**. Nothing is pushed, merged, deployed or applied.
