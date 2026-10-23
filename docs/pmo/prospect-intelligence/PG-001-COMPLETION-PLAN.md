# PG-001 — CONSOLIDATED COMPLETION PLAN

**Planning and evidence consolidation only. No implementation performed or authorized by this document.**

Repository `C:/tmp/r1-ctx` · branch `fix/r1-profile-context` · HEAD `29fea38a2d1642c1c2fd957e5151f6be81415774`
Product: Omnivyra (Prospect Intelligence / Unified Outreach). Not Drishiq.
Date: 2026-10-15

---

## 1. Baseline verification

| Check | Result |
|---|---|
| Path / branch / HEAD | All three match the expected baseline |
| Worktree | **86 entries (51 M / 35 ??)** — matches the expected audited state |
| PG-001 stage 1–2 artefacts | `contactPurpose.ts` `e539c60fe0cc2a0f`; `pg001ContactPurposeContract.test.ts` `3078b6e967ae55d6` |
| D1 audit | `C:/tmp/pg001-d1-classification-audit.md`, 38,631 bytes, outside the repo |
| Nothing cleaned/reset/stashed | Confirmed. No file modified by this task |

**Material fact the plan must account for:** `git diff --shortstat HEAD` = **51 files, 3,761 insertions, 408 deletions — none committed**, and the set spans *several* programmes (governance chain, Integration Hub, discovery, relationship attributes). See **Risk R-1**.

## 2. Current work ledger

| # | Item | State | Evidence | Remaining | Batch |
|---|---|---|---|---|---|
| 1 | PG-001 stages 1–2 — vocabulary, defaults, `purposeApplies`, NOT-WIRED tripwire | `IMPLEMENTED_AND_VERIFIED` | 4C-6B closeout: typecheck 3/3 EXIT=0 (post-edit, 12:21), 14 suites **320/320**; `pg001ContactPurposeContract` tests 1–16 | None | — |
| 2 | The new test file's **types** | `UNVERIFIED` | All three tsconfigs exclude `backend/tests` + `**/*.test.ts`; ts-jest is transpile-only | Accept, or add a tests-only project | C |
| 3 | D1 historical classification | `DECISION_REQUIRED` | D1 audit §3 rows 1–14, §5 DR-1…DR-9, §6 LQ-1…LQ-5 | One decision round | — |
| 4 | Stage 3 — `purpose_scope` schema | `IMPLEMENTATION_REQUIRED` + `BLOCKED_BY_AUTHORIZATION` | D1 §8 | Design in A; file only if authorized | A |
| 5 | Stage 4 — historical backfill | `DEFERRED` (recommended) | D1 §7.1 — unlabelled ≡ `all` today | **Recommend not doing it**; see §4.1 | — |
| 6 | Stage 5 — shadow evaluation | `IMPLEMENTATION_REQUIRED` | Nothing to shadow until rows carry scope | Optional; see §5 Batch C | C |
| 7 | Stage 6 — enforcement | `IMPLEMENTATION_REQUIRED` + `BLOCKED_BY_AUTHORIZATION` | Blocked on **LQ-4** for account paths | Evaluator + dispatch wiring | B |
| 8 | Stage 7 — legacy retirement | `BLOCKED_BY_AUTHORIZATION` | DR-8 (`__global__`), DR-9 (`outreach_suppressions`) | Out of PG-001 scope | — |
| 9 | E4 domain-reminder exemption | `IMPLEMENTED_AND_VERIFIED` | Owner decision; `w2c5b` test 6b proves no governance call on that path | None. **E4 only** | — |
| 10 | E2 (queue drain) / E5 (activation outreach) | `DECISION_REQUIRED` | 4C-5A/5B category 2b; LQ-4 | Decision, then wiring | B (if decided) |
| 11 | Path B `lead_outreach` allow-list gap | `BLOCKED_BY_AUTHORIZATION` | `KNOWN_TYPES` omits `lead_outreach`; Edge Function change ⇒ deployment | Out of scope; makes end-to-end certification impossible (**R-7**) | — |
| 12 | Operator `reason` unvalidated → DNC | `IMPLEMENTATION_REQUIRED` | D1 §4 facts 9–10; `execution.ts:112` | Bounded fix proposed §4 DR-3; **not authorized** | B (if authorized) |
| 13 | R1 — normalised Path C/D comparisons | `IMPLEMENTED_AND_VERIFIED` | `readiness.ts` `29ef3566…`, `leadIntelligenceReadService.ts` `18f73eb2…`; `piWs8OutreachReadiness`, `leadIntelligenceReadService` suites | None | — |
| 14 | R2 — legacy release truthfulness | `IMPLEMENTED_AND_VERIFIED` | `w2c4cReleaseTruthfulness` `c69160f3…`; three outcomes incl. observed `no_match` | None | — |
| 15 | R3-A′ — recorded-spelling release | `IMPLEMENTED_AND_VERIFIED` | `w2c4fProvenanceRelease` `f6f22e54…`; `norm(target_raw)` key recovery | None | — |
| 16 | R3-B | `DEFERRED` | 4C-4G: no concrete source-level requirement | Stays deferred | — |
| 17 | 4C-2 `scopesEvaluated` / 4C-3C `matchedBy` | `IMPLEMENTED_AND_VERIFIED` | `w2c2ScopesEvaluated`, `w2c3cMatchedBy` (21 tests), `w2c3cMatchedByRoute` | None | — |
| 18 | W2-B person resolution + legacy write/release failure handling | `IMPLEMENTED_AND_VERIFIED` | `suppressionService.ts` `6f42c0a0…`; `w2bSuppressionCorrectness`, `w2bSuppressionRouteTruthfulness` | None | — |
| 19 | 4C-5B email boundary contract + inventory guard | `IMPLEMENTED_AND_VERIFIED` | `w2c5bEmailGovernanceBoundary` 10 tests; 4 classified invokers | None | — |
| 20 | **Database-backed verification of the whole chain** | `UNVERIFIED` | Every governance suite uses in-memory doubles. **No PostgREST, RLS, CHECK, uniqueness or trigger behaviour has been exercised** | Cert-env run (**separate authorization**) | C |
| 21 | Everything above is **local and uncommitted** | `UNVERIFIED` at integration level | 51 M / 3,761 insertions vs HEAD | Commit authorization (**R-1**) | — |

