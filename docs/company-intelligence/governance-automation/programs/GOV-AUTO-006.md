# GOV-AUTO-006 — Canonical Architecture Drift Detection Implementation Program v1.0

**Status:** Authoritative implementation specification for the Drift Detection Runtime. **Inputs frozen:** Constitution v1.0.0, appendix catalogs, `dependency-manifest`, `check-schema-drift.js`, AUDIT-005, GOV-AUTO-001–005. **Classification: Drift Detection Ready.**

---

## 1. Executive Summary

Drift detection answers "has the map stopped matching the territory?" — it compares the ratified specification (catalogs, manifest, invariants) against actual code/registry/emitted reality, flagging divergence in either direction. AUDIT-005 §6 found this almost entirely missing (consumer/event/workflow/producer/projection/API drift) while schema/ownership/dependency drift exist. Drift needs a scheduling model (continuous). Principle: one comparison runtime reusing existing detectors + adding catalog↔code comparators. **Two commitments:** spec↔spec drift enforceable immediately (governance/documentation/schema — migration-independent); code↔spec drift phase-gated; machine-readable catalogs are a prerequisite.

## 2. Drift Detection Architecture

Single entrypoint, comparison-based; compose don't re-detect; bidirectional finding (code-drift vs spec-drift); dual scheduling (per-PR + continuous); read-only; deterministic.

## 3. Drift Inventory

Ownership/dependency/runtime/API/schema/workflow/consumer/producer/event/projection/AI-runtime/documentation/governance drift → invariant, phase, gate, owner. Migration-independent: schema, documentation, governance. Phase-gated: the rest.

## 4. Existing Drift Capability Audit

Production-ready: semantic (ownership/authority), runtime-shadow. Enforce: schema-drift, frozen-schemas. Warn: dependency-cruiser/eslint. Report (partial): documentation/governance via GOV-AUTO-001. Missing: catalog↔code detectors.

## 5. Drift Detector Specifications

New: Consumer/Producer/Event/Workflow/AI-Runtime/Projection/API/Governance/Documentation drift — purpose/inputs/outputs/methodology/severity/failure. Reused: ownership/runtime/schema/dependency.

## 6. Detection Strategy

Per-category technique (AST/dependency/semantic/repository graph/runtime/manifest/config/catalog comparison). Manifest comparison + semantic/dependency demonstrated; catalog comparison net-new (prerequisite: machine-readable catalogs).

## 7. Drift Lifecycle

Five-stage ladder + direction dimension; code↔spec phase-gated; spec↔spec immediate. Direction-aware resolution: spec-drift on ratified catalogs routes to the amendment framework (not a silent catalog edit). Rollback: stage demotion (never target).

## 8. False-Positive Governance

Confidence scoring, site-scoped suppression, waivers (governance/doc drift non-waivable), expiry, audit ledger. A spec-drift suppression must state code-fix-or-amendment; no permanent tolerance without an amendment.

## 9. Reporting

Drift report, active inventory (with direction), trend analysis (convergence), ownership/severity summaries, maturity score, active suppressions, exit code. Shared schema.

## 10. Integration

Docs (documentation drift), Census (complementary), Boundary (dependency/ownership drift), Seam (reuses call-site indices + adds catalog comparison), Merge/Release gates, Semantic Engine, Manifest, Traceability, Certification Gates. No duplication.

## 11. Rollout Plan

006A Runtime + Registry (compose existing, dual scheduling); 006B Machine-Readable Catalog Prerequisite; 006C Spec↔Spec Drift (immediate); 006D Catalog↔Code Detectors; 006E Workflow & AI-Runtime Drift; 006F Phase-Gated Enforcement + Suppression Governance.

## 12–13. Certification Gates & Production Readiness

DRIFT-GATE-001 Runtime & Registry; -002 Catalog Machine-Readability; -003 Detector Correctness; -004 Spec↔Spec Enforcement; -005 Lifecycle & Phase-Gating; -006 Direction-Aware Resolution; -007 Reporting & Maturity. Migration-independent subset enforceable now; catalog↔code detectors unbuilt + convergence-mode pre-migration.

## 14. Final Certification

**Drift Detection Ready.** Not "Incomplete" (every section). Not "Mostly Ready" (distinguishes drift from seams; surfaces the catalog prerequisite honestly). Not "Production Drift Detection Ready" (catalog detectors unbuilt; target catalogs describe post-migration). Highest-leverage: 006A + 006C — compose existing detectors + enforce governance/documentation drift immediately.

---
**Related:** [GOV-AUTO-001](GOV-AUTO-001.md) · [GOV-AUTO-004](GOV-AUTO-004.md) · [GOV-AUTO-005](GOV-AUTO-005.md) · **Depends on:** GOV-AUTO-001, machine-readable catalogs · **Reuses:** check-schema-drift.js, generate-schema-manifest.js, check-frozen-schemas.ts, dependency-cycles.json, deprecated-routes.json · **Constitution refs:** [invariants P23/P30](../../appendices/invariants.md) · **Migration gate:** immediate (spec↔spec) / GATE-4/6/7 (code↔spec) · **Classification:** Drift Detection Ready. See [relationships](../appendices/relationships.md).
