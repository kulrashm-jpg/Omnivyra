/**
 * playbooks.ts — the ONE canonical Customer Success Playbook model (CSA-006).
 *
 * PURE, deterministic, no AI, no IO, NO EXECUTION. It consumes the CSA-005
 * orchestrator's plan and translates each next-best-action into exactly ONE
 * deterministic playbook that describes HOW the customer should progress — never
 * how automation executes. Every CSA-005 action maps to one playbook (§3).
 *
 * This is the SINGLE playbook authority. Every future capability (dashboard,
 * automation, email, assistant, customer success) consumes these playbooks — it
 * produces deterministic guidance ONLY; it sends nothing and executes nothing.
 */

import {
  CUSTOMER_SUCCESS_ACTION_IDS,
  type CustomerSuccessPlan,
  type CustomerSuccessAction,
  type ActionState,
  type PriorityTier,
} from './nextBestActions';

export type EstimatedEffort = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PlaybookStep {
  title: string;
  description: string;
  required: boolean;
  blockedBy: string[];
  unlocks: string[];
}

export interface Playbook {
  id: string;
  /** The CSA-005 action this playbook is the deterministic response to (§3). */
  actionId: string;
  title: string;
  objective: string;
  prerequisites: string[];
  steps: PlaybookStep[];
  expectedOutcome: string;
  dependencies: string[];
  completionCriteria: string;
  estimatedEffort: EstimatedEffort;
  estimatedDurationMinutes: number;
  /** The milestone the customer reaches after this playbook (§5). */
  nextMilestone: string;
  /** Deterministic business-value copy (§5). */
  businessValue: string;
}

/** A playbook resolved against a company's plan — carries the action's live state. */
export interface PlaybookView extends Playbook {
  status: ActionState;
  priorityScore: number;
  priorityTier: PriorityTier;
  explanation: {
    why: string;
    whyNow: string;
    expectedBusinessValue: string;
    nextMilestone: string;
  };
}

export interface PlaybookSet {
  companyId: string;
  /** The playbook for the plan's single next-best action (or null). */
  recommendedPlaybook: PlaybookView | null;
  /** One playbook per CSA-005 action, with live state. */
  playbooks: PlaybookView[];
  evaluatedAt: string;
}

const step = (title: string, description: string, required: boolean, blockedBy: string[] = [], unlocks: string[] = []): PlaybookStep =>
  ({ title, description, required, blockedBy, unlocks });

