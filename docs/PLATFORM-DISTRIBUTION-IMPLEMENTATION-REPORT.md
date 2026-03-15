# PLATFORM DISTRIBUTION IMPLEMENTATION REPORT

**Date:** March 12, 2025  
**Scope:** Platform distribution mode (Unique vs Shared posting) — full integration

---

## FILES MODIFIED

| Path | Change Summary |
|------|----------------|
| `backend/db/campaignVersionStore.ts` | Added `buildCrossPlatformSharingFromWizard()` to derive `{ enabled, mode }` from wizard_state. `updateWizardStateInSnapshot()` now writes `cross_platform_sharing` at campaign_snapshot top level when saving wizard state. |
| `backend/services/campaignPlanningInputsService.ts` | Already had `cross_platform_sharing_enabled` in type, get, and save. Confirmed it is written to `planning_inputs` whenever planning inputs are saved. |
| `backend/services/campaignAiOrchestrator.ts` | No change required — already reads `cross_platform_sharing` from prefilledPlanning and defaults `{ enabled: true }` when missing. |
| `backend/services/deterministicWeeklySkeleton.ts` | **Slot logic:** Shared mode — each slot can cover multiple platforms (existing). Unique mode — each slot now targets exactly one platform (one slot per platform × count). Added `resolveCrossPlatformSharingEnabled()` with backward compat: `undefined` → shared mode (true). |
| `backend/services/workloadBalancerService.ts` | Input type now accepts `cross_platform_sharing: { enabled?: boolean } \| boolean`. Added `resolveCrossPlatformSharingEnabled()` — `undefined` → true (shared). |
| `backend/services/planningIntelligenceService.ts` | Input type now accepts `cross_platform_sharing: { enabled?: boolean } \| boolean`. Added `resolveCrossPlatformSharing()` — `undefined` → true (shared). |
| `backend/services/capacityFrequencyValidationGateway.ts` | Added `resolveCrossPlatformSharing()` helper. Pass-through `cross_platform_sharing` to `balanceWorkload()` instead of coercing to boolean with false default; enables workload balancer to apply its own `undefined` → shared default. |
| `pages/api/campaigns/index.ts` | Added `cross_platform_sharing` to `prefilledPlanning` when building from snapshot. Sources: `snapshot.cross_platform_sharing` or derived from `snapshot.wizard_state.cross_platform_sharing_enabled`. |
| `pages/api/campaigns/ai/plan.ts` | Forwards `cross_platform_sharing` from `existingCollectedPlanningContext` into `finalCollectedPlanningContext`. Persists `cross_platform_sharing_enabled` to `saveCampaignPlanningInputs()` when present. |
| `pages/api/campaigns/planner-finalize.ts` | Accepts `cross_platform_sharing` from request body. When creating new campaign, includes `cross_platform_sharing` in `campaign_snapshot` written to `campaign_versions`. |
| `lib/planning/campaignFrequencyEngine.ts` | No change — already uses `cross_platform_sharing_enabled` in input; validate-frequency API passes it from body. |

---

## DATABASE FIELDS ADDED

| Table / Field | Type | Notes |
|---------------|------|-------|
| `campaign_versions.campaign_snapshot` | JSONB (existing) | New key: `cross_platform_sharing: { enabled: boolean, mode: "shared" \| "unique" }` |
| `campaign_planning_inputs.recommendation_snapshot.planning_inputs` | JSONB (existing) | Existing key: `cross_platform_sharing_enabled: boolean` — confirmed written on save |

No schema migration required; both use existing JSONB columns.

---

## SNAPSHOT STRUCTURE

```json
{
  "cross_platform_sharing": {
    "enabled": true,
    "mode": "shared"
  }
}
```

- **enabled: true** → Shared mode — one piece can be scheduled to multiple platforms.
- **enabled: false** → Unique mode — each platform receives its own content.
- **mode** — `"shared"` when enabled, `"unique"` when disabled (informational).

Written when:
- Wizard state is saved (`updateWizardStateInSnapshot`)
- Planner finalize creates new campaign (from body)
- Derived into `prefilledPlanning` for GET campaigns from snapshot or wizard_state.

---

## PLANNING PIPELINE CHANGES

