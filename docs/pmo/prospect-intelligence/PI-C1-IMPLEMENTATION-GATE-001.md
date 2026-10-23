# PI-C1-GATE-001 — opportunity-spine implementation readiness gate

**STRICTLY READ-ONLY.** No implementation, no migration created, no database write, no production access, no production migration-history query, no provider call, no credential, no company-event source authorized, no commit, push, merge or deployment, no feature-flag change, and no other worktree touched. See §11 for the explicit statement.

**This report is not authorization to implement.**

---

## 1. Executive verdict

### **NOT READY** — two owner policy inputs outstanding. **No technical prerequisite fails.**

C-1 is specified to implementation depth. Every schema, transaction, authorization, audit, concurrency and test requirement has a verified precedent in this repository, and the three decisions that previously blocked the schema (D-B, D-H FK action, D-I) are **approved by this brief**.

Two things still prevent a safe start, and neither is engineering work:

| # | Outstanding | Why it blocks |
|---|---|---|
| **1** | **D-H resolution semantics.** `ON DELETE RESTRICT` is approved, but *what counts as resolved*, *who may resolve*, and *what the operator does instead* are not specified | Shipping RESTRICT without a resolution path makes an account with one open opportunity **permanently undeletable**. That converts an approved safety control into a retention-and-erasure defect. The FK cannot be safely defined until the resolution states exist |
| **2** | **C-1's core deliverable has no requirement identifier.** `IMPLEMENTATION-MANIFEST-001.md` — the ratified requirements carrier — contains **zero occurrences of "opportunit"** | C-1 would be the first PI work package built with no BR/FR/AC backing. That is a governance decision for the owner: add a requirement, or record C-1 as authorized-by-direction |

This is **not** BLOCKED in the external-dependency sense. Both items are owner decisions that can be made quickly, and §10 states each in the smallest answerable form.

**Smallest authorized next action:** answer D-H's resolution states and decide the requirement-identifier question. Nothing else is required to authorize C-1a.

---

## 2. Verified repository and worktree baseline

Measured, not assumed.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree | — | **129 entries (67 M / 62 ??), 0 staged** | unchanged from the DESIGN-002 close state; nothing reset, cleaned, stashed, switched or disturbed |

### Controlling-document hashes — all verified unchanged

| Document | SHA-256 (24 hex) |
|---|---|
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-002.md` | `34564a452997d1a8efca32c3` |
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` | `257185e621fa0b80eb970d4b` |
| `OMNIVYRA-PI-INTENT-CAPABILITY-AUDIT-001.md` | `37dda8956cc81b03a88e9b31` |
| `PI-MILESTONE-A-EXECUTION-001.md` | `1ad1105accdd5866aa8a61df` |
| `PI-MILESTONE-A-CLOSURE-AUDIT-001.md` | `582e63b7e65540cf4b52a7ab` |
| `IMPLEMENTATION-MANIFEST-001.md` (requirements carrier) | `651575cd73f1c3a7e6e04f0d` |

### The requirements carrier

**There is no definitive PI BRS/FRS on disk.** Searched `docs/pmo/prospect-intelligence/` for `BRS`, `FRS` and `definitive`: none. The approved repository carrier is `IMPLEMENTATION-MANIFEST-001.md`, whose own governing specification ("AI Implementation Playbook V2") remains absent from disk and from every commit on every ref — a finding carried unchanged from the closure audit. This gate therefore traces to the manifest, and says so where traceability is absent (§4.3).

---

## 3. Owner decisions applied, and decisions that remain open

### 3.1 Applied as explicit owner policy directions

| ID | Direction as given | Effect on the design |
|---|---|---|
| **D-B** | Account-only, person-only, or both; at least one subject. **Do not mint a person to satisfy a schema constraint** | **Confirms** DESIGN-001 §3.3 `CHECK (account_id IS NOT NULL OR person_id IS NOT NULL)`. Adds an explicit prohibition now encoded as acceptance test **T-3** |
| **D-H** | **Restrict** account deletion while open opportunities remain, with a governed resolution path. Specify states, authorization and failure behaviour. **Do not invent unresolved resolution semantics** | **Resolves** the DESIGN-002 §6.2 blocking sub-case in favour of option (b). Mechanism specified in §6.4; the **policy gap is reported, not invented** — §10 item 1 |
| **D-I** | Dedicated relational buying-role table; inference distinguishable from verified identity, provenance retained; **no person created from an inferred role** | **Confirms** `prospect_opportunity_roles` over the jsonb variant. The jsonb alternative is withdrawn |
| **D-A** | Community Discovery owns interpretation/classification/clustering/explanation/next-action; PI owns the canonical opportunity spine and qualification record | **Confirms** the DESIGN-001 §2.3 recommendation |
| **D-A.1** | Strictly one-way `Community Discovery → PI`. PI must not write back to opportunity-feed records. **Reference existing signals rather than duplicating them** | **Confirms** DESIGN-002 §1.1 and §1.3. The reference-not-duplicate instruction is already the design (`prospect_opportunity_signals` → `lead_signals`) |
| **D-J** | Baseline is the **same authorized operator using step-up**; a second approver only for designated high-risk actions. Identify existing mechanisms. **Do not invent the high-risk catalogue** | Mechanisms identified in §8.4. The catalogue is **not invented** and is reported as a remaining policy requirement — §10 item 3 |

