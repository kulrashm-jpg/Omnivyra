# OMNIVYRA-PMO-002 — Governance Re-Baseline & Program Reorganization

> | Field | Value |
> |---|---|
> | **Document ID** | PMO-002 |
> | **Title** | Governance Re-Baseline & Program Reorganization |
> | **Version** | 1.2 |
> | **Status** | **Active** (Governance Baseline) |
> | **Authority** | Omnivyra AI-platform execution — **sole active authority** |
> | **Type** | Baseline |
> | **Predecessor** | PMO-001 (Historical) |
> | **Successor** | — |
> | **Adoption Date** | 2026-07-20 (Program 0 complete; adoption transaction — see Governance Succession Log) |
> | **Supersession Criteria** | Superseded when a future adopted PMO document names PMO-002 as Predecessor |
> | **Related Amendments** | PMO-002A (succession), PMO-002B (lifecycle refinement) |
> | **Last Updated** | 2026-07-20 |

> **Authority notice.** This document is the **Active Governance Baseline** (adopted 2026-07-20 by the
> PMO-003R adoption transaction, on completion of Program 0). It holds **sole execution authority**.
> PMO-001 is now **Historical** (audit-only). Reading PMO-002 means reading this baseline together with
> amendments PMO-002A and PMO-002B.

---

## Executive Summary

The repository outgrew its plan. The original two-zone partition (A1 write-path / A2 read-egress-path)
remains architecturally valid, but Zone A2 delivered a capability set the roadmap never described — a
full **Coordination & Semantic-Intelligence Platform** — while most of A2's *original* egress mandates
went untouched. This re-baseline makes governance match reality by: (1) registering 11 built
capabilities, (2) **splitting Zone A2 into A2-Platform and A2-Egress** (the one structural change),
(3) collapsing the flat prompt list into **four dependency-driven engineering programs (0/A/B/C)**,
(4) re-grouping the TD registry into five categories with an owner on every item, and (5) adding one
ADR recording an evolution that already occurred. After adoption there is one authoritative roadmap,
no stale/duplicate/obsolete entries, and every capability, workstream, and debt item has exactly one
owner.

**Ownership taxonomy (revised):** **A1** Generation Spine · **A2-P** Coordination & Semantic-Intelligence
Platform (new) · **A2-E** Intelligence & Egress product (new) · **P** AI Platform (frozen) · **F**
Frozen-canonical.

