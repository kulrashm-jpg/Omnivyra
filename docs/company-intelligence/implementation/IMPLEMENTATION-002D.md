# IMPLEMENTATION-002D — Grounding Authority & Validation Pipeline Implementation Program v1.0

**Status:** Authoritative program for the Grounding Authority (WS-G) and Validation Pipeline (WS-V), the co-dependent pair of Phase 4. Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A], [I2B], [I2C]. Distinguishing invariant: **grounding is deterministic and no AI workflow grounds any other way** (P11); **no generated value persists unvalidated** (P19).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Stands up the two runtimes dissolving the platform's largest fragmentation. The **Grounding Authority** replaces five mechanisms [A3 §3] with one interface serving versioned Grounding Contexts. The **Validation Pipeline** replaces the validation vacuum [A3 §7, A4 §4] with one runtime enforcing schema/semantic/consistency/boundary tiers universally. Closes three defects: five-mechanism fragmentation → one authority (P4/P11); consistency vacuum [A4 §6] → dissolved (all ground in one graph); hand-maintained registry [A2 C12] + ungated MarketPulse channel [A2 C10] → structural declarations. Phase 4 is the convergence point (depends on all three foundation gates). A per-consumer dual-read strangle.

## 2. Repository Inventory

Canonical adapter → seed of the authority (its rollout machinery = the instrument); legacy getProfile → Replace; KG block → constraint+gap sections; buildCompanyUnderstanding → external-knowledge retrieval via Evidence; ad-hoc serializations → Replace; buildContentContext → thin client (30+ consumers ride free). Validation: extraction zod → S tier; containsMeaningfulSignal → Sem tier **platform-wide**; validatePublicWebsite/scrub → B tier; save-path validation (none) → Replace; consistency (none) → new Con tier; capabilityValidation → subsumed.

## 3. Boundaries (frozen)

**Grounding owns:** Grounding Context, Consumer Profiles/registration, assembly/resolution/retrieval ordering, optimization, explainability packaging. **Does NOT own:** Evidence, Facts, Confidence/Reviews, AI/prompt logic, Consumers. **Validation owns:** schema/semantic/consistency/consumer/runtime validation + decisions (a pure decision service; reads and verdicts, never writes). One integration seam: grounding-input validation.

## 4. Consumer Registry

Declarative Consumer Profiles replace the static list. Per-consumer: required/optional knowledge, confidence floor per class, freshness, refresh triggers, fallback, explainability duty. Registration law: an unregistered consumer cannot obtain grounding (P11); the per-field consumer list is derived from declarations.

## 5. Grounding Assembly

Four sections (knowledge / evidence / constraint / gap). Lifecycle: retrieve → confidence-filter → freshness-filter → contradiction-handling → consumer-optimization → deterministic-ordering → explainability-packaging. **Determinism guarantee:** identical inputs → identical Grounding Context. Prohibited inputs: raw rows, AI-output-as-evidence, unlabeled inference, cross-tenant, unattributed.

## 6. Retrieval Strategy

Knowledge (primary, consumer field set), Trust (filter, not fetch), Evidence (secondary, recorded exclusions P22), User Authority (highest constraint), Reviews, KG (constraint+gap), historical conversations, industry packs, external knowledge — each with ordering/priority/filtering/freshness/limits/fallback. All read-only (P2).

## 7. Validation Pipeline

Tiers in order: Schema (terminal), Semantic (cliché filter platform-wide + evidence-discipline; block observable, warn→block interpretive), Consistency (contradiction + cross-field alignment), Boundary (scrub/domain/website/tenant, terminal), Ownership (terminal), Confidence (terminal), Freshness (warning), Completeness (per fallback), Explainability (terminal, P7), Consumer contract. Emits ValidationPassed (token) / ValidationFailed (taxonomy → prompt governance + Learning). Closes [A3 §7] permanently.

## 8. Explainability

Every context/value answers seven questions (evidence used, facts selected, confidence + limiting dimension, freshness, exclusions, contradictions, reasoning path). Unexplainable → rejected (P7).

## 9. Runtime Policies

Content-addressed caching (correct by determinism); event-driven invalidation; tenant-scoped (P21); stateless/reentrant concurrency; per-consumer budgets + degradation; deterministic execution.

## 10–11. Integration

Knowledge (facts, read-only), Trust (composites, provenance, review state), Evidence (excerpts, freshness, attribution) — no ownership duplicated. AI runtime: request grounding by profile → validated context → prompt injection (Generation owns prompt text) → validation hook → explainability → retry on failure. No-bypass law (P11).

## 12. Event Integration

GroundingRequested/Prepared/Rejected, ValidationStarted/Passed/Failed, ConsumerRegistered/Updated. Idempotent by content-address; replayable; observable; audited.

## 13. Legacy Migration

(1) authority stand-up; (2) validation pipeline (replaces interim WS-K shim); (3) KG block + companyUnderstanding folded in; (4) content consumers (free-ride); (5) campaign/BOLT/rec consumers; (6) MarketPulse + ungated channel; (7) define-* chats; (8) remaining bypasses. Two CI census rules: zero non-Grounding-Context AI inputs (P11); zero unvalidated persistence (P19).

## 14–15. Shadow & Rollback

Dual grounding + validation warn-mode; richer/consistent grounding whitelisted; promotion on determinism + zero unexplained divergence + warn→block complete. Rollback: per-consumer revert to legacy serialization / validation to warn-mode; deterministic recomputable; no consumer interruption (structural).

## 16. Testing

Grounding (four-section, filtering, contradiction, prohibited-input), determinism (100%), validation (tiers × field classes; [A3 §7] blocked), explainability, contract, concurrency, tenancy, replay, rollback, performance.

## 17. Certification Gates

(1) one Grounding Authority (P11); (2) one Validation Pipeline (P19); (3) zero consumer bypasses; (4) deterministic; (5) explainability complete; (6) validation complete (Con tier live, closes [A4 §6]); (7) consumer contracts satisfied; (8) event correctness; (9) rollback verified; (10) production safety.

## 18. Implementation Sequence

G0 (requires **all three foundation gates**) → G1 Grounding Context model + assembly → G2 Consumer Registry → V1 Validation Pipeline (replaces interim shim) → G3 foundation integration → G4 explainability → G5 runtime policies → G6 shadow → G7 consumer migration → G8 enforcement → G9 certification → G10 retirement.

## 19–20. Certification

**Ready for Development.** Complete scope; five-mechanism fragmentation, unvalidated save, consistency vacuum, hand-maintained registry, ungated channel each map to a census-enforced closure. Clean boundaries. Not "Production Implementation Ready" — awaits all three foundation gates (the convergence precondition); on them, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002C](IMPLEMENTATION-002C.md) · [IMPLEMENTATION-002E](IMPLEMENTATION-002E.md) · [IMPLEMENTATION-002F](IMPLEMENTATION-002F.md) · **Depends on:** I1, I2A–C · **Related ADRs:** [ADR-004](../adr/ADR-004-grounding-authority.md), [ADR-005](../adr/ADR-005-universal-validation.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002D-FULL.md`](../full/IMPLEMENTATION-002D-FULL.md) · **Certification:** Ready for Development · GATE-4. See [`../appendices/relationships.md`](../appendices/relationships.md).
