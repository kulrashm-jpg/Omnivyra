# Customer Billing Impact Assessment

**Date:** 2026-05-15
**Scope:** Pre-GA customer impact for billing enforcement

## Newly Billable Actions

| Action | Current behavior | New control | Impact |
|---|---|---|---|
| `refine_variant` / activity workspace variant refinement | Billable through `runBilledAiCompletion()` | `REFINE_VARIANT_BILLING_ENABLED` with grace org support | Customers may see credit usage for variant refinement |

## Flag Behavior

| Flag/env | Default | Behavior |
|---|---|---|
| `REFINE_VARIANT_BILLING_ENABLED` | enabled when absent | Preserves existing current behavior |
| `REFINE_VARIANT_BILLING_ENABLED=false` | explicit off | Disables refine-variant billing globally |
| `REFINE_VARIANT_BILLING_ENABLED=canary` | staged | Requires org feature flag `billing.refine_variant_enabled` |
| `REFINE_VARIANT_BILLING_GRACE_ORGS` | empty | Comma-separated org IDs exempt from refine-variant billing |

## Affected Orgs

No customer org inventory was generated from the live database in this pass because localhost is pointed at a remote Supabase project. The rollout coordinator supports org-scoped enablement once staging canary orgs are provided.

## Projected Spend Change

Not measured live. The known spend-change surface is refine-variant usage. Impact should be calculated from each org's recent activity-workspace refinement count multiplied by the configured `content_rewrite` token/fixed pricing.

## Exemption Recommendations

1. Add early customer orgs to `REFINE_VARIANT_BILLING_GRACE_ORGS` during the communication window.
2. Use `REFINE_VARIANT_BILLING_ENABLED=canary` for staged paid rollout.
3. Do not combine global `BILLING_REQUIRE_AI_HANDLE=true` with broad grace exemptions until all grace-exempt direct AI paths are allowlisted or routed through an explicit non-billable scope.

## Rollout Recommendation

**Limited GA only after customer inventory is generated from staging/production read-only analytics.** Do not globally flip refine-variant billing if customer communication is incomplete.
