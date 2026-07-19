# DESIGN-001 — Canonical Company Intelligence Platform Architecture Specification v1.0

**Status:** Canonical blueprint. Derived from AUDIT-001 (Highly Coupled), AUDIT-002 (Partially Owned), AUDIT-003 (Hybrid), AUDIT-004 (Moderate). Defines what the platform becomes, not how to build it. Audit findings cited [A1]–[A4].

---

## 1. Executive Vision

Today one coherent deterministic backbone (crawl → change detection → refresh gate → classification) is surrounded by a fragmented periphery: five grounding mechanisms, ten write authorities, four disagreeing confidence contracts, six independent conversations, a quality regime protecting one workflow while the highest-volume consumers depend on the least-protected fields. The next-generation platform inverts the defect: **one intelligence domain, one evidence layer, one grounding authority, one generation lifecycle, one trust model — many consumers.** Certified strengths become the foundation (canonical adapter rollout, refresh gate, KG node model, user-lock invariant, `company_context_*` schema discipline); certified defects define the requirements, resolved by construction. End state: every piece of intelligence can answer *what it is, where it came from, how sure we are, when it was last true, and who may change it* — and every AI workflow draws from that one well.

## 2. Canonical Domain Model

**Six bounded contexts**, each with one owner and one write path: **Identity** (company, website, domains, tenancy); **Evidence** (every raw observation); **Knowledge** (the graph — facts, relationships, contradictions, confirmations); **Generation** (pipeline + conversation engine — all AI); **Trust** (confidence + provenance, jointly owned because they fail together when separated); **Distribution** (grounding authority + consumer projections).

**Field taxonomy — two axes:** *Determinability* (Observable / Derivable / Interpretive — sets generation mode, validation strictness, max confidence) and *Authority* (User-authoritative / Evidence-authoritative / Derived — resolves every "who wins" conflict as a property of the field).

## 3. Company Intelligence Architecture

**Intelligence is a projection of knowledge; knowledge is a derivation of evidence.** Evidence → Knowledge (facts with state, confidence, lineage) → Intelligence Views (per-consumer projections). The profile "row" becomes a read model. Every scope item (Company Profile, Marketing Intelligence, Strategy, Problem Transformation, Content/Campaign/Market/Recommendation/Context Intelligence) is a named projection declaring which nodes it reads at what confidence. Multi-tenancy is structural.

## 4. Canonical Evidence Layer

The single most leveraged fix — quality degrades because evidence is *unrouted*, not unavailable [A4 §2]. **The Evidence Object:** identity (content-addressed), type (crawl-page, structured-metadata, json-ld, blog-content, landing-page, social-profile, document, user-input, conversation-turn, generation-output, external-knowledge, analytics-signal, connector), source attribution, immutable versioning (supersede never overwrite), freshness (valid-until per type), evidence confidence (source-class reliability), traceability (reverse index). Rules: everything learned is evidence-first (including conversation answers and accepted suggestions); both crawlers feed one store; structured data is first-class; external knowledge routed to all; historical generations are voice evidence; future connectors plug in by emitting evidence objects.

## 5. Canonical Grounding Architecture

**One Grounding Authority** replaces five mechanisms. Every AI workflow receives a **Grounding Context**: knowledge section (facts filtered by need, with state/confidence/freshness), evidence section (selected excerpts with attribution), constraint section (locked/already-known/contradicted/below-floor), gap section (ranked unknowns). Rules: no workflow serializes the profile itself; grounding is consumer-profiled; grounding never triggers generation; cross-workflow consistency is inherited (all ground in the same graph).

## 6. Canonical Intelligence Generation Pipeline

One lifecycle: Evidence → **Evidence Selection** (policy-driven, recorded exclusions) → **Grounding** → **Prompt Construction** (governed assets, evidence-discipline clause per determinability) → **AI** (single gateway) → **Validation** (universal, server-side — no value persists unvalidated) → **Classification** (labeled opinion, never overwrites user) → **Confidence** (computed, never self-reported) → **Persistence** (one write authority, typed mutations) → **Review** (proposals for user-authority fields) → **Learning**. Deterministic-first; the three certified anti-patterns (fabricating fallback, monotonic confidence, user override) are banned.

## 7. Canonical Confidence Model

Composite, never opaque. Five dimensions: evidence, generation, deterministic, review, freshness. Rules: one canonical scale + one key registry (kills key mismatches); confidence can go down (monotonic-max prohibited); derived facts inherit the minimum adjusted by derivation strength; consumers declare floors; no fabricated defaults (absent = unknown).

## 8. Canonical Provenance Model & Company Knowledge Model

Provenance is the edge structure of the knowledge graph. **Knowledge:** entities, typed facts with state (unknown→inferred→observed→confirmed→corrected→contradicted), relationships, derived facts (recording derivation), contradictions (first-class), user confirmations/corrections (terminal authority). **Provenance (per fact version):** source (evidence ids), generator, timestamp, reviewer, confidence-at-write, lineage, overwrite history. This makes the 14 ownership conflicts individually impossible — precedence is the authority axis, recorded per write.