**Nothing is relabelled complete because a contract or test exists.** Items 1, 13–19 are verified by executed suites with recorded exits; item 20 states plainly that none of that evidence is database-backed.

## 3. Consolidated decision register — ONE round

Technical = I can implement on your yes. Product/Owner = your call. Legal = counsel.

| # | Question | Options | **Recommended** | Consequence / evidence | Kind | Min. approval |
|---|---|---|---|---|---|---|
| **DR-A** | Must historical rows be classified for PG-001 to ship? | (a) yes, backfill first; (b) **no — purpose applies to NEW records only, historical stay unlabelled ≡ `all`** | **(b)** | Decouples the feature from D1 entirely. Unlabelled already behaves as `all` (`contactPurpose.ts:99`), so (b) changes **no** existing verdict and needs no backfill, no legal answer on LQ-5, no migration of data. **This is the single biggest schedule lever.** | Owner | Owner yes |
| **DR-1** | `unsubscribe`: source-specific or one per type? | (a) one; (b) **source-specific** | **(b)** for new records; historical unlabelled under DR-A | D1 rows 3 vs 4 are the same type with the same enforcement and incomparable provenance — row 3 carries `taskId`, row 4 carries nothing. Only row 3's writer can honestly record a scope | Product + **LQ-1** | Owner + legal for narrowing |
| **DR-2** | Is `dnc_channel` purpose-blind? | (a) **purpose-blind (`all`)**; (b) outreach-only on that channel | **(a)** | Channel and purpose are orthogonal axes; the type constrains channel only (D1 row 2). "Stop phoning me" most plausibly means all calls. (b) would need evidence no row carries | Product/Owner | Owner yes |
| **DR-3** | Operator `reason` validation defect | (a) leave; (b) **validate against the 7-value enum, 400 on mismatch, keep `default:` as defence-in-depth**; (c) also identify existing anomalous rows via `evidence.legacyReason` | **(b)** now; **(c)** when read access is authorized | Today any unrecognised string silently becomes a **DNC** with a rejected legacy mirror. (b) is ~10 lines, one route, no schema | Technical | Include in Batch B scope |
| **DR-4** | Do rows exist for the three writerless types? | — | **Authorized read required** | Cannot be answered from source. `UNRESOLVED` until then; the plan does not depend on it | Owner | Grant read, or accept `UNRESOLVED` |
| **DR-5** | What *is* `deferred`? | (a) contact restriction; (b) **temporal operational state, outside the purpose model**; (c) other | **(b)** | It returns `deferred` (backpressure), not `blocked`; it is the only type permitted `effective_until`. Purpose-scoping it would let an undated "contact me later" defer **security mail indefinitely** (D1 row 10). Keep purpose-blind; fix the undated case under ADR §22 P-1, separately | Product/Owner | Owner yes |
| **DR-6** | `campaign_exclusion` representation | (a) force into the 3-value vocabulary; (b) **leave inert and refuse to scope it**; (c) model campaign scope as its own dimension | **(b)** now, **(c)** only if band 9 is ever activated | It is **narrower** than `outreach`; `all` would be a *widening*. Band 9 is structurally excluded from `mayContact` (D1 row 11). Recommend a DB CHECK that **refuses** a purpose on this type | Technical + Owner | Owner yes |
| **DR-7** | Erasure inheritance | (a) **confirm inheritance**; (b) classify independently | **(a)** | `reanchored_from_record_id` + parents retained (ADR §16) make it computable. (b) would split one instruction into two purposes at the moment a person exercises erasure | Technical | Confirm |
| **DR-8** | `suppression_entries.__global__` | **retain blocking, no classification, separate gate** | **retain** | Cross-tenant rows have no tenant to classify within | Owner | Confirm retention |
| **DR-9** | `outreach_suppressions` | **exclude from purpose-awareness entirely; keep unconditional blocking** | **exclude** | No type column, nullable unconstrained reason, zero writers, gates **live sends** (D1 row 14) | Owner | Confirm exclusion |
| **DR-10** | Storage form of "applies to everything" | (a) write `'all'` into rows; (b) **nullable column; NULL ≡ all; CHECK IN ('outreach','account')** | **(b)** | Two spellings of one state is exactly what the canonical model exists to prevent — the same argument the ADR uses for `dnc_permanent`/`'*'`. NULL also keeps "undecided" visibly undecided | Technical | Owner yes (refines the approved vocabulary's storage, not its semantics) |
| **DR-11** | Does `purpose_scope` join the uniqueness key? | (a) no; (b) **yes — `coalesce(purpose_scope,'all')` in `uq_contact_governance_identity`** | **(b)** | Without it, an account-scoped and an outreach-scoped unsubscribe **collide** and the second is dropped as `already_present` — a silent loss of the narrower instruction. This is a migration-shaped decision and must be settled in Batch A | Technical | Owner yes |
| **DR-12** | E2 / E5 | — | **Blocked on LQ-4** | Do not generalize E4. E5 still has no production caller | Product + **LQ-4** | Legal then owner |

**Legal queue (unchanged from D1 §6):** LQ-1 unsubscribe breadth · LQ-2 `consent_withdrawn` lawful basis · LQ-3 complaint obligations · **LQ-4 mail that must reach a person regardless of any restriction** · LQ-5 retroactive reinterpretation.

**Under DR-A(b), only LQ-1 and LQ-4 remain on the critical path.** LQ-2, LQ-3 and LQ-5 become non-blocking, because nothing historical is reinterpreted and no narrowing is applied to those types.

## 4. Recommended target architecture

### 4.1 The strategic shape

**Purpose-awareness ships forward-only.** Every existing row stays unlabelled and therefore keeps applying to everything; only records created *after* the change can carry a scope, and only from a source that can prove one. This satisfies every invariant in §7 of the brief by construction — no historical record is reinterpreted, nothing silently weakens, and the conservative default is the storage default rather than a code path that has to be right.

### 4.2 Data model

| Element | Design |
|---|---|
| Column | `purpose_scope text NULL` on `contact_governance_records` |
| Meaning | `NULL` = unclassified = applies to every purpose. **`'all'` is never stored** (DR-10) |
| Value CHECK | `purpose_scope IS NULL OR purpose_scope IN ('outreach','account')` |
| Type CHECK | `purpose_scope IS NULL OR governance_type IN ('dnc_permanent','dnc_channel','unsubscribe','consent_withdrawn','complaint')` — the DB **refuses** to scope `bounce_hard`, `invalid_contact` (endpoint-intrinsic), `deferred` (DR-5) and `campaign_exclusion` (DR-6) |
| Uniqueness | `uq_contact_governance_identity` gains `coalesce(purpose_scope,'all')` (DR-11), so a narrow and a broad restriction coexist |
| Provenance | `evidence.purpose_basis` on any record written with a narrow scope; `source` continues to say who recorded it |
| Erasure | the re-anchor payload **must copy `purpose_scope`** alongside `governanceType` and `effectiveFrom`. Omitting it would silently widen a narrow instruction (**R-4**) |
| Backfill | **none** |

### 4.3 Runtime

| Element | Design |
|---|---|
| Filter position | In `mayContact`, after tenant + channel + `isInForce`, **before** the band sort — never folded into a band (a band is severity, purpose is applicability) |
| Attempt purpose | Declared **only at the execution boundary** (`dispatch`/transport). Planning, materialization, recommendation, readiness and export **never** declare one and therefore always evaluate as `all` |
| Signature | `attemptPurpose` **required** on the governed send path — a new egress path cannot compile without stating its purpose. `MayContactInput.purpose` stays optional and defaults to `all` |
| Fail-closed | Purpose is **not consulted** on any fail-closed path: store read error, missing tenant, failed or ambiguous identity resolution, unanchorable subject. All still block |
| Legacy stores | Both stay purpose-blind and keep blocking unconditionally (DR-8, DR-9) |
| Unchanged | bands and ordering, lowest-band-wins, `'*'` semantics, effective-date and revocation rules, tenant isolation, R1/R2/R3-A′ |

### 4.4 Final purpose/source mapping proposal

| Source | New records | Historical |
|---|---|---|
| `manual` via `/api/outreach/outcomes` (task- and person-anchored) | `'outreach'` **only if LQ-1 permits**; otherwise NULL | NULL |
| `suppression_service` via `/api/lead-intelligence/execution` | NULL unless the operator **explicitly** states a scope (new optional request field) | NULL |
| `webhook:<provider>` | `'outreach'` if LQ-1 permits; unreachable today | NULL |
| `person_erasure` | **inherited** from the parent row (DR-7) | inherited |
| `bounce_hard` / `invalid_contact` / `deferred` / `campaign_exclusion` | **refused by CHECK** — never scoped | NULL |
| legacy `suppression_entries`, `outreach_suppressions` | out of the model | out of the model |

## 5. Three-batch implementation plan

### Batch A — Contract and data-model completion *(design only)*
**Needs:** DR-A, DR-1, DR-2, DR-5, DR-6, DR-7, DR-10, DR-11 answered. LQ-1 only if a narrow scope will actually be written.
**Work:** finalize the §4 contract in `contactPurpose.ts`; specify CHECKs, the uniqueness change, erasure inheritance and the API surface; enumerate migration + rollback requirements; state the certification plan.
**Migration file:** written **only** under an explicit file-authoring authorization (§6 row 3). Never applied in this batch.
**Parallelizable:** contract text ∥ migration drafting ∥ certification plan. **One canonical owner** for `contactPurpose.ts` and the migration.
**Exit:** owner sign-off on the contract and on DR-10/DR-11; migration file reviewed and **unapplied**; no runtime file touched; typecheck 3/3.

### Batch B — Integrated implementation
**Needs:** Batch A exit; LQ-4 **only** if account paths are to be governed (otherwise B governs outreach paths only and E2/E5 stay untouched); DR-3 in scope for the reason fix.
**Work, grouped by file owner so no two tasks touch one file:**

| Task | Files | Parallel? |
|---|---|---|
| B1 — purpose filter in the evaluator + optional input | `contactGovernance.ts` | canonical owner |
| B2 — declare purpose at the execution boundary | `dispatch.ts`, `emailTransport.ts` | after B1 |
| B3 — writer records scope + `purpose_basis` | `contactGovernanceWriter.ts` | ∥ with B1 |
| B4 — erasure copies `purpose_scope` (**R-4**) | `personErasure.ts`, `erasurePlan.ts` | ∥ |
| B5 — operator `reason` validation (DR-3) | `pages/api/lead-intelligence/execution.ts` | ∥ |
| B6 — optional operator scope field | same route + `suppressionService.ts` | after B5 |
| B7 — repository selects the new column | `contactGovernanceRepository.ts` | ∥ |

**Preserved explicitly:** fail-closed behaviour, tenant isolation, release truthfulness (R2), recorded-spelling release (R3-A′), normalised comparisons (R1), legacy blocking, E4 exemption as-is.
**Exit:** targeted suites green per task; `pg001ContactPurposeContract` tests 13–16 **deliberately updated** from "nothing imports this" to "exactly these callers import it", with the no-other-caller guarantee retained; typecheck 3/3; no existing assertion weakened without a disclosed positive replacement.

### Batch C — Integrated regression, certification, defect remediation
**Work:** full governance + security regression set; purpose-mismatch and unknown-purpose matrices; source-specific unsubscribe; broad-restriction non-bypass (channel/campaign/workflow); endpoint normalization; release-failure truthfulness; tenant isolation; fail-closed under unreadable stores; every email/outreach egress path and each approved exemption; typecheck; **cert-env database-backed run** for the CHECKs, the uniqueness change and the trigger/RLS behaviour (separate authorization — see R-2); one prioritized defect list, fixed together, affected gates rerun.
**Full application suite:** only at the integrated release gate, unless an earlier failure justifies it.
**Exit:** every negative guarantee has fail-before or mutation evidence; defect list empty or owner-accepted; `UNVERIFIED` items either closed or explicitly carried with reasons.

### Is three cycles enough?
**Yes — to a shadow-validated, enforcement-ready state for outreach paths, under DR-A(b).**
**No** if any of these hold, and I will not promise otherwise: historical classification is required (adds a backfill cycle plus LQ-5); account-path enforcement is in scope (blocked on LQ-4); production enforcement must be certified end-to-end (blocked on the Path B allow-list gap, **R-7**); or a Batch C gate fails.

## 6. Authorization matrix

| # | Operation | Status |
|---|---|---|
| 1 | Read-only inspection, local report outside the repo | **AUTHORIZED** |
| 2 | Local source and test edits | **NOT_AUTHORIZED** for this task (planning only); was authorized per-gate previously |
| 3 | Writing local migration files | **REQUIRES_SEPARATE_APPROVAL** — explicitly not inferred from this request |
| 4 | Database creation/use, queries, row counts | **NOT_AUTHORIZED** (blocks DR-4) |
| 5 | Backfill or data mutation | **NOT_AUTHORIZED** (and recommended never — DR-A(b)) |
| 6 | Shadow evaluation | **REQUIRES_SEPARATE_APPROVAL** |
| 7 | Runtime enforcement activation | **REQUIRES_SEPARATE_APPROVAL** (+ LQ-4 for account paths) |
| 8 | Legacy-store / scope retirement | **NOT_AUTHORIZED** (DR-8, DR-9 undecided) |
| 9 | Commit and push | **NOT_AUTHORIZED** — see **R-1** |
| 10 | Production deployment | **NOT_AUTHORIZED** |

## 7. Integrated test and release-readiness matrix

| Gate | Command / scope | Covers | Evidence level | Status |
|---|---|---|---|---|
| G1 | `jest` × 14 governance suites `--runInBand --forceExit` | Paths A–D, release truthfulness, provenance release, normalization, email boundary, dispatch, PG-001 contract | **unit, in-memory doubles** | **PASS — 320/320, exit 0** (4C-6B) |
| G2 | `npm run typecheck` (3 projects) | all production source incl. `contactPurpose.ts` | type-level | **PASS — 3/3, EXIT=0**, post-edit |
| G3 | test-file typechecking | `backend/tests/**` | — | **NOT RUN** — excluded by all three tsconfigs; ts-jest transpile-only |
| G4 | CHECK / uniqueness / trigger / RLS behaviour | migration correctness, DR-11 key, scope-refusal CHECK | **database-backed** | **NOT RUN** — requires cert env + authorization (**R-2**) |
| G5 | purpose-mismatch + unknown-purpose matrix | `purposeApplies` wired through the evaluator | unit | **NOT RUN** — Batch C |
| G6 | egress-path coverage | every invoker governed or explicitly exempt | unit inventory | partial — `w2c5b` classifies 4 invokers today |
| G7 | end-to-end governed email delivery | Path B outreach | production | **IMPOSSIBLE today** — `lead_outreach` absent from `KNOWN_TYPES` (**R-7**) |
| G8 | full application suite | whole repo | unit/integration | **NOT RUN** — integrated release gate only |

A typecheck is never offered as proof that test files typechecked (G3), and no in-memory double is offered as proof of PostgREST, RLS, CHECK or trigger behaviour (G4).

## 8. Critical risks and stop conditions

| # | Risk | Stop condition |
|---|---|---|
| **R-1** | **51 files / 3,761 insertions uncommitted**, spanning several programmes. A worktree loss destroys the entire W2 + 4C + PG-001 chain and more. This is the largest practical risk on the plan and it grows with every gate | **Do not begin Batch B until either the existing work is committed under an explicit authorization, or you accept the loss exposure in writing.** Note that a commit here would mix programmes, so scoping is itself a decision |
| **R-2** | No database-backed evidence exists anywhere in this chain | **Do not activate enforcement (§6 row 7) on unit evidence alone.** G4 must run in the cert env first |
| **R-3** | `campaign_exclusion` defaulting to `all` would convert a one-campaign exclusion into a total block if band 9 is ever activated | Ship the type-refusal CHECK in the same migration as the column (DR-6) |
| **R-4** | Erasure not copying `purpose_scope` would silently re-scope an instruction at the moment of erasure | B4 is a **required** task, not optional; a test must fail before the fix |
| **R-5** | Omitting `purpose_scope` from the uniqueness key drops the narrower record as `already_present` | Settle DR-11 in Batch A, before any migration file is written |
| **R-6** | Enforcing `mayContact` on account paths without LQ-4 could block security, breach and billing mail | Account-path governance stays out of scope until LQ-4 is answered |
| **R-7** | Path B email is governed but **non-deliverable**, so purpose enforcement cannot be observed end-to-end in production | Do not claim production verification of governed outreach email while the allow-list gap stands |
| **R-8** | `DECISION_REQUIRED` items answered piecemeal would restart the audit loop this plan exists to end | Hold **one** decision round covering DR-A…DR-12 + LQ-1, LQ-4 |

## 9. Expected artifacts and final acceptance criteria

**Artifacts:** updated `contactPurpose.ts` contract (A) · one migration + rollback file, unapplied (A, if authorized) · changes to the seven files in B1–B7 (B) · updated `pg001ContactPurposeContract` wiring guards (B) · new purpose-matrix suite (C) · cert-env G4 evidence (C, if authorized) · one prioritized defect list with resolutions (C) · a release-readiness matrix in the G1–G8 shape.

**Acceptance criteria.** Purpose narrows applicability **only** via an explicit classification on a record, and only for the five types the CHECK permits. No existing row's verdict changes. Every fail-closed path still blocks and is proven to. Tenant isolation, R1/R2/R3-A′ and the E4 exemption are byte-or-behaviour unchanged. Legacy stores still block unconditionally. Every egress path is governed or carries a named, owner-approved exemption. G1, G2 and G5 pass with recorded exits; G4 passes or is explicitly carried as `UNVERIFIED` with the owner's acceptance; G3 and G7 are reported as not-run with their reasons. No schema or production fact is claimed without authorized evidence.

---

**Baseline rechecked after writing this plan: branch, HEAD and worktree unchanged; no repository file modified. This report is at `C:/tmp/pg001-completion-plan.md`, outside the repository.**

**Stopping here. The next step is one consolidated owner/legal decision and authorization round — not another audit.**
