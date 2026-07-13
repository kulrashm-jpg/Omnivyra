/**
 * repairFramework.ts — reusable repair intelligence (PMF-002 §6).
 *
 * Delegates to the engine's existing deterministic repair intelligence: the repair
 * TRIGGER (score thresholds → needs-repair) and the adaptive recovery budget /
 * regeneration strategy (max repairs/retries, escalation, early-stop). The repair
 * LOOP itself (regenerating sections via LLM) is inference-orchestration and stays
 * in the engine — this framework provides the reusable decision logic any future
 * capability can reuse.
 */

export { scoreNeedsRepair } from '../../../lib/content/longFormSeoIntelligence';        // repair trigger
export { computeAdaptiveRecoveryBudget } from '../longForm/adaptiveRecoveryBudget';     // regeneration strategy / retry & fallback budget
