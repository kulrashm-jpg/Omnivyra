# CUSTOMER_SUCCESS_OPERATING_MODEL.md

Phase 15B · Phase 2 — operational queues. **Visibility only; no execution.** A company may
belong to multiple queues. Non-customers (14I) are excluded from every queue.

## Queues

| Queue | Eligibility | Priority rule | Confidence requirement | Suppression |
|---|---|---|---|---|
| **ACTIVATION** | CUSTOMER, state = ACTIVATING, with an eligible activation intervention (profile/domain/activation-recovery) | priority_score desc | inherits governance (≥ MEDIUM signal) | non-customer; no eligible activation intervention |
| **ADOPTION** | CUSTOMER, state = ADOPTING, with an eligible adoption intervention (GA/GSC/social/team/adoption/profile/domain) | priority_score desc | governance | non-customer; no eligible adoption intervention |
| **VALUE** | CUSTOMER, state ∈ {ACTIVATING, ADOPTING}, `VALUE_REALIZATION` eligible (no value yet) | priority_score desc | governance | non-customer; has value; not eligible |
| **RETENTION** | CUSTOMER, state ∈ {AT_RISK, CHURNED} | priority_score desc | governance | non-customer |
| **EXPANSION** | CUSTOMER, state ∈ {VALUE_REALIZING, EXPANDING} | priority_score desc | governance | non-customer |
| **OBSERVATION** | CUSTOMER with no actionable queue (all interventions suppressed/no-gap) | priority_score desc | governance | non-customer |

Every CUSTOMER lands in ≥ 1 queue (OBSERVATION is the catch-all). State-based queues
(RETENTION/EXPANSION/ACTIVATION/ADOPTION) are mutually exclusive by state; **VALUE overlaps**
ADOPTION/ACTIVATION → the source of multi-queue membership.

## Executive attention model

`attention_score = priority_score + state_weight + value_weight + confidence_weight`, where
state_weight: AT_RISK 30 · ACTIVATING 20 · ADOPTING 15 · EXPANDING 12 · VALUE_REALIZING 10 ·
ONBOARDING 8 · CHURNED 5 · PROSPECT 3 · UNKNOWN 0; value_weight +5 if has value;
confidence_weight HIGH 5 / MEDIUM 2 / else 0. CUSTOMER only. Ranked desc → TOP_5 / TOP_10.

## Workload analysis

`companies_per_queue`, `overlap_between_queues` (customers in ≥ 2 queues), `suppressed_companies`
(non-customers), `customer_companies_without_actionable_queue` (OBSERVATION-only),
`customer_companies_with_multiple_queues`.

## Guarantees

Read-only, deterministic, no execution, no persistence. Governance (population integrity +
confidence + state) is enforced upstream and inherited; queues never re-admit a suppressed
company.