### 3.2 Explicitly still open — no approval inferred

| ID | Status | Exact current definition retained |
|---|---|---|
| **OD-3** | **OUTSTANDING — blocker** | List permissions, archive/un-archive semantics, super-admin bypass (`PL-DEC-001`). Blocks **WP-4** |
| **OD-4** | **OUTSTANDING — blocker** | `added_via` contract (`PL-DEC-002`). Blocks **WP-4** |
| **OD-5** | **OUTSTANDING — blocker** | Person-erasure residue (`PL-DEC-003`): **A** accept · **B-1** hard delete · **B-2** soft remove. Blocks **WP-5** |
| **D-C** | **OPEN** | Person/contact identity reconciliation. Blocks **C-2**, not C-1 |
| **D-E** | **OPEN** | Need-to-offering matching method, curated vocabulary vs embeddings. Blocks **C-4**, not C-1 |
| **Company-event sources** | **NOT AUTHORIZED** | No source is authorized. The existence of `SIGNAL_WEIGHT`/`SIGNAL_HALFLIFE` for `funding`, `exec_change`, `hiring`, `expansion`, `acquisition`, `tech_migration` in `engines/buyingSignal.ts` is **code, not authorization**. `ctx.signals` has no producer and this gate does not create one |
| **Production migration state** | **UNVERIFIED** | Four PI migrations (`20261119000000`, `20261123000000`, `20261124000000`, `20261127000000`) plus `20261128000000` remain `UNVERIFIED` in production. Not queried here — production migration history is a prohibited operation in §6 |
| **Production tenant isolation** | **UNVERIFIED** | Local isolation proven (WP-3, 26 tests). Production ACLs never read. `service_role` holds `BYPASSRLS` and the application connects as `service_role` |
| **OD-8** | **OPEN** | Tenant-predicate RLS design track. Not part of C-1 |
| **D-J catalogue** | **OPEN (new)** | The designated high-risk action list. Not invented here |

No blocker above is closed by assumption, code convenience, or an unverified historical decision.

---

## 4. C-1 scope, exclusions and traceability

### 4.1 In scope

| # | Deliverable |
|---|---|
| S-1 | `prospect_opportunities` — canonical opportunity entity, tenant-scoped, subject CHECK per D-B |
| S-2 | `prospect_opportunity_signals` — **references** `lead_signals`, never copies content (D-A.1) |
| S-3 | `prospect_opportunity_roles` — relational buying-role entity with mandatory inference provenance (D-I) |
| S-4 | `prospect_score_evaluations` ALTER — `opportunity_id`, `prospect_id` relaxed, `num_nonnulls(...) = 1` coherence CHECK |
| S-5 | One atomic plpgsql write function over S-1…S-4 |
| S-6 | Account-deletion resolution gate per D-H (**pending §10 item 1**) |
| S-7 | Service + routes with `requireCapability`, step-up, `withIdempotency` |
| S-8 | Migration rollback script, per the existing convention |
| S-9 | Real-schema acceptance tests and negative controls (§7) |

### 4.2 Explicitly out of scope

The bridge itself (C-2 — needs D-C); need-to-offering matching (C-4 — needs D-E); company-event producer (C-3 — not authorized); the second-approver flow (C-5 — needs the D-J catalogue); any change to WP-2 atomicity, WP-3 security, arbitration or canonical write semantics; OD-3/OD-4/OD-5; any RLS change (OD-8); any production operation.

### 4.3 Traceability — and a governance gap

| C-1 element | Requirement in the carrier | Status in carrier |
|---|---|---|
| Buying role | **FR-21** (Buying Role, relationship graph edges, WS-7) | **PARTIAL** |
| Buying committee | **FR-22**, **BR-25** | **PARTIAL / PARTIALLY SATISFIED** |
| Intent contribution | **FR-19** (`engines/intent.ts`) | EXISTS |
| Engagement evidence | **FR-20** (`engines/behavioral.ts`, `lead_signals`) | EXISTS |
| Suppression at action time | **FR-27** (`contact_governance_records`) | EXISTS |
| **Canonical opportunity / need entity (S-1, S-2, S-5)** | **NONE** | **NO REQUIREMENT EXISTS** |

**Evidence:** `grep -nE 'opportunit' IMPLEMENTATION-MANIFEST-001.md` returns **zero matches**. The ratified carrier does not ask for an opportunity entity.

A related, favourable finding: **need-to-offering matching *is* ratified.** The carrier's attribute-source table lists **FR-16 Account → `product/service alignment`** and **FR-17 Person → `problem relevance`** as **"REQUIRED — NOT YET IMPLEMENTED"**. So C-4 is an unimplemented ratified requirement, not new scope. (Those rows show dashes in the source/provider columns, meaning no *attribute source* exists — the same is true of FR-21's `authority`/`influence`/`buying_role`, whose columns do exist in `PERSON_ATTRIBUTE_COLUMNS` but have no provider populating them.)

**Gate consequence:** C-1's core deliverable is authorized by owner direction and by nothing in the requirements carrier. This is §1 outstanding item 2.

