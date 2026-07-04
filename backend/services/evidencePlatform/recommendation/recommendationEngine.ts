/**
 * Recommendation Intelligence & Execution Planning Engine  (BETA-ENGINE-011, Phase 2/5)
 *
 * ONE reusable engine that turns validated Root Causes into deterministic, prioritized, executable
 * `ExecutionPlan`s. A recommendation exists ONLY when its root cause is diagnosed (originates exclusively
 * from validated Root Causes). Priority is derived deterministically from root-cause severity, evidence
 * strength (confidence), business impact, blocking dependency, execution cost, and risk — never hardcoded,
 * never randomized. NO AI, NO probability, NO generic templates — pure + deterministic.
 */
import type { RootCause } from '../rootcause/rootCauseModel';
import type { ExecutionPlan, PriorityBand } from './recommendationModel';
import { recommendationRulesForRootCause, type RecommendationRule } from './recommendationRuleRegistry';

const round = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * DETERMINISTIC PRIORITY (Phase 5). 0..100 from a fixed, explainable blend:
 *   severity 0.30 · impact 0.25 · confidence 0.15 · blocking 0.15 · (1-effort) 0.08 · (1-risk) 0.07
 * Higher severity/impact/confidence/blocking raise priority; higher effort/risk lower it. No hardcoded
 * ordering — plans are sorted by this score.
 */
export function computePriority(rule: RecommendationRule, cause: RootCause): number {
  const severity = cause.severity / 100; // 0..1
  const impact = rule.businessImpact / 100;
  const confidence = cause.confidence; // 0..1
  const blocking = rule.isBlocking ? 1 : 0;
  const effort = rule.requiredEffort / 100;
  const risk = rule.risk / 100;
  const score =
    severity * 0.30 +
    impact * 0.25 +
    confidence * 0.15 +
    blocking * 0.15 +
    (1 - effort) * 0.08 +
    (1 - risk) * 0.07;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

function priorityBand(priority: number): PriorityBand {
  if (priority >= 75) return 'p0';
  if (priority >= 55) return 'p1';
  if (priority >= 35) return 'p2';
  return 'p3';
}

function toPlan(rule: RecommendationRule, cause: RootCause): ExecutionPlan {
  const priority = computePriority(rule, cause);
  return {
    recommendationId: `${rule.id}::${cause.causeId}`,
    ruleId: rule.id,
    title: rule.title,
    actionType: rule.actionType,
    priority,
    priorityBand: priorityBand(priority),
    businessImpact: rule.businessImpact,
    technicalImpact: rule.technicalImpact,
    expectedBusinessOutcome: rule.expectedBusinessOutcome,
    expectedTechnicalOutcome: rule.expectedTechnicalOutcome,
    requiredEffort: rule.requiredEffort,
    dependencies: cause.blockingDependencies,
    prerequisites: rule.prerequisites,
    executionSteps: rule.executionSteps,
    validationSteps: rule.validationSteps,
    successCriteria: rule.successCriteria,
    supportingEvidence: cause.supportingEvidence,
    supportingRootCauses: [cause.causeId],
    supportingCorrelations: cause.supportingCorrelations,
    confidence: round(cause.confidence),
    reasonCodes: cause.reasonCodes,
    replaces: rule.replaces,
    validationStatus: 'validated',
    freshnessAt: cause.freshnessAt,
    decisionConsumers: rule.decisionConsumers,
  };
}

/**
 * Generate execution plans from diagnosed root causes. Only causes that are actionable AND have a
 * registered rule produce a plan (resolved/monitoring + conflicting/validation causes produce their
 * monitoring/validation plans). Deterministically ordered by priority (desc), then recommendationId.
 */
export function generateRecommendations(rootCauses: RootCause[]): ExecutionPlan[] {
  const plans: ExecutionPlan[] = [];
  for (const cause of rootCauses) {
    // Missing causes cannot produce a recommendation — there is nothing validated to act on.
    if (cause.causeType === 'missing_cause') continue;
    for (const rule of recommendationRulesForRootCause(cause.causeId)) {
      plans.push(toPlan(rule, cause));
    }
  }
  return plans.sort((a, b) => (b.priority - a.priority) || (a.recommendationId < b.recommendationId ? -1 : 1));
}

/** Generate only the plans a given decision engine consumes (Phase 6). */
export function generateRecommendationsForConsumer(consumer: string, rootCauses: RootCause[]): ExecutionPlan[] {
  return generateRecommendations(rootCauses).filter((p) => p.decisionConsumers.includes(consumer));
}

/** Compact, persistable summary of the execution plans for a decision's explainability block. */
export interface RecommendationSummary {
  count: number;
  plans: Array<{ recommendationId: string; title: string; actionType: string; priority: number; priorityBand: PriorityBand; confidence: number; reasonCodes: string[] }>;
  reasonCodes: string[];
}

export function summarizeRecommendations(plans: ExecutionPlan[]): RecommendationSummary {
  return {
    count: plans.length,
    plans: plans.map((p) => ({ recommendationId: p.recommendationId, title: p.title, actionType: p.actionType, priority: p.priority, priorityBand: p.priorityBand, confidence: p.confidence, reasonCodes: p.reasonCodes })),
    reasonCodes: plans.flatMap((p) => p.reasonCodes),
  };
}
