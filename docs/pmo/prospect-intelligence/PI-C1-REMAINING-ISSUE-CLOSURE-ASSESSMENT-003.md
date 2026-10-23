# PI-C1-REMAINING-ISSUE-CLOSURE-ASSESSMENT-003 — security-first closure assessment

**Read-only assessment.** No application code, test, migration, schema, grant, configuration, feature flag, environment or deployment setting was changed. No database, Docker or other service was started, connected to or queried. No production access and no cross-tenant access attempt. No commit, stage, stash, branch, PR, merge, push or deployment. No secret value was read or printed: only variable *names* and code paths. `C:\virality` was not touched.

**Implementation authorization: NOT GRANTED.** This prompt is not treated as approval. No owner decision is inferred, and nothing here is "closed" by design or inference alone.

Prior artifacts are preserved and **not** edited. Decision references reuse the qualified scheme of `RDR-002 §3`. New items introduced here are prefixed `CA-003` and mapped onto the existing inventory.

---

## 1. Executive summary

| Area | Result |
|---|---|
| **P0 cross-tenant lifecycle write** | **CONFIRMED SOURCE-CODE DEFECT** at HEAD `29fea38a` **and** on `main` `fef34178`; present since commit `6cd30522` (2026-05-16). **Plausible exploit path, not reproduced.** **Exploitability not demonstrated.** **Deployment exposure UNKNOWN**: no deployment identity was verifiable. Rated **MEDIUM** by this review: integrity and availability impact on another tenant, no confidentiality loss of the other tenant's lifecycle data (rationale in §3.5) |
| **Same defect class elsewhere** | **CONFIRMED in source** for four more committed write paths that take an `opportunityId` from the request body without binding it to the authorized company: `workflow.ts` (assignments, notes, tags, dispositions) and `escalations.ts`. Not limited to lifecycle |
| **Working-tree "fix"** | **Not a fix.** The WT refuses a foreign opportunity only *incidentally*, because it has no lifecycle history under the caller's org. It does not consult opportunity ownership, does not cover the other endpoints, and keeps accepting transitions on any foreign-pair history already planted |
| **Remediation** | **Designed (§5). Not implemented.** Minimum: an API-layer tenant-scoped ownership check, using the repository's own `campaignId` precedent (ROUTE-AUTH-001), plus database-level enforcement options for owner decision |
| **Lifecycle-ordering blockers** | **None closed.** 18 RDR-002 questions + 6 carried items: all **OWNER DECISION REQUIRED** or **BLOCKED** |
| **Verification V-01…V-25** | **PASS 0 · FAIL 2 · BLOCKED 17 · OWNER DECISION REQUIRED 6 · NOT RUN 0 · N/A 0.** Nothing was executed in this task, and every BLOCKED item is also unexecuted |
| **Schedule** | baseline unchanged; **OVERRUN RISK remains RAISED**; the float conflict (RDR-002 §11.1) is **unresolved**; P0 remediation is **new, unestimated** scope |
| **PI-C1 status** | **NOT READY** (§10) |
| **`C:\virality`** | **ON HOLD**: PI-C1 exit criteria unmet and no separate authorization exists |

---

## 2. Baseline and repository-state evidence

| Item | Value |
|---|---|
| Branch / HEAD | `fix/r1-profile-context` / `29fea38a2d1642c1c2fd957e5151f6be81415774` ("feat(pi): relationship-scoped canonical decision log") |
| `main` | `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2`, which is also the merge-base with HEAD |
| `git status --short` before writing | **166 entries: 72 ` M`, 94 `??`, 0 staged** |
| After writing | **167 entries: 72 ` M`, 95 `??`, 0 staged.** Sole addition: this file |
| Security/lifecycle code differing HEAD → WT | `backend/services/opportunityLifecycleService.ts` (+139/−2), `pages/api/active-leads/lifecycle.ts` (+23); `lifecycleGuardErrors.ts` untracked. **Unmodified:** `userContextService.ts`, `rbacService.ts`, `workflow.ts`, `escalations.ts`, `graph.ts`, `opportunityWorkflowService.ts`, `supabaseClient.ts`, `supabaseKeys.ts` |

**Artifact hashes (SHA-256, read at task start):**

| Artifact | Hash |
|---|---|
| PROP-001 `…DESIGN-PROPOSAL-001.md` | `9e3e570c267b403562a3077ff9793c4b73f3bed930a5b877c515c154e88a6d10` (matches OR-001, RDR-002) |
| OR-001 `…OWNER-REVIEW-001.md` | `b06bf982f9350307b001f304168d267964b4fac87275ca222271de611120812c` (matches RDR-002) |
| RDR-002 `…REVISED-DESIGN-REVIEW-002.md` | `117526a9694dd6ef12d387a6c8a5003e55482f4cddc300bf48d3f4a782f11e5f` (matches the hash reported when it was created) |
| GATE-001 `PI-C1-IMPLEMENTATION-GATE-001.md` | `f747c763bd0dbb48e6cd3f3f75809a781451abb114791a4f749a250e8b2622e9` (matches RDR-002) |
| DC-001 `PI-C1-DECISION-CLOSURE-001.md` | `7e74c05d6d991c94e46806e0960f20e287037db3721193d6904dd56518917aa0` (**first recorded here**) |
| OD-002 `PI-C1-OWNER-DECISIONS-002.md` | `7296df67fd054717a66c3c1ccfc9324f8a7f2eb06e7555d40dc1d2b891408791` (matches RDR-002) |