**Post-0A state (2026-07-20):** the Coordination Platform is now **committed** as `29a41dd1` (Zone A2,
flag-dark); **TD-17 is resolved**; the Wave-1/2 safety+grounding+PIP substrate remains **deferred**
(TD-14, owner's call). Governance authority still rests with PMO-001.

---

## 1. Updated Capability Registry

Legend — **Maturity:** Foundation / Built-dark / Live · **Rollout:** Dark (flag OFF) / Shadow / Live · **Prod-ready:** Y / Cond / N.

| Capability | Canonical owner | Maturity | Impl status | Rollout | Prod-ready |
|---|---|---|---|---|---|
| Provider Gateway | P | Live | Hardened (Wave 1d) | Live | Y |
| Safety Layer (safety/*) | P | Live | Adopted repo-wide (substrate deferred) | Live/shadow | Y |
| Grounding Engine | P | Live w/ exceptions | Activated at assimilation; not in prompt | Live | Cond |
| Context Assimilation | P | Live | Single engine | Live | Y |
| Semantic Identity (ICR-1) | P | Live (committed) | One canonical contract | Live | Y |
| Observability / Billing | P | Live / under-adopted | — | Live | Y / Cond |
| Generation Runtime | A1 | Built-dark | Consolidated in code | Dark (6 flags OFF) | Y |
| Runtime Task Profiles (PMO-ADR-09) | A1 | Built-dark | day-content converged; blueprint built | Dark | Y |
| Runtime Delegation (Writer/#7/BOLT/day) | A1 | Built-dark | fallback-safe delegation | Dark | Y |
| Prompt Assembly | A1 | Built | Single envelope assembler | via runtime | Y |
| Semantic Root (produce) | A1 | Built-dark | Single minter `buildSemanticRoot` | Dark (`SEMANTIC_ROOT_ENABLED`) | Y |
| Originality Engine | A1 | Live-partial | Single gate, keys on `decision` | Live (string tiers) | Cond (embedding dead) |
| Brand Runtime | A1 | Live-elsewhere | Inert on canonical runtime | n/a on runtime | Cond |
| Writer Runtime | A1 | Built-dark | post/thread delegate | Dark | Y |
| Long-Form Delegation | A1 | Built-dark | envelope-only adapter | Dark | Y |
| BOLT | A1 | Built-dark | master converged | Dark | Y |
| **Communication Registration** | A2-P | Foundation (committed `29a41dd1`) | single `registerCommunication` | Dark (`REGISTRATION_MODE=off`) | Y (inert) |
| **Semantic Root Registry** | A2-P | Foundation (committed) | derive+upsert, tenant-scoped | Dark (in-mem default) | Y (inert) |
| **Communication Graph** | A2-P | Foundation (committed) | pure projector + navigation | Dark | Y (inert) |
| **Communication Intelligence** | A2-P | Foundation (committed) | read-only, 12 queries | Dark | Y (inert) |
| **Query Profiles** | A2-P | Foundation (committed) | `executeProfile` + 6 profiles | Dark | Y (inert) |
| **Duplicate-Intent Detection** | A2-P | Foundation (committed) | single pure detector, honest `not_evaluable` | Dark | Y (inert) |
| **Coordination Platform** (umbrella) | A2-P | Foundation (committed) | 72/72 tests, fail-safe | Dark | Y (inert) |
| **Engagement Shadow** (semantic) | A2-P | Foundation (module committed; adoption deferred) | fire-and-forget observe | Dark (`ADOPTION_MODE=off`) | Y (inert) |
| MarketPulse | A2-E | Live-partial | provenance-honest, not cited-retrieval | Live | Cond |
| Engagement (reply) | A2-E | Live | 3 reply paths unmerged | Live | Cond |
| Authority Intelligence | A2-E | Inert | untouched, unpopulated | n/a | N |
| Analytics | A2-E / F | Live | deterministic authoritative; narration inert | Live | Y |
| Outbound Moderation | P engine + A2-E adopt | Live-shadow | one engine, wired at egress | Shadow | Y |
| Campaign / Strategic-Mix / Website Intel | F | Live | canonical deterministic | Live | Y |

**Validation:** every capability resolves to exactly one owner (A2 split removed the only ambiguity).

---

## 2. Updated Roadmap (dependency-driven)

Chronology retired; the roadmap is a **dependency DAG of four programs**. Disjoint zones (A1 vs A2-E)
run in parallel; both depend on a clean committed baseline; rollout depends on both.

```
Program 0  Governance Re-Baseline & Commit Hygiene   (PMO)         ── PREREQUISITE
      │   0A repository hygiene  ✅ COMPLETE (commit 29a41dd1, TD-17 resolved)
      │   0B governance persistence + registry sync  ◀ this document
      │   PMO-003 re-cert + adoption transaction  ── pending
      ├────────────────────────────┬───────────────────────────────┐
      ▼                            ▼                                 │
Program A  Platform Convergence   Program B  Egress Product          │  (A ∥ B, disjoint zones)
      A1 + P (ICR)                 A2-E                              │
      └──────────────┬─────────────┘                                 │
                     ▼                                                 
Program C  Rollout & Retirement   (A1 + A2-P + A2-E, PMO-sequenced)  ◀ Coordination Platform activation
```

- **Removed as completed:** WS-1a, WS-1b, WS-1c-2/2b/3b/4, ICR-1, COORD-001/002, WS-2A–2D (foundation, committed `29a41dd1`), outbound-moderation shadow adoption, safety Waves 1a–1d, grounding Wave-2 activation.
- **Removed as obsolete:** analytics-narration hardening (inert no-op; deterministic path authoritative); MarketPulse LLM-fabrication path (cancelled).
- **Retained (re-homed into A/B/C):** every open item in the TD registry.

---

## 3. Updated Workstream Registry

| Workstream | Disposition | Successor |
|---|---|---|
| WS-1a Semantic Spine | Completed | — |
| WS-1b Continuity + publish-lineage | Completed | — |
| WS-1c-2/2b/3b/4 runtime convergence | Completed | Program A (final retirement) |
| WS-1c-3c blueprint cutover-or-retire | Deferred → Merged into Program A | Program A |
| WS-1c-Final legacy retirement | Superseded | Program C |
| ICR-1 semantic-identity contract | Completed | — |
| OMNI-COORD-001/002 | Completed | — |
| WS-2A Registration / WS-2B Adoption / WS-2C Intelligence / WS-2D Query Profiles | Completed (foundation, committed `29a41dd1`) → re-homed | A2-Platform (activation in Program C) |
| WS-2 "Intelligence & Egress" (original monolith) | **Split** | A2-Platform (done-inert) + A2-Egress (Program B) |
| MarketPulse tiered pipeline | Deferred (partial) | Program B |
| Engagement reply-merge | Deferred (not started) | Program B |
| Authority activate/retire | Deferred (not started) | Program B |
| Analytics narration hardening | Cancelled (obsolete) | — |
| Provider-adapter fork merge | New → Program A (ICR-gated) | Program A |
| Image-seam merge (ADR-013) | Deferred | Program A / image wave |
| Billing universal coverage | Deferred (cross-cutting) | Operational backlog |
| Grounding-stack unification | Deferred (ICR-gated) | Program A |

**Validation:** every remaining workstream maps to exactly one program and one owner.

---

## 4. Updated Prompt Registry

| Prompt | State | Successor (exactly one) |
|---|---|---|
| WS-1a / 1b / 1c-2 / -2b / -3b / -4, ICR-1, WS-1a-fix | Archived (certified) | Program A |
| OMNI-COORD-001/002, WS-2A–2D | Archived (certified, committed `29a41dd1`, inert) | Program C (activation) |
| WS-1c-2b-fix (variants option) | Active → Program A | Program A |
| WS-1c-3c (#10 blueprint cutover/retire) | Superseded by Program A | Program A |
| WS-1c-#7 legacy-body deletion | Superseded | Program C |
| WS-1c-4b (long-form dead-shell retire + grounding merge) | Active → Program A/C | Program A (merge) + Program C (retire) |
| WS-1c-hygiene (dead builders) | Active → Program C (Cleanup) | Program C |
| WS-2 "Intelligence & Egress" monolith | Superseded (split) | Program B + A2-Platform charter |
| MarketPulse LLM-fabrication / Analytics narration | Cancelled (obsolete) | — |
| Image-seam merge | Pending (deferred) | Program A / image wave |
| Billing coverage / grounding unification | Pending (ICR-gated) | Operational / Program A |

**Rule:** no prompt may duplicate an archived one; every open prompt has a single named successor program.

---

## 5. Updated ADR Registry

PMO-ADR-01..10 (in PMO-001 §12) are retained as historically binding. Edits:

- **PMO-ADR-08/09** (runtime no-persist + task-profile): **Realized** (committed WS-1c-2/3b).
- **PMO-ADR-10** (A2 live coordination): **Realized & Superseded-in-scope** by PMO-ADR-11.

**New (records an evolution already present in the tree):**

| ADR | Decision | Basis (already in repo) |
|---|---|---|
| **PMO-ADR-11** | **Split Zone A2 into A2-Platform (Coordination & Semantic-Intelligence) and A2-Egress (MarketPulse/Engagement/Authority).** A2-Platform owns registration, semantic-root registry, communication graph/intelligence, query profiles, duplicate-intent detection, engagement semantic shadow. | The platform exists and is committed (`29a41dd1`, 72/72 tests). Documents ownership reality; invents nothing. |

**Not adopted (would invent future architecture — left as open debt):** dual-`SemanticRoot` reconciliation direction (TD-18); provider-fork merge design (Program A ICR).

---

## 6. Updated Technical Debt Registry (grouped, owned)

**Closed (appendix, removed from active):** TD-12, TD-13, TD-15 (resolved before 0A); **TD-17 (resolved by PROGRAM-0A, commit `29a41dd1`).**

| Group | TD | Item | Owner | Status |
|---|---|---|---|---|
| **Architecture** | TD-02 | Two grounding stacks not unified | P / A1 | Open (ICR) |
| | TD-03 | Originality embedding tier dead | A1 | Open |
| | TD-04 | Competing generators (ungated `unifiedEngine` fork) | A1 | Partially resolved |
| | TD-10 | Image-seam duplication (2 direct-OpenAI) | A1 (deferred) | Open |
| | TD-18 *(new)* | Dual `SemanticRoot` type/store | PMO→A1/A2-P | Open |
| | TD-19 *(new)* | Brand Runtime inert on canonical Writer path | A1 | Open |
| **Governance** | TD-14 | Uncommitted Wave-1/2 substrate | PMO / owner | **Open (explicitly deferred, PROGRAM-0A)** |
| | TD-17 | A2 re-dirtying committed files | PMO | **RESOLVED (PROGRAM-0A)** |
| **Implementation** | TD-01 | Grounding decision unused in prompt path | A1 | Open |
| | TD-05 | MarketPulse not cited-retrieval | A2-E | Partially resolved |
| | TD-06 | 3 engagement reply paths unmerged | A2-E | Open |
| | TD-09 | Authority signals inert | A2-E | Open |
| | TD-16 | Untyped semantic keys on `PlatformVariantPayload` | A1 | Open |
| **Cleanup** | TD-11 | Stale prompt builders (5 dead/orphan) | P / U | Open |
| | TD-11b | Long-form dead shell (0 prod callers) | A1 | Open |
| **Operational** | TD-07 | Provider transient-retry off | P | Open (by design) |
| | TD-08 | Billing under-adopted | P (cross-cut) | Open |
| | TD-20 *(new)* | Writer A/B parity in `scripts/cert/` only, not CI unit run | A1 / QA | Open |

**Validation:** every active TD has exactly one owner and one group.

---

## 7. Engineering Program Structure

### Program 0 — Governance Re-Baseline & Commit Hygiene *(prerequisite)*
- **Purpose:** produce a certifiable, per-zone-clean baseline and adopt this governance doc.
- **Dependencies:** none. **Owner:** PMO (+ owner for substrate decision).
- **Sub-waves:** 0A repository hygiene ✅ **complete** (commit `29a41dd1`, TD-17 resolved); 0B governance persistence + registry sync (this document); then PMO-003 re-cert + adoption transaction.
- **Success:** coordination stack committed; TD-17 closed; governance docs persisted; registries synchronized.
- **Exit:** all three PMO-002A §6 adoption triggers satisfied.
- **Order:** 1st.

### Program A — Platform Convergence & Fork Retirement
- **Purpose:** make the runtime the sole write path; eliminate live capability multiplicities.
- **Scope:** retire ungated `unifiedEngine` fork (TD-04); activate originality embedding (TD-03); consume grounding in `promptAssembler` (TD-01); adopt `brandRuntime` on runtime (TD-19); **ICR** merge `intelligence/adapters/*` onto gateway; type `PlatformVariantPayload` keys (TD-16); decide `SemanticRoot` reconciliation (TD-18); grounding-stack unification (TD-02, ICR).
- **Dependencies:** Program 0. **Owner:** A1 + P (ICR). **Prerequisites:** clean baseline; A/B parity harnesses.
- **Success:** runtime default write path under parity; one provider abstraction; embedding tier live; grounding gates prompt; brand enforced.
- **Exit:** no ungated legacy write fork; provider-fork on gateway; TD-01/02/03/04/16/18/19 closed; tsc baseline held/lowered.
- **Order:** 2nd (∥ B).

### Program B — Egress Product Adoption
- **Purpose:** deliver the original A2 egress mandates.
- **Scope:** MarketPulse tiered cited-retrieval (TD-05); merge 3 engagement reply paths → one grounded generator using memory (TD-06); authority activate-or-retire (TD-09).
- **Dependencies:** Program 0. **Owner:** A2-E. **Prerequisites:** clean baseline; frozen `marketProvenance` + outbound-moderation verdict (ready).
- **Success:** cited insights (zero fabrication); one reply generator; authority populated or removed.
- **Exit:** TD-05/06/09 closed; provenance coverage proven; dead reply path removed.
- **Order:** 2nd (∥ A).

### Program C — Rollout, Activation & Retirement
- **Purpose:** flip dark capabilities on under measured rollout; delete retired legacy.
- **Scope:** measured flag-on of runtime delegation (A/B parity per type); Coordination Platform activation (wire A1→A2 registration seam); outbound-moderation shadow→enforce (after diff review); legacy-code deletion + dead-shell/stale-builder cleanup (TD-11/11b); Writer parity into CI (TD-20).
- **Dependencies:** Programs A **and** B certified. **Owner:** A1 + A2-P + A2-E, PMO-sequenced.
- **Success:** live metrics stable; one continuous Semantic-Root→Registration→Graph flow; legacy removed; parity in CI.
- **Exit:** flags on in prod with rollback proven; no dead code; registry all-green.
- **Order:** 3rd.

---

## 8. Governance Validation

| Check | Result |
|---|---|
| Every capability has exactly one owner | ✅ (A2 split resolved the ambiguity) |
| Every workstream has exactly one owner | ✅ (§3) |
| Every roadmap item maps to repository reality | ✅ (completed/obsolete removed; coordination committed) |
| Every prompt has exactly one successor | ✅ (§4) |
| Every technical-debt item has an owner | ✅ (§6) |
| Every remaining architectural concern is registered | ✅ (TD-18/19/20 added; provider-fork + dual-root registered) |

## 9. Governance Change Log

1. Split Zone A2 → A2-Platform + A2-Egress (PMO-ADR-11).
2. Registered 11 built capabilities (Semantic Identity/Root, Registration, Graph, Intelligence, Query Profiles, Coordination Platform, Engagement Shadow, Task Profiles, Runtime Delegation, Long-Form Delegation).
3. Retired chronological roadmap → four dependency-driven programs (0/A/B/C).
4. Closed TD-12/13/15; **TD-17 resolved (PROGRAM-0A)**; added TD-18/19/20; re-grouped all TDs into 5 categories with owners.
5. Archived 12 certified prompts; cancelled 2 obsolete; superseded the WS-2 monolith and WS-1c-3c/Final.
6. Marked PMO-ADR-08/09/10 Realized; added PMO-ADR-11.
7. Recorded provider-adapter fork and dual-`SemanticRoot` as governed open items (ICR / decision-pending), not solved.
8. **PROGRAM-0A:** committed the Coordination Platform (`29a41dd1`); deferred the Wave-1/2 substrate (TD-14).
9. **PROGRAM-0B:** persisted PMO-002/002A/002B; synchronized registries to committed state.

## 10. Final Recommendation

Adopt this re-baseline once Program 0 completes. Governance then reflects the certified repository
exactly: no completed work shown active, no capability without an owner, no duplicate/obsolete roadmap
entry, one dependency-driven plan. Execution order: **Program 0 → (A ∥ B) → C.** No new architecture
invented; every entry documents code or debt that already exists.

**Governance posture:** ✅ Aligned. Authority remains with **PMO-001 (Active)** until PMO-003 fires the
adoption transaction.

---

*Amendments to this baseline: **PMO-002A** (Governance Succession & Historical Continuity) and
**PMO-002B** (Governance Lifecycle Refinement) — separate files in `docs/pmo/`, read together with this
document. Constraints of origin: no engineering program, ownership, roadmap, ADR, or TD altered beyond
recording repository reality.*
