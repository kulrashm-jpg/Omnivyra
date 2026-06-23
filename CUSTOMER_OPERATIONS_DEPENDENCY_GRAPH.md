# CUSTOMER_OPERATIONS_DEPENDENCY_GRAPH.md

Phase 13I · Phase 2 — dependency graph + structural risks. **Audit only.**

## Graph (sources → engines → cockpit)

```
SOURCE TABLES
  companies, users, company_profiles, company_domains, analytics_integrations,
  social_accounts, user_company_roles, organization_plan_assignments,
  organization_credits, signup_intents, signup_referrals,
  domain_eligibility_cache, domain_events, customer_readiness_snapshots
        │
        ▼
  ┌─────────────┐
  │  READINESS  │ ◄── central hub (every engine reads its output)
  └─────────────┘
        ├──► Opportunity ──► Priority ─────────────┐
        ├──► Executive Insights                    │
        ├──► Signal Confidence ───────────────────┐│
        │                                         ││
  customer_readiness_snapshots (written by Snapshots job)
        ├──► Evolution                            ││
        ├──► Outcomes ────────────────────────────┼┤
        └──► Impact Attribution                   ││
                                                  ▼▼
                                          ┌──────────────┐
   Acquisition (own sources) ───────────► │   PLAYBOOKS  │ (gated by Signal Confidence,
                                          └──────────────┘  Priority, Outcome)
        │                                         │
        ▼                                         ▼
  Telemetry Completeness (static)        COCKPIT → API → Command Center UI
```

## Single points of failure

1. **`getCustomerReadiness`** — every engine consumes its `tenants` output. A failure or
   empty result blanks the entire cockpit. Highest-criticality SPOF.
2. **`customer_readiness_snapshots`** — bounds Evolution, Outcomes, **and** Attribution
   (3 engines). Currently Day-1 only → all three temporal-PARTIAL.
3. **`supabase` client** — single DB seam for every loader.

## Circular dependencies

**None.** The graph is a clean DAG: sources → readiness → derived → snapshots-derived →
playbooks → cockpit → telemetry. Playbooks depend only on upstream engines.

## Hidden dependencies

- **Playbooks ← Signal Confidence** — suppression is driven by per-area confidence; not
  obvious from the playbook name. (Documented in 13G.)
- **Playbooks ← Acquisition** — `acquisition_evidence_complete` is wired in the cockpit and
  feeds a suppression predicate.
- **Evolution ← wall-clock** — the cockpit synthesizes a "current" snapshot via
  `new Date().toISOString()` (`snapshotFromCurrent`), coupling evolution to request time.

## Duplicate calculations / queries (read-only finding)

| Resource | Reads per page load | Sites |
|---|---|---|
| `customer_readiness_snapshots` | **3×** | Evolution `loadReadinessHistory` + Outcomes `loadOutcomeSnapshots` + Attribution (reuses `loadOutcomeSnapshots`) |
| `companies` | **3×** | Readiness + Cockpit `loadIdentity` + Acquisition counts |
| `company_profiles` | **2×** | Signal Confidence + Acquisition (+ Readiness) |
| `signup_referrals` | **2×** | Signup funnel + Acquisition |
| `domain_eligibility_cache` / `domain_events` | **2× each** | Signup funnel + Acquisition |

- **Duplicate loader logic:** `loadReadinessHistory` (Evolution) and `loadOutcomeSnapshots`
  (Outcomes/Attribution) both read `customer_readiness_snapshots` with overlapping columns
  → the snapshot table is loaded 3× with near-identical projections.
- Active-customer + company counts are recomputed in both Readiness and Acquisition.