---

## 5. Prerequisite / blocker matrix

Evidence verified directly in this repository during this gate. "Prior report" is marked where the claim rests on an earlier verified artefact rather than a fresh inspection.

| # | Prerequisite | Status | Evidence | Action to clear |
|---|---|---|---|---|
| P-1 | Repository/branch/HEAD baseline | **PASS** | §2, measured | — |
| P-2 | Controlling documents unchanged | **PASS** | §2, six hashes | — |
| P-3 | Frozen schedule baselines match the ledger | **PASS** | §9.1 — all three verified | — |
| P-4 | D-B, D-H FK action, D-I approved | **PASS** | §3.1 | — |
| P-5 | D-A / D-A.1 approved | **PASS** | §3.1 | — |
| P-6 | Tenant-safe composite FK pattern exists | **PASS** | `prospect_list_members` → `(prospect_id, organization_id) → canonical_leads(id, company_id)`; cross-tenant writes proven unconstructible (`23503`) in WP-6 tests 16, 27 | — |
| P-7 | `ON DELETE RESTRICT` is an established convention | **PASS** | **45 occurrences** across `supabase/migrations/*.sql` (vs 3 `NO ACTION`) | — |
| P-8 | Governed delete-refusal (trigger) precedent | **PASS** | `BEFORE DELETE ON public.*` triggers on `admin_financial_audit_events`, `billing_operations`, `billing_settlement_events`, `content_core_asset`, others; 72 migrations use `RAISE EXCEPTION` | — |
| P-9 | Atomic multi-table write precedent | **PASS** | `pi_apply_canonical_decisions` (`20261128000000`, hash `3ce166ae2cb894d5`); `pi_relationship_set_primary` (`20261122000000`) — plpgsql, tenant-first, `FOR UPDATE`, invoker rights, `RAISE EXCEPTION` | — |
| P-10 | Partial unique index precedent for duplicate prevention | **PASS** | `uq_prospect_list_members_active` — `CREATE UNIQUE INDEX … WHERE status = 'active'` (`20261127000000:236`), with the total-index alternative explicitly rejected at `:87-90` | — |
| P-11 | Two-session concurrency test method | **PASS** | `pl_prospect_lists.test.ts:725-726` asserts a real lock (`57014` / `canceling statement`) then `23505` | — |
| P-12 | Authorization primitive | **PASS** | `requireCapability(req, res, {capability, organizationId, resourceId})` — `backend/security/requireCapability.ts:81` | — |
| P-13 | Step-up primitive (D-J baseline) | **PASS** | `AuthorizationService.ts:248-277` — `StepUpRequirement`, `evaluateStepUp`, `STEP_UP_DENIED`, `STEP_UP_REQUIRED` → 401; `stepUpStatus: 'not_required' \| 'required' \| 'satisfied' \| 'not_applicable'` (`:307`) | — |
| P-14 | Audited denial sink | **PASS** | `logSecurityEvent` → `capability_audit_log` (`requireCapability.ts:144`); audits unauthenticated attempts against the capability (`:89-95`) | — |
| P-15 | Second-approver machinery exists | **PASS, with a caveat** | DB-enforced: `required_approvals_for_action()` threshold lookup + `sign_credit_action_approval()` multi-actor sign-off + `credit_action_approval_signatures` (`creditApprovalService.ts:10-11, 92, 162, 282`). **Caveat: it is credit/billing-action scoped, not generic** — reuse for opportunities needs generalization or a parallel, which is C-5 scope | — (C-5) |
| P-16 | Route idempotency primitive | **PASS** | `withIdempotency(handler, {methods, scope, staleLockMs})` — `backend/middleware/withIdempotency.ts:219-226`; defaults POST/PUT/PATCH/DELETE, does not wrap GET | — |
| P-17 | Migration rollback convention | **PASS** | `supabase/migrations/rollbacks/` — **30 scripts** | C-1 must ship one |
| P-18 | Contradiction handling exists | **PASS** | `contradiction.ts` (LI-B107): conflicting sources, stale-vs-fresh 30d, confidence divergence 0.25, stated-vs-observed, AI conflict; *"evidence is NEVER silently overwritten or deleted; the loser is retained"* | — |
| P-19 | Consent evaluator exists and is tenant-scoped | **PASS** | `contactGovernance.mayContact` (`:213`, pure, no I/O); WP-6 tests 23–25 incl. positive control and tenant-scoping | — |
| P-20 | Single scoring authority available for linkage | **PASS** | `prospect_score_evaluations` (`20261031000000`) carries `score_icp`, `score_intent`, `score_urgency`, **`score_opportunity`**, `score_priority`, `score_overall`, `confidence`, `rules_version`, `input_digest`, `contributions`, `reasoning`, `facets`, `context_gaps` | — |
| P-21 | `prospect_id` is currently `NOT NULL` on that table | **PASS (constraint confirmed)** | same migration — this is why S-4's ALTER is required | — |
| P-22 | Role table cannot reuse `person_account_relationships` | **PASS (confirmed blocker)** | `person_id NOT NULL` **and** `account_id NOT NULL` (`20261122000000`) — cannot hold an inferred role | — |
| P-23 | `lead_signals` usable as the referenced signal store | **PASS** | `organization_id uuid NOT NULL REFERENCES companies(id)`; `UNIQUE (organization_id, source_type, source_id)`; `detected_at NOT NULL`; CHECK `source_type IN ('engagement','listening')` | widening the CHECK is **not** C-1 scope |
| P-24 | Real-schema harness available | **PASS** | `scripts/ci/real-schema-ci.sh`; 37 suites / 835 tests at WP-6 close. **Its exit code is unusable as a gate** — exits 0 with failing suites | read counts from the runner |
| **P-25** | **D-H resolution semantics** | **OPEN — BLOCKING** | RESTRICT approved; resolution states, authority and operator path unspecified | **§10 item 1** |
| **P-26** | **Requirement identifier for the opportunity entity** | **OPEN — BLOCKING** | zero `opportunit` matches in the carrier (§4.3) | **§10 item 2** |
| P-27 | D-J high-risk action catalogue | **OPEN** | not invented here, per direction | §10 item 3 — blocks C-5, not C-1 |
| P-28 | D-C reconciliation policy | **OPEN** | — | blocks C-2 |
| P-29 | D-E matching method | **OPEN** | — | blocks C-4 |
| P-30 | Production migration state of PI migrations | **UNVERIFIED** | prohibited operation in this gate | operator read, separate authorization |
| P-31 | Production tenant isolation | **UNVERIFIED** | local only; `BYPASSRLS` on `service_role` | OD-8 track |
| P-32 | OD-3 / OD-4 / OD-5 | **BLOCKED** | unchanged definitions, §3.2 | owner decision; blocks WP-4/WP-5, **not** C-1 |
| P-33 | Company-event source authorization | **NOT APPLICABLE to C-1** | C-3 is out of scope (§4.2) | — |
| P-34 | 2 known pre-existing unit failures | **PASS (characterised)** | `boltExecutionRecovery.ts` (BOLT); `pages/prospects/index.tsx:108` — the latter is on the prospects UI page, so it affects WP-12, not C-1 | carried |

