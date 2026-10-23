# CA-003-P0-TENANT-OWNERSHIP-REMEDIATION-PLAN-001 — decision-ready remediation plan

**Mode: DECISION PREPARATION ONLY.** No explicit owner authorization to implement the CA-003 P0 fix was found (§1). No source code, test, migration, schema, grant, configuration, feature flag or deployment setting was changed. No Docker, database, service, production or network activity. No commit, stage, stash, branch, PR, merge, push or deployment. No secret values were read. `C:\virality` was not touched.

The filename deliberately says **PLAN**, not "REMEDIATION-AND-VERIFICATION", because nothing has been remediated or verified. That suggested name is reserved for the evidence artifact of an authorized implementation.

Decision references follow the qualified scheme in `PI-C1-LIFECYCLE-ORDERING-REVISED-DESIGN-REVIEW-002` §3 (RDR-002) and `PI-C1-REMAINING-ISSUE-CLOSURE-ASSESSMENT-003` (CA-003). New items here are prefixed **`P0P-001`**.

---

## 1. Scope and authorization evidence

| Item | Finding |
|---|---|
| Explicit owner authorization to implement the isolated P0 fix | **ABSENT.** The governing request states that it begins in decision-preparation mode and must not be read as authorization. No other message in the record authorizes implementation. CA-003 P0-Q1 ("standalone security fix?") is **PENDING OWNER DECISION** |
| Governed-work entry (`CLAUDE.md`) | **ABSENT.** No OMNI Story, no `gov start`/`gov attach`, no Authorized Paths. Any implementation must enter the governed path |
| Consequence | Read-only inspection and planning only. **Stopped before Phase D.** Phases F/G tests are designed, not run |

### 1.1 Authorization required to proceed (exact)

A written owner statement equivalent to:

> "Authorize implementation of CA-003 P0 application-level tenant-ownership remediation, OMNI-<n>, on branch <name> from base <ref>, limited to the Authorized Paths in P0P-001 §5.4. Run the unit/route test suite with the in-memory harness. **Excluded:** database changes, data cleanup, production access, grant changes, commit/merge/deploy."

Plus the separate decisions in §11 (P0P-001 Q-1…Q-8). A disposable-database reproduction (§8.2) needs **its own** authorization to start Docker.

---

## 2. Repository baseline (recorded 2026-10-19, read-only)

