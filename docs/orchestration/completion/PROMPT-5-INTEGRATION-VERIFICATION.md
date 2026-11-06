# Prompt 5 integration verification

Inbound reply intelligence, journey consequences and PI feedback. LOCAL only: nothing pushed, merged, applied or deployed. Release NO-GO.

## 1. Baseline and ancestry
- **Base:** `d11f08888`, the Outreach foundation head after T2 passed at `662d824be`. It is frozen as `refs/preserve/c5-base-d11f0888`.
- **Verified ancestors:** `33070705d` (the Prompt 4 merge), `662d824be` (O-2), `620a438fd` and `3967c7283`.
- **Prompt 4 diff:** still `456080cb…`.
- **Last change before the freeze:** `662d824be..d11f08888` is docs only.

| Tree | Purpose |
|---|---|
| `C:/tmp/orch-c5-a` | Agent A: O2-F1 compare-and-set, `replyConsequence`, person evaluation, classifier flag (OFF) |
| `C:/tmp/orch-c5-b` | Agent B: X-3 and contract 0.4.0 |
| `C:/tmp/orch-c5-c` | Agent C: read-only producer verification, plus one new test |
| `C:/tmp/orch-c5-int` | integration of A + B + C, plus the 5 deliverables |

## 2. Owner decisions applied
- **User, 2026-11-06:**
  - SC7-R stays unratified, so the classifier is OFF and every reply suspends.
  - `20270125000001` (complained) stays held.
  - EV-1: the event version stays 1.
- **Earlier owner decisions:** AC-1 (keep `actor.id`), and O-2 (Orchestration owns journey eligibility).
- **PI rulings (virality-b6):** no `PROSPECT_API_VERSION` bump; PI fixes the `outcomeInterpreter` headers; P-1 = (a); P-2 key and source as built; P-3, no PI pin.
- **Outreach rulings (virality-52):** conditions (a)–(c) on `response.received` and the classifier conditions are met; G-1..G-9 and N-1..N-5/M-1..M-5 are ruled (see INBOUND-REPLY-INTEGRATION.md §5).

## 3. Agent hand-offs (diff hashes, each against `d11f08888`)
| Agent | Hash (sha256 of `git diff`) | Files |
|---|---|---|
| A | `2c35f69875ffa88b…` | 20 |
| B (after follow-ups) | `9ac5fde4d1d178f1…` | 19 |
| C | new test only, `d2278790…` | 1 |

**Integration changes:**
- `scripts/ci/safety-test-suites.js`: merged by hand, since A and B added different lines at the same place.
- C's test is added and registered, with its X-3 block enabled and the contract-version test added.
- Two backend-tests type errors introduced by the new tests were fixed:
  - an `exclusionReasons` cast in `orch_journey_lifecycle`;
  - `export {}` in the compatibility test, whose `Row` collided with another script-scope test file.

## 4. T1
| Check | Result |
|---|---|
| Bytes: CR, control bytes, strict UTF-8 over every changed file | clean |
| `typecheck-baseline` (3 projects) | 0, at baseline |
| Backend-tests typecheck, net-new against `d11f08888` by diagnostic | **0 net-new.** 52 pre-existing, the same count Outreach registered at `d11f08888` (§4.1) |
| Gates | 9/10 pass. migration-quality: 23 violations, **identical by file name to the base** (GD-4/REL-07, pre-existing). |
| Template build `c5int_tpl` | 125 applied, 883 public tables, 1 known baseline error, 0 unexpected |

