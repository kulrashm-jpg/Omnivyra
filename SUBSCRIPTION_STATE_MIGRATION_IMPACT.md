# SUBSCRIPTION_STATE_MIGRATION_IMPACT.md

Impact of migrating entitlement to the canonical resolver.

## Schema / DB migrations
**NONE.** No new tables, columns, or SQL migrations. The resolver reads existing tables
(`billing_subscriptions`, `organization_plan_assignments`) as-is. No billing writes.

## Code changes
| File | Change | Risk |
|---|---|---|
| `backend/services/subscriptionStateResolver.ts` | NEW — canonical resolver + predicates | low (pure + injected loader, fail-closed-to-legacy) |
| `backend/services/subscriptionAllocationService.ts` | + resolver import; + `subscription_inactive` status; + `subscriptionState?` param; + validity gate between `not_billable` and `dry_run`; result carries `subscriptionState` | low (additive; gate only blocks non-entitled) |
| `backend/tests/unit/subscriptionStateResolver.test.ts` | NEW — 16 tests | n/a |

## Behavioral impact (today)
**Zero.** Live state: `billing_subscriptions` = 0 rows, `organization_plan_assignments` = 0 rows.
- The allocation sweep iterates plan assignments → 0 orgs → no allocation occurs regardless.
- Any org resolves via legacy fallback: ACTIVE if it has a plan assignment (none today), else
  EXPIRED. Verified live: a real customer org resolves `EXPIRED`, resolver runs without error.

## Behavioral impact (once `billing_subscriptions` is populated)
- Orgs with `status` canceled/expired/past_due (past grace)/paused → `subscription_inactive`,
  **no new monthly credits**.
- Orgs active/trialing (within period/trial) → allocate unchanged.
- Orgs in grace → no new credits (existing balances unaffected; top-up handling is a separate phase).

## Migration of entitlement checks
- **Allocation:** migrated to the resolver (the one validity-relevant check).
- **Tier/limits/UI** (`planResolutionService`, `usageEnforcementService`, `billingCenterService`,
  `pages/api/user/subscription`): **unchanged** — these resolve plan *tier*, not validity, and
  correctly continue to read `organization_plan_assignments`.
- No other code computed subscription validity, so nothing else required migration.

## Dependency / prerequisite
The gate is correct but only *active* once `billing_subscriptions` carries real rows. The
lifecycle write-path (checkout → create row; webhooks → update status; renewal/expiry job) is the
prerequisite to make the gate bite — explicitly **out of this phase's scope**.

## Rollback
Revert the two code files; no DB state to undo (no migration, no writes performed).
