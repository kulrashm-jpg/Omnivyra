# Post-Migration Health Certification (Phase E)

**Status: FAIL — NOT CERTIFIED.** No migration was applied (Phase B
rolled back; bulk apply withheld as unsafe), so this is the *current*
production health, not a post-activation state.

## Verification (corrected prober, run against production)

```
$ npx tsx scripts/audit/verify-billing-schema.ts
overall:    critical_missing
present:    0
missing:    26
unverified: 2
error:      0
FAIL — critical billing schema missing.
```

## Certification matrix

| Target | Result |
|---|---|
| No critical missing objects | ❌ 8 critical objects missing (4 tables + 4 RPCs) |
| No partial migrations | ❌ entire chain absent (worse than partial) |
| Reconciliation ready | ❌ `billing_operations`, `v_reservation_health` absent |
| Approvals ready | ❌ `credit_action_approvals`, `*_signatures`, `required_approvals_for_action`, `sign_credit_action_approval` absent |
| PostgREST ready | ❌ real fetch returns `PGRST205` for billing tables; cache also serves *stale phantom* metadata (the defect that masked this) |
| Rollout ready | ❌ critical missing + boot validator not clean |

## Health endpoint

`GET /api/admin/billing/health` was **not** exercised against production
(it requires an authenticated FINANCE_AUDITOR session in the running
app). Driven by the corrected shared prober it would return **HTTP 503**,
`status.overall: "critical_missing"`, every `readiness.*.ready: false`,
all `migrations[].state: "missing"`. Its logic is unit-certified (26/26
in `billingSchemaVerification.test.ts`) — the endpoint is correct; the
schema it would report on is absent.

## Positive outcome of this phase

The verification stack is now **trustworthy**: the `head:true`
false-positive defect that silently reported absent critical tables as
"present" is fixed and regression-covered. Prior to this fix the tooling
would have *falsely certified* a broken production as healthy — the
single most dangerous failure mode for a fail-fast billing guard. That
class of silent schema mismatch is now closed.

## Re-certification preconditions

Certification can only be re-attempted after an operator:
1. backs up production,
2. reconciles the 4-entry migration ledger vs 145 migration files,
3. applies the pending chain (monetization prerequisites → billing) in
   order, in a maintenance window,
4. reloads the PostgREST schema cache.

Then re-run this phase; expect `overall: ok` and all readiness green.
