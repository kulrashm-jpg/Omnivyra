# PROMPT-4-INTEGRATION-VERIFICATION

Date: 2026-11-05. Prompt 4 of 8. **Status: integrated LOCALLY and verified; NOT committed.** An owner ruling relayed by Outreach requires owner review of the diff and evidence before any commit. Production release stays **NO-GO**; T3 is not authorised.

**Companions:**
- [CONTRACT-030-APPROVAL-REVOCATION](CONTRACT-030-APPROVAL-REVOCATION.md)
- [APPROVAL-RESUBMISSION-AUDIT](APPROVAL-RESUBMISSION-AUDIT.md)
- [JOURNEY-RETIMING-OUT-OF-OFFICE](JOURNEY-RETIMING-OUT-OF-OFFICE.md)
- [SHARED-MESSAGE-OUTCOME-CONTRACT](SHARED-MESSAGE-OUTCOME-CONTRACT.md)

## 1. Baseline

| Item | Value |
|---|---|
| Branch | `outreach/foundation-base-20261104` |
| Frozen commit | `7f2ca186f57078841ff579120e6a72619b7b1f56` (Outreach confirmed the freeze 2026-11-05) |
| Ancestors verified | `b01ff5e5b` (Prompt 3 integration), `5ee390cc6` (FU-10), `47a8c5388` (Prompt 3), `19498a2e4` (D-02), `0679a5908` (D1), `6e96f6680` (Prompt 1 foundation) |
| Later commit | `3967c728` (Outreach test + docs only; code identical to `7f2ca186f`). Not included. |

## 2. Branch and worktree map

| Role | Worktree | Branch | Owner |
|---|---|---|---|
| Agent A: contract 0.3.0, `approval.revoked`, event mappings | C:/tmp/orch-c4-a-contract | `orch/c4-a-contract` | Orchestration |
| Agent B: N2, reply suspension, RV-1, complaint exit, retiming, migration | C:/tmp/orch-c4-b-journey | `orch/c4-b-journey` | Orchestration |
| Agent C: shared outcome vocabulary (proposal and pinning tests) | C:/tmp/orch-c4-c-outcomes | `orch/c4-c-outcomes` | Orchestration |
| Integration | C:/tmp/orch-c4-int | `orch/c4-integration` | Lead |

No file was changed by two agents. The lead's own integration edits:
- removed Agent B's interim complaint helper, so the complaint exit uses `journeyEvents.isComplaintInferredEvidence` directly;
- updated the migration reservation register;
- registered the two new unit governance suites in `scripts/ci/safety-test-suites.js`;
- fixed four integration defects in tests (§5.3);
- wrote this document.

## 3. Decisions applied

| ID | Decision | By |
|---|---|---|
| SC7-R | SC-7 stays UNRATIFIED. An unclassified reply pauses the run for review. No classifier output drives a journey. | User, 2026-11-05 (also relayed by Outreach as an owner ruling) |
| Q-C1 | A complaint terminates the affected run. Recipient-level suppression stays independently enforced. | User, 2026-11-05 |
| Q-C2 | `complained` is a distinct normalized outcome; no new restriction store. | User, 2026-11-05 |
| RV-1 | A revocation pauses the run for review. Resume never revives the revoked approval. | User, 2026-11-05 |
| Q-C3, Q-C4, Q-C5, Q-C6 | Complaint event from the evidence marker now; unmapped values kept as `record.unmapped`; `expired` → `execution.cancelled` (`expired`); Reject → failed (pending, Outreach DF-5) | Outreach and the contract owner |
| EV-1 | `JOURNEY_EVENT_VERSION` stays 1 | Contract owner (lead); owner may override |
| AC-1 | `actor.id` (internal user uuid) is exposed on approval events, tenant-scoped route only | Lead; owner may override |

## 4. Changed files and migrations

47 files, +5912/−123 before this document's results were filled in (see the diff). Grouped:

- **Contract and events (A):**
  - `executionContract.ts` (0.3.0; `approval.revoked`, `journey.suspended`, `record.unmapped`);
  - `journeyEvents.ts` (mappings, `isComplaintInferredEvidence`, optional `actor`);
  - the four contract docs.
- **N2 (B):**
  - `approvalBinding.ts` (`requestFreshApproval` gains an optional requester; `audit_logs` row `OUTREACH_APPROVAL_RESUBMITTED`);
  - `journeyApproval.ts`;
  - `pages/api/outreach/journey-approval.ts`.
- **Journey consequences (B):**
  - `journeyResponses.ts` (restrictions first, complaint exit, suspension);
  - `engineAdapters.ts` (RV-1);
  - `workflowProgressionSweeper.ts`;
  - `stepProgressionStore.ts` (`not_before`, later-only);
  - `journeyRetiming.ts` (new; the engine, plus resume with a return date);
  - `pages/api/execution-instances/[id].ts` (optional `returnDate`).
