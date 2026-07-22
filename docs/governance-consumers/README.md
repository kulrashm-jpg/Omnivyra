# Governance Runtime Consumers — Release R3D

Optional, **feature-flagged**, **invoke-only** consumers of the frozen **Governance Runtime v1.0.0** (`GOV-EXEC-RELEASE-v1.0.0-4903e8fb`). This release adds a **Governance Admission Adapter** that can gate governance-designated AI workflows through the runtime's published admission entrypoint — **without modifying the runtime, its constitution, its outputs, or any deterministic digest**.

The Governance Runtime remains an **independent, invoke-only subsystem**. Nothing here imports runtime internals, duplicates governance logic, or places the runtime on the standard request path. Everything is additive and independently removable.

## What it is

| Component | File | Role |
|---|---|---|
| Consumer Abstraction Layer | `backend/services/governance/governanceRuntimeConsumer.ts` | invocation / response / error interfaces, timeout, retry, version compatibility |
| Governance Admission Adapter | `backend/services/governance/governanceAdmissionAdapter.ts` | feature-flagged, fail-closed-for-designated-workflows admission gate |
| Feature Flag | `backend/services/governance/governanceAdmissionFlags.ts` | off/shadow/enforce rollout (default **off**) + designation registry |
| Diagnostics & Observability | `backend/services/governance/governanceConsumerDiagnostics.ts` | machine-readable diagnostics + adapter health |
| Validation Harness | `scripts/governance-consumers/validate-consumer.mjs` | operational validation (runtime unchanged, compat, live invocation) |
| Unit Tests | `backend/tests/unit/governanceAdmissionAdapter.test.ts` | deterministic proof of the full policy matrix |

## Default state

**OFF.** With the flag off (the default in every environment), the adapter bypasses entirely — the runtime is never invoked and standard AI requests are untouched.

## Guides

| Guide | Covers |
|---|---|
| [GOVERNANCE-ADMISSION-GUIDE.md](GOVERNANCE-ADMISSION-GUIDE.md) | architecture, execution flow, invocation lifecycle, feature-flag behavior |
| [CONSUMER-INTEGRATION-GUIDE.md](CONSUMER-INTEGRATION-GUIDE.md) | abstraction layer, supported consumers, integration rules, compatibility |
| [OPERATIONS-GUIDE.md](OPERATIONS-GUIDE.md) | rollout, rollback, troubleshooting, diagnostics, monitoring |

## Quick validation

```bash
npm run governance:consumer-validate        # fast: runtime unchanged + compatibility
npm run governance:consumer-validate:live   # + live admission (Admitted gen 3 / Rejected gen 0)
```