### 4.1 Backend-tests typecheck
- The stale baseline file reports pre-existing foundation debt. Outreach registered it as 52 at `d11f08888`.
- The comparison is by diagnostic, between the integration tree and a base tree (`d11f08888` plus only C's untracked test).
- **Result:** the integrated tree reports 52 diagnostics, all of them also present on the base, so **0 net-new**.
- The first integration run found 2 net-new diagnostics; both were fixed (§3). The diagnostic `report2BaselineRead … Duplicate identifier 'Row'` appeared on the base tree only because C's then-script-scope test sat there untracked, and it is gone with `export {}`.
- Logs: `I5b-btc.log` (integrated) and `B5-btc.log` (base).

## 5. T2
| Run | Integrated | Base | New |
|---|---|---|---|
| Real schema, full, on the new template | 102/103 suites, 2019 passed, 3 skipped, 5 failed | – | 0 |
| report1DurableHistoryEndToEnd, on the base | – | the same 5 tests fail | pre-existing harness issue (the suite expects RUNDB `w6`) |
| Whole-repo unit, compared by test name | 72 failures | 72 failures | **0 new, 0 fixed: the names are identical** |

- The real-schema total includes the new `o2f1_resume_race` suite.
- The whole-repo unit counts were 42669 passed on the integrated tree and 42446 on the base. The difference is the new tests.

**Fail-on-base proof:**
- **O2-F1 race (unit and real schema):** fails on the base (both resumes won, and the run was sendable before the floor); passes on the fix.
- **X-3 block in `orch_c5_producer_compat` (3 tests):** fails on the base, passes on the integrated tree.
- **Re-pins:** each replaced assertion is listed in WHATSAPP-UNCLASSIFIED-ENGAGEMENT-FIX.md.

**After the two type fixes:** `orch_journey_lifecycle` passes 20/20 on real schema, `orch_c5_producer_compat` passes 32/32, and the typecheck is at baseline.

**T3:** not authorised, not run.

## 6. Merge preview on the Outreach head `7486e3ffb`
`7486e3ffb` is `96c314795` (Outreach N/M fixes, consumer-reviewed PASS) plus a docs-only register commit.

- The Prompt 5 integration diff applies cleanly.
- Affected suites pass, 6/6: compatibility, X-3, shared mapping, WhatsApp re-delivery, the manual outcome route and the safety selector.

**One merge-time re-pin:** GAP-9 → N-3, an operator repeat with a different `occurredAt` is now `duplicate: true`, giving one row and one `response.replied`.
- The fake store models `idx_outreach_outcomes_manual_once`, scoped to `source = 'manual'`.
- Two mutants are each caught: one with no manual-once rule, one with the rule unscoped.
- The patch is held for the merge, not applied here, because at `d11f08888` the old behaviour is still true.

## 7. Peer review
| Reviewer | Hash reviewed | Verdict |
|---|---|---|
| Outreach (virality-52) | `2a73befdf544558c…` | **PASS**. Conditions (a)–(c) and the classifier conditions are met. (c) is confirmed: email's honest case is `delivery.confirmed`, never a reply. The GAP-9 → N-3 merge re-pin is confirmed against the real index. No Outreach-owned file is touched. |
| PI (virality-b6) | `e9231420b2803da7…` | **PASS**, with non-blocking F-1..F-3. Both OKs granted: the `not_an_opt_out` refusal, and the 034/036/037/040 re-pins (verified by content). PI ran 11 suites itself: 474 passed, 0 failed. |

**PI findings, addressed after review (delta reviewed with Outreach's verdict):**
- **F-1.** `recordPersonDecision` was not "unchanged": it now keeps `d.reasons`, where the old helper dropped them. The docblock and the 040 re-pin comment now say so. Progression passes `reasons: []`, so its records are unchanged.
- **F-2.** The P-1 guard pinned only direct imports. A new test walks the full closure of relative imports from `journeyReplyEvaluation.ts`:
  - the PI modules reached must equal a named read-side set;
  - no lifecycle writer, interpreter, producer or barrel may be reached;
  - no module in the closure may call one (checked with comments stripped).
  - A mutant that imports `journeyFeedback` into `journeyExit` is caught.
- **F-3.** A free-text opt-out the STOP detector misses never reaches PI. It is recorded as its own gap in OUTREACH-FEEDBACK-INTEGRATION.md §4, along with PI's two key-change invariants (§3).
  - Correction accepted by PI: `exitJourney` writes no restriction, so the impact is not bounded by governance.
  - Raised to the owner as an OWNER ITEM (G-11).

PI re-confirmed **PASS at `a1672379…`**, after verifying the delta per file: 6 files changed and 38/44 byte-identical. It added one residual, F-2b, now addressed:
- **F-2b.** The closure walk now follows dynamic `import('…')` as well as static imports. `prospectAliasStore` stays in the allowlist on a measured basis: the closure reaches only its reader, and an assertion that no other module in the closure names `recordProspectAlias` pins that the writer is unreachable.
- **Measured finding.** Following dynamic imports without a boundary reaches 518 modules, including the provenance writers. The path runs through `leadOutreachExecution/quota` → `bullmqClient` → `jobProcessors/engagementPollingProcessor`. That processor import runs only inside a BullMQ Worker's job handler, and quota uses `bullmqClient` only for `getSharedRedisClient`. The walk therefore does not enter `backend/queue/jobProcessors/`, which is stated in the test.
- **With that boundary:** 189 modules, PI set equal to the allowlist, and no provenance writer.
- **Mutants caught:** a dynamic `import('../prospectLifecycle/lifecycleWriter')` in journeyExit, and a dynamic `recordProspectAlias` in journeyRetiming. Both files were restored byte-identical.

PI re-confirmed **PASS at `725b60c1…`** and accepted the directory boundary.

**At PI's request, the one crossing is pinned.** In the bounded closure, the set of modules naming `jobProcessors/` must equal `['queue/bullmqClient.ts']`. A mutant importing a processor from journeyExit is caught, and the file was restored.

**PI review history:** `e9231420` → `a1672379` → `725b60c1` → `2a73befd`, PASS at each. No PI findings are open; the two stale `outcomeInterpreter.ts` headers stay with PI until after the freeze.

**Outreach notes (no change needed):**
- After an approved N-4 clearing, a STOP keeps its keyword, and anything else reads as `'[redacted]'`, then `inbound_unclassified`, then `response.received`.
- M-3: `engagement_messages.created_at` is Meta's send time, falling back to receipt time.
- Outside `backend/queue/` and `backend/workers/`, several modules REFERENCE job processors, and **none imports one for execution**. Corrected after commit; PI review, verified by grep at `f2c66117c`.
  - **Doc comments only:** `socialPublishEngineAdapter`, `publishNowService`, `lib/campaign/publishAuthorization`, `creatorOrchestrator`, `asyncRefinement`, `scheduledAnalyticsSync`.
  - **A `filePattern` string:** `nonBillableRegistry:74`.
  - **Type-only imports** of a job payload type, erased at runtime: the four `structuredPlanScheduler*` modules, and `pages/api/campaigns/ai/plan-v2.ts`.
  - The only value imports of a processor are in worker entry points. This is why the boundary is a directory, not an edge list: an edge list would have to enumerate type-only edges that carry no runtime behaviour.
  - None of these modules is in the reply-evaluation closure; the r4 pin fails if one enters.

**Recorded hashes:**
- Reviewed hash: `2a73befdf544558c79a27c5446d348388b86e1e23077e2234f3d66f91857753d`.
- This file changed after review only to add the two verdict rows and these notes, as agreed with both reviewers.

## 8. Not done in this round
- AI classification (Q-3).
- Persisted canonical codes and complained rows.
- Inbound email and SMS.
- A message → journey link, and choosing one journey among several.
- An atomic floor + state RPC, and the ABA version token.
- A dedicated `evaluated` decision kind.
- G-10 (a later WhatsApp failure after settlement).

All of these go to Prompt 6 or to owner decisions.
