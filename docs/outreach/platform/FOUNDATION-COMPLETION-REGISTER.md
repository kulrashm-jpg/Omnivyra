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
| CR-X-01 | Owner + execution programme + Orchestration | Reconcile round 3's duplicate community, RPA and WhatsApp safety code with W1 (table above) | OPEN | WhatsApp send-once and any round 3 integration | Merged resolution reviewed by both owners; suites green |
| CR-OR-D02 | Orchestration (c7) | D-02 rebased onto `a14002d0`, re-pinned there, F1 and `approval.revoked` included | REQUESTED 2026-11-04 | Inbox reply approval (C); approval invariants (C3) | Diff hash, my review, the owner's commit authorization |
| CR-OR-RACE | Orchestration (c7) | Opt-out-to-claim window; claim-loss metric; unused `advanceCommandChain` | REQUESTED | C5 closure; 1.5.0 | Tests per item |
| SC-3 | Orchestration | Journey step references `content_revision_id` | OPEN | A3 campaign → revision | Contract and migration on the base |
| SC-4 | Orchestration + Outreach | Outcome association for non-WS-3 engines | OPEN | Unsubscribe outcome; WhatsApp and community outcomes | Agreed contract plus one migration (coordinator) |
| SC-6 | Orchestration | Channel vocabulary (`phone` vs `voice`, STOP scope) | OPEN | SMS and voice profiles stay format-only | Contract text |
| SC-7 | Outreach (Engagement) → PI, Orchestration | One message-classification vocabulary with the deterministic governance classes | DRAFT by Agent B | B closure | Both owners accept |
| C-CP-1 | Content Platform (**owner not named**) | Outreach content types plus channel metadata in canonical persistence | BLOCKED: owner needed | A3 | Named owner; policy change |
| C-AI-1 | Platform AI | Personalized and conversation ops bypass the cache; route or remove `gpt-chat` / `claude-chat` | OPEN | B3 suggestions; A personalization | Change to `aiResponseCache.ts` with a cross-recipient test |
| C-PI-1 | PI | Runtime writer of `engagement_threads.unified_person_id`; recipient consent store | OPEN | B1 cross-channel context | Writer plus test |
| C-BL-1 | Billing | Channel credit actions | OPEN | Any charged send | Feature registry entries |
| C-PI-2 | PI + Outreach | Acting-account and tenant ownership proof (`proveActingAccount`, page URN vs OIDC sub) | OPEN | Community and 1.5.0 | Binding proof |

## Completion register

Status labels: NOT STARTED, IN PROGRESS, IMPLEMENTED LOCALLY, INTEGRATION REQUIRED, BLOCKED, VERIFIED T1, VERIFIED T2, SANDBOX VERIFIED, PRODUCTION VERIFIED.