- **Migration:** `20270127000000_execution_step_not_before.sql` plus its rollback.
- **Tests:** 11 new suites and 13 updated. Every changed expectation is marked `Prompt 4 — CHANGED` or `RE-PINNED 2026-11-05 (Prompt 4)`.

### Migration allocation

| Version | Use | Status |
|---|---|---|
| 20270127000000 | `execution_plan_steps.not_before` (nullable) and `advance_execution_plan` with one added EXIT line. Two SECURITY INVOKER guard triggers (later-only, never past, never on settled or running steps). No grant, policy or RLS change. | Reserved in `scripts/migrations/version-reservations.json`. Applied only to disposable sandbox databases. |
| 20270127000001-09 | Unused, reserved for Prompt 4 | Reserved. Outreach takes nothing in 20270127*. Kept clear of the GD-4 renumber block. |

`complained` outcome writes depend on Outreach's `20270125000001`, which is unapplied and held behind GD-4 plus a separate apply decision. Until then `delivery.complained` comes from the stored evidence marker.

## 5. T1 / T2 results (integrated tree)

All runs are local. Real-schema runs use disposable pg-sandbox databases: `w4_int` is built from the frozen base plus `20270127000000`, and `w4_base` is the base alone. Unit runs use a placeholder, loopback-only environment and never read `.env*`.

### 5.1 T1 (integrated tree)

| Check | Result |
|---|---|
| Template build `w4_int` | baseline errors 1, unexpected 0; 125 migrations applied |
| `npm run typecheck` | 0 errors; at baseline |
| Backend-tests typecheck | integrated 52 net-new against the committed baseline; base `7f2ca186f` gives 53. Diffed error by error: **0 introduced by Prompt 4**. The 53rd at base is Agent C's test without Agent A's export. |
| migration-quality | 23 violations, all the REL-07 baseline; none for `20270127000000` |
| db-conventions, orgaccess-binding, outbound-ssrf, route-auth, route-policy, schema-drift, secrets, tenant-authz, withrbac-binding | all exit 0 (route-auth: the 2 known open findings only) |
| Byte scans (CR, control bytes, strict UTF-8) | clean on every changed file |

### 5.2 T2 (integrated tree)

| Run | Result |
|---|---|
| Real-schema, full | 100 suites, 1996 tests. After the §5.3 fixes, the only failure is `report1DurableHistoryEndToEnd` (5 tests). It fails identically at base: it expects RUNDB `w6`, while the harness names databases `w6_*`. Pre-existing. |
| Real-schema, re-run of the fixed suites (`orch_c4_approval_revoked`, `q4_retiming_inputs`, `p4_governance_precedence`) | 3/3 suites, 47/47 tests |
| Unit, whole repository | 2386 suites. 23 failed, re-run at base and integrated and compared **by test name**: 72 failures common to both, which are pre-existing (environment: Redis, AI and network placeholders, and migration-register suites). One integrated-only failure (safety selector) is fixed in §5.3; one base-only failure was C's test. |
| Unit, re-run of the fixed suites (selector, `p4GovernancePrecedence`, `q4FollowUpRetiming`, `d02JourneyApprovalRoute`) | 4/4 suites, 108/108 tests |
| Agent runs before integration | A: unit 112/112, real-schema 98/98. B: real-schema 199/199, unit 1113/1113, mutants M1, M2, M2b and M3 killed. C: 31 passed, 10 todo. |

### 5.3 Integration defects found and fixed

1. **Reservation slug.** The register said `execution_plan_steps_not_before`; the file's slug is `execution_step_not_before`. The register now matches the file.
2. **`orch_c4_approval_revoked`.** Agent A pinned the pre-RV-1 consequence (skip the step, then advance). It is now re-pinned to RV-1: the run is paused, `needs_human approval_revoked:<fingerprint>`, `journey.suspended` appears in the view, and nothing more is handed off. The no-approval case uses a second enrolment.
3. **`q4_retiming_inputs`.** The fixture swept at the real clock under a London 09:00-17:00 window, so it failed after 17:00. The fixture window is now open all week. The window push is asserted separately against a 09:00-17:00 window.
4. **Safety selector.** `p4GovernancePrecedence` and `q4FollowUpRetiming` were not registered. Two typing-only fixes were also made, in `p4_governance_precedence` and `d02JourneyApprovalRoute`.

### 5.4 Not run

- T3 (not authorised).
- No production read, write, migration or role.
- No real provider or external send.
- After the §5.3 test-only fixes, the full real-schema and full unit suites were not re-run end to end. The affected suites were re-run, as above.

