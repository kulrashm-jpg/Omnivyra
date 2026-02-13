# Campaign Engine Governance Specification

**Version:** 1.0  
**Status:** Frozen Behavioral Contract  
**Last Updated:** 2026-02-14

## 1. Purpose

This document defines the authoritative behavioral contract of the Campaign Engine.

It governs:

- Duration evaluation
- Portfolio concurrency constraints
- Baseline conditioning
- Trade-off generation
- Priority-based governance
- Blueprint lifecycle integrity

This document must be updated before any logic-level changes are made to:

- HorizonConstraintEvaluator
- PortfolioConstraintEvaluator
- TradeOffGenerator
- CampaignPrePlanningService
- campaignBlueprintService

**No implementation changes may contradict this specification.**

## 2. System Architecture Overview

The Campaign Engine operates in layered evaluation stages:

| Stage | Name | Description |
|-------|------|-------------|
| Stage 1 | Baseline Conditioning | Adjusts pacing and intensity based on baseline strength. Does NOT cap duration. |
| Stage 2 | Duration Constraints (Stage 5A) | Content inventory, production capacity, budget limits, campaign-type minimum duration floor |
| Stage 3 | Portfolio Constraints (Stage 5B) | Overlapping campaigns, team capacity availability, parallel campaign limits |
| Stage 4 | Timeline Shift (Stage 7) | Calculates earliest viable start date if portfolio conflict exists |
| Stage 5 | Trade-Off Engine (Stage 6) | Generates structured alternatives when constraints limit duration |
| Stage 6 | Governance Layer (Stage 8) | Priority awareness, preemption suggestions, deterministic trade-off ranking |

## 3. Constraint Evaluation Order (Frozen)

The evaluation order is strictly:

1. Inventory constraint
2. Production capacity constraint
3. Budget constraint
4. Campaign-type minimum duration
5. Portfolio concurrency constraint
6. Timeline shift suggestion
7. Priority-based governance
8. Trade-off ranking

**This order must not change without updating this document.**

## 4. Status Definitions

### APPROVED

- Campaign can proceed as requested.
- No structural violation exists.

### NEGOTIATE

- Campaign can proceed only if:
  - Duration adjusted
  - Frequency reduced
  - Capacity increased
  - Start date shifted
- Structural viability exists with adjustment.

### REJECTED

- Campaign cannot proceed under current constraints.
- Occurs when:
  - `max_weeks_allowed <= 0`
  - Blocking constraint present
  - Portfolio capacity completely exhausted
- **REJECTED may still include trade-off suggestions.**

## 5. Trade-Off Types

The system may return:

- **SHIFT_START_DATE**
- **PREEMPT_LOWER_PRIORITY_CAMPAIGN**
- **REDUCE_FREQUENCY**
- **EXTEND_DURATION**
- **INCREASE_CAPACITY**

Trade-offs are **advisory only**. They do not automatically execute.

## 6. Trade-Off Ranking Order (Frozen)

### NORMAL Priority

1. SHIFT_START_DATE
2. PREEMPT_LOWER_PRIORITY_CAMPAIGN
3. REDUCE_FREQUENCY
4. EXTEND_DURATION
5. INCREASE_CAPACITY

### HIGH / CRITICAL Priority

1. PREEMPT_LOWER_PRIORITY_CAMPAIGN
2. SHIFT_START_DATE
3. REDUCE_FREQUENCY
4. EXTEND_DURATION
5. INCREASE_CAPACITY

This ranking is **deterministic** and must remain stable.

## 7. Priority Levels

Campaign `priority_level` values:

- **LOW**
- **NORMAL** (default)
- **HIGH**
- **CRITICAL**

Rules:

- HIGH and CRITICAL may trigger preemption suggestions.
- LOW never triggers preemption suggestions.
- Equal priority campaigns cannot preempt each other.
- Preemption is **advisory only**.

## 8. Blueprint Lifecycle Rules

- **Blueprint is atomic.**

| Change | Effect |
|--------|--------|
| Duration Change | Invalidates blueprint. Sets `blueprint_status = INVALIDATED`. Requires regeneration. |
| Start Date Change | Does NOT invalidate blueprint. |
| Frequency Change | Requires regeneration. |

**Blueprint Status Values:** ACTIVE | INVALIDATED | REGENERATING

Scheduler and downstream consumers must require **ACTIVE** blueprint.

## 9. Non-Negotiable Invariants

The following must **never** be violated:

1. Baseline classification logic must remain independent of duration caps.
2. Duration evaluation math must remain deterministic.
3. Portfolio simulation must not use scheduler logic.
4. Trade-offs must not auto-apply.
5. Blueprint generation must not bypass constraint evaluation.
6. Test coverage must remain complete.

## 10. Regression Guard

Before merging any changes to:

- HorizonConstraintEvaluator
- PortfolioConstraintEvaluator
- TradeOffGenerator
- CampaignPrePlanningService

The following test suites **must** pass:

- `campaign_duration_constraints.test.ts`
- `campaign_portfolio_constraints.test.ts`
- `campaign_tradeoff_engine.test.ts`
- `campaign_start_date_shift.test.ts`
- `campaign_priority_preemption.test.ts`

## 11. Future Extension Protocol

Any new constraint layer must:

1. Define evaluation order position.
2. Define status impact.
3. Define trade-off type (if applicable).
4. Define interaction with priority layer.
5. **Update this governance document.**

**No silent logic drift allowed.**

---

*End of Specification*
