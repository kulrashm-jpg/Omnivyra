# ENG-004-G19 — AUTOREPLYSERVICE RETIREMENT REPORT

**Status: PASS.** The orphaned legacy auto-reply implementation is removed. One file
deleted, nothing else. `ENG-004 remains NOT CLOSED` — see §15.

**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`. Repository-only; no deployment,
no Docker, no migration applied.

---

## 1. Pre-mutation inventory

Re-checked at current HEAD rather than trusting the ENG-004 finding, across `backend`,
`pages`, `lib`, `scripts`, `docs`, `.github` and every `.ts/.tsx/.js/.cjs/.mjs/.json/.md/.yml`.

### `autoReplyService` — zero production references

The only references anywhere were in **my own ENG-004 test suite**
(`eng004EngagementMessageTenant.test.ts`, 7 lines), which asserted the module still
existed and was orphaned. No import, no dynamic `import()`, no `require`, no string module
reference, no barrel re-export (`backend/services/index.ts`, `backend/index.ts`,
`lib/index.ts` — none mention it), no route, worker, scheduler, feature control, workflow
or script. ENG-004's finding holds at HEAD.

### `attemptAutoReply` — solely owned

Defined at `autoReplyService.ts:101` and referenced only inside that file.

### `orchestrateResponse` — **SHARED. Not deletable.**

| Reference | Reachable? |
|---|---|
| `backend/services/responseOrchestrator.ts:37` | the definition |
| `pages/api/response/generate.ts:10,76` | **yes — a live API route** |
| `docs/CONVERSATION-MEMORY-IMPLEMENTATION.md:81`, `docs/OMNIVYRA-RESPONSE-ENGINE-INTEGRATION-AUDIT.md` ×3 | documentation |

### `executeAction` — **HEAVILY SHARED. Not deletable.**

`automation/automationService.ts:253`, `bulkEngagementService.ts:28,237`,
`communityAiAutoRuleService.ts:3,521`, `communityAiScheduler.ts:2,394`,
`communityAiActionExecutorRuntime.ts:286` (definition),
`communityAiActionExecutorContracts.ts:506,524`, plus the platform-connector interface and
the Facebook/Instagram connector implementations.

### The module's own imports — all four shared, none solely owned

| Import | Other consumers |
|---|---|
| `supabase` | the whole codebase |
| `resolveResponsePolicy` (`responsePolicyEngine`) | `responseOrchestrator.ts:7,55` — reachable via `/api/response/generate` |
| `orchestrateResponse` (`responseOrchestrator`) | `pages/api/response/generate.ts` |
| `getControls` (`engagementGovernanceService`) | `conversationTriageWorker.ts:11`, `engagementDigestWorker.ts:9`, `engagementOpportunityDetectionWorker.ts:13`, plus two test mocks |

### Exported symbols — none used elsewhere

`isEligible` (0 references outside), `attemptAutoReply` (0), and the types
`EligibilityResult` / `AttemptResult`. The latter two **do** appear elsewhere —
`domainEligibilityService.ts:37` and `scripts/ops/plannerStagingLoadValidation.ts:62` —
but each is an **independent local declaration of the same name**, not an import. Checked
before deleting, because a name collision read carelessly would have looked like a
dependency.

**Conclusion: the only file solely owned by G-19 is `autoReplyService.ts` itself.** No
caller was found, so no STOP condition was triggered.

---

## 2. Files removed

| File | Hash | Size |
|---|---|---|
| `backend/services/autoReplyService.ts` | `cdeb4820c55b6943` | 5363 bytes, 169 lines |

Exactly one file. A copy is preserved outside the repository at
`C:/tmp/g19-removed-autoReplyService.ts.bak` (same hash) so the deletion is reversible
without archaeology.

**No barrel export needed removing** — none existed. **No test was deleted** — none
existed for it; the ENG-004 suite's assertions about it were inverted (§5).

---

## 3. Files retained, and why

| Retained | Why |
|---|---|
| `backend/services/responseOrchestrator.ts` | `orchestrateResponse` is called by the live `/api/response/generate` route |
| `backend/services/responsePolicyEngine.ts` | `resolveResponsePolicy` is used by `responseOrchestrator` |
| `backend/services/engagementGovernanceService.ts` | `getControls` is used by three workers |
| `backend/services/communityAiActionExecutor*` | `executeAction` has seven+ reachable consumers |
| the platform connectors | implement the connector interface, unrelated to G-19 |

None of these was G-19's to remove. The brief is explicit — do not delete shared
utilities merely because `autoReplyService` imported them — and all four of its imports
turned out to be shared. **No shared functionality was separated, moved or refactored.**

Post-deletion hashes, unchanged by this gate:
`responseOrchestrator.ts bfcbf32e21da9860` · `responsePolicyEngine.ts 579e5789123bf1cd` ·
`engagementGovernanceService.ts 3e466bd36e22ae17` ·
`communityAiActionExecutorRuntime.ts f1ea1c3763d87273` ·
`pages/api/response/generate.ts bf3a59019fa43be9`.

---

## 4. Reference search, before and after

| Symbol | Before | After |
|---|---|---|
| `autoReplyService` | 7 (all in the ENG-004 suite) | **0** outside that suite |
| `attemptAutoReply` | 2 (both inside the deleted file) | **0** outside that suite |
| `orchestrateResponse` | 9 | **8** — only the `autoReplyService` import and call are gone |
| `executeAction` | 20+ | unchanged |

The ENG-004 suite still names the two retired symbols, in prose and in the scanner that
proves they are absent. Its own file is excluded from that scan, deliberately and
explicitly — otherwise the test would flag itself and could only be made to pass by
removing the very assertion that gives it value.

---

## 5. Test results

**21 suites, 492 tests, 492 passed, 0 failed.** The ENG-004 suite grew 52 → **55**.

`eng004EngagementMessageTenant`, `eng003SesProviderEvents`,
`engagementBulkDispatchAcceptance`, `engagementAiActionabilityF5`,
`engagementAiSendBoundaryF5`, `engagementAiDiversityF6`, `engagementBulkDmClosureP11`,
`engagementBulkGovernanceP12`, `engagementUnifiedSec001`, `sec91AEngagementReplyDraft`,
`engagementWorkQueueOwnership`, `engagementDispatchRecoveryP1`, `engagementQueueRules`,
`engagementCapabilityMap`, `engagementDraftOwnershipP11`, `engagementRawThreadRouteF7`,
`engagementActionabilityPaginationF1F2`, `engagementMultiAccountD4`,
`engagementPlatformCountsD2`, `piWs5ProspectEngagement`, `ws3Milestone7Feedback`.

**Assertions inverted rather than deleted.** The ENG-004 suite previously asserted the
module *existed* and was orphaned. It now asserts:

- `autoReplyService.ts` **does not exist**;
- a recursive walk of `backend`, `pages`, `lib`, `scripts` finds **no** file (other than
  the suite itself) mentioning `autoReplyService` or `attemptAutoReply`;
- **no replacement** was introduced — no file in `backend/services` matches
  `autoreply|auto_reply|autoResponder`;
- and a **positive control**: the five shared collaborators still export and use what
  they did before, so an over-reaching deletion would fail this test rather than pass it.

The residual-unscoped set in §B2 dropped from three files to **two**
(`engagementNormalizationService`, `backfill_lead_signals`), since the two unscoped
`autoReplyService` reads no longer exist.

**Pre-existing failures preserved and untouched:** `ws3Milestone5aInternalDispatch` and
`ws3Milestone5bExternalDispatch` (38 tests). Not run in this gate's set, not attributed
here, not fixed.

Whole-repo jest: **not run** (not authorized).

---

## 6. Typecheck

**3/3 projects clean** (`tsconfig.json`, `tsconfig.backend.json`, `tsconfig.scripts.json`).

This is the load-bearing proof of module resolution: a stale `import` of a deleted module
is a compile error, so a clean typecheck across all three projects demonstrates no import
survives anywhere TypeScript can see — which is stronger than any grep.

---

## 7. Route-auth

**PASS — 1350/1350 routes**, unchanged from before the deletion (no route was removed;
`autoReplyService` was never reachable from one). The 2 KNOWN OPEN findings
(`auth/resend-invitation.ts`, `leads/index.ts`) are pre-existing and untouched.

---

## 8. Proof that no alternate reply/send path was introduced

| Claim | Evidence |
|---|---|
| the legacy chain cannot be invoked | the module is gone; typecheck 3/3 clean; recursive source walk finds zero references |
| no replacement service exists | directory assertion over `backend/services` for `autoreply`/`auto_reply`/`autoResponder` |
| the old service was not kept alive with a tenant parameter | it was deleted, not modified — §5 of the brief forbade that, and no `organizationId` was added |
| no new conversation model | no table, no migration, no service added in this gate |
| no Common Outreach change | `feedbackIngestion.ts c46ed8f4a7a83a70`, `dispatch.ts 4cee6514d36c371e`, `governance.ts 5982e2eb5a1f4199` — all unchanged |
| no Email Engine / Workflow / provider-event change | `emailSendPath`, `workflowStore 27c53b4f55984059`, `providerMessageResolver d72150b87c0dbc72` unchanged |
| G-22 / G-23 / G-24 untouched | no change to `discoverTenantForProviderMessage`, nor to either migration (`c3c5930edcd14a0a`, `ceae2ad8a984295c`) |

**Mutation probe for the deletion itself (P16).** Restoring the file to disk makes
**3 tests fail** (existence, the reference walk, and the residual-set assertion);
re-deleting restores 55/55. A negative assertion only proves something if it would fail
while the thing existed, and this one does.

**The fifteen earlier probes were re-run against post-deletion source: all fifteen
behave, every file restored byte-identically.** P1–P14 against the ENG-004 suite, P15
against the ownership suite.

---

## 9. Production status

**PRODUCTION UNTOUCHED.** No deploy, no push, no PR, no production database or
configuration change, no SES/SNS/DNS change, **no Docker daemon started**, no
`omnivyra-worker`, and no production access of any kind — including none to verify the
deletion. Repository-only, nothing committed; HEAD remains `7febdb28`.

---

## 10. IMPLEMENTED

Removal of `backend/services/autoReplyService.ts` (the sole G-19-owned file) · inversion
of the ENG-004 assertions from "exists and orphaned" to a four-part retirement proof
(absence, no references, no replacement, positive control on shared collaborators) ·
residual-unscoped set reduced from three files to two.

## 11. VERIFIED

492/492 across 21 suites · typecheck 3/3 clean (the real module-resolution proof) ·
route-auth PASS 1350/1350 · zero references to either retired symbol outside the ENG-004
suite · 16 mutation probes behaving, all files restored byte-identically · shared
collaborators hash-verified unchanged.

## 12. BLOCKED

Nothing in this gate. ENG-004's runtime verification remains blocked on the isolated
PostgreSQL environment — a separate authorized action, deliberately not attempted here.

## 13. DEFERRED

Any future auto-reply capability, which belongs to the authorized inbound and Engagement
Intelligence gates and must arrive through Common Outreach · ENG-005 inbound email ·
`Reject → failed` vocabulary · unsubscribe→suppression · lifecycle producers · reply
sentiment · WhatsApp convergence · every intelligence layer · tenant-owned sender
identity.

## 14. UNVERIFIED

Whether `docs/CONVERSATION-MEMORY-IMPLEMENTATION.md` and
`docs/OMNIVYRA-RESPONSE-ENGINE-INTEGRATION-AUDIT.md` describe behaviour that is still
current — they reference `orchestrateResponse`, which survives, so nothing they say was
invalidated by this deletion; I did not audit them further, and documentation was out of
scope. No runtime behaviour was verified in this gate, because nothing runtime-reachable
changed.

---

## 15. Remaining ENG-004 closure items

**ENG-004 is NOT CLOSED, and this gate does not close it.**

| §13 criterion | Status |
|---|---|
| isolation-sensitive reads hardened or explicitly accepted | **MET** — all reachable; two residual files classified and test-pinned |
| **G-19 cannot become an alternate reply/send path** | **MET** — the module is gone, with a probe proving the assertion is not vacuous (was PARTIALLY MET) |
| G-23 explicit architectural disposition | **MET** |
| G-24 explicit data disposition | **MET** — migration aborts, never guesses |
| migration runtime-verified in isolated PostgreSQL | **NOT MET** |
| composite tenant FKs runtime-proven | **NOT MET** |
| tenant trigger runtime-proven | **NOT MET** |
| mutation probes pass | **MET** — 16/16 |
| production untouched | **MET** |
| G-22 explicitly tracked | **MET** — still **OWNER DECISION REQUIRED**, unratified, unchanged |

**Next authorized action: stand up the isolated non-production PostgreSQL environment**,
then run the ENG-004 runtime verification — both migrations, `organization_id NOT NULL`,
the thread composite FK, the **parent** composite FK (the critical inbound boundary), the
tenant trigger, cross-tenant insert rejection, cross-tenant parent rejection, explicit
wrong-tenant rejection, `ON DELETE SET NULL (parent_message_id)` behaviour, and the
migration's abort paths.

**ENG-005 — INBOUND EMAIL remains unauthorized.**
