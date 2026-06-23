# CUSTOMER_OPERATIONS_COMPONENT_INVENTORY.md

Phase 13I · Phase 1 — inventory of every engine in the Customer Operations platform
(12A–13H). **Audit only.**

| Engine | Owner service | Inputs | Outputs | Dependencies | Consumers |
|---|---|---|---|---|---|
| **Readiness** | `customerReadinessService` | companies, users, company_profiles, company_domains, analytics_integrations, social_accounts, user_company_roles, billing tables; `deps.now` | per-company readiness (8 areas, score, bucket, tenant_status) | source tables | ALL downstream engines |
| **Opportunity Detection** | `customerOpportunityService` | readiness | per-company opportunities + summary | Readiness | Priority, Insights, Cockpit |
| **Priority** | `customerOpportunityPriorityService` | readiness + opportunities; `now` | ranked tiers + distribution | Readiness, Opportunity | Playbooks, Cockpit |
| **Executive Insights** | `customerExecutiveInsightService` | readiness | per-company insight + portfolio | Readiness | Cockpit |
| **Evolution** | `customerEvolutionService` | snapshot history + current | trajectory + portfolio | Snapshots | Cockpit |
| **Snapshots** | `customerReadinessSnapshotService` | readiness | `customer_readiness_snapshots` rows (**only writer**, via daily job) | Readiness | Evolution, Outcomes, Attribution |
| **Outcomes** | `customerOutcomeIntelligenceService` | snapshots | per-company outcome + portfolio + exec summary | Snapshots | Cockpit, Playbooks (suppression) |
| **Impact Attribution** | `customerImpactAttributionService` | snapshots (area-flips) | attribution candidates + portfolio | Snapshots (reuses `loadOutcomeSnapshots`) | Cockpit |
| **Signal Confidence** | `customerSignalConfidenceService` | source-table timestamps; `deps.now` | per-area confidence/freshness + portfolio + propagation | source tables | Playbooks (suppression), Cockpit |
| **Acquisition Intelligence** | `customerAcquisitionIntelligenceService` | signup_intents, companies, company_profiles, signup_referrals, domain_eligibility_cache, domain_events | funnel + conversions + loss reasons | source tables + cockpit counts | Cockpit, Playbooks (evidence flag) |
| **Action Playbooks** | `customerActionPlaybookService` | readiness areas + signal confidence + priority + outcome + acquisition flag | recommended + suppressed playbooks + portfolio | Readiness, SignalConfidence, Priority, Outcome | Cockpit |
| **Telemetry Completeness** | `customerTelemetryCoverageService` | static catalog (audit constants) | coverage % + gaps + blind spots | (none — structural) | Cockpit |
| **Cockpit (composition)** | `customerOperationsCockpitService` | all of the above | unified `CockpitResult` | every engine | API + UI |

**Note:** `customerOperationsService.ts` (enterprise scoring) is a pre-existing, unrelated
service — **not part of this platform**; the cockpit lives in
`customerOperationsCockpitService.ts`.