**Nothing in the matrix fails on technical grounds.** The two BLOCKING rows (P-25, P-26) are owner policy inputs.

---

## 6. Schema and architecture proposal

Unchanged from DESIGN-001 §3.3 / DESIGN-002 except where the approved directions required a change. Changes are marked **[D-x]**.

### 6.1 `prospect_opportunities`

`id uuid PK` · `organization_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE` · `account_id uuid` + composite FK `(account_id, organization_id) → prospect_accounts(id, organization_id)` **[D-H: `ON DELETE RESTRICT`]** · `person_id uuid` + composite FK `(person_id, organization_id) → unified_persons(id, company_id)` `ON DELETE SET NULL` · `opportunity_type text NOT NULL` CHECK over the existing eight Community values · `need_statement text` · `need_source text NOT NULL` CHECK `('classified_signal','company_event','manual','crm')` · `detected_reason text NOT NULL` · `detection_ref uuid` · `status text NOT NULL DEFAULT 'open'` CHECK `('open','qualified','disqualified','acted','closed','superseded')` · `dedupe_key text NOT NULL` + `UNIQUE (organization_id, dedupe_key)` · `first_detected_at` (immutable) · `last_detected_at` · `created_at` · `updated_at`.

**CHECK `(account_id IS NOT NULL OR person_id IS NOT NULL)` [D-B].** RLS enabled with the existing `service_role` policy for parity; `omnivyra_touch_updated_at` trigger, matching `20261127000000`.

### 6.2 `prospect_opportunity_signals`

`(id, organization_id, opportunity_id, signal_id, contribution text, linked_at)`; composite tenant-safe FKs onto `prospect_opportunities` and `lead_signals`; `UNIQUE (organization_id, opportunity_id, signal_id)`. **References signals; copies no content [D-A.1].**

### 6.3 `prospect_opportunity_roles` **[D-I]**

`(id, organization_id, opportunity_id, buying_role text NOT NULL, inferred_from text NOT NULL, confidence numeric, person_id uuid NULL, created_at)`.

- `buying_role` CHECK over the existing `BUYING_ROLES` vocabulary.
- `inferred_from` **NOT NULL**, CHECK `('title_keyword','resolved_role','relationship_graph','manual')` — **inference provenance is mandatory**, so an inference can never be read as a verified identity.
- `person_id` **nullable** — null is the normal Path B state; a later-discovered person is **linked**, not substituted, so inference and confirmation are both auditable.
- **No write path creates a person** — enforced by test **N-4**.

### 6.4 Account-deletion resolution gate **[D-H]** — mechanism specified, policy gap reported

**Mechanism (specifiable now):**
1. `ON DELETE RESTRICT` on the account FK — idiomatic here (P-7, 45 occurrences).
2. A `BEFORE DELETE` trigger on `prospect_accounts` raising a **named, non-leaking** exception when any non-terminal opportunity references it, following P-8 and the WP-2 rule that refusal messages never carry attribute values (a `need_statement` can contain personal data and refusals travel into logs).
3. Terminal states for this purpose: `closed`, `superseded`, `disqualified`. Non-terminal: `open`, `qualified`, `acted`.
4. Authorization for a resolution action: `requireCapability` + step-up (P-12, P-13), audited to `capability_audit_log` (P-14).
5. Failure behaviour: deletion refused atomically; nothing partially deleted; the refusal audited with the blocking opportunity count but **not** its content.

