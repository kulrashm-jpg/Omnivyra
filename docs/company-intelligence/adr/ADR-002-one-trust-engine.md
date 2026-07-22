# ADR-002 — One Trust Engine

**Status:** Accepted (ratified) · **Invariant:** P12 (+P6) · **Program:** IMPLEMENTATION-002B

## Context

AUDIT-003 certified four disagreeing confidence writers with mismatched keys (`company_name`/`unique_value_proposition` written; `name`/`unique_value` read → KG nodes permanently degrade), an unrecognized `'Needs Review'` band, monotonic `Math.max` (confidence could never decrease), a fabricated `'medium'` default, and two duplicate score columns. Provenance was reconstructed at read time; the refinements audit table was write-only. Confidence and provenance failed together.

## Decision

**One Trust engine** owns a five-dimension composite confidence (evidence, generation, deterministic, review, freshness), one canonical vocabulary + key registry, and an authoritative provenance/lineage store. Confidence is computed (never self-reported by generators), reproducible (calculator versioned), and reversible (can decrease). Trust attaches confidence and provenance to Fact versions via hooks — it returns values; Knowledge stores them.

## Alternatives considered

1. **Fix the keys in place, keep per-writer bands.** Rejected — leaves multiple writers and no reproducibility; drift recurs.
2. **Single opaque 0–100 score.** Rejected — loses the "why low" signal; the composite exposes the dominant limiting dimension for explainability.
3. **Confidence as a Knowledge concern.** Rejected — couples trust computation to fact storage; Trust is a distinct context so calibration and review evolve independently.

## Consequences

- The certified confidence defects close with migration tests proving each case.
- Provenance becomes the edge structure of the knowledge graph (lineage per version).
- Customer-success ≥60 thresholds re-point to the composite contract (early, Phase 2).
- Learning recommends calibration parameters that Trust's versioned calculator consumes.

## Trade-offs

- A composite is more expensive to compute than a band (mitigated: deterministic, cacheable, event-triggered).
- Migrating monotonic history to a reversible model requires a translation table (mitigated: dual-display window, defect-case tests).

## Future implications

Confidence is never self-reported again (generators emit a signal, one dimension input). New trust signals become new dimension inputs or calibration recommendations, never new writers. A confidence-writer census (= 1) enforces this.

## Related constitutional sections

DESIGN-002 §7 (confidence model), §8 (review), §9 (learning), §11 (P6/P12/P14); IMPLEMENTATION-002B §4–7, §16.

---
**Related ADRs:** [ADR-001](ADR-001-one-write-authority.md), [ADR-005](ADR-005-universal-validation.md), [ADR-009](ADR-009-learning-runtime.md) (calibration). **Amendments:** none.
