# GOV-AUTO-003 — Boundary Enforcement Promotion Implementation Program v1.0

**Status:** Authoritative implementation specification for the Boundary Enforcement Runtime and the warn→enforce promotion. **Inputs frozen:** Constitution v1.0.0, the live boundary estate (`architecture-migration/*`), AUDIT-005, GOV-AUTO-001/002. **Classification: Boundary Enforcement Ready.**

---

## 1. Executive Summary

Boundary enforcement is the most mature governance surface. A two-speed estate exists: **enforce-mode** (`enforce-incremental-boundaries.mjs`; `semantic-enforcement-engine.mjs --enforce` for authority-lineage/canonical-authority/mutation-governance; `runtime-shadow-elimination-audit.mjs --enforce`; `ownership-risk-audit.mjs --enforce-runtime-cycles`) and **warn-mode** (`boundary-rules.warn.json`, `dependency-cruiser.warn.cjs`, `eslint-boundaries.warn.cjs`). This program promotes the warn-mode structural/import rules, composing them with the Census Runtime — one Boundary Enforcement Runtime, no second engine. **Two commitments:** no direct Warn→Hard Block (full ladder); phase-gated incremental promotion (a boundary Hard-Blocks only after its context's migration phase, because pre-migration the boundaries are legitimately violated).

## 2. Boundary Architecture

One ruleset-driven runtime composing the enforce-mode tools + promoted warn rulesets; findings feed the Census Runtime; read-only; deterministic. Detection = boundary runtime; counting = census; semantic analysis = semantic engine.

## 3. Boundary Inventory

Write/confidence-write/read/grounding/validation/AI-call/conversation/learning/context-isolation/authority-lineage/mutation-governance/runtime-shadow/API seams → type, invariant, phase, gate. No orphan boundary. Classified by type: ownership, dependency, runtime, persistence, API, AI, projection, learning, conversation, validation.

## 4. Existing Enforcement Audit

Already-enforced: semantic (authority/canonical/mutation), runtime-shadow, runtime-cycles. Partially: enforce-incremental-boundaries. Warn-only: dependency-cruiser, eslint-boundaries, boundary-rules (the promotion target). Report-only: ownership audit variant. Missing: validation-seam, learning-seam, API-seam.

## 5. Promotion Strategy

Five-stage ladder with per-stage criteria; **no direct Warn→Hard Block** (no-skip law); phase-gating law (per-context, via `enforce-incremental-boundaries.mjs`).

## 6. Boundary Dependency Matrix

Per boundary: promotion dependency, prerequisite phase, rollout order, rollback criterion. Independent deployment (per-boundary stage is data); already-enforced semantic/runtime boundaries promote first (CI-wiring verification only).

## 7. Violation Classification

Critical (non-waivable at/after gate — not waivable), High (census-backed at/after gate, or new at Soft Block), Medium (not-yet-migrated context / Warn), Low (advisory). Severity = f(invariant class × stage × phase).

## 8. Rollback Strategy

Per-boundary stage demotion (never target change): false positive → demote+fix; migration conflict → demote to Warn; temporary regression → hold at Soft Block; emergency stabilization → demote to Report (audited, expiring, ratchet-floored for non-waivable Critical). Demotion changes stage, never target.

## 9. Reporting

Boundary report, violation trends, ownership metrics, enforcement maturity, rollout progress, active waivers/demotions, exit code. Shares the GOV-AUTO schema.

## 10. Integration

Docs (disjoint), Census (complementary — boundary detects/promotes, census counts/stages), Semantic Engine (reused), Manifest (phase map), Traceability, Certification Gates. No duplication.

## 11. Rollout Plan

003A Runtime + Ruleset Registry (compose existing, verify CI-wired); 003B Warn-Ruleset Onboarding; 003C Soft-Block Ratchet; 003D Phase-Gated Hard Block; 003E Rollback & Waiver Governance.

## 12–13. Certification Gates & Production Readiness

BND-GATE-001 Runtime Composition; -002 Ladder Compliance (no Warn→Hard); -003 Phase Alignment; -004 Ratchet Integrity; -005 Rollback Safety; -006 Reporting & Maturity. Strongest existing estate (multiple `--enforce` tools); warn rulesets unpromoted; most boundaries Hard-Block only as the migration proceeds.

## 14. Final Certification

**Boundary Enforcement Ready.** Not "Incomplete" (every section). Not "Mostly Ready" (composes a mature base; finishing act). Not "Production Boundary Enforcement Ready" (warn rulesets still warn; orchestrator unbuilt; Hard Block coupled to migration). Highest-leverage: 003A — compose the already-enforcing semantic/runtime tools under one runtime + verify CI-wired.

---
**Related:** [GOV-AUTO-002](GOV-AUTO-002.md) · [GOV-AUTO-004](GOV-AUTO-004.md) · [GOV-AUTO-005](GOV-AUTO-005.md) · **Depends on:** GOV-AUTO-004 · **Reuses:** enforce-incremental-boundaries.mjs, semantic-enforcement-engine, dependency-cruiser.warn, eslint-boundaries.warn, boundary-rules.warn · **Constitution refs:** [invariants P4](../../appendices/invariants.md) · **Migration gate:** per-context · **Classification:** Boundary Enforcement Ready. See [relationships](../appendices/relationships.md).
