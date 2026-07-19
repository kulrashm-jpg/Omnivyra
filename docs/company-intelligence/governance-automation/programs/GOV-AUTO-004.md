# GOV-AUTO-004 — Canonical Seam Analyzer Implementation Program v1.0

**Status:** Authoritative implementation specification for the Seam Analysis Runtime — the detection foundation powering the Census, Boundary, and Semantic Enforcement runtimes. **Inputs frozen:** Constitution v1.0.0, live analyzer estate, AUDIT-005, GOV-AUTO-001–003. **Classification: Seam Analyzer Ready.**

---

## 1. Executive Summary

A seam is a point where a constitutional guarantee must hold. The Census counts seam crossings; the Boundary promotes rules; both depend on a detection layer that finds the crossings. This program specifies **one canonical Seam Analysis Runtime** hosting a registry of analyzers, one per seam. It is the foundation beneath 002/003; the write/read/AI-call analyzers those programs referenced are specified here. ~Half the estate exists (semantic engine 3 enforce modes, ownership, runtime-shadow, SSRF, authz, schema); nine constitutional seam analyzers are missing, each with a proven in-repo technique. Principle: one runtime, a registry, one report, compose-don't-duplicate.

## 2. Seam Analyzer Architecture

Single entrypoint, registry-driven; parse-once shared code model (AST/import/dependency/symbol index); analyzers are pure detectors; compose the existing estate; one report; deterministic. Detection = Seam Runtime; counting = Census; promotion = Boundary; semantic analysis = semantic engine.

## 3. Seam Inventory

15 seams → invariant, phase, gate, owner: Write (P3/1), Read (P26/7), Projection (P26/7), Grounding (P11/4), Validation (P19/4), AI Runtime (P16/6), Conversation (P17/5), Learning (P14/8), Trust (P12/2), Evidence (P1/3), Authority (P3/P11/P26 cross-phase), Mutation (P3/P15/1), Ownership (P4/P30 per-context), Context Boundary (P4 per-context), API (P11/P26 4/7). No orphan seam.

## 4. Existing Analyzer Audit

Production-ready: semantic engine (authority-lineage/canonical-authority/mutation-governance), ownership auditor (cycles), runtime-shadow, SSRF (CI-wired), authz (CI-wired). Enforce: schema-drift, frozen-schemas. Warn: dependency-cruiser, eslint-boundaries. Missing: the nine constitutional seam analyzers (write/read/confidence/grounding/AI-call/validation/conversation/learning/evidence).

## 5. Analyzer Specifications

New analyzers with purpose/inputs/outputs/detection/failure/severity: Write-seam (Critical P3 — flag Fact-writes outside the authority; reuse `direct-db-writes.json`), Confidence-write-seam (Critical P12), Read-seam (High P26), Grounding-seam (Critical P11), AI-call-seam (Critical P16 — gateway chokepoint + inline-prompt + model-read), Validation-seam (Critical P19 — token + runtime companion), Conversation-seam (High P17), Learning-seam (Critical P14 — + runtime companion), Evidence-seam (Critical P1), API-seam (High P11/P26). Existing analyzers registered unchanged.

## 6. Detection Strategy

Per-seam technique across AST / import graph / dependency graph / semantic graph / repository graph / runtime assertion / config analysis. Every technique demonstrated in-repo except runtime assertion (Validation/Learning — the one net-new capability).

## 7. Analyzer Lifecycle

Five-stage ladder; per-analyzer, phase-gated; no direct Warn→Hard; already-enforced analyzers effectively at Hard Block pending CI-wiring.

## 8. False-Positive Governance

Per-analyzer confidence scoring; site-scoped suppression (the `// ssrf-ok:` generalization); waivers for blocking findings (Architecture-Steward + expiry); no permanent suppressions; non-waivable seams unsuppressable at Hard Block; append-only ledger.

## 9. Reporting

Analyzer report, violation inventory, severity/ownership summaries, historical trends (census input), maturity score, active suppressions, exit code. Shared schema.

## 10. Integration

Docs (disjoint), Census (produces findings it counts), Boundary (produces import/structural findings it promotes), Semantic Engine (registered analyzer), Manifest, Traceability, Certification Gates. Detection here; counting/promotion/semantic elsewhere.

## 11. Rollout Plan

004A Runtime + Registry (compose existing); 004B Persistence-seam analyzers; 004C AI-seam analyzers; 004D Lifecycle-seam analyzers; 004E Confidence-scoring & Suppression Governance; 004F Runtime-assertion companions.

## 12–13. Certification Gates & Production Readiness

SEAM-GATE-001 Runtime & Registry; -002 Analyzer Correctness; -003 Detection Coverage; -004 Lifecycle Compliance; -005 False-Positive Governance; -006 Reporting & Maturity. ~Half the estate enforces; nine seam analyzers unbuilt; runtime companions net-new; Hard Block coupled to migration.

## 14. Final Certification

**Seam Analyzer Ready.** Not "Incomplete" (every section). Not "Mostly Ready" (positions as detection foundation; ~half exists). Not "Production Seam Analysis Ready" (nine analyzers unbuilt; boundaries warn-mode; runtime companions net-new; Hard Block pre-migration impossible). Highest-leverage: 004A — compose already-enforcing analyzers under one Seam Runtime + verify CI-wired.

---
**Related:** [GOV-AUTO-002](GOV-AUTO-002.md) · [GOV-AUTO-003](GOV-AUTO-003.md) · [GOV-AUTO-005](GOV-AUTO-005.md) · **Depends on:** code-model tooling; existing analyzers · **Reuses:** semantic-enforcement-engine, ownership-risk-audit, runtime-shadow, check-outbound-ssrf.js, check-tenant-authz.js, direct-db-writes.json · **Constitution refs:** [invariants](../../appendices/invariants.md) · **Migration gate:** per-seam GATE-1..8 · **Classification:** Seam Analyzer Ready. See [relationships](../appendices/relationships.md).