**Policy gap — NOT invented (§10 item 1):** whether the operator may bulk-resolve, whether a resolution requires a reason code and from what vocabulary, whether `acted` should count as terminal for deletion purposes, and whether a legal-erasure request may override RESTRICT. The last is the sharpest: an erasure obligation that RESTRICT blocks is a compliance conflict, and the resolution path must say which wins.

### 6.5 Person erasure

`person_id ON DELETE SET NULL` on both new tables. The opportunity survives **account-anchored**; the role survives as an inference. Consistent with `canonical_leads.unified_person_id ON DELETE SET NULL`, whose behaviour WP-2 real-schema test 19 pinned. Erasing a person removes the person, not the knowledge that a company has a need — and the remaining record names no individual. **Independent of OD-5**, which concerns list-membership residue and stays open.

### 6.6 Score-evaluation linkage and the one-authority invariant

ALTER `prospect_score_evaluations`: add `opportunity_id uuid` + composite tenant-safe FK; relax `prospect_id` to nullable; add `CHECK (num_nonnulls(prospect_id, opportunity_id) = 1)`.

**The invariant: one evaluation authority.** Fit, intent, confidence, qualification, `rules_version`, `reasoning` and `context_gaps` already live there. A second scoring store would be a second scoring model, which `combineScores` and `prospectContext.ts` exist to prevent. Pattern precedent: `20261124000000` performed exactly this kind of widening on `canonical_attribute_decisions` (nullable subjects + coherence CHECK).

### 6.7 Transaction boundary

**One** plpgsql function, on the P-9 precedent: tenant as first parameter, `FOR UPDATE` on the subject, **invoker rights (not `SECURITY DEFINER`)**, `RAISE EXCEPTION` on a missing or wrongly-tenanted subject. It writes the opportunity, its signal links and its roles **together or not at all**. Failure semantics per DESIGN-002 §8.3: a per-detection failure fails that detection alone; the batch resolves; governance unreadable ⇒ fail closed; replay is a no-op by `dedupe_key` and link uniqueness.

### 6.8 Migration reversibility

Additive forward migration plus a rollback script in `supabase/migrations/rollbacks/` (P-17). The three new tables drop cleanly. **The S-4 ALTER is the only non-trivial reversal**: re-imposing `prospect_id NOT NULL` fails if any opportunity-linked evaluation exists, so the rollback must either delete opportunity-scoped evaluation rows or refuse. **Forward-repair is the recommended strategy** — the rollback script should refuse rather than silently delete evaluation history, consistent with the append-only discipline already applied to `canonical_attribute_decisions`.

---

## 7. Acceptance tests and negative-control matrix

Method follows the suites that produced `i2l_intake_to_list` 27/27, `ca_canonical_write_atomicity` 21/21, `ti_authenticated_tenant_isolation` 26/26 and `pl_prospect_lists` 27/27. **Counts are read from the runner, never from a wrapper exit code** (P-24).

### 7.1 Positive and invariant tests (real schema)

| # | Assertion | Maps to |
|---|---|---|
| T-1 | An **account-only** opportunity persists (`person_id` NULL) | D-B |
| T-2 | A **person-only** opportunity persists (`account_id` NULL) | D-B |
| T-3 | An opportunity with **neither** subject is refused by the CHECK, and **no person is minted** to satisfy it | D-B |
| T-4 | Both-subject opportunity persists | D-B |
| T-5 | A detection creates one opportunity with `detected_reason` preserved verbatim | §6.1 |
| T-6 | Re-running creates no second opportunity; `last_detected_at` advances, `first_detected_at` does not | §6.1 |
| T-7 | Re-linking the same signal is refused (`23505`) and is a no-op | §6.2 |
| T-8 | A role row persists with `person_id` NULL and `inferred_from` set | D-I |
| T-9 | Linking a later-discovered person **updates** the role row; the inference is retained | D-I |
| T-10 | Evaluation links to an opportunity; `num_nonnulls = 1` refuses both-or-neither | §6.6 |
| T-11 | Account deletion is **refused** while a non-terminal opportunity exists; nothing partially deleted | D-H |
| T-12 | Account deletion **succeeds** once all opportunities are terminal | D-H |
| T-13 | Person erasure leaves the opportunity account-anchored, `person_id` NULL | §6.5 |
| T-14 | A suppressed subject still yields an opportunity; its action state is not actionable | FR-27 |
| T-15 | Governance is tenant-scoped: tenant B's unsubscribe does not suppress tenant A | FR-27 |
| T-16 | An opportunity with no evaluation reads `open`, never `disqualified` | §5 lifecycle |
| T-17 | Contradictory signals yield one opportunity, reduced confidence, **both signals retained** | P-18 |
| T-18 | `superseded` dedup retains the loser with a pointer to the winner | §5.3 |
| T-19 | Refusal messages contain no `need_statement` or attribute values | WP-2 rule |
| T-20 | Role `inferred_from` is mandatory — a NULL is refused | D-I |

### 7.2 Security, tenancy, concurrency, atomicity

