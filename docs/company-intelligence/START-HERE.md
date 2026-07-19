# START HERE

**The entry point for every engineer working on the Company Intelligence Platform.**

Read this once. It orients you in ten minutes and points you to the right document for whatever you're doing. It duplicates no implementation detail — it navigates.

---

## What this is

The platform's Company Profile subsystem was audited end-to-end, redesigned as a canonical **Company Intelligence Platform**, frozen into a **Production Constitution**, and decomposed into an **eight-phase implementation program**. All of that lives in [`docs/company-intelligence/`](./). These documents are the **authoritative engineering reference** — they supersede any architecture implied by the current code.

The platform re-architects into **six bounded contexts** (Identity, Evidence, Knowledge, Trust, Generation, Distribution) with **four singleton authorities** — one write authority, one grounding authority, one confidence vocabulary, one conversation engine. Company intelligence becomes a *projection of knowledge*; knowledge a *derivation of evidence*.

## Reading order (by role)

| You are… | Read, in order |
|---|---|
| **New to the platform** | this file → [`architecture/DESIGN-001.md`](architecture/DESIGN-001.md) → [`diagrams/ownership-map.md`](diagrams/ownership-map.md) → [`adr/`](adr/) (skim the ten decisions) |
| **Reviewing a PR** | [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md) → [`GOVERNANCE.md`](GOVERNANCE.md) §2–3 |
| **Implementing a context** | the matching [`implementation/IMPLEMENTATION-002*.md`](implementation/) → its ADR → [`GOVERNANCE.md`](GOVERNANCE.md) |
| **Planning/sequencing work** | [`implementation/IMPLEMENTATION-003.md`](implementation/IMPLEMENTATION-003.md) → [`dependency-manifest.yaml`](dependency-manifest.yaml) |
| **Proposing a constitutional change** | [`amendments/README.md`](amendments/README.md) → [`amendments/AMENDMENT-001-template.md`](amendments/AMENDMENT-001-template.md) |
| **Looking something up** | [`appendices/`](appendices/) (glossary, invariants, events, consumers, workflows, traceability) |

## Architecture map (one screen)

```
 SOURCES ──▶ EVIDENCE ──▶ KNOWLEDGE ──▶ DISTRIBUTION ──▶ CONSUMERS
             (immutable    (one write     (grounding +      (content,
              objects)      authority)     projections)      campaigns,
                │              ▲    │        ▲    ▲           reports, UI…)
                │           GENERATION ──────┘    │
                │           (workflows, prompts,  │
                │            models, packs,       │
                │            conversation) ───────┘
                └──────────▶ TRUST ◀── confidence · provenance · review · learning
```

Full ownership detail: [`diagrams/ownership-map.md`](diagrams/ownership-map.md). Data lifecycle: [`diagrams/execution-flow.md`](diagrams/execution-flow.md).

## Implementation order (the eight phases)

```
0 Fabric → 1 Writes → 2 Trust ∥ 3 Evidence → 4 Grounding+Validation
        → 5 Conversation ∥ 6 Generation → 7 Projections+Consumers → 8 Learning
```

**Writes before everything** (Phase 1 is the master gate). **Grounding is the convergence** (Phase 4 needs Phases 1–3). **Learning is terminal** (Phase 8 consumes all events). Full spine + parallelization: [`diagrams/dependency-graph.md`](diagrams/dependency-graph.md), [`implementation/IMPLEMENTATION-003.md`](implementation/IMPLEMENTATION-003.md).

## Governance rules (the non-negotiables)

The four singletons are permanent (invariant **P4**): one write authority, one grounding authority, one confidence vocabulary, one conversation engine. Adding a fifth of any is non-conformant regardless of merit. See all 30 invariants in [`appendices/invariants.md`](appendices/invariants.md).

The conformance test: an implementation is conformant iff it (1) writes through the single write authority, (2) grounds through the Grounding Authority, (3) validates through the Validation Pipeline, (4) uses the canonical confidence vocabulary, (5) leaves every fact explainable, and (6) violates no invariant.

## PR expectations

Every PR touching platform code completes [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md). A reviewer blocks on any unchecked applicable item and on any **CI census regression**. The five headline census rules that block merge:

