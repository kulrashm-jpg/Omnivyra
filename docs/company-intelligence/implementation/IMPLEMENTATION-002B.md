# IMPLEMENTATION-002B — Trust Context Implementation Program v1.0

**Status:** Authoritative program for the Trust Context (WS-T, Phase 2; parallels Phase 3). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]. Distinguishing invariant: **confidence is computed, reproducible, and reversible; Trust recommends and stores, never writes Facts** (P12/P8).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Makes trust computable, reproducible, reversible. Replaces the broken confidence contract (four writers, mismatched keys, unrecognized band, monotonic-max, duplicate columns [A3 §6]) with **one composite confidence engine**; promotes read-time provenance reconstruction into an authoritative lineage store on the refinements substrate; generalizes the enrichment accept/reject flow into the constitutional review lifecycle; stands up Learning Signal capture [A4 §1]. A dual-compute strangle. Two early rescues: the confidence key registry (mismatch translations) and the customer-success ≥60 threshold consumers re-pointed to the composite.

## 2. Repository Inventory

computeConfidenceScore → generation-confidence dimension input; refine/PT band writers → **Replace**; overall_confidence/confidence_score monotonic → **Replace** (P12); KG bandToConfidence → reads composite; provenance service → lineage store (reconstruction = migration seed); readAiConfidence default 'medium' → **Replace** (P12); judge harness → calibration bench. Consumers (customer-success ≥60, KG, UI badge) → Refactor to composite contract.

## 3. Trust Boundary (frozen)

**Owns:** Confidence (composite + 5 dimensions), calculation + history, Provenance, Lineage, Review, Trust metrics, Learning Signals. **Does NOT own:** Facts, Evidence, Grounding, AI/Generation, Projections. The composite is stored on the Fact version (Knowledge-owned container) but computed and owned by Trust; generators emit a generation-confidence *signal*, never the composite (P12).

## 4. Composite Confidence Engine

Five dimensions: evidence (source-class reliability + corroboration), generation (calibrated self-assessment), deterministic (rule strength), review (human confirmation state), freshness (decay). Composite = declared versioned function exposing value + dominant limiting dimension. Derived facts inherit the minimum adjusted by derivation strength. Ceilings per determinability; floor = Unknown (no fabricated 'medium'); reversible (monotonic prohibited). Calculator versioned → reproducible.

## 5. Confidence Lifecycle

Initial → Calculated → Updated → Decayed → Contradicted → Reviewed → Confirmed → Corrected → Superseded → Archived. Recomputed deterministically on triggers; history append-only.

## 6. Provenance Specification

One immutable record per Fact version: source (evidence ids), generator (run/prompt/model or human), grounding ref, review ref, actor + class, version ref, timestamp, lineage. Migration seed = four-signal reconstruction + refinements history (marked migrated). 100% coverage guaranteed.

## 7. Review Engine

Auto-approved, Needs Review, User Confirmation, Admin Review, Terminal (Accepted/Rejected/Corrected), Expired. State machine Requested→Assigned→{Accepted|Rejected|Corrected}→Closed / Expired; dispositions immutable + reviewer-attributed + captured as Learning Signals; executes Knowledge transitions via callback.

## 8. Recalculation Strategy

Triggers: new evidence, new version, review, contradiction, freshness, confirmation/correction. Pure function of (dimension inputs, calculator version); idempotent; migration recomputes all facts once through the translation table (mismatch-key rescue + 'Needs Review'→contradiction).

## 9–10. Knowledge/Validation Integration

Mutation hooks (Trust computes composite + generates provenance before Knowledge commits — Trust returns values, Knowledge stores); review callbacks; contradiction subscription. Validation surface: confidence (floor/ceiling, no fabricated defaults, calculator version), provenance (complete, refs resolve), review (reviewer + legal transition), lineage (no dangling/cyclic).

## 11. Event Integration

ConfidenceCalculated/Updated/Decayed/Corrected, ProvenanceCreated, ReviewRequested/Assigned/Accepted/Rejected/Expired, LearningSignalCaptured. Transactional; per-fact ordering; idempotent; replayable; observable; audited.

## 12. Legacy Migration

(1) composite engine dual-compute; (2) key registry rescue; (3) provenance store; (4) review engine; (5) consumers (customer-success early); (6) legacy band writers retired; (7) confidence_score column sunset. Proof: CI census = 1 confidence writer, zero direct band reads outside the composite contract.

## 13–14. Shadow & Rollback

Dual computation + translation-table diff (mismatch rescues whitelisted, validated by confirming degraded nodes now read correctly); promotion on 100% reproducibility + zero unexplained divergence. Rollback: flag revert to legacy bands (dormant); composite history append-only; no trust-history loss (structural).

## 15. Testing

Confidence (5-dimension, ceilings/floors, monotonicity prohibited), reproducibility (100%), lineage, provenance, review, authorization, concurrency, tenancy, performance, rollback, migration (defect cases pass).

## 16. Certification Gates

(1) one confidence engine; (2) one provenance source; (3) zero drift (defects [A3 §6] verified fixed); (4) reproducible; (5) complete lineage; (6) complete provenance; (7) correct review lifecycle; (8) event correctness; (9) rollback verified; (10) production safety.

## 17. Implementation Sequence

T0 (requires Phase 0 + **WS-K gate closed** + key registry seeded) → T1 composite engine → T2 Knowledge hooks → T3 provenance store → T4 recalculation triggers → T5 review engine → T6 shadow + translation table → T7 consumer re-pointing → T8 Learning Signal capture → T9 enforcement → T10 certification → T11 retirement.

## 18–19. Certification

**Ready for Development.** Complete scope; every confidence defect maps to a named replacement with migration test; clean boundary (Trust returns values, never writes Facts). Not "Production Implementation Ready" — execution awaits the WS-K gate; on it, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002A](IMPLEMENTATION-002A.md) · [IMPLEMENTATION-002C](IMPLEMENTATION-002C.md) · **Depends on:** I1, I2A · **Related ADRs:** [ADR-002](../adr/ADR-002-one-trust-engine.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002B-FULL.md`](../full/IMPLEMENTATION-002B-FULL.md) · **Certification:** Ready for Development · GATE-2. See [`../appendices/relationships.md`](../appendices/relationships.md).
