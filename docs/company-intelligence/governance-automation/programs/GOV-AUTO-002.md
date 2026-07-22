# GOV-AUTO-002 — Constitutional Census Wiring Implementation Program v1.0

**Status:** Authoritative implementation specification for the Census Runtime. **Inputs frozen:** Constitution v1.0.0, `dependency-manifest`, AUDIT-005, GOV-AUTO-001. **Classification: Census Automation Ready.**

---

## 1. Executive Summary

AUDIT-005 certified 0 of 9 census rules wired to CI, while a substantial enforcement estate exists to host them (semantic-enforcement-engine `--enforce`, warn-mode boundary rules, seam-check technique proven by `check_lead_signal_write_boundaries.js`/`check-outbound-ssrf.js`). This program specifies **one canonical Census Runtime** — a registry-driven orchestrator composing existing analyzers + three new seam analyzers under one registry, aggregating counts against targets, one report, one exit code. No second census engine. **Two commitments:** enforcement is phase-gated (a target achievable only after its platform phase; Report/ratchet before Hard Block); static where sufficient, runtime where necessary (validation-bypass and unmanaged-learning need a runtime companion).

## 2. Census Architecture

Single entrypoint, registry-driven (manifest `census_rules`); compose don't duplicate; one report + exit code; read-only; deterministic; config-as-data.

## 3. Census Registry

The nine canonical census rules with identifier/invariant/source/impl-source/detector/target/rollout-phase/owner: `writer_authority`=1 (P3, after GATE-1), `confidence_writer`=1 (P12, GATE-2), `grounding_bypass`=0 (P11, GATE-4), `conversation_loops_outside_engine`=0 (P17, GATE-5), `unregistered_llm_calls`=0 (P16, GATE-6), `inline_prompts`=0 (P16, GATE-6), `direct_model_reads`=0 (P16, GATE-6), `direct_canonical_reads`=0 (P26, GATE-7), `unmanaged_learning`=0 (P14, GATE-8). Registry mirrors the manifest (single source; a new census requires an amendment).

## 4. Rule Inventory

The 14 named guarantees map onto the nine census rules + the validation-conformance requirement (P19, runtime-assertion via I2D §17.2, not a static census). Each guarantee → census rule / requirement, invariant, phase, gate. No new census invented.

## 5. Detection Strategy

Seven rules statically enforceable (High); `unmanaged_learning` + validation-conformance need static+runtime. Techniques: chokepoint-import (SSRF analog), write-boundary pattern (lead-signal analog), semantic authority/ownership analysis (semantic engine), registry-vs-callsite diff.

## 6. Enforcement Strategy

Five-stage ladder: Observe → Report → Warn → Soft Block → Hard Block, with per-stage promotion criteria. **Phase-gating law:** Soft Block as soon as the detector is trustworthy (ratchet, blocks new); Hard Block only after the rule's platform phase gate. Ratchet enforces monotonic improvement throughout the migration.

## 7. Exception Governance

Waivers for the waivable set (singletons + non-waivable invariants cannot be waived); mandatory expiry; Architecture-Steward approval; append-only audit ledger; emergency override (time-boxed, expiring, never for non-waivable). A waiver never changes a target.

## 8. Reporting

Census summary, violations, severity, trends, ownership, historical tracking (the governance analog of correction-rate), active waivers, exit code. Shares the GOV-AUTO-001 report schema.

## 9. Integration

Docs Runtime (disjoint domain), Semantic Enforcement Engine (reused for authority/mutation), Static Analysis (boundary detectors), Dependency Manifest (the registry single source, parity via V10), Traceability Matrix (finding link), Certification Gates (census evaluates the census portion of each gate). No duplicated responsibilities.

## 10. Rollout Plan

002A Runtime+Registry (Observe/Report, reuse existing analyzers); 002B Seam Analyzers (new detectors); 002C Boundary Promotion + Ratchet; 002D Phase-Gated Hard Block; 002E Runtime Assertion Companion; 002F Exception & Waiver Governance.

## 11–12. Certification Gates & Production Readiness

CENSUS-GATE-001 Registry Integrity; -002 Detector Correctness; -003 Report & Trend; -004 Ratchet Enforcement; -005 Phase-Gated Hard Block; -006 Exception Governance. Ready: design complete, foundation exists, targets frozen. Not ready: 0/9 wired; seam analyzers unbuilt; targets unachievable until the platform migration runs.

## 13. Final Certification

**Census Automation Ready.** Not "Incomplete" (every section specified). Not "Mostly Ready" (exhaustive; reconciles 14 guarantees to 9 rules without inventing a tenth). Not "Production Constitutional Census Ready" (0/9 wired; targets like writer=1 presuppose GATE-1). Highest-leverage: 002A in Report mode over the existing semantic engine.

---
**Related:** [GOV-AUTO-001](GOV-AUTO-001.md) · [GOV-AUTO-004](GOV-AUTO-004.md) · [GOV-AUTO-003](GOV-AUTO-003.md) · **Depends on:** GOV-AUTO-004 (detectors), manifest registry · **Reuses:** semantic-enforcement-engine, check_lead_signal_write_boundaries.js, check-outbound-ssrf.js · **Constitution refs:** [invariants P3/P11/P12/P14/P16/P17/P26](../../appendices/invariants.md), [dependency-manifest](../../dependency-manifest.yaml) · **Migration gate:** GATE-1..8 (per rule) · **Classification:** Census Automation Ready. See [relationships](../appendices/relationships.md).
