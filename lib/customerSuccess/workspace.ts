/**
 * workspace.ts — the ONE canonical Customer Success Workspace composition
 * (CSA-007).
 *
 * PURE composition, no intelligence, no calculation, no orchestration, no
 * execution. It assembles a single per-company workspace view from the OUTPUTS
 * of the existing authorities:
 *   - CSA-003 Health      (score/state/risk/contributors)
 *   - CSA-004 Lifecycle   (stage/transition/trajectory/next milestone)
 *   - CSA-005 Orchestrator (next-best action + recommended actions)
 *   - CSA-006 Playbooks    (recommended playbook + steps)
 *   - CSA-001 Usage        (usage summary — via health)
 *   - Platform Ready
 *
 * It NEVER recalculates any of them; it only reshapes their results into the
 * canonical Customer Success surface. Every field is a projection of an authority
 * output — this module introduces no new numbers.
 */

import type { CustomerSuccessPlan } from './nextBestActions';
import type { PlaybookSet } from './playbooks';

export const WORKSPACE_SECTIONS = [
  'overview', 'health', 'lifecycle', 'platform_ready', 'usage', 'next_best_action', 'recommended_actions', 'playbooks',
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export interface WorkspaceOverview {
  companyId: string;
  lifecycleStage: string;
  healthState: string;
  healthScore: number;
  platformReady: boolean;
}

export interface WorkspaceHealth {
  score: number;
  state: string;
  riskLevel: string;
  majorContributors: string[];
  recommendedImprovements: string[];
}

export interface WorkspaceLifecycle {
  stage: string;
  previousStage: string | null;
  transitionReason: string;
  trajectory: string;
  nextMilestone: string;
}

export interface WorkspaceUsage {
  totalEvents: number;
  activeUsers: number;
  activeDays: number;
  capabilitiesUsed: string[];
}

export interface WorkspaceAction {
  id: string;
  title: string;
  priorityTier: string;
  reason: string;
  expectedImpact: string;
  href: string | null;
}

export interface WorkspacePlaybookStep {
  title: string;
  description: string;
  required: boolean;
}

export interface WorkspacePlaybook {
  id: string;
  actionId: string;
  title: string;
  objective: string;
  expectedOutcome: string;
  status: string;
  steps: WorkspacePlaybookStep[];
  progress: { completed: number; total: number };
  href: string | null;
}

export interface CustomerSuccessWorkspace {
  companyId: string;
  generatedAt: string;
  sections: WorkspaceSection[];
  overview: WorkspaceOverview;
  health: WorkspaceHealth;
  lifecycle: WorkspaceLifecycle;
  platformReady: { ready: boolean; readinessScore: number };
  usage: WorkspaceUsage;
  /** §4 — the single top action (or null). */
  nextBestAction: WorkspaceAction | null;
  /** §4 — all available actions (priority-sorted, from CSA-005). */
  recommendedActions: WorkspaceAction[];
  /** §5 — the recommended playbook + the full list. */
  playbooks: { recommended: WorkspacePlaybook | null; all: WorkspacePlaybook[] };
}

export interface WorkspaceComposeInput {
  companyId: string;
  now: string;
  health: WorkspaceHealth;
  platformReady: boolean;
  readinessScore: number;
  usage: WorkspaceUsage;
  lifecycle: WorkspaceLifecycle;
  plan: CustomerSuccessPlan;
  playbookSet: PlaybookSet;
}

/** Href for an action, looked up from the plan (§6 — links to existing surfaces). */
function hrefForAction(plan: CustomerSuccessPlan, actionId: string): string | null {
  return plan.actions.find((a) => a.id === actionId)?.actionHref ?? null;
}

function toWorkspaceAction(plan: CustomerSuccessPlan, actionId: string): WorkspaceAction | null {
  const a = plan.actions.find((x) => x.id === actionId);
  if (!a) return null;
  return {
    id: a.id, title: a.title, priorityTier: a.priorityTier,
    reason: a.reason, expectedImpact: a.expectedImpact, href: a.actionHref,
  };
}

function toWorkspacePlaybook(pb: PlaybookSet['playbooks'][number], plan: CustomerSuccessPlan): WorkspacePlaybook {
  const total = pb.steps.length;
  // Progress is projected from the action's canonical state — we track no
  // per-step execution (no execution in this layer). Completed = full when the
  // action is already COMPLETED, else 0.
  const completed = pb.status === 'COMPLETED' ? total : 0;
  return {
    id: pb.id, actionId: pb.actionId, title: pb.title, objective: pb.objective,
    expectedOutcome: pb.expectedOutcome, status: pb.status,
    steps: pb.steps.map((s) => ({ title: s.title, description: s.description, required: s.required })),
    progress: { completed, total },
    href: hrefForAction(plan, pb.actionId),
  };
}

/**
 * Compose the canonical Customer Success workspace. Pure + deterministic
 * (replay/refresh safe, §7). Every value is a projection of an authority output.
 */
export function composeCustomerSuccessWorkspace(input: WorkspaceComposeInput): CustomerSuccessWorkspace {
  const { plan, playbookSet } = input;

  const nextBestAction = plan.nextBestAction ? toWorkspaceAction(plan, plan.nextBestAction.id) : null;
  const recommendedActions = plan.recommendedActions
    .map((a) => toWorkspaceAction(plan, a.id))
    .filter((a): a is WorkspaceAction => a !== null);

  const allPlaybooks = playbookSet.playbooks.map((pb) => toWorkspacePlaybook(pb, plan));
  const recommended = playbookSet.recommendedPlaybook
    ? toWorkspacePlaybook(playbookSet.recommendedPlaybook, plan)
    : null;

  return {
    companyId: input.companyId,
    generatedAt: input.now,
    sections: [...WORKSPACE_SECTIONS],
    overview: {
      companyId: input.companyId,
      lifecycleStage: input.lifecycle.stage,
      healthState: input.health.state,
      healthScore: input.health.score,
      platformReady: input.platformReady,
    },
    health: input.health,
    lifecycle: input.lifecycle,
    platformReady: { ready: input.platformReady, readinessScore: input.readinessScore },
    usage: input.usage,
    nextBestAction,
    recommendedActions,
    playbooks: { recommended, all: allPlaybooks },
  };
}