| ID | Closure | Capability | Existing evidence | Change required | Owner | Dependency | T1 | T2 | Status |
|---|---|---|---|---|---|---|---|---|---|
| A-1 | A | Channel profiles, formatters, validators (email, WhatsApp, community, SMS-format, voice-format; social via existing profiles) | `4ce2d83ed` on `outreach/a-channel-content`: 10 new files, 0 existing files changed. Social delegates to `platformAdaptationProfiles` plus `promotionDraft` caps; SMS GSM-7/UCS-2 segments; no I/O. Policy numbers other than subject 200, WhatsApp 4096 and the GSM arithmetic are proposals (C-A-2) | Confirm the numbers; choose 1 of 3 social cap registries | Agent A | C-A-2 | 41/41, re-run by the coordinator; typecheck 3/3; eslint clean | n/a (pure) | VERIFIED T1 (not yet wired into any send path) |
| A-2 | A | Personalization guard (041-D allow-list) and no engine import in generation | The allow-list is imported (same object); unauthorized, missing and not-permitted placeholders are refused; the boundary test passes, with 10 probes and transitive checks | — | Agent A | C-AI-1 for AI drafts | Included above | — | VERIFIED T1 |
| A-3 | A | Canonical save and revisions; campaign → approved revision | Tables exist; writes blocked | Policy change; link | Content Platform, Orchestration | C-CP-1, SC-3 | — | — | BLOCKED |
| A-4 | A | Shared generation through the gateway for outreach types | Gateway exists; runtime flags off | Generation request contract | Content Platform | C-CP-1 | — | — | BLOCKED |
| B-1 | B | One classification vocabulary plus deterministic STOP / unsubscribe / complaint | `c889087b9` on `outreach/b-engagement-classification`: `backend/services/engagementClassification/`, a 16-code vocabulary, the governance detector reusing `whatsappOptOut`, total mapping tables for 4 legacy producers, the `classifyMessage` entry point; additive edits to the 3 classifiers. **Not wired into any runtime path; canonical codes not persisted** | SC-7 agreement (Q-1..Q-5); a migration for `canonical_code` / `governance_codes` columns (coordinator, not written) | Agent B | SC-7, C-AI-1 | 8/8 suites, 448/448, re-run by the coordinator; typecheck 3/3 | — | VERIFIED T1 (draft contract) |
| B-2 | B | Suggestions with rationale, confidence, escalation, tone | `engagementAiAssistantService` | Extend | Agent B (later) | C-AI-1 | — | — | BLOCKED |
| B-3 | B | Inbox send boundary | `/api/engagement/reply` | Formatter, governance, approval | Agent C | CR-OR-D02 | — | — | BLOCKED |
| C-1 | C | D-01, L-3, atomic claim, P-A, D-03 | Committed locally; in the base | Integration verification | c7 / coordinator | — | base T1 pending | — | INTEGRATION REQUIRED |
| C-2 | C | D-02 approval binding | Round 2 `eabc1c0a…ec99` on `9a8dab9a`: F1 re-review edge (two CAS writers), F2 VS-5, F3. **Signed off by the dispatch owner 2026-11-04** for a local commit. c7 reports T1 0 new failures and T2 baseline only (not re-run by me). `approval.revoked` follows as contract 0.3.0 | Rebase onto the base (waits for c7's owner); 0.3.0 event change | c7 | CR-OR-D02 | c7-reported | c7-reported | IMPLEMENTED LOCALLY (uncommitted) |
| C-3 | C | No independent execution from `/api/response/generate`; Mode 3 off by default; one switch | Bypass present; default true | Fold into the canonical authority | Agent C | — | — | — | IN PROGRESS |
| C-4 | C | Inventory of entry-path authority (every route, worker, scheduler) | Partial (L-3 and claim cover community) | Executable inventory test | Agent C | — | — | — | IN PROGRESS |
| C-5 | C | Race follow-ups | Tracked | — | c7 | CR-OR-RACE | — | — | IN PROGRESS |
| C-6 | C | Cache bypass; gateway bypass routes | Present | Platform AI change | Platform AI | C-AI-1 | — | — | BLOCKED |
| D-1 | D | Email complaint state and unsubscribe evidence preserved | `25e1c8a96` on `outreach/d-engine-readiness`. **E-1:** delivery status only moves forward if unchanged since read (`advanceOutreachTaskDeliveryStatus`), so concurrent events can no longer overwrite each other. **E-2:** the complaint or hard-bounce restriction is written even when the evidence write fails (still 503, SNS retries). The complaint's `delivered` row is marked `deliveryInferredFrom: 'Complaint'`. Unsubscribe evidence is proven insert-only | Complaint as a business outcome needs CR-4 (S-1 migration); unsubscribe outcome row needs SC-4 | Agent D | SC-4, CR-4 | 39 suites, 1231 passed / 5 skipped, re-run by the coordinator; typecheck 3/3 | not run (new CAS matches the existing pattern; T2 still required) | VERIFIED T1 |
| D-2 | D | Per-engine D7 readiness evidence (5 engines) | `docs/outreach/platform/ENGINE-READINESS-D7.md` (on the D branch). Email integrated; WhatsApp no path reaches Meta (WA-1/2/3 confirmed; usage RPCs undefined; journey `hasApproval` always false); Social integrated, but account ownership is not checked; Community `proveActingAccount` absent; Browser GAP-03 confirmed and `executed` comes from a client flag | WhatsApp fix plan (10 steps, CR-X-01 first) | Agent D | CR-X-01, C-BL-1, C-PI-2 | n/a (documentation) | — | IMPLEMENTED LOCALLY |
| D-3 | D | WhatsApp L-4, send-once, WA-1/2/3 | Open | — | Agent D (later) | CR-X-01 | — | — | BLOCKED |
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