| Item | Value |
|---|---|
| Worktree / branch | `C:/tmp/r1-ctx` (a git worktree; `.git` is a file) / `fix/r1-profile-context` |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` |
| `main` | `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2` |
| Status before | **167 entries: 72 ` M`, 95 `??`, 0 staged, 0 deleted, 0 renamed** |
| Status after | **168 entries: 72 ` M`, 96 `??`, 0 staged.** Sole addition: this file |
| Other agents / processes | **Cannot be excluded.** `git worktree list` shows >100 worktrees of this repository (including `C:/virality` itself and `C:/tmp/wt-gate` on `main`). No `index.lock` in this worktree. Concurrent editing of these specific files elsewhere is **UNKNOWN** |

**Hashes verified:**

| Artifact | SHA-256 |
|---|---|
| CA-003 | `c6d25d85bd9ed29357992caccbfa1a303d0903669af207d1edadd50e4822312a` (**MATCH** with the hash supplied in the request) |
| PROP-001 | `9e3e570c267b403562a3077ff9793c4b73f3bed930a5b877c515c154e88a6d10` |
| OR-001 | `b06bf982f9350307b001f304168d267964b4fac87275ca222271de611120812c` |
| RDR-002 | `117526a9694dd6ef12d387a6c8a5003e55482f4cddc300bf48d3f4a782f11e5f` |

### 2.1 Committed vs working tree for the files in scope

| File | HEAD vs WT | `main` vs HEAD | Implication |
|---|---|---|---|
| `pages/api/active-leads/lifecycle.ts` | **WT modified** (+23: Phase-1 409 mapping) | identical | **conflict for isolation** (§2.2) |
| `backend/services/opportunityLifecycleService.ts` | **WT modified** (+139/−2: Phase-1 reader) | identical | **conflict for isolation** |
| `pages/api/active-leads/workflow.ts` | unmodified | identical | clean |
| `pages/api/active-leads/escalations.ts` | unmodified | identical | clean |
| `backend/services/opportunityWorkflowService.ts` | unmodified | identical | clean |
| `backend/services/escalationService.ts` | unmodified | identical | clean |
| `backend/services/campaignOwnershipService.ts` (ROUTE-AUTH-001) | unmodified | **absent on `main`** (commit `2626eae7`, branch only) | the precedent is not on `main` |
| `backend/tests/helpers/routeAuthHarness.ts` | unmodified, committed | (not compared) | usable test seam |

### 2.2 Isolation conflict (reported, not resolved)

Two of the files that must change already carry **uncommitted PI-C1 Phase-1 work** in this worktree. Editing them here would entangle the P0 fix with unapproved, uncommitted PI-C1 changes, and no commit could isolate one from the other without staging partial hunks of someone else's work. **Under §3 of the request, implementation must not proceed in this worktree.**

Candidate resolution (owner decision `P0P-001 Q-2`): a **new governed worktree** created by `gov start` from a committed base:
- **`main`**: the deploy/PR target. The fix then carries its own ownership helper, since ROUTE-AUTH-001 is absent there.
- or **HEAD `29fea38a`**: includes the precedent, but carries this branch's unmerged commits.

Either way the lifecycle fix is written against the **committed** lifecycle code. At HEAD/`main` that code still defaults missing history to `'detected'` (CA-003 §4).

---

## 3. Confirmed defect: exact references (re-established)

The invariant is violated identically on all six paths: **the route authorizes `companyId` (membership + role) and then writes a row pairing that `companyId` with a body-supplied `opportunityId` it never checked.** References are HEAD unless marked WT.

| # | Route → service | Lines |
|---|---|---|
| 1 | `pages/api/active-leads/lifecycle.ts` POST → `transitionLifecycle` | body parse HEAD `:51-56`; authz `:57-62`; call `:65-71`; service HEAD `opportunityLifecycleService.ts:127-158` (`?? 'detected'` at `:132`, insert `:139-150`) |
| 2 | `workflow.ts` POST `kind=assignment` → `assignOpportunity` | route `:80-117`; service `opportunityWorkflowService.ts:25-50` (**also an UPDATE** closing prior assignments for `(companyId, opportunityId, role)` at `:32-37`) |
| 3 | `workflow.ts` POST `kind=note` → `addOpportunityNote` | route `:118-127`; service `:99-121` |
| 4 | `workflow.ts` POST `kind=tag` → `addOpportunityTag` | route `:128-135`; service `:145-176` |
| 5 | `workflow.ts` POST `kind=disposition` → `setOpportunityDisposition` | route `:136-146`; service `:214-235` |
| 6 | `escalations.ts` POST → `createEscalation` | route `:56-98` (`opportunityId` optional; `null` allowed); service `escalationService.ts:46-84` |

**Shared facts, all paths:**
- **Authentication:** `enforceCompanyAccess` → `resolveUserContext` (Supabase identity), 401 if unauthenticated (`userContextService.ts:169-231`).
- **Tenant authorization:** `assertTenantAccess({ userId, organizationId: companyId })` (`:241-254`), with the content-architect and invited-admin fallbacks (`:286+`).
- **Role:** `getUserRole` + `MANAGE_LISTENING_CAPABILITIES`, which is `COMPANY_ADMIN` and `SUPER_ADMIN` (`communityAiCapabilities.ts:20`).
- **Database:** all writes use the service-role-class key, so RLS is not a control (CA-003 §3.2).
- **Schema:** single-column FK `opportunity_feed_item_id → opportunity_feed_items(id) ON DELETE CASCADE` on all six child tables (`baseline.sql:52158, 52046, 52182, 52206, 52062, 50336`), so a mismatched pair is accepted.

**Status, unchanged from CA-003:**
- Confirmed source defect: **YES**.
- Plausible exploit path: **YES, not reproduced**.
- Demonstrated exploitability: **NO**.
- Deployment exposure: **UNKNOWN**.

---

## 4. Phase A: six-path scope matrix

| # | Route / entry | Service method | Opportunity-ID source | Existing tenant authorization | Ownership check | Proposed correction | Regression test | Additional risk / dependency |
|---|---|---|---|---|---|---|---|---|
| 1 | `POST /api/active-leads/lifecycle` | `transitionLifecycle` | `req.body.opportunityId` | membership + `MANAGE_LISTENING_CAPABILITIES` in `body.companyId` | **ABSENT** (WT refuses only incidentally, via `missing` history) | route: `requireOwnedOpportunity` → 404; service: same assertion before the read | P0T-1…10 ×path 1 | **append-only target.** Planted rows are permanent and inferred to block B's deletion. File has **uncommitted Phase-1 edits** (§2.2). 500 echoes `err.message` |
| 2 | `POST /api/active-leads/workflow` `kind=assignment` | `assignOpportunity` | `req.body.opportunityId` | same | **ABSENT** | route + service assertion **before the UPDATE and the INSERT** | ×path 2 | **`assignedToUserId` from body, not validated as a member of `companyId`** (§4.2). Also emits `trackEvent('lead.assigned', entityId=opportunityId)` |
| 3 | same, `kind=note` | `addOpportunityNote` | body | same | **ABSENT** | same | ×path 3 | 500 echoes `err.message` (`note_insert_failed:<db text>`) |
| 4 | same, `kind=tag` | `addOpportunityTag` | body | same | **ABSENT** | same | ×path 4 | the `23505` re-read is org-filtered, so no leak |
| 5 | same, `kind=disposition` | `setOpportunityDisposition` | body | same | **ABSENT** | same | ×path 5 | — |
| 6 | `POST /api/active-leads/escalations` | `createEscalation` | `req.body.opportunityId` (**optional**) | same | **ABSENT** | assert only when non-null; `null` stays allowed | ×path 6 (incl. a `null` case) | **`assignedToUserId` from body, unvalidated** (§4.2) |

Answers to the Phase-A questions, identical for all six unless noted:

| Question | Answer |
|---|---|
| Authentication required? | **Yes** (401 otherwise) |
| Membership and role checked against the right tenant? | **Yes**, against `body.companyId`, which is caller-supplied but **authorized** |
| Opportunity ID untrusted? | **Yes**, from the body |
| Opportunity's tenant checked? | **No** |
| Same tenant identity as the authorization? | n/a today; the fix must use the **authorized** `companyId` value returned through `enforceCompanyAccess`, not a second body field |
| Bypass via alternate caller? | **Yes, today.** The service functions are exported and take any `organizationId`/`opportunityFeedItemId`. In-repo callers found: these routes only (the pipeline calls `initialiseLifecycleForOpportunity`, which is out of scope, §6.3) |
| Other tenant-associated ids written? | **Yes**: `assignedToUserId` (paths 2 and 6). `actorUserId`/`requestedBy`/`createdBy` come from the authenticated context, which is fine |
| Discloses foreign existence? | **Lifecycle at HEAD:** nonexistent → FK error → 500 with DB text; foreign → 200. **Workflow/escalation:** same pattern (FK 23503 text in the 500 body vs 200). **WT lifecycle:** identical 409 for both |
| Append-only / irreversible? | **Path 1 only** (append-only lifecycle). Paths 2–6 are ordinary tables. Telemetry `trackEvent` is described in code as "append-only, fail-soft" (`workflow.ts:110-112`), so a foreign `entityId` in telemetry would persist |

### 4.1 ROUTE-AUTH-001 applicability

`campaignOwnershipService.checkCampaignOwnership` is **structurally reusable but semantically wrong for this case**:
- **Reusable:** the read carries the company predicate, so it can only confirm ownership and never disclose. It has the `owned | foreign | not_found | lookup_error` outcomes, and `lookup_error` → 503 fail-closed.
- **Wrong:** it treats **`not_found` as allowed** ("a campaign that does not exist yet is allowed, because creation flows authorize the id of the campaign they are about to create"). Every opportunity write here references an **existing** opportunity, so `not_found` **must deny**.
- It is also **absent on `main`**.

**Do not reuse it directly.** Mirror its shape in a new opportunity-specific helper with deny-on-not-found.

### 4.2 Additional risks found (outside the six-path invariant, reported for decision)

| ID | Risk | Evidence | Proposed handling |
|---|---|---|---|
| **AR-1** | `assignedToUserId` (assignment, escalation) is not verified as an active member of `companyId`. A user of another tenant can be named as assignee; the only constraint is `users(id)` FK | `workflow.ts:99-108`; `escalations.ts:80`; `escalationService.ts:73` | owner decision `P0P-001 Q-4`: include a membership check in this fix, or a separate item |
| **AR-2** | 500 responses echo raw `err.message`, including DB/constraint text, on all three routes | `lifecycle.ts:89`/WT `:121`; `workflow.ts:171`; `escalations.ts:96` | include in this fix: generic body plus a server-side log |
| **AR-3** | Telemetry and realtime side effects run after a successful write, so they are absent on denial, but a foreign `entityId` already in telemetry would be permanent | `workflow.ts:110-117, 151-166` | covered by early denial; existing telemetry rows are out of scope (§9) |
| **AR-4** | `escalations.ts` PATCH (`assignEscalation`) takes `assignedToUserId` from the body | `escalations.ts:104-131` | same as AR-1 |

### 4.3 Bounded search for other opportunity-ID write paths

- **Writers of `opportunity_feed_item_id` outside tests:** only the six paths above, plus internal pipeline writers (`listeningSignalPipeline.ts:307, 325, 358`; `opportunityFeedService.ts:550`), which use ids from the pipeline's own writes.
- **Other routes taking an `opportunityId`:**

  | Route | Table it touches |
  |---|---|
  | `campaigns/planner/apply-opportunity.ts`, `ignore-opportunity.ts` | `opportunity_radar` |
  | `engagement/opportunity/resolve.ts` | `engagement_opportunities` |
  | `market-pulse/findings/[id]/promote.ts` | `opportunity_items` |
  | `outreach-plans/index.ts` | `opportunity_items` |
  | `collaboration-plans/index.ts` | `opportunity_items` |
  | `bolt/execute.ts` | `bolt_execution_runs` |
  | `campaigns/create-from-opportunity.ts`, `campaigns/proposals/*`, `engagement/content-opportunities/index.ts` | other entities |

  **None of these was reviewed for ownership binding.**
- **Review status: BOUNDED.** The full application surface (cron, workers, Edge Functions, scripts) was not established. **Implementation scope is not expanded** to the routes above without authorization (`CA-003 P0-Q4`).

---

## 5. Phase B/C: invariant, helper contract and disclosure rules

### 5.1 Invariant

**A write affecting opportunity O may proceed only when `opportunity_feed_items` holds a row with `id = O` and `organization_id = T`, where T is the company that `enforceCompanyAccess` has just authorized for the authenticated principal, and the caller holds the required role in T.**

### 5.2 Proposed helper contract (one new module; no code written)

`backend/services/opportunityOwnershipService.ts` (proposed name):

```
checkOpportunityOwnership(opportunityId: string, companyId: string)
  -> 'owned' | 'not_owned' | 'lookup_error'
  - invalid/blank inputs                         -> 'not_owned'
  - SELECT id FROM opportunity_feed_items
      WHERE id = $opp AND organization_id = $company LIMIT 1   (company predicate: never reads a foreign row)
      error -> 'lookup_error'; row -> 'owned'; none -> 'not_owned'
  - foreign and nonexistent are deliberately the SAME outcome ('not_owned')

assertOpportunityOwned(opportunityId, companyId)        (service-layer)
  -> resolves on 'owned'
  -> throws OpportunityNotOwnedError   on 'not_owned'
  -> throws OpportunityOwnershipUnavailableError on 'lookup_error'
```

- **Route mapping:** `OpportunityNotOwnedError` → **404 `{ error: 'Opportunity not found', code: 'OPPORTUNITY_NOT_FOUND' }`**, identical for foreign and nonexistent. `OpportunityOwnershipUnavailableError` → **503 retryable**, matching `TENANT_LOOKUP_ERROR`/`CAMPAIGN_LOOKUP_ERROR` (`userContextService.ts:193-201, 258-271`).
- **Where it runs:**
  - **(a) Route,** after `enforceCompanyAccess` + role, before any validation that touches the opportunity and before any write or side effect.
  - **(b) Service,** as the first statement of each of the six writer functions, so alternate callers cannot bypass it. The double read is accepted for clarity. The alternative of a single read with a branded "verified" token (`P0P-001 Q-3`) is cheaper but enforced only by the compiler, not at runtime.
- **Single-column read only.** It does not consult lifecycle history, so it is independent of the PI-C1 ordering design.

### 5.3 Race analysis

**Ownership immutability (SOURCE, bounded search).**
- No `update`/`upsert` follows any `opportunity_feed_items` reference within 8 lines in `backend/` or `lib/`.
- None appears in `pages/` (multiline search).
- No `UPDATE … opportunity_feed_items` appears in `supabase/` migrations.

`organization_id` is therefore never reassigned by application code or migrations.

**Remaining window.** The opportunity can be **deleted** between check and write. The existing single-column FK then refuses the insert (`23503`), which must map to the same generic 404/500 and never echo DB text.

**No lock or transaction is introduced.** PostgREST calls are separate transactions (`writeOwner.ts` WT comment), so a transactional check would need an RPC. That is the database-level option in §7, not the minimum fix.

### 5.4 Proposed Authorized Paths (for the OMNI Story)

| Path | Change |
|---|---|
| `backend/services/opportunityOwnershipService.ts` (new) | helper + typed errors |
| `pages/api/active-leads/lifecycle.ts` | route check; generic 500 |
| `pages/api/active-leads/workflow.ts` | route check for POST (all four kinds); generic 500; AR-1 if approved |
| `pages/api/active-leads/escalations.ts` | route check when `opportunityId` non-null; generic 500; AR-1/AR-4 if approved |
| `backend/services/opportunityLifecycleService.ts` | `assertOpportunityOwned` in `transitionLifecycle` **only** (no ordering, read or init change) |
| `backend/services/opportunityWorkflowService.ts` | assertion in the four writers |
| `backend/services/escalationService.ts` | assertion in `createEscalation` when non-null |
| `backend/tests/unit/ca003P0OpportunityOwnership*.test.ts` (new) | regression suite (§8) |

**Prohibited:** migrations, `supabase/**`, lifecycle ordering, sequence and lock logic, `initialiseLifecycleForOpportunity`, `.claude/settings*`, `verification-registry.json`.

### 5.5 Disclosure rules (Phase C)

- Foreign and nonexistent: **identical status and byte-identical body**. P0T-4 compares whole bodies, not just status.
- No SQL, constraint, table or driver text in any response. Server logs keep the internal message via the existing `console.error`/`logger` pattern, **without** the request body and without the foreign opportunity id in clear (the `campaignRef` SHA-256-prefix pattern in `campaignOwnershipService.ts` is the in-repo precedent).
- Existing validation errors (400s) are preserved.
- **Out of scope:** timing side channels. The ownership read takes the same path for foreign and nonexistent ids (one indexed lookup with an empty result), but no timing claim is made or tested.

---

## 6. Phase D: implementation summary

**NOT IMPLEMENTED: authorization absent (§1) and isolation conflict (§2.2).**

### 6.1 Ordering inside each route (for the implementer)
1. Parse the body.
2. `enforceCompanyAccess`.
3. Role check.
4. **Ownership check** (`requireOwnedOpportunity`).
5. Kind-specific validation.
6. Service call (which re-asserts).
7. Side effects (realtime, telemetry).
8. Response.

### 6.2 Explicitly unchanged
Lifecycle reader semantics, the transition graph, sequence/lock/predecessor logic, the WT Phase-1 409 mapping (if the fix lands on a base without it, it is simply absent), and retention/erasure code.

### 6.3 Out of scope, recorded
`initialiseLifecycleForOpportunity` is not externally reachable and takes its ids from the pipeline's own insert. Adding an ownership read there would add a failure point to a best-effort, error-swallowing step (RDR-002 §5). It is left to PI-C1 B-2.

---

## 7. Phase E: database-level enforcement (decision record; nothing implemented)

| | **E-1 Composite FK, `NOT VALID`** | **E-2 Insert trigger per child table** |
|---|---|---|
| Tables / columns | parent `opportunity_feed_items (id, organization_id)`; children `opportunity_lifecycle_states`, `opportunity_assignments`, `opportunity_notes`, `opportunity_tags`, `opportunity_dispositions`, `escalations`, each `(opportunity_feed_item_id, organization_id)` | same six children; a `BEFORE INSERT` (and `UPDATE OF opportunity_feed_item_id, organization_id` for non-append-only tables) trigger checks the parent pair |
| Supporting structures | `UNIQUE (id, organization_id)` on the parent. Likely `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT … USING INDEX` to limit locking (**INFERRED**). The existing `idx_…_org_opp…` indexes may serve the child side | parent lookup by `(id, organization_id)` |
| Existing inconsistent rows | untouched (`NOT VALID`). A later `VALIDATE CONSTRAINT` **fails if any exist**, so detection (CA-003 K-3) must come first | untouched |
| New writes | mismatched pair → `23503` for **every role**, service role included. FKs are not RLS (**INFERRED**) | refused for every role unless triggers are disabled |
| Escalations' nullable column | `MATCH SIMPLE`: `NULL` opportunity skips the check, which matches the API (**INFERRED**) | handled in trigger logic |
| Tenant isolation | declarative, uniform | procedural; six bodies to keep consistent |
| Append-only interaction | `ADD CONSTRAINT` on the lifecycle table is DDL. PG-002 E-7/E-8 show DDL does not fire the guard; `NOT VALID` should need no row rewrite (**INFERRED**, cf. RDR-002 V-01/V-02) | a new trigger alongside the existing guard; no change to it |
| Locking / migration risk | `ADD FOREIGN KEY … NOT VALID` takes a lock on both tables, though briefly. **Lock level and duration on target data are UNVERIFIED.** Index build on the parent is the larger cost | a trigger is a cheap catalog change; a per-insert parent read adds cost |
| Role model | works with the service role. Bypass needs DDL or `session_replication_role = replica`, which requires superuser (**INFERRED**) | same bypass via `session_replication_role` |
| Rollback | `DROP CONSTRAINT`; the parent unique constraint can stay | `DROP TRIGGER` |
| Disposable verification | apply to the replayed schema; mismatched insert refused for a service-role-equivalent role; no rewrite; lock timing | same |
| Target inspection before migration | parent row count/size, existing mismatched pairs (K-3), current locks/timeouts, role grants (RDR-002 V-05/V-25) | same |
| Owner authorization | `RDR-002 Q-14` (scope widened to six tables) + migration authorization + disposable-DB authorization | same |

**Candidate (recommendation only): E-1.** It is declarative and uniform across the six tables, and it is the pattern the sibling PI ledger already uses (PG-002 §8). E-2 makes sense only if the lifecycle table adopts RDR-002 R-4 anyway.

**Status: OWNER DECISION REQUIRED; NOT RUN.** Until it exists, application checks are the **only** control, and any other server code path writing these tables remains unprotected.

---

## 8. Phase F/G: regression and reproduction plan (designed, NOT RUN)

### 8.1 Test seam

The committed harness **`backend/tests/helpers/routeAuthHarness.ts`** suits the route- and service-level cases. It runs the **real** `enforceCompanyAccess` → `TenantGuard` chain over an in-memory fake database, and provides:
- synthetic tenants `CO_A`/`CO_B` with users `USER_A`/`USER_B`;
- `UNKNOWN_ID`;
- `failTable()` for fault injection;
- `writeCalls()`/`rows()` for no-write assertions;
- `leaksB()` with the canary `CANARY-COMPANY-B-CONFIDENTIAL`.

The precedent use is `backend/tests/unit/activityRescheduleLinkedPostBinding.test.ts` (commit `0183e5e9`).

- **Command once authorized:** `npx jest backend/tests/unit/ca003P0OpportunityOwnership --runInBand` (repo script: `"test": "jest backend/tests --runInBand --forceExit"`).
- **No service, Docker or network.** Fixtures need opportunity rows `OPP_A` (org `CO_A`) and `OPP_B` (org `CO_B`) seeded via `seed()`.
- **Limitation:** the fake database **does not enforce FKs, append-only triggers or cascades.** Those need §8.2.

### 8.2 Test matrix

Each case runs **for each of paths 1–6**, so it is 6 × 10, not one helper unit test.

| ID | Case | Expected after fix | Expected at HEAD (red baseline) |
|---|---|---|---|
| P0T-1 | `USER_A`, `CO_A`, `OPP_A` | 200; expected row; realtime/telemetry emitted | 200 |
| P0T-2 | `USER_A`, `CO_A`, **`OPP_B`** | **404 `OPPORTUNITY_NOT_FOUND`**; `writeCalls()` empty for the target table; no realtime/telemetry call | **200, row written** (the defect) |
| P0T-3 | `USER_A`, `CO_A`, **`UNKNOWN_ID`** | 404; no write | 200 in the fake (no FK); a real DB would give 500 with DB text |
| P0T-4 | compare P0T-2 vs P0T-3 | **byte-identical** status and body; `leaksB()` false | — |
| P0T-5 | member of `CO_A` without `MANAGE_LISTENING_CAPABILITIES`, `OPP_A` | 403; no write | 403 |
| P0T-6 | call each service writer directly with `(CO_A, OPP_B)` | throws `OpportunityNotOwnedError`; no write | writes |
| P0T-7 | `USER_A` with `companyId: CO_B` (+`OPP_B`) | 403 from `enforceCompanyAccess`; no ownership read of B | 403 |
| P0T-8 | `failTable('opportunity_feed_items')` | 503 retryable; no write | n/a |
| P0T-9 | same-tenant payload, status and side-effect parity with today | unchanged | — |
| P0T-10 | the path-specific variants: assignment's prior-assignment UPDATE not executed on denial; tag `23505` path; escalation with `opportunityId: null` → 200 | as stated | — |
| P0T-11 | 500 path (force a non-ownership failure) | generic body, no DB/constraint text (AR-2) | DB text echoed |
| P0T-12 *(if AR-1 approved)* | `assignedToUserId = USER_B` on `CO_A` | 4xx; no write | written |

**Real-database reproduction (separate authorization):** CA-003 §3.7 R1–R7 on a disposable stack (loopback, synthetic fixtures). It confirms the FK/oracle behaviour at HEAD, the denial after the fix, and **whether a planted lifecycle row blocks B's opportunity/company deletion** (§9).

**Results:** none. **No test was written or run.** Nothing is reported as passing.

### 8.3 Independent security review: scope for the reviewer (PENDING)

The reviewer should cover:
- correctness of the tenant binding (§5.1–5.2);
- six-path completeness, plus the §4.3 bounded list;
- alternate-caller bypass (service-layer assertion);
- disclosure (P0T-4, P0T-11);
- whether tests exercise the real guard chain;
- service-role compatibility;
- whether application checks suffice pending E-1;
- whether existing foreign rows warrant an incident decision (§9).

**Reviewer: UNKNOWN / not assigned.** Same-model-family review does not satisfy this (RDR-002 Q-12).

---

## 9. Existing foreign rows and deletion implications (separate decision record)

| Item | Content |
|---|---|
| Hypothesis | A foreign-pair lifecycle row `(org A, opp B)` makes deletion of opportunity B, and of company B, fail with `P0001`, because `ON DELETE CASCADE` reaches an append-only row. For paths 2–6 (not append-only), B's deletion would instead **cascade-delete A's rows** |
| Classification | **INFERENCE.** Built from PG-002 E-13 (executed: deleting the parent or company with *same-tenant* lifecycle rows is refused) plus the single-column FK. **Not demonstrated for a foreign-pair row** |
| Evidence needed | disposable DB: plant `(CO_A, OPP_B)` in each of the six tables; delete `OPP_B`; delete `CO_B`; observe |
| Inventory requirement | read-only aggregate count of mismatched pairs per table and tenant (CA-003 K-3; RDR-002 §8 X-TENANT). **Separate authorization, no row content exported** (`CLAUDE.md`) |
| Prohibited | deleting rows, disabling append-only protection, bypassing FKs or erasure rules, real-data deletion tests, retention/erasure policy changes |
| Decisions required before any cleanup | incident classification; whether a privileged correction path for append-only evidence may exist (`PROP-001 D-9`); legal/erasure policy (`PROP-001 D-15` / Q3, **BLOCKED**) |
| Status | **OWNER DECISION REQUIRED** (`P0P-001 Q-7`); not started |

---

## 10. Schedule estimate (dated, proposed; NOT a baseline)

| Field | Value |
|---|---|
| Estimate recorded | **2026-10-19T19:45:14+05:30 (IST)** · 14:15:14Z |
| Scope | §5.4 Authorized Paths: helper, 3 routes, 6 service writers, generic 500s, P0T-1…P0T-11 via the in-memory harness. AR-1/AR-4 **excluded** unless Q-4 includes them |
| Exclusions | E-1/E-2 migration; disposable-DB reproduction; inventory (K-3); same-class review of the §4.3 routes; deployment; PI-C1 work |
| **Human engineering effort** | **1.0–2.0 engineer-days** (implementation 0.5–1.0; tests 0.5–1.0). Adding AR-1/AR-4: **+0.25–0.5** |
| Reviewer effort | independent security review **0.5 d** (reviewer availability **UNKNOWN**) |
| Optional, separately authorized | disposable reproduction **0.5–1.0 d**; E-1 design + disposable verification **1.0–2.0 d** (excludes the production migration window) |
| Elapsed calendar time | **UNKNOWN.** It depends on owner authorization latency, Story creation and reviewer availability |
| Dependencies / critical path | P0P-001 Q-1 (authorize) → Q-2 (base/worktree) → OMNI Story → implementation → tests → independent review → human merge/deploy decision |
| Confidence | **MEDIUM** for implementation (small, well-precedented change; committed harness). **LOW** for elapsed time |
| Assumptions | the harness covers these routes without modification beyond seeding; no other caller of the six writers exists outside the repo; the base is `main` or HEAD with no conflicting edits |
| Acceptance criteria | §12 items 1–6 |
| Checkpoint / overrun alert | alert at **75 % of the upper bound (1.5 engineer-days)** consumed without passing P0T-1…P0T-4 on all six paths |
| **Baseline comparison** | Milestone A′ **2026-11-25 / 28.5 engineer-days** frozen; **this is new scope, not absorbed** into it or into C-1. On a single sequential owner it consumes Milestone A′ float one-for-one. **OVERRUN RISK remains RAISED** (OD-002 §7.5); the float conflict is still unresolved (RDR-002 §11.1); next checkpoint **Fri 2026-10-23**. Owner decision `P0P-001 Q-8` / `RDR-002 Q-11` |

---

## 11. Owner decisions required (all PENDING OWNER DECISION)

| Ref | Question | Alternatives | Prereq for implementation? |
|---|---|---|---|
| **P0P-001 Q-1** (= `CA-003 P0-Q1`) | Authorize the isolated application-level fix per §1.1? | yes / no / modified scope | **Yes** |
| **P0P-001 Q-2** | Base and worktree: a new governed worktree from `main` or from HEAD `29fea38a`? | `main` (deploy target; own helper) / HEAD (has ROUTE-AUTH-001; carries unmerged commits) | **Yes** (isolation conflict §2.2) |
| **P0P-001 Q-3** | Service-layer enforcement style | runtime re-check in every writer (candidate) / branded verified token | Yes |
| **P0P-001 Q-4** | Include AR-1/AR-4 (`assignedToUserId` membership) in this fix? | include / separate item | Yes (scope) |
| **P0P-001 Q-5** | API contract: 404 `OPPORTUNITY_NOT_FOUND` for foreign/nonexistent; generic 500 bodies | accept / alternative codes | Yes |
| **P0P-001 Q-6** | Database enforcement: E-1, E-2 or defer (= `RDR-002 Q-14`, widened to six tables) | E-1 / E-2 / defer | No for the app fix; **yes for security closure** |
| **P0P-001 Q-7** | Existing foreign rows: authorize the read-only inventory and the disposable deletion-impact test; incident classification | per §9 | No |
| **P0P-001 Q-8** | Schedule: accept the §10 estimate as new scope outside Milestone A′ / C-1, or a baseline change | — | Yes |
| `CA-003 P0-Q2` | disposable two-tenant reproduction (Docker) | yes / no | No (before closure: yes) |
| `CA-003 P0-Q3` | containment K-1…K-4 | per CA-003 §5.3 | No |
| `CA-003 P0-Q4` | same-class review of the §4.3 routes | yes / no | No (before closure: yes) |
| `CA-003 P0-Q5` | deployed-version attestation | — | No (for the exposure classification: yes) |
| `RDR-002 Q-12` | independent security reviewer | human / other-family | **Yes for closure** |

---

## 12. Exit criteria (P0 workstream)

**"Implementation complete, pending review"** requires all of the following:
1. Q-1, Q-2, Q-5 decided and a Story created.
2. The invariant enforced on all six paths at route **and** service layers.
3. P0T-1…P0T-11 (P0T-12 if Q-4) **actually run**, with recorded results per path.
4. Disposable reproduction confirms the denial (Q-2 of CA-003).
5. No DB change, cleanup or deployment outside authorization.
6. The Q-6 decision documented.

**"Security-closed"** additionally requires independent review acceptance, the Q-6 enforcement decision implemented or explicitly accepted as deferred, `CA-003 P0-Q4` complete or scoped out, and the §9 disposition decided.

**Current P0 status: PLAN PREPARED.** Not started, not implemented, not verified.

---

## 13. Remaining risks and blockers

- **No authorization** (Q-1).
- **The isolation conflict** in this worktree (Q-2).
- Deployment exposure **UNKNOWN** (`CA-003 P0-Q5`).
- Exploitability **not demonstrated**.
- AR-1/AR-4 are an unvalidated cross-tenant user reference.
- The §4.3 routes are unreviewed.
- Without E-1, service-role code paths outside these routes remain unprotected.
- The deletion impact is **inferred**.
- Same-family authorship of all analysis to date.
- Schedule overrun risk is raised.

**PI-C1 boundary.** Nothing here resolves or authorizes PI-C1:
- `RDR-002` Q-1…Q-18;
- `PROP-001` D-2, D-4, D-9, D-14, D-15/Q3, and `OR-001 G-1.6`;
- V-01…V-25 (T22 = V-07 **NOT RUN**);
- the human baseline commit;
- independent PI-C1 review;
- disposable-DB and target-inspection authorization;
- the float conflict and the 4.5–8.0 d inclusion question.

All remain open. **PI-C1: NOT READY** (CA-003 §10, 0 of 9 criteria). **`C:\virality`: ON HOLD.**

---

## 14. What changed and what did not

**Changed:** this file only, `docs/pmo/prospect-intelligence/CA-003-P0-TENANT-OWNERSHIP-REMEDIATION-PLAN-001.md`.

**Not changed:** all source, tests, migrations, schemas, grants, configuration, environment, deployment settings, database state, prior governance artifacts (hashes in §2 re-verified), git index, history, stash and branches. No test was run. No Docker, database, service or network activity.

**Commands used:** read-only `git` (`status`, `diff`, `show`, `log`, `ls-files`, `worktree list`, `rev-parse`), `grep`, `sed`, `awk`, `sha256sum`, `ls`, `date`.

**This is not independent review** (same model family as all prior artifacts).

The final hash is reported in the delivering message, because a file cannot contain its own hash.
