# OMNIVYRA-PMO-002A — Governance Amendment: Historical Continuity & Document Succession

> | Field | Value |
> |---|---|
> | **Document ID** | PMO-002A |
> | **Title** | Governance Amendment — Historical Continuity & Document Succession |
> | **Version** | 1.0 |
> | **Status** | Active (inherits PMO-002) |
> | **Authority** | Inherited from PMO-002 (now the Active Baseline) |
> | **Type** | Amendment |
> | **Predecessor** | PMO-002 (parent baseline) |
> | **Successor** | PMO-002B (next amendment in lineage) |
> | **Adoption Date** | 2026-07-20 (with PMO-002) |
> | **Supersession Criteria** | Amendment is superseded only if PMO-002 itself is superseded |
> | **Related Amendments** | Belongs to PMO-002; sibling PMO-002B |
> | **Last Updated** | 2026-07-20 (adoption) |

> **Amendment notice.** This amendment is **not** an independent governance baseline. It inherits its
> authority exclusively from PMO-002 and carries none until PMO-002 is adopted. Amendments never
> transfer governance authority — only a successor document does.

---

## 1. Governance Amendment

PMO-002 originally proposed **replacing** `OMNIVYRA-PMO-001.md` as the document of record. This amendment
**revokes that replacement** and substitutes a **succession** model.

- PMO-002 no longer *replaces* PMO-001. PMO-001 is preserved intact as the **Historical Governance Baseline**.
- PMO-002 is **Active Governance Baseline (pending adoption)** — it governs *after* Program 0 completes, not on approval.
- All PMO-002 content stands unchanged; only its status, its relationship to PMO-001, and its adoption trigger are amended.
- Persistence: PMO-002 is a **new file** (`docs/pmo/OMNIVYRA-PMO-002.md`), never an overwrite of PMO-001. PMO-001 receives **archival annotations only**.

## 2. Governance Succession Policy

Governance documents form an **append-only lineage**. A newer document **supersedes** an older one; it never rewrites or deletes it.

- **Historical Baseline** — previously governed; authority passed to a successor. Immutable except archival annotations. *(PMO-001, after adoption.)*
- **Active Baseline** — the single document currently holding execution authority. Exactly one exists. *(PMO-001 today; PMO-002 after Program 0.)*
- **Future Baseline** — a Draft successor not yet adopted; no authority until its trigger fires. *(PMO-003+.)*

**Invariants:** (1) exactly one Active Baseline at any moment; (2) supersession, not replacement; (3) auditable transfer (predecessor, successor, adoption date, trigger); (4) no retroactive edits to a Historical Baseline's substance; (5) continuity of debt/ownership across a transfer.

## 3. PMO Document Lifecycle

Every PMO document declares exactly one status: **Draft** · **Active** · **Historical** · **Superseded** · **Archived**.

| Status | Authority | Mutability |
|---|---|---|
| Draft (incl. *Pending Adoption*) | None | editable |
| Active | Full (sole) | amendments only |
| Historical | None (audit) | archival annotations only |
| Superseded | None | annotations only |
| Archived | None | read-only |

**Legal transitions:** Draft→Active (adoption) · Active→Historical (successor adopted) · Historical→Archived (housekeeping) · Draft→Superseded (folded before adoption). No return from Historical to Active.

## 4. Document Relationships

```
PMO-001  (Active now → Historical after PMO-002 adoption)   predecessor: —    successor: PMO-002
   ▼
PMO-002  (Draft — Pending Adoption)   predecessor: PMO-001   successor: —   amended by: PMO-002A, PMO-002B
   ▼
PMO-003+ (Future — no authority)
```

**Amendments vs. succession:** an amendment (PMO-002A/002B) modifies a baseline within its lineage and does **not** transfer authority. Succession transfers authority to a new Document ID. PMO-002A is an amendment, not a successor.

## 5. Historical Continuity

**PMO-001 — Historical Governance Baseline (on adoption).** Successfully governed the Generation Spine
consolidation (WS-1a/1b/1c) and the Coordination Foundation (ICR-1, OMNI-COORD-001/002, WS-2A–2D). Frozen
except archival annotations. Remains **Active** until PMO-002's adoption trigger fires; thereafter
**Historical** — retained for audit, carrying no execution authority.

**PMO-002 — Active Governance Baseline (pending).** Inherits every open item from PMO-001 by reference;
nothing is lost, only carried forward. Becomes sole execution authority on adoption.

**Traceability guarantee:** the repository always holds both the plan that produced the certified code
(PMO-001) and the plan that governs what comes next (PMO-002), linked by an auditable succession record.

## 6. Adoption Procedure

PMO-002 becomes authoritative **only** when all three triggers are satisfied (completion of Program 0):

1. **Governance adoption complete** — PMO-002 persisted with `Status: Active`; amendments recorded.
2. **Commit hygiene complete** — coordination stack + substrate decision landed; TD-17 closed; tree zone-attributable.
3. **Registries synchronized** — PMO-002 registries reconciled against the committed tree.

**Adoption transaction (atomic, PMO-executed):** stamp PMO-002 `Active` + Adoption Date; annotate PMO-001
`Historical` + successor pointer (no content change); record the transfer in the succession log
(trigger = "Program 0 complete").

**Until all three fire:** **PMO-001 remains the active governing document.** Program 0 itself runs under
PMO-001's authority, then hands the baton.

---

*This amendment belongs to PMO-002 and is refined by PMO-002B. Read the three together.*
