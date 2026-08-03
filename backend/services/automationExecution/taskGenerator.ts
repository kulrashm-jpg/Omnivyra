/**
 * INT-001 Phase 5 — Task Generator. Converts the Phase 3 outreach plan +
 * recommended actions into an ordered, dependency-chained task list with a
 * deterministic delay ladder. Generates tasks only — nothing runs them.
 */

import type { AutomationInput, AutomationTask, AutomationTaskKind } from './types';
import {
  STEP_DELAY_LADDER_HOURS,
  WAIT_TASK_THRESHOLD_HOURS,
  MAX_TASKS,
  PARALLEL_ACTION_ALLOWLIST,
} from './automationConfig';
import type { OutreachChannel } from '../qualificationPlanning/types';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function generateTasks(input: AutomationInput): AutomationTask[] {
  const { summary } = input;
  const tasks: AutomationTask[] = [];
  let lastChainTaskId: string | null = null;

  const push = (
    kind: AutomationTaskKind,
    action: string,
    channel: AutomationTask['channel'],
    dependsOn: string | null,
    estimatedDelayHours: number,
    confidence: number,
    explanation: string,
  ): AutomationTask => {
    const order = tasks.length + 1;
    const task: AutomationTask = {
      id: `task-${order}-${slug(action)}`,
      order,
      dependsOn,
      kind,
      action,
      channel,
      estimatedDelayHours,
      confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
      explanation,
    };
    tasks.push(task);
    return task;
  };

  // 1) Human routing first when Phase 3 marked it critical/high (Assign SDR).
  const sdr = summary.recommendedActions.find((a) => a.action === 'Assign SDR');
  if (sdr) {
    const t = push('human', 'Assign SDR', 'internal', null, 0, sdr.confidence, sdr.explanation);
    lastChainTaskId = t.id;
  }

  // 2) The outreach plan becomes the sequential chain, on the delay ladder;
  //    ladder gaps ≥ threshold materialize as explicit Wait tasks.
  summary.recommendedPlan.steps.forEach((step, index) => {
    const delay = STEP_DELAY_LADDER_HOURS[Math.min(index, STEP_DELAY_LADDER_HOURS.length - 1)];
    if (delay >= WAIT_TASK_THRESHOLD_HOURS && lastChainTaskId) {
      const wait = push(
        'wait', `Wait ${Math.round(delay / 24)} day(s)`, null, lastChainTaskId, delay,
        1, 'Deterministic pacing between outreach touches.',
      );
      lastChainTaskId = wait.id;
      const t = push(
        step.channel === 'content' ? 'content' : 'outreach',
        step.step,
        step.channel as OutreachChannel | 'content',
        lastChainTaskId,
        0,
        summary.recommendedPlan.confidence,
        step.detail,
      );
      lastChainTaskId = t.id;
    } else {
      const t = push(
        step.channel === 'content' ? 'content' : 'outreach',
        step.step,
        step.channel as OutreachChannel | 'content',
        lastChainTaskId,
        delay,
        summary.recommendedPlan.confidence,
        step.detail,
      );
      lastChainTaskId = t.id;
    }
  });

  // 3) Supporting content actions run in parallel off the FIRST chain task.
  const root = tasks.find((t) => t.kind !== 'human') ?? tasks[0];
  for (const action of summary.recommendedActions) {
    if (!PARALLEL_ACTION_ALLOWLIST.has(action.action)) continue;
    if (tasks.some((t) => t.action === action.action)) continue; // dedupe vs plan steps
    if (tasks.length >= MAX_TASKS) break;
    push('content', action.action, 'content', root ? root.id : null, 24, action.confidence, action.explanation);
  }

  return tasks.slice(0, MAX_TASKS);
}
