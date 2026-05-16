# Final Billing Go-Live Checklist

**Date:** 2026-05-15
**Status:** Executable checklist for limited/staged GA

## 1. Feature Flags Status

- Verify `billing.ai_enforced` on canary orgs only.
- Verify `billing.reservations_required` on canary orgs only.
- Verify `billing.refine_variant_enabled` if `REFINE_VARIANT_BILLING_ENABLED=canary`.
- Keep platform-wide `BILLING_REQUIRE_AI_HANDLE` off until canary passes.

## 2. Required Env Vars

- `BILLING_REQUIRE_AI_HANDLE`
- `REFINE_VARIANT_BILLING_ENABLED`
- `REFINE_VARIANT_BILLING_GRACE_ORGS`
- Supabase server credentials
- Redis URL
- Provider billing/payment credentials

## 3. Migration Verification

- Verify billing migrations `20260663`, `20260664`, and `20260665`.
- Verify immutable triggers on credit, payment, approval, and export tables.
- Verify `credit_untracked_actions` exists and contains owned non-billable registrations.

## 4. Cron Verification

- Run wallet reconciliation.
- Run orphan hold reaper.
- Run reservation reconciliation.
- Run orphan usage reconciliation.
- Run financial integrity audit.

## 5. Dashboard Verification

- Verify wallet aggregate.
- Verify billing operations health.
- Verify approval health.
- Verify reservation health.
- Verify anomaly counters.

## 6. Alert Verification

- Confirm anomaly emission.
- Confirm external alert routing.
- Confirm retry/failure counters.
- Confirm canary auto-disable notification.

## 7. RBAC Verification

- Confirm finance admin actions require finance/admin role.
- Confirm approver role can sign but not self-sign.
- Confirm auditor role is read-only.

## 8. Approval-Chain Verification

- Test propose, sign, reject, cancel, expire, and execute flows.
- Verify duplicate signatures are blocked.
- Verify executed approvals cannot regress.

## 9. Export Verification

- Export ledger.
- Export reservations.
- Export approvals.
- Verify manifest checksum.

## 10. Canary Org Verification

- Run `validateBillingRolloutDependencies()`.
- Run `enableBillingCanaryForOrg()`.
- Run `verifyBillingConsistency()` after canary traffic.
- Confirm 0 orphan usage, 0 drift, 0 duplicate settlements.

## 11. Rollback Procedure

- Run `emergencyDisableBillingCanary()` for affected org.
- Confirm `billing.ai_enforced` is disabled.
- Confirm refine-variant billing is disabled for affected org if needed.
- Re-run `verifyBillingConsistency()`.

## 12. Emergency Contacts/Runbooks

- Finance owner
- Engineering on-call
- Database owner
- Payment provider owner
- Customer support owner

## 13. GA Activation Order

1. Run staging load suite.
2. Register/verify non-billable advisory entries.
3. Enable internal canary orgs.
4. Run live reconciliation certification.
5. Enable staging orgs.
6. Enable limited production orgs.
7. Expand percentage rollout.
8. Enable platform-wide enforcement only after zero drift and zero orphan usage.

## 14. Post-GA Monitoring Schedule

- First 24 hours: hourly reconciliation and anomaly review.
- First week: daily canary health review.
- First month: weekly registry and customer-impact review.
- Quarterly: non-billable registry expiry review.
