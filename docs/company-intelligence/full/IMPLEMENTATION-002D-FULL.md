# IMPLEMENTATION-002D — Grounding Authority & Validation Pipeline (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002D.md`](../implementation/IMPLEMENTATION-002D.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-G + WS-V, Phase 4 (co-dependent pair). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A], [I2B], [I2C]. Distinguishing invariant: **grounding is deterministic and no AI workflow grounds any other way** (P11); **no generated value persists unvalidated** (P19). **Classification: Ready for Development.**

---

## 1. Executive Summary

This program stands up the two runtimes that dissolve the platform's largest certified fragmentation. The **Grounding Authority** replaces the five certified grounding mechanisms — the canonical adapter, legacy `getProfile`, the knowledge graph block, `buildCompanyUnderstanding`, and per-endpoint ad-hoc strings — with one interface through which every AI workflow requests a versioned **Grounding Context**. The **Validation Pipeline** replaces the certified validation vacuum — where only extraction was zod-checked, only strategy had a cliché filter, and the chat-save path performed zero server-side content validation — with one runtime enforcing schema, semantic, consistency, and boundary tiers universally (P19). Together they close three certified defects by construction: the five-mechanism fragmentation becomes one authority (P4/P11); the consistency vacuum is dissolved because every workflow grounds in the same graph and new claims are consistency-checked; and the hand-maintained 96-consumer registry plus the ungated MarketPulse intelligence channel become structural declarations enforced by the authority. Phase 4 is the convergence point: it depends on all three foundation gates because a Grounding Context is assembled *from* Facts (Knowledge), *filtered by* confidence and review state (Trust), and *backed by* evidence excerpts (Evidence). The program is a **per-consumer dual-read strangle**. The Validation Pipeline formalizes and replaces the interim validation shim that WS-K stood up, and becomes the single issuer of the `ValidationPassed` tokens that Knowledge mutations and Generation outputs require. After Phase 4, ad-hoc profile serialization is architecturally impossible.

## 2. Repository Inventory

The canonical adapter → the seed of the Grounding Authority (its rollout machinery is *the* migration instrument); legacy `getProfile` → Replace (consumers re-pointed; retired); the KG grounding block → the constraint+gap sections of every Grounding Context; `buildCompanyUnderstanding` → external-knowledge retrieval via Evidence (an evidence-section contributor); per-endpoint ad-hoc serializations → Replace; `buildContentContext` → thin client (30+ consumers ride free). Validation: extraction zod → the schema (S) tier; `containsMeaningfulSignal` → the semantic (Sem) tier, **platform-wide**; `validatePublicWebsite` + partition assertions + self-scrub → the boundary (B) tier; save-path validation (none) → Replace (the interim WS-K shim becomes the full pipeline); consistency (none) → the new consistency (Con) tier; `capabilityValidation` (largely disabled) → subsumed by the real tiers.

## 3. Boundaries (frozen)

**Grounding owns:** the Grounding Context object, Consumer Profiles + registration, context assembly/resolution/retrieval ordering, optimization, explainability packaging, the deterministic assembly function. **Grounding does NOT own:** Evidence (selects and references, never stores), Facts (reads, never mutates), Confidence/Reviews (filters by, never computes), AI Generation + Prompt Logic (prepares the request, never writes prompts or invokes models), Consumers (they declare profiles and subscribe). **Validation owns:** schema, semantic, consistency, consumer-contract, and runtime validation + decisions — a pure decision service that reads and verdicts, never writes. One integration seam: grounding-input validation runs the pipeline against a Grounding Context before it is served.

## 4. Consumer Registry

Replaces the hand-maintained static list with declarative registration. Every consumer registers a Consumer Profile: required knowledge (denied → declared fallback), optional knowledge, minimum confidence floor per field class, freshness tolerance, refresh triggers, fallback/degradation, explainability pass-through. Registration law: an unregistered consumer cannot obtain grounding (P11); the per-field consumer list is derived from declarations.

## 5. Grounding Assembly

