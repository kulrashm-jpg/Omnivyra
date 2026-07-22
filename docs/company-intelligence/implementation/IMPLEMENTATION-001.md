# IMPLEMENTATION-001 — Migration & Execution Blueprint v1.0

**Status:** Master execution blueprint. Inputs: [A1–A4], [D1], [D2] — frozen. Decides sequence, risk, and certification; makes no architectural decisions (all inherited); defines no code/schemas/tickets/timelines.

**Classification: Ready.**

---

## 1. Executive Summary

An eight-phase strangler migration, writes-first, measured-before-moved, behind proven off/shadow/enforce machinery. Of 22 subsystems assessed: **9 preserve, 6 refactor, 4 consolidate, 3 replace**. Sequencing follows the dependency spine: measurement and events first (Phase 0), the single write authority second (Phase 1 — everything depends on writes being owned), then trust, evidence, grounding+validation, conversation, generation, projections/consumers, and learning. Two critical defects get early closure in Phase 1: the unvalidated chat-save path and the confidence key mismatches. Verdict: Ready; upgrades to Production Implementation Ready on Phase-0's gate.

## 2. Repository Readiness Assessment

**PRESERVE:** AI gateway; refresh gate + policy engine + change detection + fingerprinting (CKRE); safeFetch/SSRF + crawl cache; canonical adapter rollout machinery + shadow diagnostics; KG module; competitor engine + 8 tests; user-lock/fill-empty primitives; extraction zod schema + confidence weights + cliché filter; `company_context_*` schema + bootstrap + judge harness + observability. **REFACTOR:** crawlWebsiteSources + metadata extractor (emit evidence); classifyCompanyBusiness (labeled opinion); provenance service + refinements table (lineage store); context intelligence service + review flow; draft services; buildContentContext (grounding client). **CONSOLIDATE:** 5-file barrel; 13 LLM sites + 10 scaffolds; dual notification stacks; frontend god hook. **REPLACE:** the 10-writer persistence surface; per-endpoint conversations; refine-side confidence writers. **DEPRECATE:** dead endpoints (completeness, mission-context, forced-context); unused chat panel; PT fallback injector; duplicate confidence column.

## 3. Dependency Graph

Phase 0 (fabric) unblocks all → WS-K (writes; nothing enforces before it) → WS-T ∥ WS-E (independent, both depend on Knowledge) → WS-G+WS-V (convergence, needs all three) → WS-C ∥ WS-GEN → WS-P+WS-CM → WS-L (terminal). Ordering law: writes precede trust; trust+evidence parallelize; grounding requires both; validation requires trust; conversation/generation require grounding+validation; projections require stable knowledge; consumers require projections; learning requires all emitting.

## 4. Migration Strategy

Strangler everywhere; shadow mandatory before enforce (divergence forensics, "overwrite must be 0"); dual reads during grounding migration; dual writes only in Phase 1's write authority; tenant-isolation as rollout unit (internal → beta → cohorts → all); compatibility windows (N/N−1); rollback = flag re-point, never destructive.

## 5. Workstream Definition

WS-0 Platform Fabric (event bus, flag fabric, correction-rate baseline, schema lineage), WS-K Knowledge Write Authority, WS-T Trust, WS-E Evidence, WS-G Grounding Authority, WS-V Validation Pipeline, WS-C Conversation Engine, WS-GEN Generation Pipeline, WS-P Projections, WS-CM Consumer Migration, WS-L Learning Loop, WS-I Identity (standing). Each with responsibilities, prerequisites, and completion criteria.

## 6. Implementation Phases

| Phase | Objective | Risk | Gate |
|---|---|---|---|
| 0 Fabric | measure before moving | Low | baseline live, events verified, lineage ratified |
| 1 Writes | single write authority + early fixes | **High** | writer census = 0 outside authority; overwrite = 0; save validation |
| 2 Trust | confidence + provenance unified | Medium | composite coverage; defect cases fixed |
| 3 Evidence | store + collectors + routing | Medium | all emitting; evidence linked E2E |
| 4 Grounding+Validation | one authority + universal validation | Medium-High | bypass falling to zero; validation coverage = 100% |
| 5 Conversation | unified engine | Medium | six endpoints on engine; dedup verified |
| 6 Generation | pipeline + prompt governance + packs | Medium | zero unregistered LLM calls; bench baselines |
| 7 Projections+Consumers | read models + frontend | Medium-High | consumer criteria; legacy at zero callers |
| 8 Learning | loop + retirement | Low | all gates green; conformance passing |

## 7. Consumer Migration Strategy

