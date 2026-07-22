# IMPLEMENTATION-002B — Trust Context Implementation Program (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002B.md`](../implementation/IMPLEMENTATION-002B.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-T, Phase 2 (parallels Phase 3). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]. Distinguishing invariant: **confidence is computed, reproducible, and reversible; Trust recommends and stores, never writes Facts** (P12/P8). **Classification: Ready for Development.**

---

## 1. Executive Summary

The Trust Context makes trust computable, reproducible, and reversible. It replaces the certified broken confidence contract — four disagreeing writers, mismatched keys, an unrecognized band, monotonic-max, and duplicate columns — with **one composite confidence engine**, promotes the read-time provenance reconstruction into an authoritative lineage store built on the `company_profile_refinements` substrate, generalizes the enrichment accept/reject flow into the constitutional review lifecycle, and stands up the Learning Signal capture that closes the certified missing measurement loop. Trust runs after Knowledge: it depends on WS-K's single write authority existing so that confidence and provenance attach to Fact versions at one seam. The program is a **dual-compute strangle** — the composite engine computes in shadow alongside legacy bands, divergence is measured against a declared translation table (including the mismatch-key rescue), consumers are re-pointed to the composite, and legacy band writers are retired. Trust never writes Facts; it hands computed composites and provenance to Knowledge through the integration hooks and executes only the state transitions Reviews produce. Two early rescues land here: the confidence key registry (the `company_name`→`name`, `unique_value_proposition`→`unique_value`, `'Needs Review'`→contradiction translations) and the customer-success ≥60 threshold consumers re-pointed onto the composite contract — early because they consume trust, not grounding.

## 2. Repository Inventory

`computeConfidenceScore` → the generation-confidence dimension input (not the whole score). Refine `field_confidence` writer and PT `field_confidence` writer → **Replace** (engine computes; writers retired). `overall_confidence`/`confidence_score` monotonic-max → **Replace** (P12); one column sunset. KG `bandToConfidence` → Refactor (reads composite). `calculateContextQualityMetadata` reliability formula → Refactor (a Trust-owned quality projection over composites). The `field_confidence` JSONB column → Preserve (Phase-2 storage seam, dual-written). Band enum + rogue `'Needs Review'` → Replace with the canonical vocabulary + key registry. `companyProfileProvenanceService` (read-time reconstruction) → Refactor (store; reconstruction = migration seed). `enrichmentProvenance` → Refactor (record shape). `company_profile_refinements` → lineage substrate. `readAiConfidence` default 'medium' → Replace (fabricated defaults prohibited, P12). Offline LLM-judge harness → Preserve (calibration bench). Consumers (customer-success ≥60, KG state, UI badge) → Refactor to the composite contract.

## 3. Trust Context Boundary (frozen)

**Owns:** Confidence (the composite + all five dimensions), calculation + history, Provenance records, Fact lineage, Review objects/decisions/lifecycle, Trust metrics, Learning Signals + calibration. **Does NOT own:** Facts (attaches confidence/provenance via hooks; never creates or mutates Fact values), Evidence (references ids), Grounding, AI/Generation (consumes generation-run refs; never invokes models), Projections, Consumers. Boundary law: the composite is stored on the Fact version (a Knowledge-owned container) but computed and owned by Trust; generators emit a generation-confidence *signal*, never the composite (P12).

## 4. Composite Confidence Engine

