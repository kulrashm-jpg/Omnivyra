# IMPLEMENTATION-001 — Migration & Execution Blueprint (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-001.md`](../implementation/IMPLEMENTATION-001.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

Master execution blueprint. Inputs: [A1–A4], [D1], [D2] — frozen. Decides sequence, risk, and certification; makes no architectural decisions (all inherited); defines no code/schemas/tickets/timelines. **Classification: Ready.**

---

## 1. Executive Summary

The transformation is a **strangler migration in eight phases**, executed writes-first, measured-before-moved, behind the platform's own proven off/shadow/enforce machinery. The repository is unusually well-positioned: the audits certified that every hard capability the target needs already exists somewhere in the codebase — a rollout gate with divergence forensics, a cost-disciplined refresh policy engine, a knowledge-graph engine, a single AI gateway, contract tests on the most safety-critical invariants — and that the defects are defects of *multiplicity and routing*, not missing capability. The blueprint therefore maximizes **promotion of existing assets** over new construction: of 22 major subsystems assessed, 9 are preserved, 6 refactored, 4 consolidated, and only 3 replaced outright.

Sequencing follows the constitutional dependency spine: measurement and events first (Phase 0), the single write authority second (Phase 1 — because every later phase depends on writes being owned), then trust, evidence, grounding+validation, conversation, generation, projections/consumers, and learning. Two certified critical defects get early, targeted closure inside Phase 1 rather than waiting for their "natural" phase: the unvalidated chat-save path and the confidence key mismatches, because both are low-surface, high-severity, and fully specified. Readiness verdict: **Ready** — implementation may begin immediately with Phase 0; "Production Implementation Ready" status is granted automatically upon Phase 0's certification gate.

## 2. Repository Readiness Assessment

**PRESERVE (promote as-is; constitutional assets):** the AI gateway (certified clean single seam); the refresh gate + policy engine + change detection + fingerprinting (CKRE stack, certified 8/10 deterministic backbone, contract-tested); the safeFetch/SSRF layer + crawl cache (fail-closed); the canonical adapter rollout machinery + shadow divergence diagnostics (the mandatory cutover instrument); the Company Knowledge Graph module (sound, 18 tests); the competitor engine + its 8 contract tests (best-tested subsystem); the user-lock/fill-empty invariant implementations (honored consistently where wired); the extraction zod schema + confidence weights + `containsMeaningfulSignal` cliché filter (reference implementations); and the `company_context_*` schema pattern + bootstrap service + offline LLM-judge harness + observability seams (exemplary).

**REFACTOR:** `crawlWebsiteSources` + metadata extractor (emit Evidence Objects; JSON-LD promoted from fingerprint-only to evidence); `classifyCompanyBusiness` (labeled-opinion writer, loses user-override, weak-signal fallback carries low confidence); the provenance service + `company_profile_refinements` (into the Trust lineage store); `companyContextIntelligenceService` + enrichment review flow (review generalizes; table becomes a Grounding-fan-out closing the ungated channel); the strategy/marketing/PT draft services (re-homed as pipeline workflows); `buildContentContext` (thin client of the Grounding Authority).

**CONSOLIDATE:** the 5-file service barrel (dissolved along context boundaries as a byproduct, never a standalone rewrite); the 13 hand-rolled LLM call sites + 10 duplicated scaffolds (into the single pipeline); the dual notification stacks (into one event bus with a UI bridge); the frontend god hook + mega-object drilling (consumed as projections + events during Phase 7).

**REPLACE (unconstitutional; no salvageable contract):** the 10-writer persistence surface (raw upserts, schema-cache column-drop retry, report_settings full-replace) → the single Knowledge write authority; per-endpoint `define-*` conversations → the unified conversation engine; refine-side `field_confidence` writers (mismatched keys, `'Needs Review'` band, monotonic max) → the Trust-context confidence calculator.

**DEPRECATE:** dead endpoints (`completeness`, `mission-context`, `forced-context`); the unused `CompanyProfileChatPanel`; the PT `deterministicRefineFallback` content injector (deleted under P20); the duplicate `confidence_score` column (sunset).

## 3. Dependency Graph & implementation-order law

Phase 0 (fabric) unblocks all → WS-K (writes; nothing else may enforce before it) → WS-T ∥ WS-E (independent; both depend only on Knowledge) → WS-G + WS-V (co-dependent pair; convergence — needs Facts + Confidence + Evidence) → WS-C ∥ WS-GEN → WS-P + WS-CM → WS-L (terminal). The order law derived from the graph: write authority precedes trust (confidence needs one writer to attach to); trust and evidence are independent and parallelize; grounding requires both; validation requires trust (it assigns confidence); conversation and generation require grounding + validation; projections require stable knowledge; consumers require projections; learning requires the event history all prior phases emit. The learning loop's *measurement half* is deliberately hoisted to Phase 0 so every phase is measured against a baseline.

