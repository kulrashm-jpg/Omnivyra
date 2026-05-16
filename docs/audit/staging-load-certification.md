# Staging Load Certification

**Date:** 2026-05-15
**Scope:** Pre-GA billing activation certification
**Status:** HOLD - live staging load suite not executed from localhost

## Execution Boundary

The local runtime is pointed at remote Supabase project `klkiseupptzbecbxwrky` and `npm run check` emitted the environment isolation warning for remote Supabase usage. To preserve the no-customer-impact and no-unsafe-mutation rules, this pass did not run destructive or high-volume billing writes from localhost.

## Workloads Required

| Workload | Required shape | Executed in this pass | Result |
|---|---:|---:|---|
| 10K concurrent deductions | 10,000 HOLD/CONFIRM flows across many orgs | No | Blocked pending staging runner |
| Queue replay storm | 10,000 duplicate execution hashes | No | Blocked pending staging runner |
| Reservation churn stress | HOLD/RELEASE cycles at sustained concurrency | No | Blocked pending staging runner |
| AI completion concurrency saturation | Enforced `runBilledAiCompletion()` canary traffic | No | Blocked pending canary orgs |
| Invoice aggregation scale run | 10K org invoice projection | No | Blocked pending staging dataset |
| Reconciliation under heavy write load | Concurrent writes plus reconciliation jobs | No | Blocked pending staging runner |
| Approval workflow contention | Parallel signatures/execution attempts | No | Blocked pending staging runner |
| Cross-org billing contention | Same-org and cross-org lock comparison | No | Blocked pending staging runner |

## Metrics Captured

| Metric | Captured | Actual |
|---|---|---|
| p50/p95/p99 latency | Partial | Static guard only; no staging write latency |
| DB lock contention | No | Requires real staging workload |
| Reconciliation duration | No | Requires staging DB run |
| Replay suppression rate | No | Requires duplicate-key workload |
| Reservation leak rate | No | Requires churn workload |
| Failed settlement percent | No | Requires canary traffic |
| Duplicate prevention hit percent | No | Requires replay storm |
| Queue throughput | No | Requires queue runner |
| Orchestrator saturation | No | Requires concurrent workload |
| RPC failure rate | No | Requires staging RPC calls |

## Infra Sizing

Not certified in this pass. The production-safe recommendation remains to run the suite against a staging database with production-like schema, at least one worker pool, and isolated canary organizations before enabling platform-wide billing enforcement.

## Bottlenecks

Previously identified likely bottlenecks remain:

| Bottleneck | Evidence | GA impact |
|---|---|---|
| Per-org `organization_credits` row lock | Ledger RPC serializes same-org writes by design | Requires concurrency limit per org |
| `orphanUsageReconciliationJob` O(N) usage scan | Existing implementation checks each usage event individually | Monitor under large AI volume |
| Full-portfolio reconciliation linear scan | `reconcileAll()` scans orgs one at a time | Acceptable only for current portfolio size |

## Threshold Breaches

No live thresholds were measured. This is a certification blocker, not a pass.

## Production-Safe Concurrency Recommendations

Until the live suite is run:

| Surface | Temporary production-safe limit |
|---|---:|
| Same-org billable operations | 25 concurrent operations per org |
| Cross-org billable operations | 500 concurrent operations platform-wide |
| Queue replay processing | 100 duplicate retries per minute per queue |
| Invoice projection | 100 orgs per batch |
| Reconciliation scan | 1,000 orgs per run |
| AI billing canary | Internal/staging orgs only |

## Tuning Recommendations

1. Run the full staging suite before GA flag flip.
2. Keep `BILLING_REQUIRE_AI_HANDLE` scoped through canary org feature flags until orphan usage is zero.
3. Keep localhost mutation guards active.
4. Add a staging-only load runner before revisiting global production enablement.

## Certification Verdict

**FAIL / NOT CERTIFIED FOR GA.** The code path is prepared, but live staging load proof has not been produced in this environment.
