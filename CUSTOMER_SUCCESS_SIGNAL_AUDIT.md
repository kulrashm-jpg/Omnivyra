# CUSTOMER_SUCCESS_SIGNAL_AUDIT.md

Phase 15B · Phase 1 — usable operational signals. **Audit only.** Operational value lens.

| Signal | Source | Confidence | Freshness | Actionability | Suppression impact | Operational value | Class |
|---|---|---|---|---|---|---|---|
| Readiness (12A/C) | customerReadinessService | HIGH | live | direct gaps | — | feeds all queues | **OPERATIONAL** |
| Priority (12E) | customerOpportunityPriorityService | HIGH | live | ranks queues | — | queue ordering + attention | **OPERATIONAL** |
| Activation (14B) | customerActivationService | HIGH | live | activation gaps | — | ACTIVATION queue | **OPERATIONAL** |
| Profile Completion (14C) | profileCompletionIntelligenceService | HIGH | live | profile gaps | — | ACTIVATION/ADOPTION | **OPERATIONAL** |
| Digital Adoption (14D) | digitalAdoptionService | MEDIUM | live | capability gaps | — | ADOPTION queue | **OPERATIONAL** |
| Value Realization (14E) | customerValueRealizationService | HIGH | live | value gaps | — | VALUE/EXPANSION | **OPERATIONAL** |
| Signal Confidence (13E) | customerSignalConfidenceService | HIGH | live | gate | suppresses low-conf | confidence gating | **OPERATIONAL (gate)** |
| Population Integrity (14I) | customerPopulationIntegrityService | HIGH | live | gate | excludes non-customers | top exclusion gate | **OPERATIONAL (gate)** |
| Intervention Governance (15A) | customerInterventionGovernanceService | HIGH | live | state + eligibility | enforces all suppression | queue assignment basis | **OPERATIONAL** |
| Opportunity (12D) | customerOpportunityService | HIGH | live | derived | — | context | INFORMATIONAL |
| Executive Insight (12F) | customerExecutiveInsightService | HIGH | live | narrative | — | drawer context | INFORMATIONAL |
| Execution Adoption (14G) | campaignExecutionAdoptionService | HIGH | live | depth | — | EXPANSION context | INFORMATIONAL |
| Monetization (14H) | monetizationIntelligenceService | MEDIUM | live | revenue UNKNOWN | — | context only | INFORMATIONAL |
| Onboarding (14A) | onboardingConversionService | MEDIUM | live | unjoinable cohorts | — | pre-company context | INFORMATIONAL |
| Acquisition (13F) | customerAcquisitionIntelligenceService | MEDIUM | live | pre-company | — | context | INFORMATIONAL |
| Evolution (12G/H) | customerEvolutionService | LOW | **stale** | — | — | — | **UNSUITABLE** (day-2) |
| Outcome (13C) | customerOutcomeIntelligenceService | LOW | stale | — | — | — | **UNSUITABLE** (day-2) |
| Attribution (13D) | customerImpactAttributionService | LOW | stale | — | — | — | **UNSUITABLE** |
| Value Drivers (14F) | valueDriverIntelligenceService | LOW | live | association-only | — | — | **UNSUITABLE** as a trigger |

## Findings

- **OPERATIONAL signals** drive queues: Readiness, Activation, Profile, Adoption, Value
  (triggers) + Signal Confidence and Population Integrity (gates) + Governance (assignment).
- **INFORMATIONAL signals** add drawer context but don't assign queues.
- **UNSUITABLE signals** (stale/association-only) are excluded from operations — consistent
  with the 15A source audit.