| # | Assertion |
|---|---|
| T-21 | Cross-tenant `account_id` is **unconstructible** (`23503`) |
| T-22 | Cross-tenant `person_id` is unconstructible (`23503`) |
| T-23 | Cross-tenant signal link is unconstructible (`23503`) |
| T-24 | Cross-tenant **read** returns zero rows under two real `authenticated` sessions, with production-shaped grants re-created first so the denial is attributable to RLS and not to a missing GRANT |
| T-25 | An unauthorized action is **denied and audited** in `capability_audit_log` |
| T-26 | An action without satisfied step-up is denied with `STEP_UP_REQUIRED` and audited |
| T-27 | **Concurrent** duplicate creation: two real sessions race on `dedupe_key`; one wins, the other observes `23505` or the lock, and exactly **one** opportunity exists afterwards |
| T-28 | Retry after a failed attempt creates no second opportunity and no orphan links |
| T-29 | Forced failure on the signal-link insert leaves **no opportunity** |
| T-30 | Forced failure on the role insert leaves no opportunity and no links |
| T-31 | Forced failure leaves **no partial audit/provenance state** — no evaluation row, no decision row |

### 7.3 Negative controls — the harness must catch a real failure

Each plants a defect in the **disposable container only**, proves the corresponding test fails, then restores and re-asserts.

| # | Control | Proves |
|---|---|---|
| N-1 | Drop the subject CHECK → **T-3 must fail** | the CHECK is what refuses, not the test's own WHERE |
| N-2 | Replace `dedupe_key` unique index with a non-unique one → **T-6, T-27 must fail** | duplicate prevention is a real index |
| N-3 | Change the account FK to `ON DELETE CASCADE` → **T-11 must fail** | RESTRICT is what blocks deletion |
| N-4 | Add a person-creating write to the opportunity services → a tree-walking scan **must flag it** | no fictitious people (D-I), on the `caCanonicalSoleWriter` precedent with comment-stripping and string-literal handling |
| N-5 | Add a PI write to `opportunity_feed_items` / `lead_signals` / `signal_intent_clusters` / `active_leads` → the one-way scan **must flag it** | D-A.1 one-way enforcement |
| N-6 | Make the write function non-atomic → **T-29…T-31 must fail** | atomicity is the transaction, not the test |
| N-7 | Drop a tenant-safe composite FK → **T-21 must fail** | isolation is the schema |
| N-8 | Stub `mayContact` to always `allowed` → **T-14 must fail** | consent is evaluated, not assumed |
| N-9 | Relax `inferred_from` to nullable → **T-20 must fail** | inference provenance is mandatory |
| N-10 | Grant-only denial check: run T-24 **without** re-creating grants and confirm the failure mode is a privilege error, not a zero-row result | a missing GRANT cannot masquerade as isolation |

**Not safely testable, and recorded as such:** production isolation (prohibited), production migration state (prohibited), and any company-event path (no authorized source).

### 7.4 Gates

Full real-schema suite with **no new failures** against 37 suites / 835 tests · `npm run typecheck` 3/3 · backend-tests project with **0 diagnostics in new files** against its 551 pre-existing baseline · scoped PI unit regression with no new failures beyond the 2 known pre-existing · control-byte scan clean · WP-2/WP-3 artefacts unchanged by hash.

---

## 8. Security and tenant-isolation proof requirements

| Requirement | Proof |
|---|---|
| Tenant key convention | `organization_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE` on all three tables — matching every neighbour except the `lead_intelligence` outlier (`company_id text`, no FK), which is **not** a model to follow |
| Structural isolation | composite tenant-safe FKs; T-21…T-23 prove cross-tenant writes **unconstructible** |
| Authenticated-role isolation | T-24 under two real sessions, with grants re-created first (N-10 proves the distinction) |
| **Honest limit** | **Isolation on the live path is application + composite FKs, not RLS.** `service_role` holds `BYPASSRLS` and the application connects as `service_role`. Production isolation remains **UNVERIFIED** and this gate does not claim it |
| Authorization | `requireCapability` on every write route; platform authority for the bridge surface, per the CLOSURE-series finding that write routes need real authority rather than a VIEW-tier capability |
| **D-J baseline** | same operator + step-up: `StepUpRequirement` / `evaluateStepUp`, `STEP_UP_REQUIRED` → 401 so the UI can prompt (P-13) |
| **D-J second approver** | machinery exists but is **credit-action scoped** (P-15): `required_approvals_for_action()` + `sign_credit_action_approval()` + `credit_action_approval_signatures`. Generalizing it is **C-5**, and it needs the catalogue (§10 item 3) |
| Audit | `capability_audit_log` for allow/deny incl. unauthenticated attempts; `canonical_attribute_decisions` append-only for canonical reasons; `prospect_score_evaluations` for scoring reasons; `detected_reason` + `detection_ref` + signal links for why an opportunity exists. **No new audit table** — the repository already carries at least five |
| Source permissions | per-tenant `lead_ingestion` flag plus the global `ENABLE_LEAD_INGESTION` kill switch, which is checked **first**. Production values **UNVERIFIED** |
| Non-leaking refusals | T-19 — refusal text carries no need statement or attribute value |

