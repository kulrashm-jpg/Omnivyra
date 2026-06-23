# CUSTOMER_OPERATIONS_DUPLICATION_AUDIT.md

Phase 13J · Phase 5 — duplicate read/calculation inventory. **Audit only — no refactoring.**
Classification: **SAFE_TO_CONSOLIDATE** (mechanical, low risk) · **REQUIRES_REVIEW**
(different projections/semantics) · **DO_NOT_TOUCH** (intentional / correctness-critical).

| Duplication | Sites | Reads/load | Classification | Rationale |
|---|---|---|---|---|
| `customer_readiness_snapshots` | `loadReadinessHistory` + `loadOutcomeSnapshots` (×2: outcomes & attribution) | 3 | **SAFE_TO_CONSOLIDATE** | same table; outcome loader's columns ⊇ history loader's; one shared load could feed all three |
| Duplicate loader logic | `loadReadinessHistory` vs `loadOutcomeSnapshots` | — | **SAFE_TO_CONSOLIDATE** | near-identical projection; one canonical snapshot loader + adapters |
| `companies` | Readiness + `loadIdentity` + Acquisition count | 3 | **REQUIRES_REVIEW** | Readiness selects different columns than identity/count; readiness is the SPOF — reuse must not couple identity to readiness internals |
| `company_profiles` | Signal Confidence + Acquisition + Readiness | 2–3 | **REQUIRES_REVIEW** | different projections (`last_refined_at` vs `overall_confidence` count vs profile object) and filters; merge needs care |
| `signup_referrals` | Signup funnel + Acquisition | 2 | **SAFE_TO_CONSOLIDATE** | identical read; trivially shareable |
| `domain_eligibility_cache` | Signup funnel + Acquisition | 2 | **SAFE_TO_CONSOLIDATE** | identical read |
| `domain_events` | Signup funnel + Acquisition | 2 | **SAFE_TO_CONSOLIDATE** | identical read |
| active/company **counts** | Readiness + Acquisition (cockpit passes `tenants.length`) | — | **SAFE_TO_CONSOLIDATE** | already partly shared (cockpit forwards counts); funnel still re-counts companies |
| Snapshot **write** (daily job) | `customerReadinessSnapshotService.upsertDaily` | n/a | **DO_NOT_TOUCH** | not a read-path dup; authorized idempotent job (13B) |
| Readiness internal queries | `customerReadinessService` | ~9 | **DO_NOT_TOUCH** | core hub; well-tested; changing risks every downstream engine |

## Summary

- **SAFE_TO_CONSOLIDATE (6):** snapshot reads/loader, referrals, eligibility, events,
  counts — mechanical wins if a future optimization phase is authorized.
- **REQUIRES_REVIEW (2):** companies + profiles — shared table, divergent projections;
  consolidation must preserve each consumer's columns/filters.
- **DO_NOT_TOUCH (2):** the snapshot writer and readiness internals.

No remediation performed; this is the change-map for a future (separately authorized)
optimization pass.
