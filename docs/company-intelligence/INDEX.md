# Specification Index

Complete map of the Company Intelligence Platform specification set, with each document's purpose, classification, and cross-references.

Citation keys used throughout the set: `[A1]`–`[A4]` (audits), `[D1]`,`[D2]` (designs), `[I1]` (blueprint), `[I2A]`–`[I2H]` (context programs). Invariants are `P1`–`P30` ([`appendices/invariants.md`](appendices/invariants.md)).

---

## Architecture (`architecture/`)

| Doc | Key | Title | Classification | Purpose |
|---|---|---|---|---|
| [AUDIT-001](architecture/AUDIT-001.md) | A1 | Architecture Discovery | Highly Coupled | Structure: routes, services, DB, dependencies |
| [AUDIT-002](architecture/AUDIT-002.md) | A2 | Ownership & Responsibility | Partially Owned | Who owns what; 14-conflict register |
| [AUDIT-003](architecture/AUDIT-003.md) | A3 | Intelligence Generation | Hybrid | How intelligence is produced |
| [AUDIT-004](architecture/AUDIT-004.md) | A4 | Intelligence Quality | Moderate | How good it is; where it degrades |
| [DESIGN-001](architecture/DESIGN-001.md) | D1 | Canonical Platform Architecture | — | Target architecture (six contexts) |
| [DESIGN-002](architecture/DESIGN-002.md) | D2 | Production Constitution | Complete | Frozen contracts + 30 invariants |

## Implementation (`implementation/`)

| Doc | Key | Workstream | Phase | Distinguishing invariant |
|---|---|---|---|---|
| [IMPLEMENTATION-001](implementation/IMPLEMENTATION-001.md) | I1 | — | 0–8 | Migration blueprint; Ready |
| [IMPLEMENTATION-002A](implementation/IMPLEMENTATION-002A.md) | I2A | WS-K Knowledge | 1 | One write authority; append-only facts |
| [IMPLEMENTATION-002B](implementation/IMPLEMENTATION-002B.md) | I2B | WS-T Trust | 2 | One confidence engine; reproducible, reversible |
| [IMPLEMENTATION-002C](implementation/IMPLEMENTATION-002C.md) | I2C | WS-E Evidence | 3 | Immutable, attributed, universally routed |
| [IMPLEMENTATION-002D](implementation/IMPLEMENTATION-002D.md) | I2D | WS-G/WS-V Grounding+Validation | 4 | One grounding authority; universal validation |
| [IMPLEMENTATION-002E](implementation/IMPLEMENTATION-002E.md) | I2E | WS-C Conversation | 5 | Universal dedup; no unvalidated persistence |
| [IMPLEMENTATION-002F](implementation/IMPLEMENTATION-002F.md) | I2F | WS-GEN Generation+Packs | 6 | No hidden AI generation; governed prompts/models |
| [IMPLEMENTATION-002G](implementation/IMPLEMENTATION-002G.md) | I2G | WS-P/WS-CM Projections+Consumers | 7 | Zero direct reads; projections derived |
| [IMPLEMENTATION-002H](implementation/IMPLEMENTATION-002H.md) | I2H | WS-L Learning | 8 | Recommends never applies; nothing auto-changes |
| [IMPLEMENTATION-003](implementation/IMPLEMENTATION-003.md) | I3 | — | 0–8 | Production execution roadmap |

## Enforcement & navigation

| Doc | Purpose |
|---|---|
| [START-HERE](START-HERE.md) | Engineer entry point (read first) |
| [CONFORMANCE-CHECKLIST](CONFORMANCE-CHECKLIST.md) | Mandatory per-PR governance gate |
| [GOVERNANCE.md](GOVERNANCE.md) | How the constitution is amended, waived, and enforced |

## Governance layer (`adr/`, `amendments/`, manifests)