| Stage | Behavior |
|-------|----------|
| **Wizard** | `cross_platform_sharing_enabled` saved in wizard_state; `updateWizardStateInSnapshot` writes `cross_platform_sharing` to campaign_snapshot. |
| **Campaign snapshot** | `cross_platform_sharing` at top level; flows into prefilledPlanning for plan API. |
| **Planning inputs** | `cross_platform_sharing_enabled` in `planning_inputs`; read by `getCampaignPlanningInputs`. |
| **AI orchestrator** | Uses prefilledPlanning.cross_platform_sharing; defaults `{ enabled: true }` when null. |
| **Weekly skeleton** | If enabled: unique = MAX(content types); slot_platforms can list multiple platforms. If disabled: unique = SUM(content types × platforms); each slot targets one platform. |
| **Workload balancer** | `resolveCrossPlatformSharingEnabled()` — undefined → true. |
| **Planning intelligence** | `resolveCrossPlatformSharing()` — undefined → true. |

---

## SCHEDULER BEHAVIOR

**Shared mode (enabled: true):**
- post_per_week = 3, platforms = [linkedin, twitter] → 3 pieces total.
- Each slot: slot_platforms = [linkedin, twitter] — one piece reused on both.

**Unique mode (enabled: false):**
- post_per_week = 3, platforms = [linkedin, twitter] → 6 pieces total (3 × 2).
- Slots: [linkedin], [linkedin], [linkedin], [twitter], [twitter], [twitter].

`deterministicWeeklySkeleton.ts` slot_platforms logic:
- Shared: iterate; each slot gets all platforms with remaining count; decrement all.
- Unique: for each platform, create `count` slots, each with `[platform]` only.

---

## API PAYLOAD CHANGES

| API | Field | Format |
|-----|-------|--------|
| **GET /api/campaigns** (type=campaign) | `prefilledPlanning.cross_platform_sharing` | `{ enabled: boolean, mode: "shared" \| "unique" }` |
| **POST /api/campaigns/ai/plan** | Forwards via `collectedPlanningContext` / `prefilledPlanning` | Same |
| **POST /api/campaigns/planner-finalize** | `cross_platform_sharing` in body | `{ enabled: boolean, mode: "shared" \| "unique" }` — persisted to campaign_snapshot |

---

## BACKWARD COMPATIBILITY STRATEGY

| Scenario | Behavior |
|----------|----------|
| `cross_platform_sharing` undefined | Treated as **shared mode** (enabled: true). |
| `cross_platform_sharing` null | Same — shared mode. |
| Legacy boolean `true` / `false` | Supported; treated as enabled. |
| Object with `enabled` | Uses `enabled`; derives mode from it. |
| Object with `mode: "unique"` but no `enabled` | Treated as enabled: false. |

Applied in: deterministicWeeklySkeleton, workloadBalancerService, planningIntelligenceService, capacityFrequencyValidationGateway.

---

## TEST SCENARIOS

1. **Shared posting campaign** — wizard selects Shared; `cross_platform_sharing_enabled: true` saved; snapshot has `{ enabled: true, mode: "shared" }`; skeleton produces 3 slots for 3 posts × 2 platforms; each slot targets [linkedin, twitter].
2. **Unique posting campaign** — wizard selects Unique; `cross_platform_sharing_enabled: false` saved; snapshot has `{ enabled: false, mode: "unique" }`; skeleton produces 6 slots; each slot targets [linkedin] or [twitter] only.
3. **Mixed platform scheduling** — shared mode: one piece reused; unique mode: separate pieces per platform.
4. **Existing campaign without field** — `cross_platform_sharing` absent in snapshot; all services default to shared mode (enabled: true).

---

## EDGE CASES HANDLED

- **Missing field on old campaigns** — Default to shared (true).
- **Object with only `mode`** — `mode: "unique"` implies enabled: false.
- **String values** — `resolveCrossPlatformSharing` handles "true"/"false"/"shared"/"unique".
- **capacityFrequencyValidationGateway** — Pass-through raw value so workloadBalancer applies its default; no double-coercion.
- **Slot ordering in unique mode** — Platforms iterated in `selected_platforms` order; slots built per platform then concatenated.