## 6. Cross-workstream compatibility

- Contract 0.3.0 is additive.
  - 0.2.0 capability declarations still pass, because the comparison uses the major version only.
  - Readers must ignore unknown event types.
  - Re-mapped rows get a new type and therefore a new eventId. No consumer exists outside test databases: the events route is undeployed.
- Outreach owns the channel writers and the SC-7 code. Prompt 4 changed no Outreach-owned file, except N2 in `approvalBinding.ts`, which was agreed with Outreach and reviewed by them.
- PI: unchanged. Open item X-3: every unclassified WhatsApp reply still moves PI to `engaged`.

## 7. Outreach peer review

**Reviewed:** combined diff sha256 `a67d6d02086ebb597737d32290f654fb8aa2f4e5190d133ecd4aa05be279946d` (47 files). Outreach reproduced the hash from a private index copy, byte for byte. **SIGNED OFF, conditional on F-1 to F-3**, which are now applied. Outreach checks the delta only.

**Outreach's own run:** a fresh pg-sandbox on loopback, 125 migrations through `20270127000000`.
- Real-schema 66/66: `p4_governance_precedence` 23, `orch_c4_approval_revoked` 17, `p4_reply_suspension` 8, `q4_retiming_inputs` 7, `n2_resubmission_audit` 6, `p4_governance_whatsapp` 5.
- Unit: 7 suites, 226 passed.
- Conditions C-1, C-2 and D-1 to D-3 met. No provider calls. RV-1, `not_before`, the complaint exit, N2 and "SC-7 never presented as ratified" all confirmed.

**Fixes applied after review:**
- **F-1:** `isComplaintInferredEvidence` now returns `true` (complaint) from its outer `catch`, so the fail-toward-complaint rule holds on every path. A test pins it with a throwing proxy and a throwing getter.
- **F-2:** the `journeyRetiming.ts` header now names the run route as the only importer and `20270127000000` as where `not_before` is persisted.
- **F-3:** four to-dos in `sharedMessageOutcomeMapping.test.ts` were already implemented. They are replaced by pointers to the covering suites. The remaining to-dos are S-1 ×2, DF-5, DF-7/P-6, SC7-R and PI `complained`.

**Recorded observations (no code change):**
- **O-1, deploy order (release gate):** `stepProgressionStore` always selects `not_before`. The code must never be deployed before `20270127000000` is applied, or every step read fails with 42703. That fails closed, but it halts all progression. Rollback order: roll back the application first, then the migration, as the rollback file states.
- **O-2:** `not_before` holds back the sweeper and `advance_execution_plan`, not dispatch itself. A task handed off before the pause can still go out through two paths:
  - an operator's `/activate` (a human action);
  - the flag-gated recovery sweep (internal channel only).

  No automated external path bypasses it. Any wording elsewhere that "both clocks honour it" means only these two progression paths.
- **O-3:** only complaint and unsubscribe restrictions end a run. A hard bounce or any other restriction beside a pending reply pauses the run, and governance still refuses the send (unit-tested). This is consistent with the ruling.
- **O-4, N2:** if the audit insert fails after the compare-and-set, the task moves without an audit row. The failure is reported as `auditFailed` and never swallowed. This is acceptable because the move is toward needing approval.
- **Legacy `sesEventType` fallback:** Outreach never issued a veto. Orchestration recorded "Outreach can veto it in review". "Your veto stands" in the review request meant that this right stood, not that a veto had been issued. Outreach reviewed the helper and found it consistent with their condition: a row counts as a complaint when `sesEventType` names a complaint, so it fails toward complaint. **The fallback stays.**

**Commit:** not made. Committing is the user's decision under the relayed owner ruling.

## 8. Remaining blockers and open decisions

- **Owner:**
  - SC7-R (the 16 codes; Q-1, Q-2, Q-3, Q-5);
  - X-3 / DF-6 (PI engagement on an unclassified reply);
  - EV-1 and AC-1 confirmation;
  - GD-4 and the apply decision for `20270125000001` (`complained` writes).
- **Outreach follow-ups:**
  - DF-5 (SES Reject → failed/`rejected`);
  - DF-7 / P-6 (WhatsApp post-settlement failures, raw Meta statuses);
  - `complained` in `BUSINESS_OUTCOME_TYPES` and the corpus copy;
  - the `recordEvidenceDebt` 22P02 seen in C-2;
  - SC-4 (journey event for the unsubscribe link).
- **Waits for SC7-R:** classifier-fed retiming (out_of_office, follow_up).
- **Release:**
  - T3 not authorised;
  - human security-owner sign-off open;
  - production grants unmeasured;
  - migration not applied anywhere.
