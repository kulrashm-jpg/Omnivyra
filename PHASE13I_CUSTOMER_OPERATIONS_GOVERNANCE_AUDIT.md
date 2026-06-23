# PHASE13I_CUSTOMER_OPERATIONS_GOVERNANCE_AUDIT.md

Phase 13I — full governance audit of the Customer Operations platform (12A–12H, 13A–13H).
**Audit only — no feature work, remediation, automation, notifications, recommendations,
customer-facing changes, writes, or schema changes.** Findings grounded in the actual code,
not memory.

## Deliverables
1. [CUSTOMER_OPERATIONS_COMPONENT_INVENTORY.md](CUSTOMER_OPERATIONS_COMPONENT_INVENTORY.md) (Phase 1)
2. [CUSTOMER_OPERATIONS_DEPENDENCY_GRAPH.md](CUSTOMER_OPERATIONS_DEPENDENCY_GRAPH.md) (Phase 2)
3. This report (Phases 3–8)

## Architecture summary

12 engines + 1 composition layer, all read-only and capability-gated
(`SUPER_ADMIN_DASHBOARD_VIEW`). Pattern is uniform: **pure compute function + injectable
loader** per engine, composed by `customerOperationsCockpitService` into one
`CockpitResult` served by `GET /api/super-admin/customer-operations` and rendered by
`pages/super-admin/customer-operations.tsx`. 153 unit tests, `tsc` clean.

## Dependency graph summary

Clean **DAG**, no cycles. `Readiness` is the central hub (every engine consumes it);
`customer_readiness_snapshots` bounds Evolution/Outcomes/Attribution. Detail + SPOFs in the
dependency-graph doc.

## Determinism status (Phase 3)

Verified: **zero `Math.random`** anywhere. Time usage is confined to four services, all
**injectable** (`deps.now` / `now` param):

| Engine | Class | Note |
|---|---|---|
| Opportunity, Executive Insights, Evolution (compute), Outcomes, Attribution, Playbooks, Telemetry, Snapshot row-build | **DETERMINISTIC** | pure; stable ordering; fixed tie-breaks (id/localeCompare) |
| Readiness | **PARTIALLY_DETERMINISTIC** | lifecycle recency (DORMANT/INACTIVE, active_30d) uses `deps.now ?? Date.now()` |
| Priority | **PARTIALLY_DETERMINISTIC** | age-momentum uses `now = Date.now()` default |
| Signal Confidence | **PARTIALLY_DETERMINISTIC** | freshness bands vs `deps.now` — temporal **by design** |
| Cockpit composition | **PARTIALLY_DETERMINISTIC** | synthesizes "current" snapshot via `new Date()` for Evolution |
| — | **NON_DETERMINISTIC** | **none** |

All PARTIALLY_DETERMINISTIC engines are deterministic given a fixed clock and are tested
with injected time. Tie-breaks everywhere are explicit (`company_id` / `playbook_id` /
area `localeCompare`). Stable ordering confirmed in every ranker.

## Governance status (Phase 4)

| Requirement | Status |
|---|---|
| Read-only (cockpit path) | ✅ **0 write ops** in the read path (grep-verified) |
| Admin-only | ✅ `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` on the API |
| No customer delivery | ✅ none |
| No notification generation | ✅ none |
| No recommendation execution | ✅ Playbooks are visibility-only (no buttons/execution) |
| No automation | ✅ snapshot cron documented but **not wired** |
| No mutation | ✅ only writers: `customerReadinessSnapshotService.upsertDaily` (13B daily job, idempotent, **off the read path**) and the **pre-existing unrelated** `customerOperationsService` enterprise scorer (not this platform) |

**Violations: none.** The only platform write is the authorized, isolated daily snapshot
upsert; the cockpit/API/UI never write.

## Technical debt inventory (Phase 5 — not remediated)

1. **Duplicate snapshot reads** — `customer_readiness_snapshots` loaded **3×** per request
   (Evolution `loadReadinessHistory`, Outcomes `loadOutcomeSnapshots`, Attribution reusing
   it). Could be one shared load.
2. **Duplicate loader logic** — `loadReadinessHistory` vs `loadOutcomeSnapshots` read the
   same table with overlapping projections.
3. **Duplicate source reads** — `companies` 3×, `company_profiles` 2×, `signup_referrals`
   2×, `domain_eligibility_cache`/`domain_events` 2× each (signup-funnel vs acquisition).
4. **Recomputed counts** — active/company counts derived in both Readiness and Acquisition.
5. **Naming collision risk** — `customerOperationsService.ts` (enterprise) vs
   `customerOperationsCockpitService.ts` (this platform) — easy to confuse; documented.
6. **No stale/dead code found** in the platform engines; no unused exported models detected
   in the read path. UI sections all bound to live result fields.

## Test coverage assessment (Phase 6)

- **Unit tests: strong.** 13 files, **153 tests** — every engine's pure logic covered
  (classification, ranking, suppression, math, determinism).
- **Integration tests: absent.** Gaps:
  - **All DB loaders are untested** (`loadOutcomeSnapshots`, `loadSignalObservations`,
    `loadAcquisitionInputs`, `loadIdentity`, `loadSignupFunnel`, `loadReadinessHistory`) —
    tests inject fake data, so per-table column mapping (e.g. GA4/GSC provider split,
    timestamp extraction) is unverified by automation.
  - **`getCustomerOperations` orchestrator has no end-to-end test** — only the pure pieces
    (`aggregateSignupFunnel`, `applyCockpitFilters`) are unit-tested; full composition is
    verified only by manual live runs.
  - **No test asserts the read-path remains write-free** beyond the cockpit/API source
    grep contract; the engine loaders aren't contract-tested.
- **Critical untested paths:** the snapshot → outcome/attribution chain against real schema
  (mitigated: snapshot writer has 6 tests + live verification in 13B–13D).

## Performance observations (Phase 7 — no optimization)

- **Sequential composition** — `getCustomerOperations` awaits **7 engine loaders in series**
  (no `Promise.all`); page latency ≈ sum of all queries, not max.
- **~25–30 DB round-trips per page load**, several duplicated (see debt #1–3). Fine at
  n=38; grows linearly with tenants.
- **No pagination / no caching** — full recompute per request (telemetry catalog is static
  but cheap).
- **Filters applied twice** — server-side (API) and client-side (page) — minor redundancy.
- **Drawer is free** — reuses the already-loaded company object, no extra fetch (good).

## Final maturity assessment

| Dimension | Rating | Basis |
|---|---|---|
| Architecture | **Mature** | clean DAG, uniform pattern, no cycles |
| Determinism | **Mature** | no randomness; time injectable; explicit tie-breaks |
| Governance | **Mature** | read-only, admin-gated, zero read-path writes |
| Unit testing | **Mature** | 153 tests, every engine |
| Integration testing | **Immature** | loaders + orchestrator untested; no E2E |
| Performance | **Adequate-for-scale** | sequential + duplicate queries; fine at current size, not yet optimized |
| Tech debt | **Low-moderate** | duplicate queries/loaders; no dead code |

**Overall: production-ready for its read-only, admin-only purpose at current scale, with a
clear, bounded debt list** (consolidate snapshot/source loaders, parallelize composition,
add loader + orchestrator integration tests) — none of which is remediated here.

## Constraints honored
Audit only ✅ · no feature work ✅ · no remediation ✅ · no automation ✅ · no notifications ✅ ·
no recommendations ✅ · no customer-facing changes ✅ · no writes ✅ · no schema changes ✅.

Stopped after report.