All PI governance documents remain untracked, so their identity is by content hash only.

---

## 3. P0: cross-tenant lifecycle write

### 3.1 Trace: external entry point → database write (HEAD; WT differences marked)

| Stage | Source | Principal | What is established |
|---|---|---|---|
| 1. Route | `pages/api/active-leads/lifecycle.ts`, default export via `createApiRoute` (observability/request context only, per its comment `W0-1`) | anonymous HTTP caller | — |
| 2. Body parse | `lifecycle.ts:51-56` (HEAD) / `:52-58` (WT): `companyId`, `opportunityId`, `to`, `reasoning` **all from `req.body`** | — | input shape only |
| 3. Authentication | `enforceCompanyAccess` → `resolveUserContext(req)` (`userContextService.ts:169-175`), backed by `getSupabaseUserFromRequest` (`supabaseAuthService.ts:31`). An unauthenticated caller gets 401 (`:219-231`) | **end user** (Supabase-authenticated user id) | identity |
| 4. Tenant authorization | `assertTenantAccess({ userId, organizationId: companyId })` (`:241-254`): active member of an active org. Fallbacks: the `content_architect` cookie principal (`:286-294`) and invited admins. `campaignId`, **if supplied**, is bound to the company (`campaignBound`, `:193-214`, ROUTE-AUTH-001) | end user | **`companyId` is authorized for this user.** Tenant id = an authorized request field |
| 5. Role | `getUserRole(ctx.userId, companyId)` (`rbacService.ts:176-195`) + `MANAGE_LISTENING_CAPABILITIES` (`lifecycle.ts:58-62`) | end user | role in `companyId` |
| 6. **Opportunity ownership** | **absent.** `opportunityId` goes straight to `transitionLifecycle({ organizationId: companyId, opportunityFeedItemId: opportunityId, … })` (`lifecycle.ts:65-71` HEAD) | — | **nothing** |
| 7. Current-state read | HEAD: `getCurrentLifecycleState(companyId, opportunityId)` filtered by `organization_id = companyId` (HEAD `opportunityLifecycleService.ts:84-96`); **no rows ⇒ `from = 'detected'`** (HEAD `:131-132`). WT: `readCurrentLifecycleState` ⇒ `missing` ⇒ `LifecycleEvidenceUnavailableError` (WT `:256-268`) | **service role** | HEAD: an invented predecessor |
| 8. Validation | `canTransitionLifecycle('detected', to)`: `triaged`, `dismissed`, `archived` allowed (`backend/types/opportunityLifecycle.ts:35-45`) | service role | — |
| 9. **Database write** | `ownedDbTable('opportunity_lifecycle_states').insert({ organization_id: companyId, opportunity_feed_item_id: opportunityId, previous_state: from, … })` (HEAD `:139-150`) | **service role** (§3.2) | the row lands |
| 10. Schema | single-column FKs only: `opportunity_feed_item_id → opportunity_feed_items(id)` (`baseline.sql:52158`) and `organization_id → companies(id)`. **No composite FK** (PG-002 Exp. F: "Cross-tenant insert … ACCEPTED"; 0 multi-column FKs) | — | a mismatched pair is accepted |
| 11. Side effect | `publishRealtime({ organizationId: companyId, … opportunity_feed_item_id: opportunityId })` (`lifecycle.ts:73-85`) | — | broadcast to tenant A only |

### 3.2 Credential (Q5), established without reading values

- `supabaseClient.ts` takes its server key from `requireSupabaseSecretKey()` (`supabaseKeys.ts:75`). The only alternative source the resolver names is `legacy-service-role` (`supabaseKeys.ts`, deprecation path). **The server credential is a secret/service-role-class key.** SOURCE.
- The committed migration `20261026000000_close_anon_rls_exposure.sql:28-33` records that "every server path … uses the service-role key. service_role has BYPASSRLS". SOURCE, but dated (a 2026-09-14 production measurement). The current production key class is **UNVERIFIED**.
- **RLS is not a control on this path.** Even if the migration is applied, it constrains only `anon`/`authenticated`. The server bypasses it.

### 3.3 Answers to the eight P0 questions

