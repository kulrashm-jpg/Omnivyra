# PROGRAM A — Immutable Engineering Baseline

> **This document is a historical baseline. It must never be rewritten.** It records the completed
> engineering state of Program A (Platform Convergence) as the canonical comparison point for future
> audits, regression investigations, release certification, and Program B planning.

## 1. Identity

| Field | Value |
|---|---|
| **Program** | Program A — Platform Convergence |
| **Work package** | PROGRAM-A-CLOSE-002 (Immutable Engineering Baseline) |
| **Authority** | PMO-002 (Active Governance Baseline) |
| **Closure certification** | PROGRAM-A-CLOSE-001 — ENGINEERING OBJECTIVES COMPLETE |
| **Date** | 2026-07-21 |
| **Engineering-complete commit** | `4cf061f2a280e4b1e2b4d7a802a85d8c67db90bf` (PA-007) |
| **Baseline tag** | `baseline/program-a-engineering-complete` (annotated, points at `4cf061f2`) |
| **PMO version** | PMO-002 v1.2 (+ amendments PMO-002A, PMO-002B) |

## 2. Scope — what Program A includes

- **Gateway transport infrastructure** — `backend/services/aiGatewayTransports.ts` (PA-001): additive raw-transport seams for gemini/perplexity (implemented) + copilot (typed stub), a shared HTTP fetch envelope, and provider capability metadata.
- **Canonical dispatcher** — `backend/services/aiGatewayDispatcher.ts` (PA-002): the single provider-routing decision point over the untouched core callers (`callOpenAi`/`callAnthropic`) + the PA-001 registry.
- **Provider migrations** — all five visibility adapters route transport through the dispatcher (PA-003..007), each behind an adapter-owned feature flag.
- **Adapter-ownership doctrine** — Platform owns raw transport; adapters own business logic (prompt build, citation extraction, scoring, budget, cache, rate-limit, retry). Reusable base seam `LLMAdapterBase.fetchCompletionJson` (PA-004).
- **Feature-flag rollout** — per-provider `*_ADAPTER_GATEWAY_TRANSPORT` flags, all default OFF.
- **Operational readiness** — PA-008A provider readiness certification; OPS-001 rollout/rollback process (validated as a labeled simulation).
- **Platform substrate landed** — PREP-1: `ai/safety`, `ai/grounding` + assimilation delta, PIP foundation.

## 3. Out of Scope — what Program A explicitly excludes

- **Production rollout / deployment** — Operations (code is undeployed; local-only).
- **Production soak** — Operations (no operational evidence gathered; PA-008B not executable by engineering).
- **Platform metadata enhancement** — extending `NormalizedCompletion` to carry provider-native extras (e.g., Perplexity `citations[]`) — Platform, future ICR.
- **Copilot gateway transport** — no real `callCopilot` implementation — Platform, future.
- **Legacy transport retirement** — PA-008C, gated on a passed production soak (per-provider).
- **Program B** — Egress Product Adoption (separate program).

## 4. Repository Snapshot

| Field | Value |
|---|---|
| **HEAD (at engineering-complete)** | `4cf061f2` (PA-007) |
| **Branch** | `feat/intel-egress-coordination-foundation` |
| **Total Program A commits** | 10 (PREP-1 ×3 + PA-001..007 ×7) |
| **Baseline tag** | `baseline/program-a-engineering-complete` |
| **Deployment status** | **Not deployed** — local-only (Program-A chain ahead of `origin/main`, unpushed) |

**Program A commit chain:**

| Commit | Work package | Zone |
|---|---|---|
| `13b24512` | PREP-1 ai/safety substrate | P |
| `e1898eeb` | PREP-1 ai/grounding + assimilation delta | P |
| `39127b53` | PREP-1 PIP foundation | P |
| `1af8345b` | PA-001 gateway transport seams | P |
| `888031ff` | PA-002 canonical dispatcher | P |
| `e7bb18bf` | PA-003 OpenAI adapter | A2 |
| `9299d52b` | PA-004 Anthropic adapter (+ base seam) | A2 |
| `4bf7bf11` | PA-005 Gemini adapter | A2 |
| `b65072c0` | PA-006 Perplexity adapter | A2 |
| `4cf061f2` | PA-007 Copilot adapter | A2 |

## 5. Verification (at baseline)

| Check | Result |
|---|---|
| Tests | 44 across 7 suites, all green (gatewayTransportSeams, aiGatewayDispatcher, {openai,anthropic,gemini,perplexity,copilot}AdapterGatewayAdoption) |
| Migrations | **0** — no schema/data changes across the entire Program A |
| TypeScript baseline | PASS — actual 54, 0 net-new across all 10 commits |
| Cross-zone verification | 0 violations — Platform (P) / Intelligence (A2) boundaries clean |
| Feature flags | 5 provider flags, all default OFF |
| Reversibility | flag OFF ⇒ legacy transport; env-var rollback; no deploy; no residual state |

## 6. Provider status (at baseline)

| Provider | Engineering | Activation |
|---|---|---|
| OpenAI | Migrated | READY (staged, per PA-008A) — soak pending |
| Anthropic | Migrated | READY (staged) — soak pending |
| Gemini | Migrated | READY (staged) — soak pending |
| Perplexity | Migrated | BLOCKED — `NormalizedCompletion` cannot carry grounded `citations[]` |
| Copilot | Migrated (stub-aware) | BLOCKED — no real `callCopilot` transport |

## 7. Baseline Compatibility Rules

1. Future engineering work **must NOT modify this baseline document** (it is historical/immutable).
2. Future programs **must reference** this baseline as their starting point.
3. Any architectural **deviation from the doctrines** in §3 of the Architectural Snapshot below **must be justified via a new ADR or PMO-approved decision**.
4. **Program B ADRs shall reference this baseline.**

## Architectural Snapshot — permanent doctrines established by Program A

1. **Canonical Gateway** — one transport home for all LLM providers (`aiGatewayTransports.ts`).
2. **Canonical Dispatcher** — one routing decision point (`aiGatewayDispatcher.ts`).
3. **Platform owns transport** — raw provider I/O lives in Platform (Zone P).
4. **Adapters own business logic** — prompt, citation, scoring, budget, retry stay in the adapter/base (Zone A2).
5. **Provider feature flags** — per-provider, default OFF, independent.
6. **Dark rollout** — activations land dormant; measured, staged enablement.
7. **Pure reshape** — `NormalizedCompletion` ↔ provider response shape, keeping downstream byte-identical.
8. **Reversible deployment** — env-var rollback, zero migrations, no residual state.

## Program Transition Record

| Domain | Status / Ownership |
|---|---|
| **Engineering** | ✅ COMPLETE (this baseline) |
| **Operations** | → deployment · production soak · rollout · PA-008C legacy retirement (post-soak) |
| **Platform** | → `NormalizedCompletion` provider-metadata enhancement (ICR) · Copilot gateway transport |
| **Governance** | → register PMO-ADR-12 (semantic identity) in the PMO-002 ADR registry |
| **Program B** | → new authority under PMO-002 (Egress Product Adoption) |

---

*Reference: [PROGRAM A release notes](../../releases/PROGRAM-A.md) · governing document [OMNIVYRA-PMO-002](../OMNIVYRA-PMO-002.md). Immutable — corrections are made in successor documents, never here.*
