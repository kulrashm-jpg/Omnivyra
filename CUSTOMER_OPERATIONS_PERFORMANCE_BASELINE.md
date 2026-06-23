# CUSTOMER_OPERATIONS_PERFORMANCE_BASELINE.md

Phase 13J · Phase 4 — performance baseline for one `GET /api/super-admin/customer-operations`
load. **Measurement only — no optimization.** Counts derived from the actual code (grep +
loader inspection).

## Composition stages (sequential, no `Promise.all`)

| # | Stage | DB queries | Notes |
|---|---|---|---|
| 1 | `getCustomerReadiness` | ~9 | heaviest; central hub |
| 2 | Opportunity / Priority / Insights | 0 | pure, on readiness output |
| 3 | `loadReadinessHistory` | 1 | `customer_readiness_snapshots` |
| 4 | `loadIdentity` | 1 | `companies` |
| 5 | `loadSignupFunnel` | 4 | eligibility, events, referrals, companies-count |
| 6 | `getCustomerOutcomes` → `loadOutcomeSnapshots` | 1 | `customer_readiness_snapshots` (**dup**) |
| 7 | `getCustomerImpactAttribution` → `loadOutcomeSnapshots` | 1 | `customer_readiness_snapshots` (**dup**) |
| 8 | `getCustomerSignalConfidence` → `loadSignalObservations` | 5 | domains, analytics, social, profiles, roles |
| 9 | `getCustomerAcquisitionIntelligence` → `loadAcquisitionInputs` | ~7 | intents×2, profiles×2, referrals, eligibility, events |
| 10 | Playbooks / Telemetry / portfolio assembly | 0 | pure |

## Baseline metrics

| Metric | Value |
|---|---|
| **Total DB round-trips** | **~29** per page load |
| **Sequential dependency stages** | **7+ awaited** engine calls (no parallelism) |
| **Duplicate queries** | snapshots ×3 · companies ×3 · company_profiles ×2 · signup_referrals ×2 · domain_eligibility_cache ×2 · domain_events ×2 |
| **Pure (no-query) stages** | opportunity, priority, insights, playbooks, telemetry |
| **Largest contributors** | Readiness (~9) · Acquisition (~7) · Signal Confidence (5) · Signup funnel (4) |

## Observations (no action taken)

- Latency ≈ **sum** of all stage queries (sequential), not the max. At n=38 this is small;
  it grows **linearly** with tenant count and query count.
- ~10 of ~29 round-trips are **duplicates** (same table re-read by a different engine) —
  see the duplication audit.
- No pagination, no caching, no memoization — every request recomputes the full platform
  (the pure stages are cheap; the cost is the DB round-trips).
- The drawer adds **0** queries (reuses the loaded row).

This baseline is the reference point for any future optimization (out of scope here).
