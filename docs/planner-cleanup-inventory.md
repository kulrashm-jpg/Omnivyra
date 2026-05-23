# Planner Cleanup Inventory

A single ledger of every transitional / compatibility artifact in the
planner surface. Each entry has explicit **removal criteria** and a
**TODO annotation** at the code site so `grep TODO\(remove-` will
always surface the same set you read here.

Pair with [docs/planner-compatibility-retirement.md](planner-compatibility-retirement.md) — that doc explains the *strategy*; this doc is the *manifest*.

> **Why this exists.** Temporary stabilization code has a fossilization
> half-life of about one quarter if nobody owns its removal. The
> inventory below is what makes the patient choice (keep the shim)
> reversible — once removal criteria are met, you have one place to
> consult instead of grepping the codebase from memory.

---

## Annotation grammar

Every transitional code site carries a TODO of the form:

```
TODO(remove-after-<criterion>): <one-line rationale>
```

`<criterion>` is a stable, short token that matches an entry in this
document. Grep for `TODO(remove-after-` to enumerate live entries.

---

## Entry 1 — `content_capacity` mirror in normalizer output

| Field | Value |
|---|---|
| **TODO token** | `remove-after-weekly-capacity-cutover` |
| **Site (primary)** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — `normalizePlannerCapacityInputs` return value |
| **Site (telemetry branch)** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — `planner_legacy_contract_usage` emission |
| **Added** | Stabilization-hardening pass (Phase 2) |
| **Why kept** | Four UI quick-pick consumers still read `content_capacity` as a fallback. |
| **Removal criteria (ALL must hold)** | 1. Dashboard query `event:'planner_legacy_contract_usage' legacy_field:'content_capacity'` returns zero across one full release cycle. <br>2. The four UI consumer files (see §Affected Files below) have migrated to read `weekly_capacity`. |
| **Removal action** | a) Delete `content_capacity` field from `PlannerCapacityNormalized` interface and `normalizePlannerCapacityInputs` return. b) Delete the legacy-telemetry branch. c) Update [project_planner_capacity_contract.md](C:\Users\Admin\.claude\projects\c--virality\memory\project_planner_capacity_contract.md). |
| **Affected files (UI consumers)** | `components/campaign-ai/QuickPickCapacityPanels.tsx`, `components/campaign-ai/useCampaignAiQuickPickState.ts`, `components/campaign-ai/planningContextHelpers.ts`, `components/campaign-ai/QuickPickPlatformContentRequestsPanel.tsx` |

---

## Entry 2 — Defensive `return 0` in `coerceTotalCount`

| Field | Value |
|---|---|
| **TODO token** | `remove-after-strict-mode-stable` |
| **Site** | [backend/services/capacityExpectationValidator.ts](backend/services/capacityExpectationValidator.ts) — `coerceTotalCount` non-record branch |
| **Added** | Stabilization arc (validator hardening) |
| **Why kept** | Validator must never throw under default `warn` mode; chokepoint bypasses might exist that we haven't traced. |
| **Removal criteria (ALL must hold)** | 1. `PLANNER_CONTRACT_ENFORCEMENT_MODE=strict` has been live in production for ≥1 release cycle. <br>2. Dashboard query `event:'planner_contract_violation' severity:'error'` returns zero across that cycle. |
| **Removal action** | a) Replace the non-record branch with an unconditional `throw new Error(...)`. b) Delete `enforceCapacityContract`'s `shouldThrow: false` return path (the function then returns `void` or just calls the emitter directly). c) Remove this entry from the inventory. |

---

## Entry 3 — `_telemetry` field on `PlannerCapacityIngressInput`

| Field | Value |
|---|---|
| **TODO token** | None — **NOT a transitional artifact** |
| **Site** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — `PlannerCapacityIngressInput._telemetry` |
| **Status** | **Permanent contract feature.** The opt-in telemetry pattern is the right design — unit tests + non-orchestrator callers should not produce operational noise. Listed here only to disambiguate from removable items. |

---

## Entry 4 — Lazy `require()` for `emitStructuredEvent` in `campaignAiCapacity.ts`

| Field | Value |
|---|---|
| **TODO token** | `remove-after-module-load-order-verified` |
| **Site** | [backend/services/campaignAiCapacity.ts](backend/services/campaignAiCapacity.ts) — two `// eslint-disable-next-line @typescript-eslint/no-require-imports` blocks |
| **Added** | Phase 9 (telemetry envelope retrofit) |
| **Why kept** | Defensive against module-load-order issues in unit-test isolation (the observability barrel might not be initialised when `campaignAiCapacity` is first imported in a test). |
| **Removal criteria** | A focused test sweep confirms that converting both lazy requires to static `import` at the top of the file does NOT break unit tests in `backend/tests/unit/campaignAiCapacity*.test.ts`. |
| **Removal action** | Replace both `require()` calls with a single top-of-file `import { emitStructuredEvent } from '../../observability/runtime/structuredTelemetry';`. |

---

## How to remove an entry

1. Confirm the removal criteria are met. Don't trust intuition — run the dashboard query.
2. Delete the code at all sites listed in the entry.
3. Delete the entry from this document.
4. Search for the TODO token to confirm no orphan sites remain: `grep -r "TODO(remove-after-<token>)" .`
5. Update related memory entries (linked in each entry's "Removal action" row).
6. Open a PR with a brief description referencing this inventory.

---

## How to add an entry

When you introduce new transitional / compatibility logic:

1. Pick a stable token. Format: `remove-after-<criterion-name>`. Examples: `weekly-capacity-cutover`, `strict-mode-stable`, `module-load-order-verified`.
2. Annotate the code site: `// TODO(remove-after-<token>): <one-line rationale>`.
3. Add an entry to this document with: TODO token, site, why kept, removal criteria, removal action, affected files (if any).
4. Reference the entry from any relevant memory.

The discipline: **no new transitional code without a corresponding inventory entry.** If you can't write the removal criteria, you don't yet understand the shim well enough to add it.

---

## Open transitional entries — quick summary

| # | TODO token | Site | Status |
|---|---|---|---|
| 1 | `remove-after-weekly-capacity-cutover` | `campaignAiCapacity.ts` — `content_capacity` mirror | Live |
| 2 | `remove-after-strict-mode-stable` | `capacityExpectationValidator.ts` — `return 0` fallback | Live |
| 4 | `remove-after-module-load-order-verified` | `campaignAiCapacity.ts` — lazy require | Live |