---

## 9. Estimate, effort, critical path and forecast

### 9.1 Frozen baselines — verified against the ledger, no discrepancy

| Item | Brief states | **Ledger `1ad1105accdd5866`** | Result |
|---|---|---|---|
| Milestone A′ deadline | 2026-11-25 | §3.1 **Wed 2026-11-25** | **MATCH** |
| Milestone A′ effort | 28.5 human engineer-days | §3 **"Focused effort: 28.5 engineer-days"** | **MATCH** |
| WP-7 baseline finish | 2026-11-17 | §3 row WP-7 **Tue 2026-11-17** | **MATCH** |
| WP-7 budget | 4 engineer-days | §3 row WP-7 **4.0** | **MATCH** |

### 9.2 This gate task

| | |
|---|---|
| **Actual start** | **2026-10-17T16:31:29+05:30** |
| External wait before start | 1 h 03 min 33 s (DESIGN-002 close 15:27:56 → 16:31:29) — **not** engineering effort |
| Original estimate for this gate | **0.5 engineer-days** (read-only verification + report) |
| **75% of estimate reached at** | **0.375 engineer-days** of active effort |
| Active effort at report | **~5 minutes** — far below the 75% threshold; **no gate overrun** |
| Remaining estimate | 0 — the gate is complete at this report |
| Monitoring | **No continuous monitoring is claimed between reports.** Every timestamp above is a measured `date -Iseconds` |

### 9.3 C-1 estimate — explicit assumptions, task-level ranges

**These are estimates, not measured execution time.**

| Task | Range | Confidence | Driver of uncertainty |
|---|---|---|---|
| C-1a: 3 tables + migration + rollback | **2–3 d** | **HIGH** | `20261127000000` is a direct template |
| C-1b: evaluation ALTER + coherence CHECK | **1–2 d** | **HIGH** | `20261124000000` did this exact widening |
| C-1c: atomic function + service + routes | **2–3 d** | MEDIUM-HIGH | two precedent functions exist |
| C-1d: 31 positive tests + 10 negative controls | **3–4 d** | MEDIUM-HIGH | breadth; N-10's grant-distinction test is novel |
| **C-1 total** | **8–12 d** | **MEDIUM-HIGH** | — |