Per-consumer: current/target/path/compatibility/validation/completion. Company Profile UI (last, per-section); content (free-ride via buildContentContext); campaigns/BOLT/recs (re-point); reports (Observed+ floor); MarketPulse (close ungated channel); analytics/customer-success (composite via Trust contract, early Phase 2); AI runtime (write-authority clients); future agents (registration-only). Legacy-bypass closure inventoried into Phase-4/7 backlog.

## 8. Data Migration Philosophy

Ownership transitions before data moves; the current profile row is the seed projection; lineage preservation from refinements history; confidence preservation with translation (including mismatch-key rescue); immutable evidence from Phase 3 forward; projection rebuilding always safe; historical compatibility through sunset windows.

## 9. Feature Flag Strategy

Per-subsystem ladder: off (byte-faithful) → shadow → compare → enforce → legacy-retired. Tenant-level primary axis; percentage rollout for reads only (never writes); emergency disable; production verification before enforce; flag hygiene (retirement condition at creation).

## 10. Testing & Certification Framework

Unit (preserve + extend certified suites, close holes), integration, architectural (CI census counters), contract, event, grounding, confidence, performance, regression (shadow divergence), security, tenancy, explainability, consumer — each with measurable exit criteria.

## 11. Rollback Strategy

Flag re-point + projection rebuild; never a data operation on immutable stores. Legacy writers dormant through Phase 2; projections rebuild from Facts; events additive; user experience preserved (byte-faithful legacy until enforce, per-tenant).

## 12. Risk Register

R1 unknown writer (Critical — Phase-0 census). R2 report_settings race (High — sub-key arbitration first). R3 shadow divergence noise (High — taxonomy whitelist). R4 frontend destabilization (High — last, per-section, beta-first). R5 validation over-firing (Medium — warn-mode window). R6 grounding latency (Medium — perf cert). R7 confidence translation (Medium — dual-display). R8 partial-adoption plateau (High — census gates require zero, not progress). R9 cost increase (Medium — deterministic-first). R10 schema drift (High — Phase-0 lineage audit). R11 event lag (Low). R12 flag sprawl (Low).

## 13. Parallelization Plan

Independent: WS-T ∥ WS-E; WS-C ∥ WS-GEN; consumer moves within Phase 7. Blocking: nothing before WS-0; nothing writes-adjacent before WS-K; WS-G on WS-T+WS-E; WS-CM on WS-P; WS-L on all. Synchronization: end of Phase 1, 4, 7. Merge checkpoints: CI conformance counters. Shared-file discipline: barrel and god hook are dissolution zones.

## 14. Completion Definition

Workstream: §5 criteria + counters at target + flags retired/sunset + tests green. Phase: gate passed in production + rollback demonstrated + observability live. Context: sole owner, conformant, evented. Platform: all §12 conformance passing, all P1–P30, all §15 gates, legacy retired, correction-rate reported.

## 15. Production Readiness Gates

Architecture, Contract, Consumer, Performance, Security, AI Quality, Confidence, Explainability, Data Integrity, Rollback — each with objective pass/fail criteria.

## 16. Executive Migration Roadmap

Phase 0 → GATE-0 → Phase 1 (critical) → GATE-1 → Phase 2 ∥ 3 → Phase 4 → Phase 5 ∥ 6 → Phase 7 → Phase 8. Certification milestones = the eight phase gates; production rollout = per-tenant enforce flips.

## 17. Final Implementation Readiness Certification

**Ready.** The specification stack is complete and closed. The migration instruments already exist in production (flag ladder, shadow forensics, per-tenant rollout, "overwrite must be 0"). The asset inventory is favorable (9 preserve, 3 replace = the unowned/broken subsystems). Risk is front-loaded and bounded (the Critical risk mitigated by a Phase-0 census; the highest-uncertainty surface last). Not "Production Implementation Ready" outright — that requires Phase-0 deliverables (baseline, event spine, schema lineage) to exist, which is the first work of implementation, not an open question; on Phase-0's gate the classification upgrades automatically. Not "Conditionally Ready" — no external condition blocks starting Phase 0.

---
**Related:** [DESIGN-002](../architecture/DESIGN-002.md) · [IMPLEMENTATION-003](IMPLEMENTATION-003.md) · [IMPLEMENTATION-002A..H](IMPLEMENTATION-002A.md) · **Depends on:** DESIGN-001/002 · **Related ADRs:** [ADR-010](../adr/ADR-010-constitutional-governance.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-001-FULL.md`](../full/IMPLEMENTATION-001-FULL.md) · **Certification:** Ready. See [`../appendices/relationships.md`](../appendices/relationships.md) · [`../dependency-manifest.yaml`](../dependency-manifest.yaml).
