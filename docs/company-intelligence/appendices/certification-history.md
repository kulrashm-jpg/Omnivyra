# Appendix — Certification History

Each specification document's classification and the basis for it. This is the audit trail of how the platform was certified from discovery through executable plan.

## Audits (what exists)

| Doc | Verdict | Headline evidence |
|---|---|---|
| AUDIT-001 Architecture Discovery | **Highly Coupled** | 2,384-line god hook; 5-file service barrel (~3,265 lines); ~52 files raw-query `company_profiles`; `report_settings` multi-writer grab-bag; read-triggers-LLM-refine |
| AUDIT-002 Ownership | **Partially Owned** | Canonical read seam real (96-consumer registry) but NO write seam (10 writers, 2 conventions); 14-conflict register; confidence key mismatches; classifier overrides user |
| AUDIT-003 Intelligence Generation | **Hybrid** | Deterministic control plane (crawl/gate/classify/competitor) + AI generation plane (13 call sites); languageRefine & enrichment are NOT LLM; 5 grounding mechanisms; unvalidated chat-save path |
| AUDIT-004 Intelligence Quality | **Moderate** | Bimodal by field tier; only strategy has a cliché filter; PT boilerplate injector; no cross-field consistency; Phase-1 gates don't touch profile AI; no production correction-rate loop |

## Designs (what it becomes)

| Doc | Classification | Basis |
|---|---|---|
| DESIGN-001 Architecture | — (target) | Six bounded contexts; four singletons; intelligence = projection of knowledge = derivation of evidence; every defect closed structurally, every strength preserved |
| DESIGN-002 Production Constitution | **Production Constitution Complete** | 24 objects, field contracts, 8 state machines, closed event vocabulary, consumer contracts, AI governance, 30 invariants, measurable conformance |

## Implementation (how it is built)

| Doc | Classification | Gate summary |
|---|---|---|
| IMPLEMENTATION-001 Blueprint | **Ready** | 8 phases, strangler + shadow + per-tenant; 9 preserve / 6 refactor / 4 consolidate / 3 replace; upgrades to Production Implementation Ready on Phase-0 gate |
| IMPLEMENTATION-002A Knowledge | **Ready for Development** | Gate: writer census = 1; overwrite = 0; chat-save validated |
| IMPLEMENTATION-002B Trust | **Ready for Development** | Gate: one confidence engine; drift = 0; reproducible; complete lineage/provenance |
| IMPLEMENTATION-002C Evidence | **Ready for Development** | Gate: one evidence layer; immutable; complete routing; SSRF non-regression |
| IMPLEMENTATION-002D Grounding+Validation | **Ready for Development** | Gate: one grounding authority + one validation pipeline; bypass = 0; deterministic; explainable |
| IMPLEMENTATION-002E Conversation | **Ready for Development** | Gate: one engine; zero duplicate questioning; no unvalidated persistence |
| IMPLEMENTATION-002F Generation+Packs | **Ready for Development** | Gate: one runtime; zero inline prompts/direct model calls/unregistered workflows; bench-gated |
| IMPLEMENTATION-002G Projections+Consumers | **Ready for Development** | Gate: one projection runtime; direct-read census = 0; frontend dissolved |
| IMPLEMENTATION-002H Learning | **Ready for Development** | Gate: one learning runtime; zero unmanaged learning; correction-rate live; **constitution in force** |
| IMPLEMENTATION-003 Execution Roadmap | — (operational) | Dependency spine, parallelization, rollback checkpoints, milestones M0–M6, feature-complete vs production-ready |

## Why every 002 program is "Ready for Development" not "Production Implementation Ready"

Each program is fully specified — every object, transition, event, and integration seam enumerated, coding prompts derivable mechanically. Each awaits only its **upstream phase gate** (a sequencing precondition, not an open decision), per IMPLEMENTATION-001 §17. On the upstream gate closing, each classification upgrades automatically. Phase 0 (fabric/baseline/schema-lineage) is the single precondition that starts the chain.

## The defect-closure ledger (what the program guarantees)

| Certified defect | Closed by |
|---|---|
| 10 write authorities (A2 C1) | I2A — writer census = 1 (P3) |
| 5 grounding mechanisms (A3 §3) | I2D — grounding authority (P4/P11) |
| Unvalidated chat-save (A3 §7) | I2A/I2D/I2E — universal validation (P19) |
| Confidence contract drift (A3 §6) | I2B — one confidence vocabulary (P12) |
| Evidence mis-routing (A4 §2) | I2C — one evidence layer, universally routed |
| Consistency vacuum (A4 §6) | I2D — single-graph grounding + Con-tier validation |
| No learning loop (A4 §1) | I2H — correction-rate metric + governed calibration |
| Deterministic fabrication (A4 §7) | I2F — PT fallback deleted (P20) |
| Tenancy by discipline (A2 C14) | structural tenancy (P21) |
| Dual notification stacks (A2 C11) | one event bus (P23), ProjectionUpdated sole freshness signal |