The Grounding Context has four sections: **knowledge** (facts filtered by the consumer's needs, each with state/confidence/freshness), **evidence** (selected excerpts with attribution), **constraint** (user-locked fields, already-known facts — the KG block generalized, contradicted facts, below-floor exclusions), **gap** (unknown-but-valuable facts, ranked — the KG next-question logic generalized). Assembly lifecycle: retrieve → confidence-filter (drop/flag below the consumer's floor) → freshness-filter → contradiction-handling (surface, never silently resolve, P13) → consumer-optimization → deterministic-ordering → explainability-packaging. **Determinism guarantee (the core invariant):** identical inputs (fact versions, confidence composites + calculator version, evidence versions, consumer-profile version, assembly version) produce an identical Grounding Context. Prohibited assembly inputs: raw profile-row serializations, other AI outputs presented as evidence (the certified self-referential grounding), unlabeled inference, cross-tenant data, unattributed text.

## 6. Retrieval Strategy

Per-source ordering/priority/filtering/freshness/limits/fallback for Knowledge (primary), Trust (applied as filter, not a separate fetch), Evidence (secondary, recorded exclusions, P22), User Authority (highest constraint priority), Reviews, the Knowledge Graph (constraint + gap), historical conversations, industry packs, and external knowledge. Retrieval law: all retrieval is read-only (P2 — grounding never triggers generation or mutation, closing the certified read-initiates-write hazard); selection and every exclusion are recorded.

## 7. Validation Pipeline

One runtime, invoked at three seams (Knowledge mutation, grounding-input, Generation output). Tiers in order: **Schema** (envelope/shape, registry key, value shape — terminal); **Semantic** (generic-filler/cliché rejection promoted platform-wide + evidence-discipline per determinability class — blocking for observable, warn→configurable-block for interpretive); **Consistency** (new claims vs the graph: contradiction detection + cross-field alignment — the certified vacuum); **Boundary** (self/platform scrub, domain-existence, `validatePublicWebsite`, tenant scoping — terminal); **Ownership** (actor class admissible — terminal); **Confidence** (composite within [floor, ceiling], no fabricated defaults, calculator version — terminal); **Freshness** (staleness flagged — warning); **Completeness** (required-knowledge present — per consumer fallback); **Explainability** (basis carried — terminal, P7); **Consumer contract**. Emits `ValidationPassed` (with a token consumed by Knowledge/Generation) or `ValidationFailed` (with a typed failure taxonomy feeding prompt governance and Learning). Recoverable failures (warnings) annotate but pass; terminal failures reject. This is where the certified critical gap closes permanently — no generated value reaches persistence without a token, on any path including the client-mediated chat-save route.

## 8. Explainability

Every Grounding Context and validated value carries a package answering: evidence used (referenced ids + excerpts + attribution), facts selected (ids/versions), confidence (composite + dominant limiting dimension), freshness (age + decay), exclusions (what retrieval dropped, with reason), contradictions (surfaced), reasoning path (retrieval order + filter decisions + assembly version). A context lacking a complete package fails the explainability validation tier and is not served (P7). Serves users (trust/correction), operators (why-did-generation-produce-this), and downstream AI (basis-aware reasoning).

## 9. Runtime Policies

Content-addressed caching (correct by determinism); event-driven invalidation (KnowledgeChanged, ConfidenceUpdated/Decayed, EvidenceSuperseded/Expired, ConsumerUpdated); tenant-scoped keys (P21); stateless/reentrant concurrency (concurrent requests for the same key collapse to one computation); per-consumer budgets + degradation (omit evidence section with recorded exclusion rather than fail); deterministic execution (no wall-clock/random/order dependence).

## 10–11. Integration & AI Runtime

Knowledge provides Facts/Relationships (read-only); Trust provides confidence composites + provenance + review state; Evidence provides Objects/Observations + freshness + attribution. Grounding selects; Evidence supplies and attributes. Sequencing: requires all three foundation gates closed (the Phase-4 convergence). AI runtime integration: the workflow requests grounding by consumer profile → receives a validated Grounding Context → injects it as structured context (never a raw row) → generated output is validated before persistence (the token required by the Knowledge write authority) → the Grounding Context id is recorded on the run → on ValidationFailed the workflow may re-request/re-generate. No-bypass law (P11) enforced by the CI grounding-bypass census.

## 12. Event Integration

