# CUSTOMER_ONLY_BASELINE.md

Phase 16C · Phase 1 — clean CUSTOMER-only baseline (QA/TEST/INTERNAL excluded via the
persisted `customer_population_classification`). Live production.

## Baseline counts (n = 5 real customers)

| Metric | Count | % |
|---|---|---|
| customer_count | 5 | 100% |
| active_count | 3 | 60% |
| adopted_count (≥1 area ready) | 2 | 40% |
| executing_count | 1 | 20% |
| value_count | 1 | 20% |
| revenue_count | **0** | **0%** |

## Complete customer journey table (Phase 2)

| Customer | Created | Status | Score | Profile | Domain | GA | GSC | Social | Team | Billing | Exec | Value | Revenue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Infitoo Systems llp | 06-20 | ACTIVE | 14 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | 0 | — | 0 |
| Afrost | 06-13 | ACTIVE | 14 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | 0 | — | 0 |
| Embrosales | 05-10 | DORMANT | 14 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | 0 | — | 0 |
| Unfinished Innovations LLP | 05-09 | ACTIVE | 43 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | 17 | ✓ | 0 |
| Drishiq | 04-28 | DORMANT | 29 | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | 0 | — | 0 |

## Milestone completion (% of customers missing)

| Milestone | Missing |
|---|---|
| BILLING | **0%** (all paid) |
| ACTIVATION | 40% |
| PROFILE | 60% |
| SOCIAL | 80% |
| EXECUTION | 80% |
| VALUE | 80% |
| **DOMAIN** | **100%** |
| **GA** | **100%** |
| **GSC** | **100%** |
| **TEAM** | **100%** |
| **REVENUE** | **100%** |

## The shape

**All 5 customers pay — then the journey collapses at onboarding setup.** Domain, GA, GSC,
and team are **0/5** (universally unstarted); only 2 complete a profile; only 1 executes; none
generate (recorded) revenue.
