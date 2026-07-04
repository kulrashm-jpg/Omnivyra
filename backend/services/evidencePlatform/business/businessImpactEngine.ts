/**
 * Business Impact, Opportunity & ROI Engine  (BETA-ENGINE-012, Phase 2/5)
 *
 * ONE reusable engine that turns Execution Plans into commercially-prioritized Business Impact artifacts,
 * quantifying opportunity from validated evidence and classifying ROI honestly (measured / estimated /
 * not_determinable — never fabricated). Executive priority is derived deterministically from business
 * impact, opportunity, dependency-unlock, execution cost/complexity, confidence, risk-reduction, and
 * time-sensitivity — never hardcoded, never randomized. NO AI, NO forecasting, NO invented revenue.
 */
import type { Evidence } from '../evidenceModel';
import type { ExecutionPlan } from '../recommendation/recommendationModel';
import type { RootCause } from '../rootcause/rootCauseModel';
import { evidenceValue } from '../evidenceAwareConfidence';
import type { BusinessImpact, BusinessPriorityBand } from './businessImpactModel';
import { businessRulesForPlan, COMMERCIAL_CONTEXT_KEYS, type BusinessRule, type BusinessRuleContext } from './businessRuleRegistry';

const round = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * DETERMINISTIC EXECUTIVE PRIORITY (Phase 5). 0..100 from a fixed, explainable blend:
 *   businessImpact 0.26 · opportunity 0.20 · dependencyUnlock 0.16 · confidence 0.12 · riskReduction 0.08 ·
 *   timeSensitivity 0.08 · (1-cost) 0.05 · (1-complexity) 0.05
 * Higher value/opportunity/dependency/confidence/risk-reduction/urgency raise priority; higher cost +
 * complexity lower it. No hardcoded ordering — initiatives are sorted by this score.
 */
export function computeBusinessPriority(dims: {
  businessImpact: number; opportunitySize: number; dependencyUnlock: number; confidence: number;
  riskReduction: number; timeSensitivity: number; executionCost: number; executionComplexity: number;
}): number {
  const s =
    (dims.businessImpact / 100) * 0.26 +
    (dims.opportunitySize / 100) * 0.20 +
    (dims.dependencyUnlock / 100) * 0.16 +
    dims.confidence * 0.12 +
    (dims.riskReduction / 100) * 0.08 +
    (dims.timeSensitivity / 100) * 0.08 +
    (1 - dims.executionCost / 100) * 0.05 +
    (1 - dims.executionComplexity / 100) * 0.05;
  return Math.round(Math.max(0, Math.min(1, s)) * 100);
}

function priorityBand(p: number): BusinessPriorityBand {
  if (p >= 70) return 'p0';
  if (p >= 50) return 'p1';
  if (p >= 30) return 'p2';
  return 'p3';
}

function extract(evidence: Evidence[], keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const v = evidenceValue(evidence, key);
    if (v != null) out[key] = v;
  }
  return out;
}

function toImpact(rule: BusinessRule, plan: ExecutionPlan, cause: RootCause | undefined, evidence: Evidence[]): BusinessImpact {
  const ctx: BusinessRuleContext = {
    values: extract(evidence, rule.requiredEvidence),
    // BETA-PROVIDER-008: authenticated commercial evidence enables MEASURED ROI (never fabricated).
    commercial: extract(evidence, COMMERCIAL_CONTEXT_KEYS),
  };
  const severity = cause?.severity ?? plan.priority;
  const opportunitySize = rule.opportunity(ctx, severity);
  const roi = rule.roi(ctx);
  const confidence = plan.confidence;
  const businessPriority = computeBusinessPriority({
    businessImpact: rule.businessImpact, opportunitySize, dependencyUnlock: rule.dependencyUnlock,
    confidence, riskReduction: rule.riskReduction, timeSensitivity: rule.timeSensitivity,
    executionCost: rule.executionCost, executionComplexity: rule.executionComplexity,
  });
  return {
    impactId: `${rule.id}::${plan.recommendationId}`, ruleId: rule.id, title: rule.title,
    businessImpact: rule.businessImpact, technicalImpact: rule.technicalImpact, customerImpact: rule.customerImpact,
    opportunitySize, executionCost: rule.executionCost, executionComplexity: rule.executionComplexity,
    riskReduction: rule.riskReduction, dependencyUnlock: rule.dependencyUnlock, timeSensitivity: rule.timeSensitivity,
    businessPriority, priorityBand: priorityBand(businessPriority), roi,
    supportingEvidence: plan.supportingEvidence, supportingRootCauses: plan.supportingRootCauses,
    supportingCorrelations: plan.supportingCorrelations, supportingExecutionPlans: [plan.recommendationId],
    confidence: round(confidence), reasonCodes: plan.reasonCodes,
    explanation: `${rule.title}: ${rule.rationale.opportunity} ROI: ${roi.status}.`,
    validationStatus: 'validated', freshnessAt: plan.freshnessAt, decisionConsumers: rule.decisionConsumers,
  };
}

/**
 * Assess business impact for a set of execution plans (with their diagnosing root causes + evidence for the
 * opportunity math). Deterministically ordered by business priority (desc), then impactId.
 */
export function assessBusinessImpact(plans: ExecutionPlan[], rootCauses: RootCause[], evidence: Evidence[]): BusinessImpact[] {
  const causeById = new Map(rootCauses.map((c) => [c.causeId, c]));
  const impacts: BusinessImpact[] = [];
  for (const plan of plans) {
    const cause = plan.supportingRootCauses[0] ? causeById.get(plan.supportingRootCauses[0]) : undefined;
    for (const rule of businessRulesForPlan(plan.ruleId)) {
      impacts.push(toImpact(rule, plan, cause, evidence));
    }
  }
  return impacts.sort((a, b) => (b.businessPriority - a.businessPriority) || (a.impactId < b.impactId ? -1 : 1));
}

export function assessBusinessImpactForConsumer(consumer: string, plans: ExecutionPlan[], rootCauses: RootCause[], evidence: Evidence[]): BusinessImpact[] {
  return assessBusinessImpact(plans, rootCauses, evidence).filter((i) => i.decisionConsumers.includes(consumer));
}

/** Compact, persistable summary for a decision's explainability block — business-ordered. */
export interface BusinessImpactSummary {
  count: number;
  initiatives: Array<{ impactId: string; title: string; businessPriority: number; priorityBand: BusinessPriorityBand; opportunitySize: number; roiStatus: string; confidence: number }>;
  roiMeasured: number;
  roiEstimated: number;
  roiNotDeterminable: number;
  reasonCodes: string[];
}

export function summarizeBusinessImpact(impacts: BusinessImpact[]): BusinessImpactSummary {
  return {
    count: impacts.length,
    initiatives: impacts.map((i) => ({ impactId: i.impactId, title: i.title, businessPriority: i.businessPriority, priorityBand: i.priorityBand, opportunitySize: i.opportunitySize, roiStatus: i.roi.status, confidence: i.confidence })),
    roiMeasured: impacts.filter((i) => i.roi.status === 'measured').length,
    roiEstimated: impacts.filter((i) => i.roi.status === 'estimated').length,
    roiNotDeterminable: impacts.filter((i) => i.roi.status === 'not_determinable').length,
    reasonCodes: impacts.flatMap((i) => i.reasonCodes),
  };
}
