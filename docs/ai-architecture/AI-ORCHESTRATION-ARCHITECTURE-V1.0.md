# OmniVYRA — AI Orchestration Platform · Final Architecture Specification · Version 1.0

**Status:** Production-Ready architecture · Migration complete · Operational rollout evidence-gated.
**Authority:** This is the **canonical** architecture specification for the AI Orchestration (configuration-resolution) platform. It **supersedes the AI-ORCHESTRATION migration phase documents** (`AI-ORCHESTRATION-PHASE-2A…3A-*.md`) as the architectural baseline; those are retained as migration history (see §Migration History). It complements — and does not replace — the AI generation/gateway blueprint (`CANONICAL-AI-ARCHITECTURE.md`, AI-ARCH-000).
**Not** an implementation prompt or an operational runbook. Future engineering treats this document as the architectural baseline.
**Owner:** AI Orchestration Team. **Date:** 2026-07-31.

> **As-built status (honest baseline).** Every component below is **implemented and tested** (127 orchestration tests) and ships **inert behind default-OFF rollout flags → byte-identical to today**. This spec defines the **permanent target architecture**; the Configuration Resolver becomes the authoritative execution-config source **only through the evidence-gated operational rollout** (Phase 3A runbook: OFF→SHADOW→DUAL→CANARY→FULL). One small, gated engineering step — the gateway synchronous-resolve execution swap that makes the gateway consume `ResolverCache → LegacyExecutionAdapter` — remains before CANARY/FULL can execute the resolver config; it is intentionally deferred until live parity evidence exists. "Authoritative" throughout describes the target end-state realized at FULL.

---

## 1. Guiding Principles (permanent)

1. **Deterministic Resolution** — the same configuration input always produces the same execution plan.
2. **Immutable Configuration** — published configuration versions are immutable.
3. **Single Source of Truth** — the Configuration Resolver is the only authority for execution configuration.
4. **Observable Execution** — every execution decision is explainable (reason/decision codes + resolution trace + fingerprint).
5. **Operational Safety** — promotion and rollback are operational activities, not architectural concerns.

---

## 2. Architecture Overview (target)

```
                AI Gateway                         backend/services/aiGateway* (executeGatewayCompletion)
                     │
                     ▼
            Execution Authority                    aiOrchestration/orchestrationMode.ts + promotion.ts
                     │  (rollout-controlled)
                     ▼
              Resolver Cache                        aiOrchestration/resolverCache.ts
                     │  (read-through, generation-aware)
                     ▼
        Configuration Resolver                      aiOrchestration/configurationResolver.ts
                     │
                     ▼
        ResolvedExecutionPlan                       aiOrchestration/types/ResolvedExecutionPlan.ts
                     │
                     ▼
      LegacyExecutionAdapter                        aiOrchestration/legacyExecutionAdapter.ts
                     │
                     ▼
        Gateway Execution Layer                     aiGatewayProviders* (callProviderWithRetry)
                     │
                     ▼
          Provider / Model                          openai · anthropic · (gemini · perplexity · copilot)
```

Exactly one execution configuration exists per request. The Resolver is authoritative (at FULL). The adapter remains the only translation layer until a future gateway-native execution model replaces the legacy configuration object.

---

## 3. Runtime Flow (one deterministic path)

```
Request → Capability Resolution → Execution Profile Resolution → Routing Policy Resolution
        → Execution Plan Generation → Resolver Cache → Execution Plan → Adapter → Gateway → Provider
```

No runtime heuristics. No hidden routing. No mutable execution state.

---

## 4. Core Runtime Components

