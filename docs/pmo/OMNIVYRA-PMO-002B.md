# OMNIVYRA-PMO-002B — Governance Lifecycle Refinement (Final)

> | Field | Value |
> |---|---|
> | **Document ID** | PMO-002B |
> | **Title** | Governance Lifecycle Refinement (Final) |
> | **Version** | 1.0 |
> | **Status** | Draft (Pending Adoption) — inherits PMO-002 authority |
> | **Authority** | Inherited from PMO-002 (none until PMO-002 is adopted) |
> | **Type** | Amendment |
> | **Predecessor** | PMO-002A |
> | **Successor** | — |
> | **Adoption Date** | Pending — with PMO-002 |
> | **Supersession Criteria** | Amendment is superseded only if PMO-002 itself is superseded |
> | **Related Amendments** | Belongs to PMO-002; sibling PMO-002A |
> | **Last Updated** | 2026-07-20 |

> **Amendment notice.** Governance-only editorial refinement of the lifecycle model. Alters no engineering
> program, capability, roadmap, TD, ADR, ownership, or sequencing. Weakens no PMO-002A invariant.

---

## 1. Governance Lifecycle Refinement

**Status (authority)** and **Version (evolution)** are formally independent axes.

- **Status** — does this document hold execution authority now? (Draft / Active / Historical / Superseded / Archived)
- **Version** — which revision am I reading? (`MAJOR.MINOR`, monotonic)

A document may advance many Versions while holding one Status (PMO-002 accrues amendments A, B → Versions
1.1, 1.2 while remaining `Draft`). A Status change does not by itself bump Version, and vice-versa.

| Status | Authority | Version behavior | Mutability |
|---|---|---|---|
| Draft (incl. *Pending Adoption*) | None | increments freely | editable |
| Active | Full (sole) | increments via approved amendments | amendments only |
| Historical | None (audit) | frozen | archival annotations only |
| Superseded | None | frozen | annotations only |
| Archived | None | frozen | read-only |

## 2. Governance Amendments Policy

**Definition.** An amendment is a governance-only revision attached to a specific baseline; it refines/clarifies/corrects without transferring authority.

**Authority rules:**
1. Amendments are **not** independent baselines.
2. Amendments inherit authority **exclusively** from their parent baseline (so PMO-002A/002B carry no authority until PMO-002 is adopted).
3. Reading an amended document = **baseline + all approved amendments**, interpreted together (later prevails on in-scope conflict).
4. Amendments **never** transfer governance authority — only a successor document does.

**Numbering & relationships:**
- Amendments to `PMO-00N` are suffixed `A, B, C, …` in approval order (`PMO-002A`, `PMO-002B`, `PMO-002C`).
- All `PMO-002*` amendments **belong to** PMO-002 (listed in its `Related Amendments`).
- An amendment increments the parent's Version **MINOR** and never changes the parent's Status.
- Amendments are append-only; a superseding clarification is the next-letter amendment, never an edit of a prior one.
- Cross-baseline amendments are prohibited.

## 3. Document Metadata Standard (mandatory going forward)

Every PMO document MUST carry a header with: **Document ID · Title · Version · Status · Authority · Type ·
Predecessor · Successor · Adoption Date · Supersession Criteria · Related Amendments · Last Updated.**

*(PMO-001 predates this standard and is grandfathered; it carries an archival annotation header.)*

## 4. Governance Invariants (permanent; carried forward unchanged)

1. **Exactly one Active Governance Baseline exists** at every moment — never zero, never two.
2. **Governance authority transfers only through document succession**, never through amendment.
3. **Amendments inherit authority from their parent baseline** and hold none independently.
4. **Historical documents are immutable** except archival annotations.
5. **Governance history is append-only.**
6. **Status and Version are independent axes.**
7. **Every governance document declares predecessor and successor relationships.**
8. **Every governance decision remains fully traceable.**

## 5. Updated Transition Rules

**Invariant (transition):** during the PMO-001 → PMO-002 handover, no moment may exist in which both
documents are Active or neither is Active. Authority passes in a single atomic transaction.

**Pre-transition (now until Program 0 completes):**
- PMO-001 — **Status: Active** (sole authority). Program 0 executes **under PMO-001**.
- PMO-002 — **Status: Draft (Pending Adoption)**, Version 1.2 (incl. amendments A, B). No authority.

**Adoption transaction (atomic, fires only when all three PMO-002A §6 triggers are met):**
1. PMO-002 → **Active**; set Adoption Date (Version unchanged by the flip).
2. PMO-001 → **Historical** in the same transaction; annotate successor + record-of-service (content frozen).
3. Append the transfer to the succession log (trigger = "Program 0 complete").

**No intermediate state** is permitted between steps 1 and 2. **Post-transition:** PMO-002 sole Active;
PMO-001 Historical (audit-only); no return path.

## 6. Executive Summary (governance framework, final)

PMO-002 re-baselines governance to match the certified repository; PMO-002A established succession so
PMO-001 is preserved (immutable Historical Baseline) rather than overwritten; **PMO-002B finalizes the
framework** by (1) making handover authority a formal invariant (PMO-001 stays Active until an atomic
adoption transaction), (2) defining that amendments inherit authority and never transfer it, and (3)
separating Status (authority) from Version (evolution) with a mandatory metadata header and a permanent
Governance Invariants section. No engineering decision is changed. The framework is stable enough to serve
as the long-term Omnivyra PMO operating standard.

**Governance posture:** ✅ Framework finalized. Current authority: **PMO-001 Active**; PMO-002 Draft
(Pending Adoption, v1.2, amendments A+B). Execution order: Program 0 → (A ∥ B) → C.

---

*This amendment belongs to PMO-002 and refines PMO-002A. Read the three together.*
