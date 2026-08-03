/**
 * INT-001 Phase 5 — consolidated Automation Summary. Fixed orchestration
 * order: channels → tasks → timeline → review → readiness → summary.
 * Pure; generatedAt is always the upstream summary's generatedAt.
 */

import type { AutomationInput, AutomationSummary, AutomationPlan } from './types';
import { sequenceChannels } from './channelSequencer';
import { generateTasks } from './taskGenerator';
import { buildExecutionTimeline } from './timelineBuilder';
import { assessHumanReview } from './humanReviewEngine';
import { assessReadiness } from './readinessEngine';

export function buildAutomationPlan(input: AutomationInput): AutomationPlan {
  const channelSequence = sequenceChannels(input);
  const tasks = generateTasks(input);
  const timeline = buildExecutionTimeline(tasks, input.summary.generatedAt);
  return { tasks, timeline, channelSequence };
}

export function buildAutomationSummary(input: AutomationInput): AutomationSummary {
  const plan = buildAutomationPlan(input);
  const review = assessHumanReview(input);
  const readiness = assessReadiness(input, review);

  // Blend upstream intelligence confidence with the plan's own confidence.
  const confidence = Math.round(
    (input.summary.confidence * 0.6 + input.summary.recommendedPlan.confidence * 0.4) * 100,
  ) / 100;

  return {
    leadId: input.summary.leadId,
    status: readiness.status,
    statusReasons: readiness.reasons,
    executionTimeline: plan.timeline,
    tasks: plan.tasks,
    channelSequence: plan.channelSequence,
    review,
    confidence,
    generatedAt: input.summary.generatedAt,
  };
}