- **AI Gateway** — receives requests, owns the request lifecycle; never makes configuration decisions.
- **Execution Authority** (`resolveExecutionAuthority`) — determines which configuration source is active; controlled exclusively through rollout (mode + master enable flag); never overridden elsewhere. The single source of "who executes".
- **Resolver Cache** (`ResolverCache`) — deterministic in-memory execution plans; read-through · single-flight · LRU · TTL · stale-while-revalidate · generation-aware invalidation · transparent fallback. No business logic.
- **Configuration Resolver** (`resolveExecutionPlan`) — transforms persisted configuration into an immutable execution plan: capability resolution · execution-profile selection · routing resolution · provider/model selection · metadata + fingerprint generation. Never executes requests.
- **LegacyExecutionAdapter** — temporary, pure, lossless, deterministic translation `ResolvedExecutionPlan → LegacyExecutionConfiguration`. Round-trip snapshot-identity proven.
- **Gateway Execution Layer** — consumes the execution configuration; invokes providers; owns retries, timeout, and provider-SDK interaction. No configuration logic.
- **ConfigurationParityGuard** (validation) — pure comparator (executed vs resolver config) powering shadow/dual/canary evidence; diagnostic-only, never influences execution.
- **ExecutionSnapshotBuilder** — the single execution-semantics engine (normalization + canonical snapshot + hashing) used by every equivalence/parity/adapter check.

---

## 5. Persistence Model (version-driven; published versions immutable)

Entities: Providers · Models · Model Families · Model Versions · Execution Profiles · Execution Profile Versions · Configuration Fingerprints · Capability Bindings · Routing Policies · Decision Catalog · Resolution Reasons · Configuration Versions.
Tables: `llm_providers` · `llm_models` · `ai_model_families` · `ai_model_versions` · `ai_execution_profiles` · `ai_execution_profile_versions` · `ai_capability_profile_bindings` · `ai_routing_policies` · `ai_resolution_reason_codes` · `ai_resolution_decision_codes` · `ai_operation_capability_map` · `ai_config_versions` · `company_llm_configs`.

### Configuration Lifecycle
```
Draft → Validation → Publish → Version → Generation Increment → Resolver Cache Refresh → Execution
```
Every published version creates a new **configuration generation** (`ai_config_versions`), which drives cache invalidation. Historical versions remain reproducible (immutable `*_versions` snapshots).

---

## 6. Resolver Algorithm (deterministic pipeline)

1. Resolve Capability (operation→capability if needed) → 2. Resolve Organization Overrides (precedence: capability-override → org-default → capability-default → platform-default → legacy) → 3. Resolve Routing Policy → 4. Resolve Execution Profile (+ sparse override patch) → 5. Resolve Provider → 6. Resolve Model (+ version) → 7. Generate Execution Metadata (reason/decision/source/trace) → 8. Generate Fingerprints → 9. Produce `ResolvedExecutionPlan`.

First-match-wins precedence; no branching on runtime randomness.

---

## 7. Execution & Versioning & Fingerprint Models

**Execution plan** (immutable) carries: Provider · Model · Temperature · Max Tokens · Timeout · Retry Policy · Reason Codes · Metadata · Fingerprints · Resolution Trace.

**Versioning** — configuration changes never overwrite prior versions: `publish → new version → new generation → cache invalidation → new execution plans`; historical versions stay reproducible.

**Fingerprints** — every plan carries `ConfigurationFingerprint`, `ExecutionFingerprint`, `ResolutionTraceVersion`, `ResolverVersion`, with separated `execution_schema_version` / `canonicalization_version` / `fingerprint_algorithm`. Fingerprints uniquely identify execution behavior (`sha256:v1:<hex>`), computed by a single source-of-truth util.

---

## 8. Operational Model

Promotion: `OFF → SHADOW → DUAL → CANARY → FULL`, each stage rollout-controlled and evidence-gated.
Rollback: **mode change or enable-switch off** — deploy-free, no migration, effective next request.

---

## 9. Failure Model

- **Resolver Cache failure** → resolver executes directly (cache never a SPOF).
- **Resolver failure** → existing gateway failure policy.
- **Provider failure** → retry policy; fallback provider only if configured.
- **Database failure** → cached plans continue serving; new resolutions fail per gateway policy.
- **Rollback** → always operational, never architectural.

---

## 10. Security Model

