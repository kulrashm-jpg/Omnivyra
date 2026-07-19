# Consumer Activation Guide (OMNI-GOV-002)

How to bring a governance-sensitive production workflow under constitutional admission through the certified runtime — safely, reversibly, OFF by default.

## The first activated workflow (reference)

**Governance audit sweep** — `backend/jobs/governanceAuditJob.ts` (`runAllCompanyAudits`). A Stage-28 background job (cron/worker) that audits every company's campaigns. It is the first production workflow to consume the runtime.

Wiring (the entire integration):

```ts
import { evaluateAdmission } from '../services/governance';
// …after the "already running" guard, before doing work:
const admission = await evaluateAdmission({ operation: 'governance.audit.sweep' });
if (!admission.admitted) {
  console.log('GovernanceAuditJob: skipped — constitutional admission not granted', {
    disposition: admission.disposition, reason: admission.reason, mode: admission.mode,
  });
  return;
}
```

And one designation line:

```ts
// backend/services/governance/governanceAdmissionFlags.ts
export const GOVERNANCE_DESIGNATED_OPERATIONS = new Set([
  'governance.admission.selfTest',
  'governance.audit.sweep',        // ← added
]);
```

That is all. With the flag off (default), `evaluateAdmission` bypasses instantly (`admitted:true`, no runtime spawn) and the sweep runs exactly as before.

## Behavior by flag mode

| Mode | Runtime invoked? | Sweep runs? |
|---|---|---|
| `off` (default) | no | yes (unchanged) |
| `shadow` | yes | yes (observed, never blocked) |
| `enforce` + Admitted | yes | yes |
| `enforce` + Rejected / error | yes | **no** (fail-closed skip) |

## Activation checklist

1. Confirm the workflow is genuinely governance-sensitive and **latency-tolerant** (the enforce path spawns the runtime, ~40–70s). Background jobs qualify; interactive request paths generally do not.
2. Add the operation label to `GOVERNANCE_DESIGNATED_OPERATIONS`.
3. Call `evaluateAdmission` (never throws; branch on `admitted`) or `enforceAdmission` (throws `GovernanceAdmissionDenied`) immediately before the sensitive work.
4. Add a unit test proving: flag off → work proceeds unchanged (no spawn); enforce + Admitted → proceeds; enforce + Rejected → skipped. Inject the transport (`invokeOptions.invoker`) to keep it fast and deterministic — never mock governance logic.
5. Roll out via `off → shadow → (canary) → enforce`.

## Rules

- Use the published consumer only (`backend/services/governance`); never import `runtime/*.mjs`.
- Duplicate no governance decision — the runtime decides; the workflow only reacts.
- Keep it flag-gated and OFF by default.
- Verify the runtime is unchanged after activation: `npm run governance:verify-baseline` → VERIFIED.

## End-to-end validation

- Job wiring + decision matrix: `backend/tests/unit/governanceAuditAdmission.test.ts`.
- Live runtime decision path: `npm run governance:consumer-validate:live` → CONSUMER-VALIDATED (Admitted at active generation, Rejected at an inactive generation) — the same certified transport every designated operation flows through.
