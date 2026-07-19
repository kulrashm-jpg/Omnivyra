# GOV-AUTO-005 — Production PR Governance & Merge Gate Implementation Program v1.0

**Status:** Authoritative implementation specification for the Governance Runtime (merge gate, branch protection, review, freeze protection). **Inputs frozen:** Constitution v1.0.0, `CONFORMANCE-CHECKLIST.md`, `GOVERNANCE.md`, `HISTORY.md`, `MAINTAINERS.md`, AUDIT-005, GOV-AUTO-001–004. **Classification: Repository Governance Ready.**

---

## 1. Executive Summary

Converts the manual Conformance Checklist and the sibling runtimes into a required, aggregated merge decision, and adds the two primitives AUDIT-005 found absent: CODEOWNERS/branch protection and an automated freeze guard on ratified documents. Principle: one canonical Governance Runtime that aggregates, never re-runs. **Two commitments:** phased requiredness (some gates required immediately — docs + already-enforcing analyzers; census/boundary/seam phase in); freeze protection is a first-class gate (edits to ratified docs without a linked amendment are blocked — P30/HISTORY enforced).

## 2. Governance Architecture

Aggregation not re-execution; one decision point (merge allowed iff every required-for-branch-and-phase gate is green, mandatory reviews satisfied, no freeze violation, no non-waivable violation open); policy as data; read-only; deterministic. Checklist sections map one-to-one onto governance gates.

## 3. Repository Governance Inventory

Constitutional compliance, documentation, census, boundary, seam, semantic, schema, security, observability, release, freeze, version, traceability, amendment, review requirements → owner, severity, cert gate, required-from phase. No orphan requirement.

## 4. Merge Gate Inventory

Required-immediate: Docs, SSRF, authz, semantic, runtime-shadow, mutation-governance, schema, Freeze Guard (non-waivable). Required-ratchet→target: Census, Boundary. Optional→Required: Seam. Requiredness law: immediate for constitutional/already-enforcing; ratchet while pre-migration; target post-phase-gate; no jump to target before the platform phase.

## 5. Branch Protection Model

Protected/Release/Hotfix/Maintenance/Constitutional branch classes → approvals, required gates, merge restrictions. CODEOWNERS routes by path. No class merges with a non-waivable violation open. Constitutional class enforces the freeze/amendment policy.

## 6. Review Governance

Architecture / Constitutional / Documentation / Security / Platform reviews with triggers (path/label-based) and reviewers. Reviews are additive to gate greenness.

## 7. Constitutional Change Governance

ADR modification, amendment, invariant change (non-waivable rejected), manifest change, gate change → mandatory approvals, amendment linkage, traceability, audit trail. Blocks change PRs lacking amendment linkage or failing impact-completeness.

## 8. Freeze Protection

Ratified documents / invariants / amendment history / release artifacts → permitted edits (forward pointers, PATCH) vs prohibited (decision change without amendment). Emergency override (incident-referenced, expiring, audited, never for non-waivable). Non-waivable Required-immediate gate.

## 9. Reporting

Governance report (merge verdict), merge readiness, approval status, certification status, repository posture, governance maturity, verdict. Shared schema.

## 10. Integration

Consumes 001–004/006 gates + existing analyzers; 007 reuses the freeze guard. Owns only aggregation, requiredness policy, branch protection, review routing, freeze guard, merge verdict.

## 11. Rollout Plan

005A Aggregation (Report); 005B CODEOWNERS + Path Routing; 005C Required-Immediate Gates (first production merge gate); 005D Freeze Guard; 005E Review & Constitutional-Change Governance; 005F Phased Gate Requiredness.

## 12–13. Certification Gates & Production Readiness

PRGOV-GATE-001 Aggregation Integrity; -002 Required-Immediate Enforcement; -003 Branch Protection Model; -004 Freeze Protection; -005 Constitutional-Change Governance; -006 Phased Requiredness; -007 Reporting & Maturity. First GOV-AUTO phase with an immediate production surface (005C/D/B on already-green checks + freeze guard).

## 14. Final Certification

**Repository Governance Ready.** Not "Incomplete" (every section). Not "Mostly Ready" (identifies a real immediate production subset). Not "Production Repository Governance Ready" (CODEOWNERS/branch protection absent; aggregator unbuilt; census/boundary/seam unbuilt). Highest-leverage: 005C + 005D — make already-green checks required + stand up the non-waivable freeze guard + CODEOWNERS.

---
**Related:** [GOV-AUTO-004](GOV-AUTO-004.md) · [GOV-AUTO-007](GOV-AUTO-007.md) · [CONFORMANCE-CHECKLIST](../../CONFORMANCE-CHECKLIST.md) · **Depends on:** GOV-AUTO-001–004,006 · **Reuses:** pull_request_template.md, check:ssrf/authz, semantic/runtime enforce modes · **Constitution refs:** [invariants P30](../../appendices/invariants.md), [GOVERNANCE §3](../../GOVERNANCE.md), [HISTORY](../../HISTORY.md) · **Migration gate:** immediate subset + per-gate · **Classification:** Repository Governance Ready. See [relationships](../appendices/relationships.md).