- **Configuration integrity** → immutable published versions.
- **Version integrity** → generation tracking.
- **Execution integrity** → fingerprints.
- **Tenant isolation** → organization-scoped resolution + RLS; tenant id in every cache/coalescing key.
- **Auditability** → resolution traces + `config_change_logs`; no mutable execution history.
- **Secrets** → BYOK keys AES-256-GCM encrypted at rest; keys never logged.
- **Observability privacy** → summaries only; never prompts/responses/PII/configuration contents.

---

## 11. Performance Model

Steady-state execution → Resolver Cache → no database access. Cache: O(1) lookup · single-flight loading · LRU eviction · TTL · SWR refresh. Expected steady-state hit rate **> 95%**; sub-millisecond in-memory hits; misses amortized; fallback path bounded.

---

## 12. Extension Model (extend without redesign)

New Provider → Provider Registry · New Model → Model Registry · New Capability → Capability Mapping · New Routing Policy → Routing Policy Table · New Execution Profile → Versioned Profile. No runtime architecture changes required.

---

## 13. Architecture Decision Records (permanent)

- **ADR-001** — The Configuration Resolver is authoritative.
- **ADR-002** — Execution Profiles are versioned.
- **ADR-003** — Published configuration is immutable.
- **ADR-004** — Execution plans are deterministic.
- **ADR-005** — Configuration generations drive cache invalidation.
- **ADR-006** — Fingerprints uniquely identify execution behavior.
- **ADR-007** — The Resolver Cache owns hot-path optimization.
- **ADR-008** — Promotion is operational.
- **ADR-009** — Rollback is deploy-free.
- **ADR-010** — Execution authority has exactly one source.

---

## 14. Architectural Invariants (must never change)

Exactly one execution authority · exactly one configuration resolver · exactly one snapshot-semantics engine (`ExecutionSnapshotBuilder`) · exactly one adapter (`LegacyExecutionAdapter`) · immutable configuration versions · deterministic resolution · generation-based cache invalidation · immutable execution plans · fingerprints uniquely identify execution · rollback remains deploy-free · no runtime randomness.

---

## 15. Future Extension Principles

Future work MAY introduce: Native Gateway Execution · Multi-region Resolver Cache · Provider Health Scoring · Adaptive Routing Policies · Cost-aware Routing · Multi-provider Failover · Streaming Optimization · Model Benchmark Integration. **None require redesigning the core resolver architecture.**

---

## 16. Migration History

Established through the completed program: **Phase 1** Architecture Audit → **Phase 2A** Resolver Architecture (design) → **Phase 2B.1/1A/1B** Configuration Persistence (frozen) → **Phase 2A-2 … 2A-2.3** Resolver Validation (shadow, equivalence, snapshot, adapter round-trip) → **Phase 2A-3** Dual Execution Validation → **Phase 2B** Promotion Control Plane → **Phase 2C** Runtime Readiness (Resolver Cache) → **Phase 3A** Operational Rollout Runbook. The migration program is complete; its phase documents are retained as history and superseded by this specification as the baseline.

---

## 17. Operational Status

| Dimension | Status |
|---|---|
| Architecture | Complete (this spec) |
| Implementation | Complete (built + tested; inert behind default-OFF flags) |
| Testing | Complete (127 orchestration tests green) |
| Operational runbook | Complete (Phase 3A) |
| Production promotion | **Evidence-gated** (not yet performed; one deferred gateway-swap step precedes CANARY/FULL execution) |
| Legacy retirement | Pending operational authorization |

---

## 18. Conformance Requirements

Any future change to AI Orchestration MUST preserve: deterministic resolution · immutable published configuration · generation-based invalidation · resolver authority · execution-plan compatibility · fingerprint integrity · tenant isolation · deploy-free rollback · operational observability.

A proposed change violating any of these requires a **new ADR + architecture review** before implementation.

---

## Conclusion

Version 1.0 establishes the permanent architectural foundation of the OmniVYRA AI Orchestration platform: configuration construction is replaced by deterministic resolution; configuration is immutable and versioned; promotion is a safe operational activity; and rollout is evidence-driven with immediate, deploy-free rollback. Future engineering builds upon this specification as the authoritative reference for design, implementation, operations, and governance — activating the resolver's authority through the evidence-gated rollout when a live environment and parity evidence are available.
