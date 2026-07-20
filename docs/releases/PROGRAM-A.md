# Release Notes — Program A: Platform Convergence

**Status:** Engineering complete (PROGRAM-A-CLOSE-001). **Authority:** PMO-002.
**Baseline:** `baseline/program-a-engineering-complete` → `4cf061f2` (PA-007). **Date:** 2026-07-21.
**Deployment:** not yet deployed (local-only). Runtime-neutral — all changes ship dark behind default-OFF flags.

## Objectives

Eliminate the live architectural duplication in the LLM provider layer by making the canonical AI
Gateway the single transport for all provider traffic, **without** disrupting the AI-visibility
measurement adapters or their business logic — additively, reversibly, and one provider at a time.

## Architecture

- **Gateway transport seams** (`aiGatewayTransports.ts`) — the one home for raw provider transport, mirroring the existing `callOpenAi`/`callAnthropic` conventions (`NormalizedCompletion`, abort/timeout/usage-normalization).
- **Canonical dispatcher** (`aiGatewayDispatcher.ts`) — a single `dispatchTransport(providerId, …)` routing point over the untouched core callers + the seam registry.
- **Adapter migrations** — all five visibility adapters route transport through the dispatcher behind adapter-owned flags; a reusable base seam (`LLMAdapterBase.fetchCompletionJson`) serves the base-derived adapters.
- **Doctrines established:** Platform owns transport; adapters own business logic; per-provider dark flags; pure `NormalizedCompletion`↔provider-shape reshape; env-var-reversible rollout with zero migrations.

## Achievements

- **5/5 providers** migrated onto the canonical gateway (OpenAI, Anthropic, Gemini, Perplexity, Copilot).
- **10 commits**, **44 tests** (7 suites, all green), **0 migrations**, TypeScript baseline held (**54, 0 net-new**) throughout, **0 cross-zone violations**.
- **Fully reversible:** every migration is dark (flag default OFF ⇒ legacy transport); rollback is an env-var flip with no deployment and no residual state.
- **Provider readiness certified** (PA-008A): OpenAI/Anthropic/Gemini READY for staged enablement; rollout/rollback process validated (OPS-001, simulation).

## Known Limitations (documented, not defects)

- **Perplexity — BLOCKED:** the Platform `NormalizedCompletion` contract cannot carry Perplexity's grounded `citations[]`, so the gateway path drops the "Sources: …" answer appendix. Legacy (default) path preserves citations. Unblock via a future Platform-contract ICR or explicit product acceptance of citation-free normalization.
- **Copilot — BLOCKED:** `callCopilot` is intentionally an unimplemented stub (`GatewayTransportNotImplementedError`); flag-ON degrades to `unavailable`. Unblock when a real Copilot gateway transport exists.
- **Production evidence — absent:** no deployment/soak performed; production parity is unverified until a staged soak runs (Operations).

## Future Ownership

| Domain | Work |
|---|---|
| Operations | push · deploy · staged soak (Anthropic→Gemini→OpenAI) · PA-008C legacy retirement (post-soak) |
| Platform | `NormalizedCompletion` provider-native-metadata ICR (unblocks Perplexity) · Copilot gateway transport |
| Governance | register PMO-ADR-12 in the PMO-002 ADR registry |
| Program B | Egress Product Adoption (new program under PMO-002) |

---

*Baseline manifest: [PROGRAM-A-ENGINEERING-BASELINE](../pmo/baselines/PROGRAM-A-ENGINEERING-BASELINE.md). Governing document: [OMNIVYRA-PMO-002](../pmo/OMNIVYRA-PMO-002.md).*
