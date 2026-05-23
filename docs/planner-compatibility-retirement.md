# Planner Compatibility Retirement Checklist

This document tracks the **transitional compatibility surface** of the
planner-capacity contract and the criteria under which each piece can
be safely removed. It is a living document — operators retiring a
compatibility shim should update it in the same commit.

> **Audience.** Engineers planning a compatibility-retirement pass.
> **Not** a runtime artifact — nothing here changes behavior. The
> structured telemetry events referenced below are what actually
> measure retirement readiness.

---

## Why this exists

The capacity contract was migrated from a dual-semantic shape
(`available_content: 'No' | Record<string, number>`) to a canonical
shape (`has_existing_content: boolean` + `available_content: Record`)
in the stabilization arc. Two transitional artifacts remain:

1. **`content_capacity` mirror field** emitted by the normalizer for
   legacy UI quick-pick consumers that still read it.
2. **Defensive validator coercion** in `coerceTotalCount` that returns
   `0` for non-record inputs (mode-gated; default `warn`).

Both are required NOW to maintain backward compatibility but become
*future drift vectors* if left indefinitely. This document is the
explicit roadmap to retire them safely.

---

## Compatibility surface inventory

### 1. `content_capacity` mirror in normalizer output

| Aspect | Detail |
|---|---|
| **File** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — `normalizePlannerCapacityInputs` return value |
| **Why kept** | UI quick-pick panels still read `content_capacity` as a fallback (`components/campaign-ai/QuickPickCapacityPanels.tsx`, `useCampaignAiQuickPickState.ts`, `planningContextHelpers.ts`, `QuickPickPlatformContentRequestsPanel.tsx`) |
| **Why removable** | All internal planner code reads `weekly_capacity` only (post-stabilization). The mirror exists ONLY for UI compatibility. |
| **Removal criterion** | Dashboard query: `event:'planner_legacy_contract_usage' legacy_field:'content_capacity'` shows **zero emissions across a full release cycle** AND the four UI files above have migrated to read `weekly_capacity`. |
| **Removal action** | Delete the `content_capacity` field from the `normalizePlannerCapacityInputs` return; delete the legacy-usage telemetry branch; update [project_planner_capacity_contract.md](C:\Users\Admin\.claude\projects\c--virality\memory\project_planner_capacity_contract.md). |
| **TODO marker** | `TODO(remove-after-weekly-capacity-cutover)` in [campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) at the legacy-telemetry branch. |

### 2. Defensive `return 0` in `coerceTotalCount`

| Aspect | Detail |
|---|---|
| **File** | [backend/services/capacityExpectationValidator.ts](backend/services/capacityExpectationValidator.ts) — `coerceTotalCount` non-record branch |
| **Why kept** | Validator must never throw in production under `warn` mode; chokepoint bypasses might exist that we haven't found. |
| **Why removable** | Once `PLANNER_CONTRACT_ENFORCEMENT_MODE=strict` runs in production for one release cycle with **zero `planner_contract_violation` events at `severity:'error'`**, the `return 0` fallback is dead code. |
| **Removal criterion** | Dashboard: `event:'planner_contract_violation' severity:'error'` count = 0 across release cycle in `strict` mode. |
| **Removal action** | Replace the non-record branch with a hard `throw` (no `return 0` fallback). Delete `enforceCapacityContract`'s `shouldThrow: false` return path. |
| **TODO marker** | `TODO(remove-after-strict-mode-stable)` in [capacityExpectationValidator.ts](backend/services/capacityExpectationValidator.ts). |

### 3. `_telemetry` field on `PlannerCapacityIngressInput`

| Aspect | Detail |
|---|---|
| **File** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — optional `_telemetry` on the ingress input |
| **Why kept** | Allows unit tests + non-orchestrator callers to invoke the normalizer without producing operational noise. |
| **Removable?** | **No, keep indefinitely.** This is not a transitional artifact — it's a contract feature. The opt-in pattern is the right design. |

---

## Enforcement-mode promotion path

The contract is currently `warn` by default ([backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) → `PLANNER_ENFORCEMENT_MODE`). Promotion path:

| Mode | When | Effect |
|---|---|---|
| `shadow` | Initial rollout (operator override) | Silent telemetry at `info` severity |
| `warn` ← **CURRENT** | Default; non-breaking, alerting-visible | `warn`-severity telemetry; validator still returns 0 |
| `strict` | After 1+ release cycle of `warn` with zero violations | `error`-severity telemetry + throw; chokepoint bypasses become 5xx |

To set the mode in production: `PLANNER_CONTRACT_ENFORCEMENT_MODE=strict` in the worker / Vercel env. Roll out worker first; once it's stable, enable in Vercel.

**Do not promote to `strict` until** the dashboard shows zero
`planner_contract_violation` events with `normalized: false` for at
least one release cycle. The events are emitted under the canonical
envelope ([observability/runtime/structuredTelemetry.ts](observability/runtime/structuredTelemetry.ts)) so any log aggregator can run this query.

---

## Retirement event catalogue

Events to monitor for retirement readiness:

| Event | Severity (current) | What it means | Retirement signal |
|---|---|---|---|
| `planner_contract_violation` | `warn` | Unnormalized input reached validator (chokepoint bypass) | Zero emissions for one release → safe to promote enforcement to `strict` |
| `planner_legacy_contract_usage` | `warn` | Caller supplied `content_capacity` without `weekly_capacity` | Zero emissions for one release → safe to drop the mirror |
| `bolt_sweeper_recovered_abandoned` | `info` | Sweeper found stale runs | Not a retirement signal — this is permanent forensic instrumentation |

All three carry the canonical envelope fields (`deployment_id`,
`git_sha`, `worker_pid`, `run_id`, `planner_stage`, `timestamp`) so
they can be grouped / filtered identically.

---

## When in doubt

If you're about to remove a compatibility shim and the retirement
criteria above are *almost* met but not quite (e.g. one stray event
last week), **wait one more release cycle**. The cost of leaving the
shim is a few lines of code; the cost of premature removal is a
runtime error on the production path. The whole reason this document
exists is to make the patient choice the easy one.
