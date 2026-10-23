# ENG-004-CLOSURE REPORT — ENGAGEMENT TENANT HARDENING

**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`.
**Owner decisions taken during this gate:** isolated environment first (no Docker) ·
G-22 left unratified · G-19 recommend retirement, report only.

---

## Status: ENG-004 is NOT CLOSED

**All source-level closure work is complete. Closure fails on exactly one criterion:
the migrations have never been executed.** You chose to stand up the isolated
environment first rather than open a Docker window, so §13's requirement that "the
migration has been runtime-verified in isolated PostgreSQL" is unmet by decision, not by
omission. ENG-005 stays gated.

What is now true:

| | |
|---|---|
| isolation-sensitive reads hardened | **all reachable ones** — 25 of 85 sites now carry a tenant predicate, up from 2 |
| residual unscoped | exactly **3 files**, each classified and pinned by a test |
| G-19 | **CHARACTERIZED → RETIRE recommended**; untouched |
| G-23 | **FIXED** by migration `20261118000000` |
| G-24 | **data disposition explicit**: migration aborts; counts UNVERIFIED |
| G-22 | **OWNER DECISION REQUIRED** (your decision, recorded) |
| tests | 52 in the ENG-004 suite; **489/489 across 21 suites** |
| probes | **15, all behaving, all restored byte-identically** |
| gates | typecheck 3/3 · route-auth PASS 1350/1350 |
| production | **UNTOUCHED** — no Docker daemon started, no production read |

**The most important thing in this report is not the hardening.** It is §4: making one
lookup tenant-scoped exposed a latent authorization bypass in
`pages/api/engagement/generate-response.ts`, where an unresolvable signal **skipped** the
tenant check and answered 200. That guard had been load-bearing on an accident. It is
fixed, and probe P15 holds it.

---

## 1. The 18 reads, re-opened and classified

The ENG-004 inventory found 85 access sites and 27 on the isolation surface. Re-opening
the 18 I had left, plus three more the tightened scan surfaced, gives this:

### HARDEN NOW — done (21 sites across 19 files)

| Site | Tenant source | Why it needed it |
|---|---|---|
| `engagement/like.ts` | `organizationId` (session) | `messageId` from the request body |
| `engagement/message/mark-self.ts` read | `organizationId` | body-supplied id |
| **`engagement/message/mark-self.ts` UPDATE** | `organizationId` | **cross-tenant WRITE** — see below |
| **`engagement/backfill-self-signals.ts` UPDATE** | `organizationId`, validated by `enforceCompanyAccess` | **cross-tenant WRITE** |
| `engagement/message/bulk-like.ts` ×3 | `organizationId` | body-supplied id lists |
| `engagement/reply.ts` signal read | `organizationId` (param of `resolveSignal`) | signal → message id |
| `engagement/reply.ts` target read | `organizationId` | body-supplied id |
| `engagement/suggestions.ts` | `organizationId` | body-supplied id |
| `response/generate.ts` | `organizationId` | body-supplied id |
| `engagement/thread/bulk-pattern-reply.ts` | `organizationId` | body-supplied id |
| `engagement/inbox.ts` | `organizationId` | internally derived ids, scoped anyway |
| `engagement/generate-response.ts` | `company_id` — **signature change** | signal → message id |
| `leadDetectionService.ts` ×2 | `input.organization_id` | already in the contract |
| `responseOrchestrator.ts` | `input.organization_id` | already in the contract |
| `insightIntelligenceService.ts` | `organizationId` (param) | already in the contract |
| `engagementConversationIntelligenceService.ts` | **new required param** | had no tenant at all |
| `responseStrategyLearningWorker.ts` | `orgIds` (batch-bounded) | cross-tenant worker |
| `engagementAiAssistantService.ts` self-sweep | `organization_id` | missed by the first inventory |

**Two cross-tenant WRITE holes, which matter more than any read.**
`mark-self.ts:81` and `backfill-self-signals.ts:222` both did
`.update({...}).eq('id', messageId)` with **no tenant predicate**. A caller authorized for
tenant A could rewrite tenant B's message `direction` and `raw_payload`. The ENG-004
trigger does **not** catch this: it fires only `BEFORE INSERT OR UPDATE OF thread_id,
organization_id`, and neither column is touched by those updates. Both now carry
`.eq('organization_id', organizationId)`; probes P11 and P12 hold them.

**Two signature changes**, each with one call site, both verified by typecheck:
`analyzeMessage(message_id)` → `analyzeMessage(message_id, organization_id)` (caller
passes `context.organization_id`), and `resolveThreadIdFromSignal(signalId)` →
`(signalId, organizationId)`. `analyzeMessage` **fails closed** when the tenant is absent
rather than falling back to an unscoped read — a skipped analytics pass is recoverable, a
cross-tenant read is not.

### The residual three files

| Site | Classification | Why |
|---|---|---|
| `autoReplyService.ts` ×2 | **ORPHANED** | zero callers, zero tests; neither entry point accepts a tenant, so it cannot be scoped without a signature change (G-19) |
| `engagementNormalizationService.ts:431` | **SAFE TRANSITIVELY** | `(thread_id, platform_message_id)` — thread-scoped, and now structurally tenant-safe via the composite FK. A recovery read for a row just written to a known thread |
| `scripts/operator/db/backfill_lead_signals.ts:95` | **PLATFORM-GLOBAL** | operator backfill script, cross-tenant by design |

A test scans all 22 engagement-message files and asserts the unscoped identity-touching
set is **exactly these three** — non-empty first, so a broken scanner fails rather than
declaring victory. A fourth appearing is a test failure.

**Nothing was replaced by an application-only check**, and no tenant is inferred from
request or provider data: every predicate's value is a session org, a validated route
org, or a contract parameter. Typecheck proving 3/3 clean is what shows each identifier
genuinely resolves in its scope rather than merely appearing nearby.

---

## 2. G-19 — autoReplyService

**Status: ORPHANED · NON-COMPLIANT · RETIRE RECOMMENDED. Untouched, per your decision.**

| | |
|---|---|
| current product requirement | **None found.** Zero importers in `backend`, `pages`, `lib`; zero tests; no route, worker or scheduler reaches it |
| can it send | **Yes** — `attemptAutoReply → orchestrateResponse → executeAction`, whose runtime imports `getToken` (platform tokens), `executeRpaTask` (RPA worker) and `sendCommunityAiWebhooks` |
| Common Outreach | **bypassed** — `communityAiActionExecutorRuntime` references `leadOutreachExecution`, Common Outreach and `mayContact` **zero** times |
| tenant | **derived from the caller-supplied `threadId`**, never from an authorized context |

**Recommendation: RETIRE / REMOVE**, which is also your brief's stated preference where
no product dependency exists. I did not delete it — you chose report-only.

For the record, the minimum refactor **if** a requirement later appears: an authoritative
`organizationId` parameter on both entry points; dispatch through Common Outreach so the
frozen gate order applies; no direct transport; and no second reply/conversation model.
That is a separate authorized change.

**It must not be given a caller before that happens** — and inbound email is exactly what
would give it one.

---

## 3. G-23 — platform message identity

**FIXED.** Migration `20261118000000_eng004_close_platform_message_tenant_scope.sql`.

Characterization first:

- **Nothing relies on the global index for deduplication.** All five upserts conflict on
  the **thread-scoped** index: `whatsappWebhookProcessor:148`, `bulkEngagementService:306`,
  `engagementNormalizationService:423`, `engagementOutboundMirrorService:174`,
  `engagement/reply.ts:913` — every one `onConflict: 'thread_id,platform_message_id'`.
- **It was created without a stated rationale**, in `20260604_engagement_sync_integrity.sql`,
  alongside a batch of scraped-sync columns. Read single-tenant it is sensible; read
  multi-tenant it is wrong.
- **The harm is concrete, not theoretical.** Two tenants can monitor the same public
  LinkedIn post. Both scrape the same comment. The first ingests; the second fails with
  23505 on an index it cannot see — one tenant's data denying another's ingestion, with
  an error that discloses existence.
- **Duplicates under the new definition are impossible.** The replacement key is a
  **superset**: any pair unique across all tenants is necessarily unique within one.
  Widening a unique key cannot fail on data that satisfied the narrower one, so there is
  no audit to perform and no abort path needed. (Narrowing would require one; this is not
  that.)

The migration creates `UNIQUE (organization_id, platform, platform_message_id)`
**before** dropping the global index, so no window exists in which neither protects the
table; refuses to run if `organization_id` is absent; leaves the thread-scoped unique
alone; and drops the now-redundant non-unique partial index ENG-004 had added over the
same columns. Probe P14 inverts the create/drop order and the suite fails.

**Global uniqueness is never a tenant-isolation mechanism.** That is now true in the
schema, not just in a report.

---

## 4. The authorization bypass this gate exposed

Not in the brief, and the most consequential finding here.

`pages/api/engagement/generate-response.ts` resolves a thread either from a client
`thread_id` or from a `signal_id`, then applies the F5-P1.1 tenant check **inside**
`if (resolvedThreadId) { … }`. Making the signal's message lookup tenant-scoped meant a
foreign signal now legitimately resolves to **nothing** — and with `resolvedThreadId`
null, the check was skipped entirely and the handler answered **200**.

The existing security test caught it immediately: "the signal-resolved path is authorized
too" went from 403 to 200. No draft was created, so nothing leaked — but the guard had
only ever worked because the unscoped resolution almost always succeeded. It was
load-bearing on an accident.

Fixed by failing closed: if the signal path was taken and resolution produced nothing,
return 403. That applies the guard's own written principle — "a thread we cannot resolve
is a thread we cannot prove the caller owns." Probe **P15** disables the branch and the
ownership suite fails.

Both original expectations now hold for better reasons: the rival-tenant signal is
refused because the tenant-scoped lookup cannot see it, and the owned signal still
creates its draft.

---

## 5. G-24 — NULL-tenant threads

**Data disposition: explicit. Counts: UNVERIFIED.**

| Question | Answer |
|---|---|
| how many exist | **UNVERIFIED.** Production may not be read; the non-production project `lomndxmrpyudaegddpef` holds **zero** `engagement_threads` and **zero** `engagement_messages`, so it cannot tell us anything |
| legacy/system rows? | **UNVERIFIED** — no data to inspect |
| do they have messages? | **UNVERIFIED** |
| reachable? | **UNVERIFIED** |
| assignable from authoritative evidence? | **No evidence source exists.** Nothing in the repo reassigns `engagement_threads.organization_id` — the only org-reassigning update is on `free_credit_profiles` |
| must they be quarantined? | Effectively yes, until someone looks |
| should the migration fail closed? | **Yes, and it does** |

The migration counts orphans, untenanted rows and mismatches, and **aborts with exact
counts plus the first 20 offending ids** rather than inventing ownership. It contains no
`DELETE` and no `DROP TABLE`. If any thread has a NULL tenant, it will refuse to apply —
by design, and that refusal is the answer, not a failure.

I did not use production as a substitute for the counts.

---

## 6. Required answers

1. **Are all 27 isolation-sensitive reads now hardened?** **No — all *reachable* ones
   are.** 25 of 85 sites carry a tenant predicate (from 2). Three files remain, each
   classified: `autoReplyService` (orphaned, no tenant parameter exists),
   `engagementNormalizationService:431` (thread-scoped, safe transitively),
   `backfill_lead_signals` (platform-global operator script).
2. **If not, why not?** Because scoping them would require either a signature change to
   orphaned code you have decided to retire, or tenant inference where none is available —
   and both are worse than the classification. A test pins the set at exactly three.
3. **Is G-19 retired or formally refactor-required?** **Neither yet: RETIRE
   RECOMMENDED**, no product dependency found, untouched per your decision. Retirement is
   its own authorized change and should land before ENG-005.
4. **Is G-23 fixed or owner-deferred?** **FIXED** — migration `20261118000000`,
   tenant-scoped unique, provably safe on existing data.
5. **Authoritative status of NULL-tenant threads?** **UNVERIFIED counts, explicit
   disposition**: the migration aborts rather than guessing. No production read.
6. **Has the migration actually executed?** **No.** Neither migration has run anywhere.
7. **Have the composite FKs been runtime-tested?** **No.**
8. **Has the trigger been runtime-tested?** **No.**
9. **Is ENG-004 now closed?** **No** — on item 6/7/8 only, by your decision to stand up
   the isolated environment first.

---

## 7. Database behaviour still to prove

Per §6 of the brief, these must be real PostgreSQL tests. **None has been run.** The
suite that will run them does not exist yet because the environment does not.

`organization_id NOT NULL` · `message.org = thread.org` · cross-tenant thread attachment
rejected · **cross-tenant parent attachment rejected** (the critical inbound boundary) ·
explicit wrong `organization_id` rejected · missing `organization_id` derived from the
thread · parent deletion sets **only** `parent_message_id` null and `organization_id`
stays non-null · thread deletion retains CASCADE · no cross-tenant update possible · plus
the migration's own abort paths (orphan, untenanted, mismatch detection).

Why not run: Docker Desktop is the only route to a PostgreSQL on this machine — no
native `psql`/`pg_ctl`/`postgres`, no non-Docker WSL distro, no embedded Postgres in
`node_modules` — and starting the daemon auto-starts `omnivyra-worker`, which points at
the managed production host and was observed running production crons on 2026-09-11.
**You chose to stand up the isolated environment first.** No daemon was started.

---

## 8. Mutation probes

Fifteen. Each asserts its anchor matches exactly once before writing, restores in a
`finally`, and is re-hashed afterwards.

| # | Injection | Result | Restored |
|---|---|---|---|
| P1 | direct-id lookup loses tenant | 2 failed | ✓ |
| P2 | parent lookup loses tenant | 3 failed | ✓ |
| P3 | scraped platform-id parent loses tenant | 2 failed | ✓ |
| P4 | thread composite FK removed | 1 failed | ✓ |
| P5 | extension update loses tenant | 2 failed | ✓ |
| P6 | tenant read from the request body | 1 failed | ✓ |
| P7 | trigger corrects instead of raising | 1 failed | ✓ |
| P8 | parent FK loses its `SET NULL` column list | 1 failed | ✓ |
| P9 | bulk `sendReply` loses tenant | 2 failed | ✓ |
| P10 | worker parent sweep loses its tenant bound | 2 failed | ✓ |
| **P11** | **mark-self UPDATE loses tenant** | 2 failed | ✓ |
| **P12** | **backfill UPDATE loses tenant** | 2 failed | ✓ |
| **P13** | **`analyzeMessage` drops its required tenant** | 2 failed | ✓ |
| **P14** | **G-23 drops the global index before creating its replacement** | 1 failed | ✓ |
| **P15** | **signal path stops failing closed** | 1 failed | ✓ |

Every file returned to its baseline hash. **No zero-byte mutation was counted** — the
runner raises instead.

P4, P7, P8 and P14 remain **source-level**: they prove the migrations *say* the right
thing. Proving the FKs and trigger *behave* needs §7's environment. Labelled, not counted
as equivalent.

---

## 9. Tests run

**21 suites, 489 tests, 489 passed, 0 failed.** The ENG-004 suite grew from 26 to **52**.

`eng004EngagementMessageTenant`, `eng003SesProviderEvents`,
`engagementBulkDispatchAcceptance`, `engagementAiActionabilityF5`,
`engagementAiSendBoundaryF5`, `engagementAiDiversityF6`, `engagementBulkDmClosureP11`,
`engagementBulkGovernanceP12`, `engagementUnifiedSec001`, `sec91AEngagementReplyDraft`,
`engagementWorkQueueOwnership`, `engagementDispatchRecoveryP1`, `piWs5ProspectEngagement`,
`engagementActionabilityPaginationF1F2`, `engagementDraftOwnershipP11`,
`engagementRawThreadRouteF7`, `engagementQueueRules`, `engagementCapabilityMap`,
`engagementMultiAccountD4`, `engagementPlatformCountsD2`, `ws3Milestone7Feedback`.

**Typecheck 3/3 clean. Route-auth PASS 1350/1350.** Whole-repo jest not run (not
authorized). T2 not run (§7).

**Three further fixture updates**, on top of ENG-004's five:
`engagementAiSendBoundaryF5`, `engagementDraftOwnershipP11`, `sec91AEngagementReplyDraft`
seeded threads with a tenant but messages without one. Each message now carries the org
of **its own** thread — which is what makes the cross-tenant case in
`engagementDraftOwnershipP11` a genuine refusal rather than a missing fixture. No
assertion was weakened; the rival-tenant case still expects 403 and still gets it.

**Pre-existing failures preserved:** `ws3Milestone5aInternalDispatch` and
`ws3Milestone5bExternalDispatch` (38 tests) remain failing, untouched, not attributed
here, not opportunistically fixed.

---

## 10. Status by category

### IMPLEMENTED
21 additional tenant predicates across 19 files · two cross-tenant UPDATE holes closed ·
two signature changes with fail-closed behaviour · the `generate-response` signal-path
fail-closed fix · G-23 tenant-scoped platform message identity (migration
`20261118000000`) · 26 further tests (52 total) · 5 further probes (15 total).

### VERIFIED
**Source/T1 only:** 489/489 across 21 suites · typecheck 3/3 · route-auth PASS ·
15 probes behaving with byte-identical restores · the residual-unscoped set pinned at
exactly three files · the counterfactual asserted (no predicate ⇒ the other tenant's row
is returned).

### BLOCKED
Runtime verification of both migrations, both composite FKs, the trigger, and all §7
behaviours — awaiting the isolated environment, by your decision.

### OWNER DECISION REQUIRED
**G-22** — ENG-003's interim `discoverTenantForProviderMessage` remains unratified and
explicitly tracked, unchanged, per your decision. It still satisfies every constraint the
brief lists (fails on zero matches, fails on multiple tenants, never infers from
recipient/sender/payload), and is still to be replaced by authoritative sender identity
mapping once tenant-owned senders exist.
**G-19 retirement** — recommended, awaiting authorization.

### DEFERRED
Inbound email and all of ENG-005 · `Reject → failed` vocabulary (ENG-003 decision
unchanged, `ingestFeedback` untouched) · unsubscribe→suppression · lifecycle producers ·
reply sentiment · WhatsApp convergence · every intelligence layer · tenant-owned sender
identity.

### UNVERIFIED
Whether either migration applies · real orphan/untenanted/mismatch counts · whether any
production thread has a NULL tenant · runtime behaviour of the FKs and trigger ·
`ON DELETE SET NULL (parent_message_id)` on this engine · whether
`(platform, platform_message_id)` holds cross-tenant duplicates today (immaterial: the
new key is a superset) · whether the three residual sites are reachable without a prior
route-level tenant check.

---

## 11. Closure criteria

| §13 criterion | Status |
|---|---|
| required isolation-sensitive reads hardened or explicitly accepted | **MET** — all reachable; three classified and test-pinned |
| G-19 cannot become an alternate reply/send path | **PARTIALLY MET** — it is orphaned and recommended for retirement, but the module and its send path still exist |
| G-23 has an explicit architectural disposition | **MET** — fixed |
| G-24 has an explicit data disposition | **MET** — abort, never guess |
| migration runtime-verified in isolated PostgreSQL | **NOT MET** |
| composite tenant FKs runtime-proven | **NOT MET** |
| tenant trigger runtime-proven | **NOT MET** |
| mutation probes pass | **MET** — 15/15 |
| production untouched | **MET** |
| G-22 explicitly tracked | **MET** |

**ENG-004: NOT CLOSED. ENG-005 — INBOUND EMAIL is NOT authorized.**

Three things remain, in order:
1. **Stand up the isolated non-production PostgreSQL** (W2), then run §7 in full.
2. **Authorize G-19 retirement** — removing the module closes that criterion outright.
3. **Resolve G-22** if you want it ratified rather than tracked.

---

**Production status: PRODUCTION UNTOUCHED.** No Docker daemon started, no migration
applied anywhere, no production read, no deployment, no SES/SNS/DNS change, no flag
change.