GroundingRequested/Prepared/Rejected, ValidationStarted/Passed/Failed, ConsumerRegistered/Updated. Idempotent by grounding-context content-address; replayable (re-derives deterministically); observable (grounding requests, divergence, validation-failure taxonomy, cache hit-rate); audited.

## 13. Legacy Migration

Per-mechanism/per-consumer, using the canonical adapter's own rollout machinery: (1) authority stand-up (shadow behind the adapter seam); (2) validation pipeline (formalizes the interim WS-K shim; issues tokens); (3) KG block + `buildCompanyUnderstanding` folded into constraint/gap + evidence sections; (4) content consumers (`buildContentContext` re-seated; 30+ ride free); (5) campaign/BOLT/rec consumers (legacy `getProfile` bypasses migrate); (6) MarketPulse incl. the ungated channel (both channels through the authority); (7) the six define-* chats; (8) remaining raw-read + legacy sites. Two CI census rules: zero AI call sites consuming non-Grounding-Context input (P11); zero generated values persisted without a `ValidationPassed` token (P19).

## 14. Shadow & Rollback

Dual grounding (legacy serves; the authority records its context). Comparison: authority output diffed against each consumer's legacy serialization; richer/consistent grounding whitelisted; the noisy legacy nondeterminism sources pinned during comparison. Validation runs in warn-mode first, recording what it *would* block, so Sem-tier over-firing is calibrated before enforce. Promotion (per consumer per tenant): determinism verified; zero unexplained divergence; validation warn→block completed with acceptable rejection rate; performance within budget; rollback exercised. Rollback: per-consumer revert to legacy serialization; validation revert to warn-mode or the interim shim; cache flush-and-rebuild; because the authority assembles alongside legacy until enforce, grounding is deterministic/recomputable, and validation degrades to warn rather than block, no consumer is interrupted.

## 15. Testing Framework

Grounding (four-section assembly per profile; filtering; contradiction; prohibited-input rejection); determinism (identical inputs → byte-identical context; 100%); validation (all tiers × field classes; blocking/warning/terminal; token issuance; the launder exploit blocked); explainability (seven questions; unexplainable rejected); contract (profiles honored); concurrency (cache-collapse, reentrancy); tenancy (cross-tenant impossible, tenant-scoped cache); replay (deterministic re-derivation); rollback (no-interruption proof); performance (assembly + validation latency vs baseline).

## 16. Certification Gates

(1) one Grounding Authority (zero non-Grounding-Context AI inputs, P11); (2) one Validation Pipeline (zero unvalidated persistence, P19; interim shim retired); (3) zero consumer bypasses (legacy + ungated channel migrated); (4) deterministic grounding; (5) explainability complete; (6) validation complete (Con tier live, closes the consistency vacuum); (7) consumer contracts satisfied (registry derived); (8) event correctness; (9) rollback verified; (10) production safety (security non-regression, observability live).

## 17. Implementation Sequence

G0 (requires all three foundation gates) → G1 Grounding Context model + assembly (dark) → G2 Consumer Registry → V1 Validation Pipeline runtime (replaces the interim shim; co-developed with G1) → G3 foundation integration → G4 explainability packaging → G5 runtime policies → G6 shadow harness → G7 consumer migration (content free-ride → campaigns/BOLT/recs → MarketPulse + ungated channel → define-* chats → remaining bypasses) → G8 enforcement (validation warn→block per workflow) → G9 certification → G10 retirement staging.

## 18–19. Certification

**Ready for Development.** Complete scope; the five-mechanism fragmentation, unvalidated save, consistency vacuum, hand-maintained registry, and ungated channel each map to a census-enforced closure; clean boundaries. Not "Production Implementation Ready" — awaits all three foundation gates (the convergence precondition); on them, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002D.md`](../implementation/IMPLEMENTATION-002D.md) · [`IMPLEMENTATION-002C-FULL.md`](IMPLEMENTATION-002C-FULL.md) · [`IMPLEMENTATION-002E-FULL.md`](IMPLEMENTATION-002E-FULL.md) · **Related ADRs:** [ADR-004](../adr/ADR-004-grounding-authority.md), [ADR-005](../adr/ADR-005-universal-validation.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-4.