| Rule | Must be | Gate |
|---|---|---|
| No new write authority | writer census = 1 | I2A §14 |
| No grounding bypass | bypass census = 0 | I2D §17 |
| No direct canonical reads | read census = 0 | I2G §16 |
| No unregistered AI workflow | LLM-call census = 0 | I2F §16 |
| No unmanaged learning | learning census = 0 | I2H §16 |

## Certification flow

```
Coding prompt derives from a 002 program
      ▼
PR completes CONFORMANCE-CHECKLIST + passes CI census
      ▼
Feature-complete (shadow: computes alongside legacy, serves nothing)
      ▼
Per-tenant enforce (internal → beta → cohorts → all) + rollback demonstrated
      ▼
Production-ready (gate green, observability live, legacy dormant-with-sunset)
      ▼
Phase gate → next phase may enforce
```

**Feature-complete vs production-ready** is defined in [`implementation/IMPLEMENTATION-003.md`](implementation/IMPLEMENTATION-003.md) §7.

## Common mistakes (read before your first PR)

1. **Adding a second writer/reader path** "just for this feature." This is the #1 non-conformance — everything writes through the Knowledge authority and reads through Grounding (AI) or Projections (display). (P3, P11, P26)
2. **Persisting AI output without validation.** No generated value persists without a `ValidationPassed` token, on any path — including client-mediated saves. (P19)
3. **Self-reporting confidence in a generator.** Generators emit a *signal*; Trust computes the composite. (P12)
4. **Editing a Fact in place.** Knowledge is append-only; supersede, never overwrite. (P15)
5. **Fabricating fallback content.** Deterministic logic never fabricates; an empty/unknown result is honest. (P20)
6. **Serializing the profile row into a prompt.** Ad-hoc grounding is prohibited; request a Grounding Context. (P11, D2 §7)
7. **Editing a ratified document to change a decision.** Ratified docs are frozen — change them only through an [amendment](amendments/README.md).
8. **Silent truncation / dropped writes.** Record exclusions (P22); a dropped write is an error, never a warning (P29).

## Amendment process (changing the constitution)

Ratified documents (DESIGN-001, DESIGN-002, IMPLEMENTATION-001, 002A–H, 003, the ADRs) are **frozen**. You never overwrite them. To change a constitutional decision:

1. Open an amendment from [`amendments/AMENDMENT-001-template.md`](amendments/AMENDMENT-001-template.md).
2. State the evidence (amendments are evidence-driven).
3. Identify affected invariants, gates, ADRs, and programs.
4. The prior constitution stands until the amendment is ratified.
5. On ratification, the amendment *supersedes* — the original stays as history.

Full lifecycle: [`amendments/README.md`](amendments/README.md). The four singletons (P4) and other non-waivable invariants cannot be amended away — see [`GOVERNANCE.md`](GOVERNANCE.md) §5.

## Document editions

Each constitutional document has a concise **Reference Edition** (maintained, certification-ready — the files you see) and an archival **Full Edition** in [`full/`](full/) preserving the complete original rationale. As of v1.0.0 the dual-edition strategy is complete — every constitutional document has both. The Reference Edition is authoritative for maintenance; the Full Edition is frozen history. See [`README.md`](README.md#document-editions) for the convention.

## Ratification (v1.0.0)

The constitution is **ratified at version 1.0.0** (2026-07-18). Ratified documents are frozen; they change only through [amendments](amendments/). See [`VERSION.md`](VERSION.md) (versioning rules), [`RATIFICATION.md`](RATIFICATION.md) (the record), [`RELEASE-NOTES-v1.0.0.md`](RELEASE-NOTES-v1.0.0.md) (what shipped), [`LIFECYCLE.md`](LIFECYCLE.md) (document stages), [`HISTORY.md`](HISTORY.md) (preservation policy), and [`MAINTAINERS.md`](MAINTAINERS.md) (roles).

---

**Related:** [`README.md`](README.md) · [`INDEX.md`](INDEX.md) · [`GOVERNANCE.md`](GOVERNANCE.md) · [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md) · [`appendices/relationships.md`](appendices/relationships.md)
