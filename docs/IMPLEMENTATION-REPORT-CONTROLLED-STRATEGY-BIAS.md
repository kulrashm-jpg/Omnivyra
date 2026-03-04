# IMPLEMENTATION REPORT — CONTROLLED STRATEGY BIAS

## 1. Files Modified

- **Created:** `backend/services/strategyBiasService.ts`
- **Created:** `pages/api/community-ai/strategy-bias.ts`
- **Modified:** `backend/services/campaignAiOrchestrator.ts` (import, buildPromptContext input, userPayload.strategy_bias, runWithContext fetch and pass-through)
- **Created:** `docs/IMPLEMENTATION-REPORT-CONTROLLED-STRATEGY-BIAS.md`

## 2. Bias Logic

- **Base weight:** 0.1.
- **Adjustments (additive, then clamp):**
  - Drift severity **HIGH** → +0.4
  - Drift severity **MEDIUM** → +0.2
  - Intelligence level **HIGH** → +0.2
  - high_priority_actions **≥ 5** → +0.2
- **Clamp:** Result clamped to [0.1, 1.0] (two decimal places).
- **Inputs:** `detectStrategicDrift(campaign_id)`, `getWeeklyStrategyIntelligence(campaign_id)`, `getStrategyAwareness(campaign_id)`. All three are loaded; drift and intelligence drive the deltas; awareness is included in `bias_reasoning` (awareness level) for transparency only.

## 3. Bias Level Rules

- **LOW:** bias_weight **< 0.3**
- **MODERATE:** bias_weight **≥ 0.3** and **≤ 0.6**
- **HIGH:** bias_weight **> 0.6**

## 4. Planner Injection Point

- **Where:** `campaignAiOrchestrator.ts`, inside `runWithContext`, immediately after the existing `weeklyStrategyIntelligence` fetch and before `buildPromptContext(...)`.
- **What:** `strategy_bias = await computeStrategyBias(input.campaignId)` in try/catch (failure does not fail plan generation). Result passed into `buildPromptContext` as `strategy_bias`. In `buildPromptContext`, when `input.strategy_bias` is set, it is assigned to `userPayload.strategy_bias`.
- **Usage:** The value is **not** read in any prompt text, system message, or decision branch. It is only attached to the context payload that is sent to the AI. No prompt mutation, no decision-tree change — silent attachment only.

## 5. Data Flow After Change

```text
runWithContext (plan generation)
  → getWeeklyStrategyIntelligence(campaignId)
  → computeStrategyBias(campaignId)
       → detectStrategicDrift, getWeeklyStrategyIntelligence, getStrategyAwareness
       → base 0.1 + drift/intelligence/priority deltas → clamp → bias_level
  → buildPromptContext(…, strategy_bias)
       → userPayload.strategy_bias = input.strategy_bias
  → prompt.messages (unchanged; strategy_bias is in userPayload but not used in message content)

GET /api/community-ai/strategy-bias?campaign_id=…
  → requireCampaignAccess → computeStrategyBias(campaignId)
  → { success: true, bias: { bias_weight, bias_level, bias_reasoning } }
```

## 6. Safety Guarantees

- **No planner logic change:** No conditionals or branching in the orchestrator use `strategy_bias`; plan generation and validation flow are unchanged.
- **No prompt mutation:** No string concatenation or template uses `strategy_bias`; system/user messages are unchanged.
- **No AI behavior change:** Model input (messages) is unchanged; only the JSON context object carries an extra key.
- **No automatic strategy mutation:** No code path writes or updates strategy, blueprint, or plan based on bias.
- **Advisory only:** Bias is computed and attached for possible future use; current behavior is zero behavioral mutation.

## 7. Verification Notes

- **Bias increases with drift and pressure:** HIGH drift (+0.4), MEDIUM drift (+0.2), HIGH intelligence (+0.2), and high_priority_actions ≥ 5 (+0.2) all increase weight; combined they can reach 1.0 (capped).
- **Stable scenarios stay low:** No drift (severity LOW), LOW intelligence, and fewer than 5 high-priority actions yield weight 0.1 (base only), bias_level LOW.
- **Planner behavior unchanged:** No references to `strategy_bias` in prompt building or decision logic; only attachment to `userPayload.strategy_bias` in the same way as `weekly_strategy_intelligence`.