## 4. Migration Strategy

Strangler pattern everywhere (each context stands up beside its legacy equivalent; legacy call sites become clients one at a time; legacy retired only at zero callers, measured). Shadow mode mandatory before every enforce, reusing the existing divergence-forensics pattern with the "unauthorized overwrite MUST be 0" law. Dual reads during grounding migration; **dual writes only where justified — exactly one place** (the write authority in Phase 1). Tenant isolation as the rollout unit (internal/beta first; the never-touch production tenants protected). Compatibility windows (consumer contracts serve N/N−1; legacy read paths remain live/dark for one full phase after their successor's enforcement). Rollback philosophy: every flip is a flag re-point; no phase performs a destructive data operation while its predecessor's path is still within the rollback window.

## 5. Workstream Definition

WS-0 Platform Fabric (event bus, flag fabric, correction-rate baseline from existing refinements + review-events data, single ordered schema-lineage declaration). WS-K Knowledge Write Authority (the one write path + early closure of the unvalidated chat-save path). WS-T Trust (confidence vocabulary + key registry, composite calculator, provenance/lineage store). WS-E Evidence (store; both crawlers emit; external routing). WS-G Grounding Authority. WS-V Validation Pipeline. WS-C Conversation Engine. WS-GEN Generation Pipeline (+ industry packs, prompt governance). WS-P Projections. WS-CM Consumer Migration. WS-L Learning Loop. WS-I Identity (standing; hardening for structural tenancy). Each carries responsibilities, prerequisites, and completion criteria.

## 6. Implementation Phases

Eight phases, each with objective, scope, risk, rollout strategy, rollback strategy, and a certification gate: 0 Fabric (Low), 1 Own the Writes (High, master gate), 2 Own the Trust ∥ 3 Own the Evidence (Medium), 4 Own Grounding+Validation (Medium-High, convergence), 5 Own Conversations ∥ 6 Own Generation (Medium), 7 Own the Consumers (Medium-High, frontend last per-section), 8 Close the Loop (Low). Phases 2 and 3 run concurrently after Phase 1's gate; Phase 5 and 6 overlap where workflows are independent; Phase 7 consumer moves parallelize per consumer.

## 7. Consumer Migration Strategy

Per-consumer path with compatibility and completion criteria. Company Profile UI (last; per-section; state consolidation as re-pointing, not a standalone refactor). Content generation (free ride — re-seat `buildContentContext` internals; its 30+ consumers untouched). Campaigns/planner and BOLT (re-point per registered profile). Reports (Observed+ floor; raw display read → projection). Recommendations (canonical set re-points; the 4 legacy bypasses migrate explicitly). MarketPulse (close the ungated intelligence channel). Analytics/Customer Success (re-point thresholds to the composite in Phase 2 — early, because they consume trust not grounding). AI Runtime (write-authority clients). Future Agents (registration-only). The ~26 legacy `getProfile` modules and ~40 raw sites are inventoried into the Phase-4/7 backlog by domain.

## 8. Data Migration Philosophy

Ownership transitions before data moves (a store changes owner before it changes shape). The current profile row is the seed projection (initial facts derive from existing columns + field_confidence + locks + provenance — the reconstruction the provenance service already performs; nothing re-generated to migrate). Lineage preservation from the refinements before/after history where derivable, honestly marked "migrated" where not. Confidence preservation with translation (the mismatch-key rescue; no fabricated defaults). Immutable evidence from Phase 3 forward. Projection rebuilding always safe. Historical compatibility through sunset windows.

## 9. Feature Flag Strategy

Per-subsystem ladder (generalizing the proven `canonical-grounding` model): off (byte-faithful legacy) → shadow (new computes, legacy serves, divergence recorded) → compare (new serves read-only with automatic legacy fallback) → enforce (new authoritative) → legacy-retired. Tenant-level rollout is the primary axis; percentage rollout for read-path flips only (never writes — all-or-nothing to avoid split-brain). Emergency disable per flag. Production verification before enforce. Flag hygiene (retirement condition at creation).

## 10. Testing & Certification Framework

Unit (preserve + extend the certified suites; close the coverage holes — marketing draft, prompt assembly, normalization/save), integration (per seam), architectural (the §12 [D2] static counters wired into CI), contract, event, grounding, confidence (reproducibility + translation correctness), performance, regression (shadow divergence as a standing signal), security, tenancy, explainability, consumer — each with measurable exit criteria.

## 11. Rollback Strategy

Universal law: rollback = flag re-point + (where applicable) projection rebuild; never a data operation on immutable stores. Legacy writers remain dark through Phase 2; projections rebuild from Facts; events are additive; because every serving path retains byte-faithful legacy until enforce, and enforce is per-tenant, no rollback ever changes what a user sees beyond restoring prior behavior.

## 12. Risk Register

R1 unknown 11th writer (Critical — static census before any cutover). R2 report_settings race (High — sub-key arbitration first). R3 shadow divergence noise (High — divergence taxonomy whitelist). R4 frontend destabilization (High — last, per-section, beta-first). R5 validation over-firing (Medium — warn-mode window). R6 grounding latency (Medium — perf cert + caching). R7 confidence translation (Medium — dual-display + recompute). R8 partial-adoption plateau (High — census gates require zero, not progress). R9 cost increase (Medium — deterministic-first + budgets). R10 schema/environment drift (High — Phase-0 lineage audit; instrument the silent column-drop to error immediately). R11 event lag (Low). R12 flag sprawl (Low). Each with description, probability, impact, mitigation, detection, and recovery.

## 13. Parallelization Plan

Fully independent: WS-E ∥ WS-T; WS-C ∥ WS-GEN; consumer moves within Phase 7. Blocking dependencies (hard): nothing before WS-0; nothing writes-adjacent before WS-K; WS-G on WS-T+WS-E; WS-V on WS-T; WS-CM on WS-P; WS-L on all. Synchronization points: end of Phase 1 (re-baseline on the write authority), end of Phase 4 (re-baseline on grounding+validation), end of Phase 7 (constitution in force for consumers). Merge checkpoints: the CI conformance counters. Shared-file discipline: the service barrel and god hook are dissolution zones — parallel workstreams may only delete from them by moving responsibilities into their own context homes, never edit in place concurrently.

## 14. Completion Definition

Workstream complete: §5 criteria + counters at target + flags retired/sunset + tests green. Phase complete: gate passed in production for all rollout tenants + rollback demonstrated (one exercised revert per critical phase) + observability live. Context complete: sole owner (zero bypasses), conformant, evented. Platform complete: all §12 [D2] conformance passing, all P1–P30, all §15 gates, legacy retired/sunset, and the learning loop reporting correction-rate trends per field family — the platform measures its own quality, the terminal gap.

## 15. Production Readiness Gates

Architecture, Contract, Consumer, Performance, Security, AI Quality, Confidence, Explainability, Data Integrity, Rollback — each with objective pass/fail criteria.

## 16. Executive Migration Roadmap

Phase 0 → GATE-0 → Phase 1 (critical) → GATE-1 → Phase 2 ∥ 3 → Phase 4 → Phase 5 ∥ 6 → Phase 7 → Phase 8. Certification milestones = the eight phase gates; production rollout milestones = per-tenant enforce flips within each phase (internal → beta → cohorts → all), each reversible.

## 17. Final Implementation Readiness Certification

**Ready.** The specification stack is complete and closed — no architectural decision remains open for implementation to make. The migration instruments already exist in production (the flag ladder, shadow-divergence forensics, per-tenant rollout, the "overwrite must be 0" law are certified operating code, not aspirations). The asset inventory is favorable (9 of 22 subsystems preserve as-is; the three outright replacements are precisely the subsystems the audits certified as unowned or broken, with their target contracts fully specified). Risk is front-loaded and bounded — the single Critical risk (unknown writers) is mitigated by a Phase-0 static census before any cutover; the highest-uncertainty surface (frontend) is deliberately last. Not "Production Implementation Ready" outright — that status requires the Phase-0 deliverables to exist (the measurement baseline, the verified event spine, the ratified schema lineage), which are the first work of implementation, not open questions; upon Phase 0's gate, the classification upgrades automatically. Not "Conditionally Ready" — no external condition or unresolved decision blocks the start of Phase 0.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-001.md`](../implementation/IMPLEMENTATION-001.md) · [`IMPLEMENTATION-003-FULL.md`](IMPLEMENTATION-003-FULL.md) · [`DESIGN-002-FULL.md`](DESIGN-002-FULL.md) · **Related ADRs:** [ADR-010](../adr/ADR-010-constitutional-governance.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready.