## 9. Unified Conversation Engine

One engine — the commit-52305785 intent realized. One runtime, mode configs (onboarding, refinement, recommendations, campaign/content planning, strategy). Shared memory (conversation state in the knowledge context — what one learns, all know). Deduplication by node identity. Adaptive, evidence-aware questioning (never ask what evidence answers). Confidence-aware questioning (low-confidence → confirmation questions). Progressive profiling (readiness = knowledge completeness). Conversation output flows through the pipeline — turns become evidence, extractions become validated proposals.

## 10. Industry Intelligence Architecture

**Industry Intelligence Packs** — declarative, versioned. Each declares fact-schema extensions, goal/KPI vocabularies, audience/messaging frames, competitor topology, campaign templates, recommendation priors, evidence expectations. Packs are content, not code; adding an industry is authoring a pack. The classifier selects the pack (uncertainty exposed as confidence, user override authoritative); never silently flattens to generic.

## 11. Continuous Learning Architecture

Closes the loop [A4 §1]: user edits/corrections (ground truth → correction rate), accept/reject (precision), conversation corrections, content/campaign/engagement outcomes (downstream validity), human reviews (confidence calibration), analytics (drift). Learning adjusts confidence, selection policy, and pack content — never silently rewrites facts; every adjustment is provenance-tracked; the offline judge bench becomes the standing evaluation bench.

## 12. Explainability Architecture

A read model over Trust + Evidence. Every field answers: why? based on what? confidence? last updated / by whom? evidence? alternatives (retained superseded/contradicted/rejected)? Serves users (correction), operators (audit), and downstream AI (basis-aware reasoning).

## 13. Extensibility Architecture

New evidence/crawlers/connectors → emit Evidence Objects. New models → gateway policy. New industries → packs. New agents/consumers → declare a grounding profile. Multilingual → evidence attribute + generation policy. Multimodal → evidence types with extractors. The rule: new capabilities plug into contexts; they never add writers, grounding mechanisms, confidence vocabularies, or conversation stacks — those four counts are invariants fixed at one.

## 14. High-Level Data Flow

Sources → Evidence Store (immutable, versioned, attributed) → Knowledge Graph (facts, states, lineage, contradictions) → Grounding Authority → consumers (content, campaigns, mix, recs, reports, MarketPulse, future agents) + Generation Pipeline ← Conversation Engine; Trust (confidence + provenance) → Explainability + Learning loop (adjusts selection, confidence, packs). Change propagation on one event bus.

## 15. Canonical Ownership Model

Identity → Identity context. Observations → Evidence. Facts → Knowledge (one write authority). Grounding → Distribution. Generation/prompts → Generation. Confidence + provenance → Trust (one vocabulary). Validation → pipeline (mandatory). Conversations → engine. Industry knowledge → packs. Quality measurement → learning loop. Tenancy → structural.

## 16. Architectural Principles

Evidence-first; one writer per truth; deterministic where possible, AI where beneficial, labeled always; user authority inviolable and explicit; confidence earned, composite, reversible; validation universal; everything explainable; the platform measures itself; consistency by construction; extensions plug in, never fork (four singleton invariants permanent).

## 17. Target Production Architecture

Logical re-architecture, not a microservice mandate — six contexts as modular boundaries within the existing footprint. Certified-sound infrastructure retained and promoted: AI gateway, refresh gate/change-detection stack, flag-gated rollout machinery, observability seams, `company_context_*` schema discipline. Cost discipline generalizes: the refresh gate's budget model becomes the pipeline-wide generation-economy layer.

## 18. Migration Philosophy

Strangle, don't rewrite (canonical adapter off/shadow/enforce is the instrument). Writes before reads. The graph grows by adoption, not big-bang. Never break the invariants that already work. Measure before and after (correction-rate baseline stood up early). Consumers move last and painlessly (projections preserve consumer shapes).

## 19. Final Architecture Certification

Complete coverage of certified defects (all resolved structurally, not policed). Complete preservation of certified strengths. Conformance rule: an implementation is conformant iff it writes through the single write authority, grounds through the Grounding Authority, validates through the pipeline, uses the canonical confidence vocabulary, and leaves every fact explainable. Any change adding a second writer, grounding path, confidence vocabulary, or conversation stack is non-conformant regardless of local merit. Supersedes all implicit architecture in the current implementation.

---
**Related:** [DESIGN-002](DESIGN-002.md) · [AUDIT-001..004](AUDIT-001.md) · **Depends on:** AUDIT-001..004 · **Related ADRs:** [ADR-001..010](../adr/README.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/DESIGN-001-FULL.md`](../full/DESIGN-001-FULL.md) · **Certification:** target architecture. See [`../appendices/relationships.md`](../appendices/relationships.md).