Five dimensions: **evidence** (source-class reliability + corroboration count — Evidence supplies the class, Trust weights), **generation** (calibrated model self-assessment, recalibrated by Learning), **deterministic** (rule-derivation strength — classifier signal, competitor gate scores), **review** (human confirmation state — Trust-owned), **freshness** (decay against the field's volatility + site-change signals — Trust-owned). Composition = a declared, versioned function exposing the composite value and the dominant limiting dimension ("low because stale"). Derived facts inherit the minimum of input composites adjusted by derivation strength. Ceilings per determinability (interpretive fields never reach observed-level). Floor = Unknown (no fabricated 'medium'). Reversible (monotonic-max prohibited). Calculator versioned → reproducibility (same inputs + version ⇒ same composite).

## 5. Confidence Lifecycle

Initial → Calculated → Updated → Decayed → Contradicted → Reviewed → Confirmed → Corrected → Superseded → Archived, each with trigger, calculation, events, consumers, and rollback. History append-only; every composite version retained (no trust-history loss).

## 6. Provenance Specification

Exactly one immutable provenance record per Fact version, created transactionally with the version via the Knowledge integration hook. Contents: source (evidence ids), generator (pipeline run id, prompt version, model — or human actor), grounding reference, review reference, actor + actor class, version reference, timestamp, lineage (parent versions for derived facts). Migration seed = the four-signal reconstruction + the refinements before/after history (honestly marked migrated). Every Fact version has complete provenance (gate); records are immutable (P5, 1:1 with versions).

## 7. Review Engine

Generalizes the enrichment accept/reject/snooze flow into all review types: Auto-approved, Needs Review, User Confirmation, Admin Review, Terminal (Accepted/Rejected/Corrected — immutable, reviewer-attributed, captured as Learning Signals), Expired (conservative fallback). State machine Requested → Assigned → {Accepted | Rejected | Corrected} → Closed / Expired; guards (recorded reviewer identity; reviewer cannot edit evidence; generator cannot auto-resolve). Review executes Knowledge transitions via callback (ConfirmFact/CorrectFact/contradiction resolution) — Trust decides, Knowledge transitions.

## 8. Confidence Recalculation Strategy

Deterministic recomputation on: new evidence, new Fact version, review decision, contradiction, freshness tick, user confirmation/correction. Pure function of (dimension inputs, calculator version); no wall-clock/randomness/read-order dependence; idempotent. Migration recomputes all facts once through the translation table (mismatch-key rescue + `'Needs Review'`→contradiction).

## 9–10. Knowledge & Validation Integration

Mutation hooks (Knowledge invokes Trust to compute composite + generate provenance before committing the Fact version — Trust returns values, Knowledge stores). Confidence assignment (Trust computes; Knowledge stores; Trust never writes the Fact value, P8). Provenance generation (1:1 with versions). Lineage updates (derived-fact mutations pass parent refs). Review callbacks (dispositions invoke Knowledge mutations). Contradiction notifications (KnowledgeContradicted → Trust lowers composite + raises a Review). Validation surface: confidence (floor/ceiling, no fabricated defaults, calculator version), provenance (complete, refs resolve), review (reviewer + legal transition + authorized), lineage (no dangling/cyclic). Sequencing: requires the WS-K gate closed.

## 11. Event Integration

ConfidenceCalculated/Updated/Decayed/Corrected, ProvenanceCreated, ReviewRequested/Assigned/Accepted/Rejected/Expired, LearningSignalCaptured. Full envelope; per-fact ordering; idempotent; replayable; observable; audited.

## 12. Legacy Migration

(1) composite engine dual-compute; (2) confidence key registry rescue (translation table; the certified defect cases now read correctly); (3) provenance store (reconstruction seeds; store authoritative); (4) review engine (enrichment flow generalized); (5) consumers re-pointed (customer-success early); (6) legacy band writers retired; (7) `confidence_score` column sunset. Proof: a CI census confirms zero `field_confidence`/confidence-column writers outside the Trust engine and zero direct band reads outside the composite contract at enforce.

## 13. Shadow Rollout Strategy

Dual computation (legacy bands serve; composite recorded). Comparison: the composite (mapped back through the translation table) diffed against legacy per field; the mismatch-key rescue cases are expected divergences (legacy was wrong), whitelisted with reason. Divergence metrics per field family; the rescue validated by confirming the previously-degraded nodes (`name`, `unique_value`, business_model) now read correctly. Promotion (per consumer per tenant): reproducibility spot-checks = 100%; zero unexplained divergence; translation-table correctness on migrated data; performance within budget; rollback exercised. Enforcement: composite serves; legacy band writers dormant; dual-write of composite history continues.

## 14. Rollback Strategy

Confidence engine: per-consumer/per-tenant flag revert to legacy bands (dormant until Phase-2 gate); composite history append-only (never lost). Provenance: additive over the reconstruction seed; revert falls back to read-time reconstruction. Review: revert stops new engine reviews; dispositions are immutable records. Lineage: append-only, rollback-proof. Events: revert stops emission; subscribers idempotent. Guarantee: because composites compute *alongside* (not replacing) legacy bands until enforce and all trust history is append-only, no rollback can lose trust history — structural.

## 15. Testing Framework

Confidence (five-dimension composition; ceilings/floors; contradiction/review/decay adjustments; monotonicity prohibited); reproducibility (100%); lineage (no dangling/cyclic; migrated chains); provenance (100% coverage, refs, immutability); review (all types × dispositions; expiration; authorization; Learning Signal capture); authorization; concurrency (parallel recompute; version races; idempotent); tenancy; performance (recompute + hook overhead); rollback (exercised, trust-history-equivalence); migration (translation-table correctness on the defect cases).

## 16. Certification Gates

(1) one confidence engine (census = 1); (2) one provenance source (reconstruction retired); (3) zero drift (defects verified fixed); (4) reproducible (100% + calculator version stamped); (5) complete lineage; (6) complete provenance; (7) correct review lifecycle; (8) event correctness; (9) rollback verified; (10) production safety.

## 17. Implementation Sequence

T0 (requires Phase 0 + WS-K gate closed + key registry seeded) → T1 composite engine core → T2 Knowledge hooks (dual-write dark) → T3 provenance/lineage store → T4 recalculation triggers + reproducibility harness → T5 review engine → T6 shadow + translation table → T7 consumer re-pointing (customer-success early; UI badge deferred to Phase 7) → T8 Learning Signal capture (calibration application is WS-L) → T9 enforcement → T10 certification → T11 retirement staging.

## 18–19. Certification

**Ready for Development.** Complete scope; every confidence defect maps to a named replacement with a migration test; clean boundary (Trust returns values, never writes Facts). Not "Production Implementation Ready" — execution awaits the WS-K gate; on it, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002B.md`](../implementation/IMPLEMENTATION-002B.md) · [`IMPLEMENTATION-002A-FULL.md`](IMPLEMENTATION-002A-FULL.md) · [`IMPLEMENTATION-002C-FULL.md`](IMPLEMENTATION-002C-FULL.md) · **Related ADRs:** [ADR-002](../adr/ADR-002-one-trust-engine.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-2.