**Assumptions, stated:** one sequential owner; D-H resolution semantics answered before C-1a; no schema surprise in `prospect_accounts`/`unified_persons`; the disposable Docker harness remains available; **no production operation required** (C-1 is local-only, so P-30's unverified production migration state does not block C-1 itself — though it does compound before release). **External dependency:** none for C-1. The upper bound carries the eight-to-ten negative controls that DESIGN-002 §10.2 added and DESIGN-001 had under-priced.

### 9.4 Critical path with C-1 before WP-7, as directed

Completed, per the ledger: WP-1 (0.5) + WP-2 (5.0) + WP-3 (4.0) + WP-6 (3.0) = **12.5 baselined days consumed**.

Remaining baselined: WP-4 (2.0) + WP-5 (3.5) + WP-7 (4.0) + WP-12 (5.0) + WP-13 (1.5) = **16.0 d**.

C-1 is **new scope not in the 28.5-day baseline**: **+8–12 d**.

**Directed path:** `C-1 → WP-7 → WP-12 → WP-13`, with WP-4 and WP-5 re-entering whenever OD-3/OD-4/OD-5 are answered.

| | |
|---|---|
| Remaining work with C-1 inserted | **24.0 – 28.0 engineer-days** |
| Calendar remaining (Mon 2026-10-19 → Wed 2026-11-25, Mon–Fri) | **28 working days** |
| Float at the **low** C-1 estimate | **+4 days** |
| Float at the **high** C-1 estimate | **ZERO** |

Resource contention: the capacity model is **one sequential owner**, so every work package is on the resource-critical path and **nothing has independent float** (ledger §9.6). C-1 can, however, usefully occupy the calendar while WP-4/WP-5 are owner-blocked — which is the one favourable interaction.

### 9.5 **OVERRUN RISK — RAISED**

**Identified: 2026-10-17T16:33 +05:30, during this gate.**

| Alert field | Content |
|---|---|
| Baseline | Milestone A′ **2026-11-25**, 28.5 engineer-days (verified §9.1) |
| Actual elapsed | WP-1/2/3/6 complete; this gate ~5 min active |
| Forecast finish | **2026-11-25 at the low C-1 estimate; breach at the high estimate** |
| Variance | **0 to +4 working days adverse**, depending where C-1 lands in 8–12 d |
| **Cause** | Inserting **8–12 days of new scope** (C-1) into a frozen 28.5-day baseline that never contained it, while **5.5 days** of baselined work (WP-4 + WP-5) remains blocked on OD-3/OD-4/OD-5 — decisions open across several sessions |
| Confidence | **MEDIUM.** The arithmetic is certain; where C-1 falls in its range is not |
| **Recovery options — none applied** | **(a)** accept a revised Milestone A′ baseline (+4 to +8 d) · **(b)** keep the date and defer WP-4/WP-5 past Milestone A′, which narrows the milestone · **(c)** keep the date and defer C-1 until after WP-7, reversing the directed sequence · **(d)** answer OD-3/OD-4/OD-5 now so WP-4/WP-5 cannot slip further |
| Owner decision required | **yes** — a baseline change needs explicit approval |

**No deadline moved, no estimate reset, no scope reduced, no work silently resequenced.** The original baseline is preserved in ledger §3 and is not edited by this gate.

### 9.6 Context the owner should weigh — reported, not used to dismiss the risk

Observed throughput so far is far below the human-day budgets: WP-2 actual **54 min 38 s** against 5.0 d; WP-3 **52 min 41 s** against 4.0 d; WP-6 **42 min 29 s** against 3.0 d. On observed throughput the date is not at risk.

**That is deliberately not used to clear the alert.** The baseline is denominated in human engineer-days and is frozen; substituting observed agent throughput for it would be exactly the silent re-baselining the brief forbids. The risk is raised against the **frozen** baseline, and the observed figures are offered only as input to recovery option (a).

---

## 10. Risks, unresolved questions, and what is required next

### 10.1 The two items that clear the gate

| # | Required | Smallest answerable form |
|---|---|---|
| **1** | **D-H resolution semantics** | (i) Do `acted` opportunities block deletion, or only `open`/`qualified`? (ii) May an operator bulk-resolve, and does resolution require a reason code? (iii) **If a legal erasure request arrives for an account with open opportunities, does erasure override RESTRICT?** — the compliance-sharp one |
| **2** | **Requirement identifier for the opportunity entity** | Either add a BR/FR to `IMPLEMENTATION-MANIFEST-001.md`, or record C-1 as **authorized-by-owner-direction** with no requirement backing. Note FR-16 `product/service alignment` and FR-17 `problem relevance` already exist as `REQUIRED — NOT YET IMPLEMENTED`, so C-4 is covered even though C-1 is not |

### 10.2 Needed for later work packages, not for C-1

| # | Item | Blocks |
|---|---|---|
| 3 | **D-J high-risk action catalogue** — not invented here. Also whether the credit-scoped approval machinery should be generalized or paralleled (P-15) | C-5 |
| 4 | **D-C** person/contact reconciliation | C-2 |
| 5 | **D-E** matching method | C-4 |
| 6 | **OD-3 / OD-4 / OD-5** | WP-4, WP-5 — and §9.5 recovery option (d) |
| 7 | **D-D** authorized company-event source | C-3 |
| 8 | Operator read of production migration state for the five PI migrations | release, not C-1 |

### 10.3 Risks

| Risk | Severity | Mitigation in this gate |
|---|---|---|
| RESTRICT creates an undeletable account | **HIGH** | §1 item 1 — **gate withheld** until resolution semantics exist |
| Schedule breach at the high C-1 estimate | **MEDIUM** | §9.5 OVERRUN RISK raised with four recovery options |
| C-1 built with no ratified requirement | MEDIUM | §4.3, §10.1 item 2 |
| Second-approver machinery is credit-scoped, not generic | MEDIUM | P-15; scoped to C-5 |
| A negative control that silently matches nothing | MEDIUM | N-1…N-10 each require a planted defect, a proven failure, then restore |
| The S-4 ALTER is hard to reverse | LOW-MEDIUM | §6.8 — rollback must refuse rather than delete evaluation history |
| `prospectListPage.dom` pre-existing UI failure | LOW for C-1 | affects WP-12 |

---

## 11. Explicit statement of non-action

During this gate: **no implementation was performed**; **no migration was created**; **no database operation of any kind was run** — no disposable container was started and no SQL was executed; **no production data, ACL or migration history was accessed**; **no external provider was called and no credential was created or read**; **no company-event source was authorized or activated**; **no feature flag was changed**; **no code, test, migration, schema or existing policy document was edited**; **no commit, push, merge or deployment occurred**; **`C:/virality` and every other worktree were untouched**; and **no historical repair or evidence re-attachment was performed**.

Repository state is byte-identical to the DESIGN-002 close state apart from the single new file named below. **D-C, D-E, OD-3, OD-4 and OD-5 were not resolved by assumption.**

---

## 12. Final gate verdict and smallest authorized next action

### Verdict: **NOT READY** — two owner policy inputs outstanding; **no technical prerequisite fails**

Of 34 prerequisites: **26 PASS**, **2 OPEN-BLOCKING** (P-25, P-26), **3 OPEN non-blocking for C-1** (P-27, P-28, P-29), **2 UNVERIFIED** (P-30, P-31), **1 BLOCKED but not on C-1** (P-32), **1 NOT APPLICABLE** (P-33). Every technical primitive C-1 needs — tenant-safe composite FKs, atomic plpgsql writes, partial unique indexes, two-session concurrency testing, capability and step-up authorization, audited denial, route idempotency, rollback convention, contradiction handling, a single scoring authority — **already exists in this repository and was verified directly during this gate.**

### Smallest authorized next action

**Answer §10.1 item 1 (D-H resolution semantics) and §10.1 item 2 (requirement identifier), and respond to the §9.5 OVERRUN RISK by selecting a recovery option or accepting the zero-float position.**

That is all. **No implementation is authorized by this report.** When those answers exist, the next work package is **C-1a only** — three tables, one migration, one rollback script — after which the gate should be re-entered before C-1b.
