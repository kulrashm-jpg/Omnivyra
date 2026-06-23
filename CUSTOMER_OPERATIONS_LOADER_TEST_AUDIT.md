# CUSTOMER_OPERATIONS_LOADER_TEST_AUDIT.md

Phase 13J · Phase 1 — loader test coverage after adding integration tests
([customerOperationsIntegration.test.ts](backend/tests/unit/customerOperationsIntegration.test.ts)).
A filter-honoring in-memory `supabase` mock exercises each loader's real column mapping.

| Loader | Owner | Status | Evidence |
|---|---|---|---|
| `loadReadinessHistory` | customerEvolutionService | **TESTED** | scopes by `company_id` (`.in`), maps area columns; b excluded |
| `loadOutcomeSnapshots` | customerOutcomeIntelligenceService | **TESTED** | returns ordered snapshots/company; `areas` populated |
| `loadSignalObservations` | customerSignalConfidenceService | **TESTED** | GA4 provider split; prefers `last_live_check_at`; WEBSITE/PROFILE timestamps mapped |
| `loadAcquisitionInputs` | customerAcquisitionIntelligenceService | **TESTED** | completed-vs-pending via honored `.eq`; eligibility success excluded |
| `loadSignupFunnel` | customerOperationsCockpitService | **TESTED** | 6-bucket aggregation incl. CLAIMED_DOMAIN |
| `loadIdentity` | customerOperationsCockpitService (internal, not exported) | **PARTIALLY_TESTED** | exercised only via the `getCustomerOperations` orchestrator test (identity_health attached); no direct unit test |

**Summary:** 5 of 6 loaders **TESTED** directly; `loadIdentity` **PARTIALLY_TESTED**
(covered transitively, not exported for direct testing). 0 **UNTESTED**.

The mock honors `.eq` / `.in` / `.gte` filters and records write spies, so the tests
verify real projection/mapping logic — the exact gap flagged in 13I.
