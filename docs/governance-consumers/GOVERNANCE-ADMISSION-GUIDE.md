# Governance Admission Guide

The **Governance Admission Adapter** is an optional gate placed **before** a governance-designated AI workflow executes. When enabled, it asks the frozen Governance Runtime v1.0.0 — through its **published admission entrypoint** — whether the operation may enter the execution pipeline, and (in enforce mode) blocks it if not.

## Architecture

```
 AI workflow (governance-designated only)
        │  enforceAdmission({ operation, tenantId })
        ▼
 Governance Admission Adapter        ← policy: off / shadow / enforce, fail-closed
        │  invokeGovernanceRuntime()
        ▼
 Consumer Abstraction Layer          ← transport: timeout, retry, compatibility, parse
        │  child process (published CLI)
        ▼
 gateway.mjs --execute <ref> --generation <N> --json   ← FROZEN runtime (invoke-only)
        │  documented admission JSON
        ▼
 { admissionDecision: { gatewayDecision, entersPipeline, reason, admissionId } }
```

- **Invoke-only.** The adapter spawns the published entrypoint as a child process and reads its documented JSON. It **never imports** `runtime/*.mjs` internals.
- **No duplicated logic.** The runtime alone computes the admission decision; the adapter only interprets it (Admitted → allow, otherwise → block).
- **Not a request-path dependency.** The adapter is off by default and scoped to designated workflows, so standard AI requests never touch the runtime.

## Published contracts consumed

| Contract | Purpose |
|---|---|
| `gateway.mjs --json` (GOV-AUTO-022 / WP-23) | live admission decision |
| `docs/governance-runtime-v1.0.0/VERSION.json` | version + release digest for compatibility |
| `docs/governance-runtime-v1.0.0/MANIFEST.json` | runtime version fallback |

The admission JSON contract (fields the consumer reads):

```json
{
  "runtimeVersion": "1.0.0",
  "admissionDecision": {
    "gatewayDecision": "Admitted | Rejected | Deferred",
    "entersPipeline": true,
    "reason": "inactive-constitution | null",
    "admissionId": "ADM-Gen3-…"
  }
}
```

> The gateway **exits non-zero** to signal a blocked (Rejected/Deferred) decision while still printing this JSON. The consumer treats a non-zero exit **with a valid contract** as a decision, not a transport failure; only a killed/timeout or empty output is a transport error.

## Execution flow

1. A governance-designated workflow calls `enforceAdmission({ operation, tenantId })` immediately before AI execution.
2. The adapter resolves the flag mode for the tenant.
   - **off** → return immediately (`bypass`), runtime not invoked.
   - operation **not designated** → return immediately (`not-designated`), runtime not invoked.
3. Designated + enabled → the abstraction verifies **compatibility** (published VERSION/MANIFEST). Incompatible → typed `GOV_CONSUMER_INCOMPATIBLE`.
4. The abstraction invokes the published entrypoint with a hard timeout and bounded retry, then parses the documented JSON.
5. The adapter applies policy:
   - **shadow** → record a diagnostic and **always allow** (never blocks).
   - **enforce** → `Admitted` allows; anything else (Rejected/Deferred, timeout, invoke error, incompatible, bad output) **blocks** → `GovernanceAdmissionDenied`.
6. A machine-readable diagnostic is recorded on every path (including bypass).

## Invocation lifecycle

| Stage | Owner | Failure code |
|---|---|---|
| compatibility gate | abstraction | `GOV_CONSUMER_INCOMPATIBLE` |
| spawn published entrypoint | abstraction | `GOV_CONSUMER_INVOKE_FAILED` |
| per-attempt timeout (default 45s, retry ×1) | abstraction | `GOV_CONSUMER_TIMEOUT` |
| parse documented JSON | abstraction | `GOV_CONSUMER_BAD_OUTPUT` |
| admission policy | adapter | `GovernanceAdmissionDenied` |

## Feature-flag behavior

The flag is the reusable Rollout Kit flag `governance-admission` (default **off**).

| Mode | Runtime invoked? | Blocks? | Use |
|---|---|---|---|
| `off` (default) | no | no | disabled everywhere until deliberately promoted |
| `shadow` | yes (designated only) | no | observe real decisions safely before enforcing |
| `enforce` | yes (designated only) | yes (fail-closed) | authoritative admission for designated workflows |

- Environment: `ROLLOUT_GOVERNANCE_ADMISSION_MODE = off | shadow | enforce`.
- Per-tenant canary: `ROLLOUT_GOVERNANCE_ADMISSION_TENANTS` (shadow→enforce for listed tenants).
- Kill: `ROLLOUT_GOVERNANCE_ADMISSION_KILL` or the global `ROLLOUT_KILL_SWITCH` → resolves to off.
- Live re-resolution: env is read per call, so a flag flip takes effect without redeploy.
