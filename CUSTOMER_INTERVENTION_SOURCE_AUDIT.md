# CUSTOMER_INTERVENTION_SOURCE_AUDIT.md

Phase 15A · Phase 1 — every intelligence source that could trigger an intervention.
**Audit only. No assumptions.**

| Source | Owner | Freshness | Confidence | False-positive risk | False-negative risk | Intervention suitability |
|---|---|---|---|---|---|---|
| Readiness (12A/C) | customerReadinessService | live | HIGH | Low | Low | **HIGH** — area gaps are direct triggers |
| Opportunity (12D) | customerOpportunityService | live | HIGH | Low | Low | MEDIUM — derived from readiness |
| Priority (12E) | customerOpportunityPriorityService | live | HIGH (heuristic weights) | Med | Low | MEDIUM — ranking, not a trigger |
| Executive Insight (12F) | customerExecutiveInsightService | live | HIGH | Low | Med | LOW — narrative only |
| Evolution (12G/H) | customerEvolutionService | **stale** (needs ≥2 snapshots) | LOW (day-1) | Med | High | LOW — not yet usable |
| Outcome (13C) | customerOutcomeIntelligenceService | stale (NO_HISTORY) | LOW | Med | High | LOW — not yet usable |
| Attribution (13D) | customerImpactAttributionService | stale | LOW | High | High | **UNSUITABLE** — co-observed, day-2 |
| Signal Confidence (13E) | customerSignalConfidenceService | live | HIGH | Low | Low | **HIGH (as a GATE, not a trigger)** |
| Acquisition (13F/14A) | customerAcquisitionIntelligenceService | live | MEDIUM | Med | High | LOW — unjoinable cohorts |
| Onboarding (14A) | onboardingConversionService | live | MEDIUM | Med | High | MEDIUM — early-stage gaps |
| Activation (14B) | customerActivationService | live | HIGH | Low | Med | **HIGH** — activation gaps |
| Profile Completion (14C) | profileCompletionIntelligenceService | live | HIGH (but confidence=0 ambiguity) | Med | Low | **HIGH** — profile gaps |
| Digital Adoption (14D) | digitalAdoptionService | live | MEDIUM (presence not data-flow) | Med | Low | **HIGH** — capability gaps |
| Value Realization (14E) | customerValueRealizationService | live | HIGH | Low | High (engagement blind) | MEDIUM — value gaps |
| Value Drivers (14F) | valueDriverIntelligenceService | live | LOW (tiny n) | High | High | LOW — association only |
| Execution Adoption (14G) | campaignExecutionAdoptionService | live | HIGH | Low | High | MEDIUM — depth gaps |
| Monetization (14H) | monetizationIntelligenceService | live | MEDIUM (revenue UNKNOWN) | Med | Med | LOW — no revenue signal |
| **Population Integrity (14I)** | customerPopulationIntegrityService | live | HIGH | Low | Low | **HIGH (as the TOP GATE)** — excludes non-customers |

## Findings

- The **trigger** sources fit for interventions are the live, high-confidence gap detectors:
  **Readiness, Activation, Profile Completion, Digital Adoption** (+ Value/Execution as
  secondary).
- The **gate** sources are **Signal Confidence (13E)** and **Population Integrity (14I)** —
  they don't trigger interventions, they *suppress* them.
- **Attribution, Value Drivers, Outcome, Evolution are UNSUITABLE as triggers** (stale,
  tiny-n, or association-only) — using them would risk false positives.