| # | Question | Answer | Evidence class |
|---|---|---|---|
| 1 | Principal at each stage | end user (JWT-authenticated) for stages 3–5; **service role** for every database read and write (stages 7–9) | SOURCE |
| 2 | Where the authorized tenant is derived | from **`req.body.companyId`**, then **authorized** by membership (`assertTenantAccess`). The tenant id is untrusted input that is *validated*, not derived from session context | SOURCE |
| 3 | Where the opportunity is derived and bound | derived from **`req.body.opportunityId`**. **Never verified to belong to `companyId`** at HEAD, on `main` or in the WT | SOURCE (**confirmed defect**) |
| 4 | Can a company-A caller influence a company-B opportunity? | **Yes, at HEAD/`main`.** Preconditions: an authenticated user with `MANAGE_LISTENING_CAPABILITIES` in A, plus knowledge of a B opportunity UUID (`gen_random_uuid`, so not enumerable; how a UUID could leak is **UNKNOWN**). Outcome: row `(org=A, opp=B's id, previous_state='detected', state=to)` inserted | plausible path, **not reproduced** |
| 5 | Service role bypasses RLS? | yes (§3.2); RLS provides no protection here | SOURCE (dated) |
| 6 | Does the WT contain a fix? | **No authoritative fix.** The WT refuses because lifecycle history under org A is `missing`. That is (a) **not an ownership check**: it never reads `opportunity_feed_items`; (b) tenant-scoped only in that the lifecycle read filters `organization_id`; (c) **bypassed whenever A already has history for B's opportunity**, e.g. rows planted while HEAD was deployed, which then transition normally; (d) **absent from the other four endpoints** (§3.6). Race-safety is moot, since there is no ownership check to race | SOURCE |
| 7 | Reachable in committed code? Deployed? | **Committed: yes** (HEAD and `main`; `transitionLifecycle`'s `?? 'detected'` dates to `6cd30522`, 2026-05-16). **Deployed: UNKNOWN.** No deployment identity, release tag or runtime version was verifiable read-only. If `main` is deployed, the path is reachable there | SOURCE / **UNKNOWN** |
| 8 | Other operations affected? | see §3.6 | SOURCE |

### 3.4 Classification

| Category | Status |
|---|---|
| Confirmed source-code defect | **YES**: a missing tenant-ownership binding for `opportunityId`, on HEAD and `main` |
| Plausible exploit path not yet reproduced | **YES**: §3.1 stages 1–10 are traced, and the schema acceptance is executed in PG-002 Exp. F as superuser. **Not** reproduced through the product TypeScript |
| Demonstrated exploitability | **NO** |
| Deployment exposure | **UNKNOWN** |

### 3.5 Impact and severity rationale (review judgement, not a CVSS score)

- **Integrity (tenant A's data).** A's lifecycle ledger can hold permanent rows citing B's opportunity. They are **append-only**, so they can never be removed (E-6). A's board/dashboard counts include them (A3/A4 filter only by org).
- **Availability (tenant B), INFERRED from executed E-13 plus the schema.**
  - Deleting B's opportunity cascades to A's lifecycle row (`ON DELETE CASCADE`). The append-only trigger raises `P0001`, so **B can no longer delete that opportunity**, and deleting **company B** is likewise refused via the cascade.
  - B's retention run for that feed item would hit the same refusal. The WT protective probe (C3) filters `organization_id = B` and would not see A's row.
- **Confidentiality.** **No leak of B's lifecycle state.** Every read (A1/A2/A3/A4/B1, the history GET) filters by the caller's org.
  - At HEAD there is a **weak existence oracle**: a nonexistent UUID fails the FK and returns 500 with `err.message` in the body (`lifecycle.ts:89`), while an existing foreign UUID returns 200. This needs UUID guesses, which are not enumerable.
  - In the WT, both cases return the identical 409 `lifecycle_history_missing`.
- **Exploit cost.** Requires a legitimate tenant account with a management role and a foreign opportunity UUID.
- **Rating: MEDIUM.** Cross-tenant integrity/availability effects that are permanent by construction raise it. The UUID precondition, the authenticated management role, and the absence of confidentiality loss lower it. **Owner may re-rate.**

### 3.6 Same-class review of adjacent paths

| Endpoint / path | Operation | `opportunityId` bound to `companyId`? | Effect if foreign | Status |
|---|---|---|---|---|
| `pages/api/active-leads/lifecycle.ts` POST | lifecycle transition | **No** | §3.5 | **CONFIRMED** (HEAD/`main`); WT incidental refusal |
| `pages/api/active-leads/workflow.ts` POST (`:82-104`) → `opportunityWorkflowService.ts` | assignment (`:25-50`), note, tag, disposition inserts with `organization_id: companyId, opportunity_feed_item_id: opportunityId` | **No** | foreign-pair rows; not append-only, so B's deletion cascades **delete A's rows** (loss for A, no block for B) | **CONFIRMED in source**, file unmodified (committed) |
| `workflow.ts` DELETE (`?opportunityId=&tag=`) | remove tag | org-filtered delete | only A's rows affected | review needed; likely contained |
| `pages/api/active-leads/escalations.ts` POST (`:58-92`) | escalation with optional `opportunityId` | **No** | foreign-pair escalation row; cascade on B's deletion | **CONFIRMED in source** (committed) |
| `escalations.ts` PATCH | by `escalationId` + `companyId` | org-filtered (`assignEscalation`/`updateEscalationStatus` take `organizationId`) | — | review needed |
| `pages/api/active-leads/graph.ts` GET | read | reader filters `organization_id` (`opportunityGraphService.ts:282-286`) | none observed | low risk |
| `lifecycle.ts` GET history/board | read | org-filtered | none | low risk |
| `initialiseLifecycleForOpportunity` | init | not externally reachable; ids come from the pipeline's own write (`listeningSignalPipeline.ts:307`) | — | not affected |
| Account deletion / erasure | `isResolvedForAccountDeletion` | WT only, zero callers | n/a | not reachable |
| Other routes that accept opportunity ids (`campaigns/*-opportunity*`, `engagement/opportunity*`, `market-pulse/findings/[id]/promote`, `outreach-plans`, `collaboration-plans`, `bolt/execute`) | various | **not reviewed in this task** | — | **REVIEW REQUIRED** (CA-003 P0-Q4) |

Child tables with single-column parent FKs, so mismatched pairs are accepted by the schema: `opportunity_lifecycle_states` (`baseline.sql:52158`), `opportunity_assignments` (`:52046`), `opportunity_dispositions` (`:52062`), `opportunity_notes` (`:52182`), `opportunity_tags` (`:52206`), `escalations` (`:50336`).

### 3.7 Safe, isolated reproduction plan (NOT RUN; requires authorization)

- **Environment:** disposable PostgreSQL on loopback, with replayed `baseline.sql` and migrations as in PG-002 §2.2. The product API runs against it with a **disposable** Supabase-compatible stack or a direct service-layer test harness. **No production, no real tenants, no customer data.**
- **Fixtures (synthetic):** companies `T-A` and `T-B`; user `U-A`, an active member of `T-A` with `MANAGE_LISTENING_CAPABILITIES`; opportunity `O-B` in `T-B` with an initial lifecycle row; opportunity `O-A` in `T-A` likewise; one random UUID `O-X` that exists nowhere.

| Step | Action as `U-A` | Expected at HEAD (hypothesis) | Evidence to retain |
|---|---|---|---|
| R1 | POST lifecycle `{companyId:T-A, opportunityId:O-A, to:'triaged'}` | 200 (control) | response, row |
| R2 | POST `{companyId:T-A, opportunityId:O-B, to:'triaged'}` | **200, row `(T-A, O-B)` inserted** | response, `SELECT` of the row |
| R3 | POST `{companyId:T-B, opportunityId:O-B, …}` | 403 (membership) | response |
| R4 | POST `{companyId:T-A, opportunityId:O-X, …}` | 500 with FK text (oracle) | response body |
| R5 | as T-B's owner, delete `O-B` | `P0001` refusal (availability) | error |
| R6 | repeat R2/R4 against the WT build | 409 `lifecycle_history_missing` for both | responses |
| R7 | workflow POST assignment/note/tag/disposition and escalation POST with `O-B` | 200 and rows inserted (hypothesis) | responses, rows |

**Authorization required:** start Docker and a disposable database; run the product code against it (CA-003 P0-Q2).

---

## 4. Committed HEAD versus working tree

RDR-002 §2.3 remains the authoritative traceability table. It was re-verified here for the security-relevant rows and is extended:

| Claim | HEAD (`29fea38a`) | `main` (`fef34178`) | WT | Consequence |
|---|---|---|---|---|
| Missing-history ⇒ `'detected'` in `transitionLifecycle` | **present** (`:132`) | **present** (`:132`) | removed; refuses | the P0 path exists in committed code |
| Lifecycle API error mapping | 409 invalid transition; **500 echoes `err.message`** | same | adds 409 for missing/unreadable/immutable; 500 still echoes `err.message` | the FK-message oracle persists for other errors in the WT |
| Opportunity ownership check (any endpoint) | **absent** | **absent** | **absent** | not fixed anywhere |
| `campaignId` ownership binding precedent | present in `enforceCompanyAccess` | not on `main` (`userContextService.ts` differs `main`→HEAD by +96/−4) | same as HEAD | the remediation pattern is committed on this branch only |
| Service-role server credential | yes | yes | yes | RLS not a control |

---

## 5. Minimum remediation design (proposal only, NOT IMPLEMENTED)

### 5.1 Required properties and how each option meets them

| Property | **A. API ownership binding** (minimum) | **B. Service-layer precondition** | **C. DB composite FK** | **D. DB trigger pair check** (lifecycle only; RDR-002 R-4) |
|---|---|---|---|---|
| Tenant id from an authorized context | `companyId` stays an authorized request field (`enforceCompanyAccess`); unchanged | same | n/a | n/a |
| Opportunity proven to belong to the tenant | `SELECT id FROM opportunity_feed_items WHERE id=$opp AND organization_id=$company` before any write; result `owned` / `not_found` / `lookup_error` → 503 (mirrors `checkCampaignOwnership`) | the service refuses unless given a verified pair | `UNIQUE (id, organization_id)` on the parent plus `FOREIGN KEY (opportunity_feed_item_id, organization_id)` on each child, **`NOT VALID`** so existing rows are not checked | trigger refuses the insert if the pair is absent from the parent |
| Bypass via alternate callers / service role | **bypassable** by any other server caller | bypassable by direct `ownedDbTable` writes | **not bypassable** by any role short of DDL | not bypassable (lifecycle only) |
| Race safety | ownership is immutable in source: no `update` of `opportunity_feed_items` found (RDR-002 §J grep). Deletion between check and insert is caught by the existing FK | same | atomic | atomic, under lock |
| No new info leak | **identical 404** for foreign and nonexistent; **stop echoing `err.message`** in 500s | same | DB errors must not be echoed | same |
| Ordering/predecessor atomicity | independent of A; still needs PROP-001/RDR-002 work | same | independent | combined with R-4 |
| Preserves deletion/erasure/retention | yes | yes | yes. `NOT VALID` leaves any planted rows in place; they still block B's deletion (§5.3) | yes |
| Scope | 3 routes (lifecycle POST, workflow POST, escalations POST) + 1 helper | 6 service writers | 1 parent key + 6 child FKs (`PROP-001 D-11` / `RDR-002 Q-14`) | 1 trigger |
| Owner-controlled? | no policy choice; needs implementation authorization | same | **yes** (`RDR-002 Q-14`) | **yes** (`RDR-002 Q-2`, `Q-6`) |

**Recommended minimum (not a decision):** **A + B now**, as a narrowly scoped security fix independent of the ordering redesign. **C** as the database-level guarantee once the owner decides `RDR-002 Q-14`. D is relevant only if R-4 is chosen.

### 5.2 Regression tests (proposed; none written)

| ID | Test | Expected |
|---|---|---|
| CA-003 P0-T1 | same-tenant transition (A, O-A) | 200; row written |
| P0-T2 | foreign opportunity (A, O-B) on lifecycle POST | **404**; **no row**; B's history unchanged |
| P0-T3 | nonexistent opportunity (A, O-X) | **404, byte-identical body to P0-T2** (no oracle) |
| P0-T4 | P0-T2 for workflow assignment, note, tag, disposition and escalation POST | 404, no row in each table |
| P0-T5 | ownership lookup failure injected | 503 retryable; no write |
| P0-T6 | membership in B but `companyId=A` (no A membership) | 403 (unchanged) |
| P0-T7 | after C: direct service-role insert of a mismatched pair | `23503` refused |
| P0-T8 | 500 path | body contains no SQL/constraint text |
| P0-T9 | B deletes O-B after the fix, with no planted rows | succeeds (cascade unaffected) |
| P0-T10 | unit: `transitionLifecycle` / workflow writers called without a verified pair | refused (B) |

### 5.3 Containment options (none applied; each needs explicit owner authorization)

| Option | Effect | Risk | Authorization needed |
|---|---|---|---|
| **K-1** Ship A + B as a hotfix through a governed Story | closes the API path | code change to production routes; must not wait for the ordering redesign | OMNI Story with Authorized Paths for the 3 routes + helper + writers; review; human merge and deploy |
| **K-2** Temporarily disable lifecycle/workflow/escalation POST | stops new foreign-pair writes immediately | legitimate users lose transitions and workflow actions | owner product decision + deployment |
| **K-3** Read-only detection of existing mismatched pairs (`RDR-002 §8` category X-TENANT) across all six tables | sizes past exposure; aggregate counts per tenant only | requires read access to production data | separate read-only production authorization; output aggregate only (`CLAUDE.md`: no raw evidence in repo/Jira) |
| **K-4** Add composite FKs (C) `NOT VALID` | DB-level block for new writes | migration on production tables; lock behaviour (`RDR-002 V-02`-type verification) | `RDR-002 Q-14` + migration authorization |
| **K-5** Remediate planted lifecycle rows | — | **append-only: impossible without a privileged correction path**, which needs a separate governance decision (`PROP-001 D-9`; legal/erasure boundary, Q3) | **not proposed** |

---

## 6. Owner-question reconciliation

**Statuses:** PASS · FAIL · BLOCKED · NOT RUN · OWNER DECISION REQUIRED · NOT APPLICABLE. No item is passed on design or inference.

### 6.1 RDR-002 Q-1 … Q-18

| Ref | Subject | Status | Dependency / note |
|---|---|---|---|
| `RDR-002 Q-1` (`PROP-001 D-1`, `D-3`) | design and ordering contract | OWNER DECISION REQUIRED | V-04 / V-09 evidence |
| `RDR-002 Q-2` | writer cutover (R-1…R-4) | OWNER DECISION REQUIRED | V-08, V-09 |
| `RDR-002 Q-3` | `transitioned_at` vs `seq` (transaction-start time) | OWNER DECISION REQUIRED | V-10 |
| `RDR-002 Q-4` | initial-row mechanism | OWNER DECISION REQUIRED | V-11 |
| `RDR-002 Q-5` | `missing` opportunities (init failure is best-effort and swallowed: `listeningSignalPipeline.ts:305-316`) | OWNER DECISION REQUIRED | §8 M-MISSING count (K-3-type authorization) |
| `RDR-002 Q-6` (`PROP-001 D-10`) | privilege model M-0/M-1/M-2 | OWNER DECISION REQUIRED | V-05, V-12, V-13 |
| `RDR-002 Q-7` (`PROP-001 D-8` ext.) | fail-closed for ties, chain breaks, ambiguity | OWNER DECISION REQUIRED | V-15 |
| `RDR-002 Q-8` | transition validation on a tied legacy top | OWNER DECISION REQUIRED | — |
| `RDR-002 Q-9` (`PROP-001 D-12`) | retry/idempotency | OWNER DECISION REQUIRED | V-14 |
| `RDR-002 Q-10` (`PROP-001 D-13`) | report-only detection (chain-consistency method, not "predecessor claimed twice") | OWNER DECISION REQUIRED | authorization for rehearsal and read-only run |
| `RDR-002 Q-11` | estimate inclusion; float conflict; OVERRUN response | OWNER DECISION REQUIRED | §9 |
| `RDR-002 Q-12` | independent and security review | OWNER DECISION REQUIRED | — |
| `RDR-002 Q-13` | F-1 triage | **OWNER DECISION REQUIRED, now elevated to P0.** Source defect confirmed; see CA-003 P0-Q1…Q5 | — |
| `RDR-002 Q-14` (`PROP-001 D-11`) | composite parent key / tenant FK | OWNER DECISION REQUIRED, **scope widened** to six child tables (§3.6) | — |
| `RDR-002 Q-15` | which V-items gate authorization vs merge; T22 | OWNER DECISION REQUIRED | — |
| `RDR-002 Q-16` | authorize disposable DB and read-only target inspection | OWNER DECISION REQUIRED | — |
| `RDR-002 Q-17` | human adoption-baseline commit | BLOCKED (human-only action) | `CLAUDE.md` |
| `RDR-002 Q-18` (`PROP-001 D-7`) | implementation authorization | OWNER DECISION REQUIRED; not recommended (§10) | all of §10 |

### 6.2 Carried items

| Ref | Status |
|---|---|
| `PROP-001 D-2` no backfill (no volatile default, no trigger suspension) | OWNER DECISION REQUIRED (evidence supports: E-7, PG-002 E4) |
| `PROP-001 D-4` dead reader | OWNER DECISION REQUIRED, **after** `RDR-002 Q-17` (live at HEAD) |
| `PROP-001 D-9` born-terminal repair route | OWNER DECISION REQUIRED (defer candidate) |
| `PROP-001 D-14` discarded errors (C1, C2, A4) | OWNER DECISION REQUIRED; defect is FAIL in V-18 |
| `PROP-001 D-15` / Q3 legal erasure | **BLOCKED**: policy not located (OD-002 §5.3). Untouched by this task |
| `OR-001 G-1.6` (`PG-002 D-8` supersession) | OWNER DECISION REQUIRED |

### 6.3 New P0 questions (additions mapped to `RDR-002 Q-13`)

| Ref | Question | Alternatives | Prereq for PI-C1 implementation? | Answer |
|---|---|---|---|---|
| **CA-003 P0-Q1** | Treat the opportunity-ownership defect as a **standalone security fix** (A + B), separate from and ahead of the ordering redesign? | standalone now / fold into PI-C1 | **Yes** (§10) | **PENDING OWNER DECISION** |
| **CA-003 P0-Q2** | Authorize the synthetic two-tenant reproduction (§3.7) on a disposable stack? | yes / no | No (recommended before the fix merges) | **PENDING OWNER DECISION** |
| **CA-003 P0-Q3** | Containment: K-1, K-2, K-3, K-4 (any combination)? | per §5.3 | No | **PENDING OWNER DECISION** |
| **CA-003 P0-Q4** | Commission the same-class review of the other opportunity-id routes listed in §3.6 | yes / no | Yes, for the security sign-off | **PENDING OWNER DECISION** |
| **CA-003 P0-Q5** | Identify the deployed code version (who can attest it?) | — | Yes, to classify exposure | **PENDING OWNER DECISION** |

---

## 7. Verification matrix

**Environments:**
- **DISP**: disposable database or stack. Requires authorization to start Docker or services.
- **RO-TGT**: read-only target inspection, authorized separately.
- **REPO**: read-only source.
- **HUMAN**: a human-only action.

**Nothing was executed in this task.**

### 7.1 V-01 … V-25

| ID | Risk addressed | Exact test / inspection | Env | Expected result | Evidence to retain | Human auth? | Owner / dependency | Status |
|---|---|---|---|---|---|---|---|---|
| V-01 | `NOT VALID` CHECK semantics, writer outage | apply to replayed schema; insert NULL; scan delta | DISP | legacy exempt; new NULL refused; no scan | SQL + output | yes | Q-16 | **BLOCKED** |
| V-02 | single-txn DDL rewrite / intermediate state | ADD COLUMN + CONSTRAINT NOT VALID + UNIQUE INDEX in one txn; concurrent insert | DISP | no rewrite; no NULL intermediate row | filenodes, outputs | yes | Q-16 | **BLOCKED** |
| V-03 | multiple NULLs under `UNIQUE (seq)` | insert ≥2 NULLs after index build | DISP | accepted | output | yes | Q-16 | **BLOCKED** (build EXECUTED in PG-002; insert not) |
| V-04 | parent `FOR UPDATE` serialization | PG-002 Exp. D with row lock, superuser **and** service-role-equivalent | DISP | chain not fork; unrelated unblocked | session logs | yes | Q-16, Q-1 | **BLOCKED** |
| V-05 | real grants / role / BYPASSRLS / migration applied | catalog queries | RO-TGT | written inventory | query output (no secrets) | yes | Q-16 | **BLOCKED** |
| V-06 | lock wait and timeouts | N-writer harness; `SHOW` timeouts | DISP + RO-TGT | no fork; structured refusal on timeout | logs | yes | Q-16 | **BLOCKED** |
| **V-07 (T22)** | authenticated-role RLS isolation | JWT-claims `authenticated` role against both tables and any new function | DISP | all denied | outputs | yes | Q-16, Q-15 | **BLOCKED.** NOT RUN; **superuser results are not a substitute** |
| V-08 | old/new writer coexistence or cutover | old writers running during the R-3/R-4 steps | DISP | no NULL after first `seq`; no refused valid write; no lost init | logs | yes | **Q-2** | **OWNER DECISION REQUIRED** |
| V-09 | R-4 trigger lock-before-allocate | adapted PG-002 Exp. A2/C | DISP | lock = seq = commit order per opportunity; caller `seq` overwritten | logs | yes | **Q-2** | **OWNER DECISION REQUIRED** |
| V-10 | `transitioned_at` inversion | B starts first, A locks first | DISP | inversion observed/excluded | rows | yes | Q-16, Q-3 | **BLOCKED** |
| V-11 | initial-row ordering, duplicates, lost init | concurrent init; init + transition race | DISP | one initial row; init `seq` lowest | rows | yes | **Q-4** | **OWNER DECISION REQUIRED** |
| V-12 | direct-write denial / invariant enforcement | direct insert under the chosen model | DISP | refused or overwritten | outputs | yes | **Q-6** | **OWNER DECISION REQUIRED** |
| V-13 | function EXECUTE privileges | `has_function_privilege` for PUBLIC/anon/authenticated | DISP (then RO-TGT) | none | output | yes | Q-16 | **BLOCKED** |
| V-14 | retry after lost response | commit, drop response, retry | DISP | per contract; no duplicate | logs | yes | **Q-9** | **OWNER DECISION REQUIRED** |
| V-15 | existing false predecessors | chain-consistency detection (§8 of RDR-002) | DISP → RO-TGT | aggregate counts only; zero writes | counts | yes | **Q-10** | **OWNER DECISION REQUIRED** |
| V-16 | transition race and tenant refusal (product path) | real-schema tests via product TS | DISP | chain not fork; identical refusals | test output | yes | Q-16 | **BLOCKED** |
| V-17 | reader agreement | fixed history through A1/A3/A4/B1 | DISP | identical state | output | yes | Q-16 | **BLOCKED** |
| V-18 | discarded errors C1/C2/A4 | source inspection (done); fault-injection test (not done) | REPO + DISP | fail closed | — | yes (test) | `PROP-001 D-14` | **FAIL**: source confirms the defect at HEAD and WT (C1/C2 `opportunityLifecycleService.ts:166`, `:190`; A4 `strategicDashboardsService.ts:153`) |
| V-19 | tenant isolation: mismatched pair | source trace (done, §3); P0-T1…T10 (not done) | REPO + DISP | refused at API and DB | — | yes (tests) | CA-003 P0-Q1, `RDR-002 Q-14` | **FAIL**: source confirms the defect (§3) |
| V-20 | append-only integrity | UPDATE/DELETE; delete parent/company | DISP | `P0001`; survive | outputs | yes | Q-16 | **BLOCKED** (pre-change EXECUTED in PG-002 E-6/E-13; post-change not) |
| V-21 | retention unchanged | `ret_retention_pre_exclusion` (untracked) on the committed base | DISP | identical outcomes | output | yes | Q-16, Q-17 | **BLOCKED** |
| V-22 | no accidental backfill; re-runnable migration | apply, interrupt, re-apply | DISP | valued rows = new inserts only | outputs | yes | Q-16 | **BLOCKED** |
| V-23 | product TypeScript exercised | real-schema suite | DISP | red today, green after | output | yes | Q-16 | **BLOCKED** |
| V-24 | committed baseline | human adoption commit; `git` re-verification | HUMAN + REPO | all WT-only facts at a committed SHA | commit SHA | **human-only** | Q-17 | **BLOCKED** |
| V-25 | target PostgreSQL version | `SHOW server_version` | RO-TGT | recorded | output | yes | Q-16 | **BLOCKED** |

**Counts:** PASS **0** · FAIL **2** (V-18, V-19) · BLOCKED **17** · OWNER DECISION REQUIRED **6** (V-08, V-09, V-11, V-12, V-14, V-15) · NOT RUN **0** as a primary status (every item is unexecuted; V-07 is additionally flagged NOT RUN) · N/A **0**. **Total 25.**

### 7.2 The ten required checks mapped to the matrix

| # | Required check | Covered by | Status |
|---|---|---|---|
| 1 | A cannot write against B's opportunity | V-19, P0-T2, P0-T4, P0-T7 | FAIL (source) / tests BLOCKED |
| 2 | A cannot read/infer B's state via errors | P0-T3, P0-T8; reads org-filtered (§3.5) | reads: SOURCE-consistent; oracle at HEAD: **FAIL (source)**; tests BLOCKED |
| 3 | concurrent transitions cannot record false predecessors | V-04/V-09, V-16 | BLOCKED / OWNER DECISION |
| 4 | independent opportunities not serialized together | V-04, V-06 (E-14 shape EXECUTED as PoC only) | BLOCKED |
| 5 | legacy rows under the fail-closed policy | V-15, V-17; policy `RDR-002 Q-7` | OWNER DECISION REQUIRED |
| 6 | old/new writer coexistence or cutover | V-08, V-09 | OWNER DECISION REQUIRED |
| 7 | init failures cannot silently lose initialization | V-11; `RDR-002 Q-4`, `Q-5` | OWNER DECISION REQUIRED. **Today init failure *is* silently lost** (SOURCE) |
| 8 | grants and EXECUTE match the architecture | V-05, V-12, V-13 | BLOCKED / OWNER DECISION |
| 9 | authenticated-role isolation under the real role | V-07 | BLOCKED (NOT RUN) |
| 10 | erasure and retention invariants intact | V-20, V-21; Q3 untouched | BLOCKED |

---

## 8. Unresolved dependencies and required authorizations

| Dependency | Needed from | Unblocks |
|---|---|---|
| Decision on P0 handling (CA-003 P0-Q1, Q3) | owner | security fix K-1, containment |
| OMNI Story for the security fix with exact Authorized Paths | human (Jira) | any code change (`CLAUDE.md`) |
| Disposable stack authorization (Docker, services) | owner (`RDR-002 Q-16`, CA-003 P0-Q2) | 17 BLOCKED V-items, the P0 reproduction |
| Read-only target inspection authorization | owner (`RDR-002 Q-16`) | V-05, V-06, V-13, V-25; K-3 |
| Deployed-version attestation | owner / operations (CA-003 P0-Q5) | exposure classification |
| Adoption-baseline commit | human (`RDR-002 Q-17`) | V-24, V-21, D-4 |
| Design decisions Q-1…Q-9, Q-14 | owner | V-08, V-09, V-11, V-12, V-14 |
| Independent and security review | owner (`RDR-002 Q-12`) | readiness |
| Q3 legal policy | legal/policy owner | **not on this path**; stays BLOCKED |

---

## 9. Schedule and overrun status (unchanged)

- **Frozen baseline:** Milestone A′ **Wed 2026-11-25 / 28.5 human engineer-days**; WP-7 **Tue 2026-11-17 / 4.0**; C-1 **+8–12 d** (GATE-001 §9.5; DC-001 §5.4).
- **OVERRUN RISK: REMAINS RAISED**, MEDIUM-HIGH (OD-002 §7.5). **Next checkpoint: Fri 2026-10-23.**
- **The float conflict is unresolved.** GATE-001 §9.5 says breach above the low C-1 estimate. DC-001 §5.4–§5.5 and OD-002 §7.5 say zero float at 12 d (RDR-002 §11.1). Owner: `RDR-002 Q-11`.
- **Estimate inclusion is unresolved.** PROP-001's 4.5–8.0 d may sit inside or on top of C-1. RDR-002 §11.3's overrun conditions stand unchanged.
- **New, unestimated scope from this assessment:** the P0 security fix (A + B across 3 routes and 6 writers), the same-class route review, composite FKs if chosen, the reproduction, and detection. **No estimate is produced or adopted, and no date is moved.** If the P0 fix runs on the same single sequential owner, it consumes Milestone A′ float one-for-one unless the owner schedules it separately (`RDR-002 Q-11`, CA-003 P0-Q1).

---

## 10. Exit criteria for PI-C1 readiness

PI-C1 lifecycle-ordering implementation may be *considered* for authorization only when **all** of these hold:

1. **P0 security:** CA-003 P0-Q1 is decided. If standalone, the ownership fix is merged through its own governed Story, P0-T1…T10 pass on a disposable stack, and the same-class review (P0-Q4) is complete or explicitly scoped out by the owner.
2. **Baseline:** V-24 is done by a human, and RDR-002 §2.3 is re-verified at the committed SHA.
3. **Decisions:** `RDR-002` Q-1, Q-2, Q-3, Q-4, Q-6, Q-7, Q-8, Q-11, Q-12, Q-14 and Q-15 are answered and recorded with qualified references.
4. **Design:** a revised design document reflecting those answers, with a recorded hash.
5. **Verification:** V-01, V-02, V-04 (or V-09), V-05, V-08, V-10, V-11, V-12 and V-19 **PASS** with retained evidence. V-07 passes or is explicitly accepted as a gap. V-18 has a remediation decision.
6. **Review:** independent and security review per `RDR-002 Q-12`.
7. **Schedule:** owner response to `RDR-002 Q-11`. No implicit baseline change.
8. **Governance:** an OMNI Story whose Authorized Paths match the scope; `gov verify` only.
9. **Boundaries intact:** append-only, no backfill, retention unchanged, Q3 untouched.

**Current state against these criteria: 0 of 9 met. PI-C1 is NOT READY.**

`C:\virality` remains **ON HOLD**. It needs these criteria met **and** a separate explicit authorization, neither of which exists.

---

## 11. What was and was not changed

**Changed:** this file only, `docs/pmo/prospect-intelligence/PI-C1-REMAINING-ISSUE-CLOSURE-ASSESSMENT-003.md`.

**Not changed:** application code, tests, migrations, schemas, grants, configuration, feature flags, environment, deployment settings, database records, existing governance records (PROP-001, OR-001, RDR-002, GATE-001, DC-001, OD-002 hashes unchanged), git history, index or stash. No Docker, database, service, production or `C:\virality` access. No secret values were read.

**Commands used:** read-only `git` (`status`, `diff`, `show`, `log`, `grep`, `rev-parse`, `merge-base`), `grep`, `sed`, `sha256sum`, `ls`, `wc`.

### Files inspected
- **Diffed HEAD vs WT:** `pages/api/active-leads/lifecycle.ts`, `backend/services/opportunityLifecycleService.ts`. Also compared on `main`.
- **Auth and roles:** `backend/services/userContextService.ts:100-300`, `backend/services/rbacService.ts:176-201`.
- **Credentials (variable names and code paths only):** `backend/db/supabaseKeys.ts:60-95`.
- **Adjacent routes:** `pages/api/active-leads/workflow.ts`, `escalations.ts`, `graph.ts` (grep); `backend/services/opportunityWorkflowService.ts:25-60`; `backend/services/opportunityGraphService.ts:279-291`.
- **Schema and history:** `supabase/_schema/baseline.sql` FK grep; `git log -S` for the `?? 'detected'` default.
- **Governance records:** the six artifacts hashed in §2.

**This is not independent review.** It was produced by the same model family as every prior artifact in this chain.