| Doc | Purpose |
|---|---|
| [adr/](adr/) | Architecture Decision Records ADR-001..010 — *why* each major decision |
| [amendments/](amendments/) | The only mechanism to change a ratified decision (framework + template) |
| [dependency-manifest.yaml](dependency-manifest.yaml) / [.json](dependency-manifest.json) | Machine-readable graph (contexts, phases, gates, census, consumers) |
| [full/](full/) | Archival Full Editions (dual-document strategy) |

## Appendices — additions

| Doc | Contents |
|---|---|
| [traceability-matrix](appendices/traceability-matrix.md) | Every audit finding → invariant → program → gate → closure |
| [relationships](appendices/relationships.md) | Master document cross-reference (single-source) |

## Governance automation (`governance-automation/`)

| Doc | Purpose |
|---|---|
| [governance-automation/](governance-automation/README.md) | The automation layer enforcing this constitution — audit (AUDIT-005), eight runtimes (GOV-AUTO-001..008), realization (GOV-IMPL-001), certification (GOV-CERT-001), execution (IMPLEMENT-GOV-001, EXEC-GOV-001, work packages). Additive; references the constitution, never modifies it. |

## Ratification & preservation (v1.0.0)

| Doc | Purpose |
|---|---|
| [VERSION](VERSION.md) | Constitutional version + semantic versioning rules |
| [RATIFICATION](RATIFICATION.md) | Ratification record, frozen document list, certification summary |
| [RELEASE-NOTES-v1.0.0](RELEASE-NOTES-v1.0.0.md) | Architecture / implementation / governance / certification achievements |
| [LIFECYCLE](LIFECYCLE.md) | Draft → Review → Ratified → Superseded → Archived / Withdrawn |
| [HISTORY](HISTORY.md) | Historical preservation policy (never delete/overwrite/rewrite) |
| [MAINTAINERS](MAINTAINERS.md) | Maintainer / reviewer / steward / amendment / certification roles |
| [FINAL-VALIDATION](FINAL-VALIDATION.md) | Complete evidence-based consistency audit |
| [full/](full/) | Archival Full Editions — every document, dual-edition strategy complete |

## Diagrams (`diagrams/`)

| Doc | Shows |
|---|---|
| [ownership-map](diagrams/ownership-map.md) | Context → concern ownership; the 14 closed conflicts |
| [execution-flow](diagrams/execution-flow.md) | Evidence → Knowledge → Generation → Consumers lifecycle |
| [dependency-graph](diagrams/dependency-graph.md) | Phase/workstream dependency spine |
| [migration-roadmap](diagrams/migration-roadmap.md) | Eight-phase sequence + gates |

## Appendices (`appendices/`)

| Doc | Contents |
|---|---|
| [glossary](appendices/glossary.md) | Canonical terms |
| [invariants](appendices/invariants.md) | P1–P30 with rationale + audit anchor |
| [event-catalog](appendices/event-catalog.md) | Every domain event, producer, consumers |
| [consumer-catalog](appendices/consumer-catalog.md) | Every consumer, read path, contract |
| [workflow-catalog](appendices/workflow-catalog.md) | Every AI workflow, grounding, validation |
| [certification-history](appendices/certification-history.md) | Each document's verdict + gate summary |

---

## Reading orders

- **Fastest orientation:** README → DESIGN-001 → migration-roadmap diagram.
- **Full architectural grounding:** AUDIT-001..004 → DESIGN-001 → DESIGN-002.
- **To implement phase N:** IMPLEMENTATION-001 §5–6 → the matching 002 program → CONFORMANCE-CHECKLIST → GOVERNANCE.
- **To execute the program:** IMPLEMENTATION-003 (roadmap) alongside dependency-graph + migration-roadmap diagrams.
- **To understand a decision's rationale:** the matching ADR in [`adr/`](adr/).
- **To change a ratified decision:** the [`amendments/`](amendments/) framework.

---
**Related:** [`START-HERE.md`](START-HERE.md) · [`README.md`](README.md) · [`GOVERNANCE.md`](GOVERNANCE.md) · [`appendices/relationships.md`](appendices/relationships.md)
