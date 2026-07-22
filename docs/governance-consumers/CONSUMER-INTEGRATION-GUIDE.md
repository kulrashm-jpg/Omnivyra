# Consumer Integration Guide

How to build and wire consumers of the frozen Governance Runtime v1.0.0 through the **Consumer Abstraction Layer** — the single supported way application code interacts with the runtime.

## The abstraction layer

`backend/services/governance/governanceRuntimeConsumer.ts` defines the whole contract surface:

| Interface | Shape |
|---|---|
| **Invocation** | `GovernanceInvocation { executionRef, generation }` |
| **Options** | `GovernanceInvokeOptions { timeoutMs?, retries?, retryBackoffMs?, invoker?, skipCompatibility? }` |
| **Response** | `GovernanceResponse { decision, entersPipeline, reason, admissionId, runtimeVersion, durationMs, attempts, compatibility, raw }` |
| **Error** | `GovernanceConsumerError { code, attempts, detail }` — codes: `GOV_CONSUMER_INCOMPATIBLE \| _TIMEOUT \| _INVOKE_FAILED \| _BAD_OUTPUT` |
| **Compatibility** | `CompatibilityReport { compatible, runtimeVersion, releaseDigest, consumerVersion, expectedVersion, expectedReleaseDigest, reasons }` |

Key entry points:

```ts
import { invokeGovernanceRuntime, checkCompatibility } from '@/backend/services/governance';

const compat = checkCompatibility();               // published contracts only, no runtime run
const res = await invokeGovernanceRuntime(
  { executionRef: 'ai:my.workflow', generation: 3 },
  { timeoutMs: 45_000, retries: 1 },
);
// res.decision ∈ Admitted | Rejected | Deferred
```

- **Timeout handling** — a hard per-attempt timeout kills the child process; exceeding it yields `GOV_CONSUMER_TIMEOUT`.
- **Retry policy** — `retries` additional attempts (default 1) with `retryBackoffMs` backoff; a malformed contract is **not** retried.
- **Version compatibility** — verified before every invocation from `VERSION.json`/`MANIFEST.json`; an unsupported major or a release digest ≠ `4903e8fb` yields `GOV_CONSUMER_INCOMPATIBLE`.
- **Injectable transport** — `invoker` lets tests exercise the abstraction deterministically without a real ~40s spawn. Only the transport is injectable; **no governance logic is mockable**.

## Supported consumers

| Consumer | Status |
|---|---|
| Governance Admission Adapter | shipped (R3D) — the reference consumer |
| Future consumers (e.g. governance-aware planning, certification gating) | supported via the same abstraction; must follow the rules below |

## Integration rules (mandatory)

1. **Depend only on the abstraction.** Import from `backend/services/governance` — never from `docs/company-intelligence/governance-automation/runtime/*`.
2. **Never import runtime internals** and never duplicate governance decision logic — the runtime decides.
3. **Governance-designation is opt-in.** A workflow is eligible only if its stable operation label is in `GOVERNANCE_DESIGNATED_OPERATIONS`. Everything else bypasses.
4. **Never place the runtime on the standard request path.** Consumers are feature-flagged off by default and scoped to designated workflows.
5. **Additive and removable.** A consumer must be deletable without touching the runtime, the constitution, or any digest.

## Wiring a governance-designated AI workflow

Add the operation to the designation registry, then call the adapter immediately before AI execution:

```ts
// backend/services/governance/governanceAdmissionFlags.ts
export const GOVERNANCE_DESIGNATED_OPERATIONS = new Set(['governance.policySynthesis']);

// in the governance-designated workflow, just before AI execution:
import { enforceAdmission } from '@/backend/services/governance';
await enforceAdmission({ operation: 'governance.policySynthesis', tenantId });
// throws GovernanceAdmissionDenied only in enforce mode when not Admitted;
// bypasses (returns) when the flag is off or the op is not designated.
```

Prefer `evaluateAdmission()` (never throws; returns `{ admitted, disposition, … }`) when the caller wants to branch instead of throw.

## Compatibility requirements

| Requirement | Enforced by |
|---|---|
| runtime major within `1..1` | `checkCompatibility()` |
| release digest == `4903e8fb` | `checkCompatibility()` |
| published contracts present | `checkCompatibility()` (missing → incompatible, fail-closed) |
| live `runtimeVersion` reported | captured in `GovernanceResponse.runtimeVersion` |

`SUPPORTED_RUNTIME` in the abstraction is the single source of truth for the accepted version window and digest; bump it deliberately when certifying against a new runtime release.