// ── the catalog: exactly one playbook per CSA-005 action (§3) ────────────────
const PLAYBOOKS: ReadonlyArray<Playbook> = [
  {
    id: 'onboarding_playbook', actionId: 'complete_onboarding',
    title: 'Onboarding Playbook', objective: 'Complete mandatory setup to reach Platform Ready.',
    prerequisites: [], dependencies: [],
    steps: [
      step('Verify your email', 'Confirm your email address.', true, [], ['Profile & company setup']),
      step('Complete your profile', 'Add your name and role.', true, ['Verify your email'], ['Company setup']),
      step('Set up your company', 'Create your workspace and claim your domain.', true, ['Complete your profile'], ['All integrations']),
    ],
    expectedOutcome: 'The workspace reaches Platform Ready and unlocks every capability.',
    completionCriteria: 'Platform Ready is true.',
    estimatedEffort: 'MEDIUM', estimatedDurationMinutes: 6,
    nextMilestone: 'Platform Ready', businessValue: 'Unlocks the entire platform for the account.',
  },
  {
    id: 'company_profile_playbook', actionId: 'improve_company_profile',
    title: 'Company Profile Playbook', objective: 'Complete and confirm the company profile.',
    prerequisites: [], dependencies: [],
    steps: [
      step('Review auto-filled details', 'Confirm the profile prefilled from your website.', true, [], ['Sharper AI outputs']),
      step('Add positioning & audience', 'Fill unique value, audience, and key messages.', false, [], []),
    ],
    expectedOutcome: 'A complete, confirmed profile that grounds every AI output.',
    completionCriteria: 'Company profile area is READY.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 5,
    nextMilestone: 'Confident profile', businessValue: 'Higher-quality generated content and campaigns.',
  },
  {
    id: 'social_connection_playbook', actionId: 'connect_social',
    title: 'Social Connection Playbook', objective: 'Connect at least one social channel.',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open social platforms', 'Go to the social connection surface.', true, ['Platform Ready'], []),
      step('Authorize a channel', 'Connect LinkedIn, X, or another channel.', true, [], ['Publishing', 'Engagement monitoring']),
    ],
    expectedOutcome: 'At least one channel is connected for publishing and monitoring.',
    completionCriteria: 'A social account is connected (social area READY).',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 3,
    nextMilestone: 'First publish', businessValue: 'Enables publishing and engagement monitoring.',
  },
  {
    id: 'analytics_playbook', actionId: 'connect_ga4',
    title: 'Analytics Playbook', objective: 'Connect Google Analytics (GA4).',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open data integrations', 'Go to the integrations surface.', true, ['Platform Ready'], []),
      step('Connect GA4', 'Authorize Google Analytics.', true, [], ['Traffic reporting']),
    ],
    expectedOutcome: 'GA4 is connected and content performance ties to real traffic.',
    completionCriteria: 'GA4 area is READY.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 3,
    nextMilestone: 'Traffic insight', businessValue: 'Reports show real traffic outcomes.',
  },
  {
    id: 'search_console_playbook', actionId: 'connect_gsc',
    title: 'Search Console Playbook', objective: 'Connect Google Search Console.',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open data integrations', 'Go to the integrations surface.', true, ['Platform Ready'], []),
      step('Connect Search Console', 'Authorize GSC.', true, [], ['Search-query insight']),
    ],
    expectedOutcome: 'GSC is connected and surfaces the queries you rank for.',
    completionCriteria: 'GSC area is READY.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 3,
    nextMilestone: 'Search insight', businessValue: 'Search-query fuel for content planning.',
  },
  {
    id: 'first_content_playbook', actionId: 'generate_first_content',
    title: 'First Content Playbook', objective: 'Generate your first on-brand content.',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open the content workspace', 'Go to the content engine.', true, ['Platform Ready'], []),
      step('Generate a draft', 'Create your first piece of content.', true, [], ['First campaign', 'First publish']),
    ],
    expectedOutcome: 'Your first on-brand draft exists.',
    completionCriteria: 'A content-generation event has occurred.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 5,
    nextMilestone: 'First campaign', businessValue: 'First tangible value from the content engine.',
  },
  {
    id: 'campaign_launch_playbook', actionId: 'create_first_campaign',
    title: 'Campaign Launch Playbook', objective: 'Create your first campaign.',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open campaigns', 'Go to the campaign planner.', true, ['Platform Ready'], []),
      step('Plan a campaign', 'Define objective and content mix.', true, [], ['First publish']),
    ],
    expectedOutcome: 'A campaign plan is live.',
    completionCriteria: 'A campaign-creation event has occurred.',
    estimatedEffort: 'MEDIUM', estimatedDurationMinutes: 10,
    nextMilestone: 'First publish', businessValue: 'Coordinated multi-channel output.',
  },
  {
    id: 'first_publish_playbook', actionId: 'publish_first_post',
    title: 'First Publish Playbook', objective: 'Publish your first post.',
    prerequisites: ['Platform Ready', 'A connected channel'], dependencies: ['Connect social accounts'],
    steps: [
      step('Connect a channel', 'Ensure a website or social channel is connected.', true, ['Platform Ready'], []),
      step('Schedule or publish', 'Push your first post live.', true, ['Connect a channel'], ['Analytics data']),
    ],
    expectedOutcome: 'Your first post is scheduled or published.',
    completionCriteria: 'A publishing event has occurred.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 4,
    nextMilestone: 'First results', businessValue: 'Content reaches your audience.',
  },
  {
    id: 'recommendations_review_playbook', actionId: 'review_recommendations',
    title: 'Recommendations Review Playbook', objective: 'Review and apply a recommendation.',
    prerequisites: ['Platform Ready'], dependencies: ['Complete onboarding'],
    steps: [
      step('Open recommendations', 'Go to the command center.', true, ['Platform Ready'], []),
      step('Apply a recommendation', 'Act on the highest-value next step.', false, [], []),
    ],
    expectedOutcome: 'A recommended improvement is applied.',
    completionCriteria: 'A recommendation was viewed/applied.',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 5,
    nextMilestone: 'Continuous improvement', businessValue: 'Acts on the highest-value next moves.',
  },
  {
    id: 'reengagement_playbook', actionId: 'increase_activity',
    title: 'Re-engagement Playbook', objective: 'Restore workspace activity.',
    prerequisites: [], dependencies: [],
    steps: [
      step('Return to the workspace', 'Open the command center.', true, [], []),
      step('Complete one action', 'Generate content, plan a campaign, or publish.', true, [], ['Recovering health']),
    ],
    expectedOutcome: 'Renewed activity and recovering health.',
    completionCriteria: 'Recent activity resumes (active days rise).',
    estimatedEffort: 'LOW', estimatedDurationMinutes: 5,
    nextMilestone: 'Healthy again', businessValue: 'Re-engages the account and protects retention.',
  },
];

/** actionId → the ONE playbook (§3). */
export const PLAYBOOK_BY_ACTION: ReadonlyMap<string, Playbook> = new Map(PLAYBOOKS.map((p) => [p.actionId, p]));

/** Every CSA-005 action id has exactly one playbook (invariant, asserted in tests). */
export const PLAYBOOK_IDS = PLAYBOOKS.map((p) => p.id);

/** Resolve one action into its playbook view (carrying the action's live state). Pure. */
export function playbookForAction(action: CustomerSuccessAction): PlaybookView | null {
  const pb = PLAYBOOK_BY_ACTION.get(action.id);
  if (!pb) return null;
  return {
    ...pb,
    status: action.state,
    priorityScore: action.priorityScore,
    priorityTier: action.priorityTier,
    explanation: {
      why: action.explanation.why,
      whyNow: action.explanation.whyNow,
      expectedBusinessValue: pb.businessValue,
      nextMilestone: pb.nextMilestone,
    },
  };
}

/**
 * Translate a CSA-005 plan into the canonical playbook set. Pure + deterministic
 * (replay/refresh safe, §7). Every action maps to one playbook; the plan's
 * next-best action selects the recommended playbook.
 */
export function buildPlaybookSet(plan: CustomerSuccessPlan): PlaybookSet {
  const playbooks = plan.actions
    .map((a) => playbookForAction(a))
    .filter((p): p is PlaybookView => p !== null);

  const recommendedPlaybook = plan.nextBestAction ? playbookForAction(plan.nextBestAction) : null;

  return {
    companyId: plan.companyId,
    recommendedPlaybook,
    playbooks,
    evaluatedAt: plan.evaluatedAt,
  };
}

/** True when every canonical action id has a mapped playbook. */
export function everyActionMapped(): boolean {
  return CUSTOMER_SUCCESS_ACTION_IDS.every((id) => PLAYBOOK_BY_ACTION.has(id));
}
