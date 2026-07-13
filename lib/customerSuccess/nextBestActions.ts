/**
 * nextBestActions.ts — the ONE canonical Customer Success Orchestrator model
 * (CSA-005).
 *
 * PURE, deterministic, no AI, no IO, NO EXECUTION. It decides WHAT should happen
 * next for a company — never how. Given signals from the existing authorities
 * (CSA-004 lifecycle, CSA-003 health, CSA-001 usage, readiness area coverage,
 * Platform Ready) it produces prioritized next-best-actions with canonical
 * states, dependencies, expected impact, and deterministic explanations.
 *
 * It is the SINGLE next-best-action authority. Every future Customer Success
 * capability (automation, emails, reminders, CS dashboards, playbooks) consumes
 * these recommendations — this module produces recommendations ONLY; it sends
 * nothing, executes nothing, triggers nothing (§6).
 */

export type LifecycleStage =
  | 'ONBOARDING' | 'ACTIVATED' | 'ADOPTING' | 'GROWING' | 'MATURE' | 'DECLINING' | 'DORMANT';

export type ReadinessAreaState = 'READY' | 'NOT_READY' | 'UNKNOWN';
export type ActionState = 'AVAILABLE' | 'BLOCKED' | 'COMPLETED' | 'DISMISSED' | 'DEFERRED';
export type PriorityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ActionArea =
  | 'COMPANY_PROFILE' | 'WEBSITE' | 'GOOGLE_ANALYTICS' | 'GOOGLE_SEARCH_CONSOLE' | 'SOCIAL_INTEGRATIONS';

export interface OrchestratorInputs {
  companyId: string;
  now: string;
  platformReady: boolean;
  lifecycleStage: LifecycleStage;
  healthScore: number;
  healthState: string;
  trajectory: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';
  inactiveDays: number | null;
  /** Integration/setup coverage (readiness area states). */
  areas: Record<ActionArea, ReadinessAreaState>;
  /** Distinct days with any product usage in the window. */
  usageActiveDays: number;
  /** Capabilities exercised (from CSA-001 usage byCapability). */
  capabilitiesUsed: string[];
  /** Actions the consumer has recorded as dismissed (optional; no persistence here). */
  dismissedActionIds?: string[];
}

export interface CustomerSuccessAction {
  id: string;
  title: string;
  category: string;
  state: ActionState;
  priorityScore: number;
  priorityTier: PriorityTier;
  reason: string;
  blockingFactors: string[];
  dependencies: string[];
  expectedImpact: string;
  explanation: {
    why: string;
    whyNow: string;
    expectedOutcome: string;
    requiredPrerequisites: string[];
  };
  actionHref: string | null;
}

export interface CustomerSuccessPlan {
  companyId: string;
  lifecycleStage: LifecycleStage;
  healthState: string;
  /** The single highest-priority AVAILABLE action (or null). */
  nextBestAction: CustomerSuccessAction | null;
  /** AVAILABLE actions, highest priority first. */
  recommendedActions: CustomerSuccessAction[];
  /** Every action with its canonical state. */
  actions: CustomerSuccessAction[];
  evaluatedAt: string;
}

// ── action catalog (§2) ─────────────────────────────────────────────────────
interface Prereq { met: boolean; blockingFactors: string[]; dependencies: string[]; requiredPrerequisites: string[]; }

interface ActionDef {
  id: string;
  title: string;
  category: string;
  basePriority: number;
  /** Lifecycle stages where this action is the right next step. */
  relevantStages: LifecycleStage[];
  href: string | null;
  expectedImpact: string;
  why: string;
  expectedOutcome: string;
  /** Completed when the underlying signal is already satisfied. */
  isCompleted: (i: OrchestratorInputs) => boolean;
  /** Hard prerequisites — when unmet the action is BLOCKED. */
  prereq: (i: OrchestratorInputs) => Prereq;
}

const ready = (i: OrchestratorInputs, a: ActionArea) => i.areas[a] === 'READY';
const used = (i: OrchestratorInputs, cap: string) => i.capabilitiesUsed.includes(cap);

/** After-onboarding gate: most growth actions require Platform Ready first. */
function needsOnboarding(i: OrchestratorInputs): Prereq {
  return i.platformReady
    ? { met: true, blockingFactors: [], dependencies: [], requiredPrerequisites: [] }
    : { met: false, blockingFactors: ['Onboarding incomplete'], dependencies: ['Complete onboarding'], requiredPrerequisites: ['Platform Ready'] };
}
const noPrereq: Prereq = { met: true, blockingFactors: [], dependencies: [], requiredPrerequisites: [] };

const ACTION_DEFS: ReadonlyArray<ActionDef> = [
  {
    id: 'complete_onboarding', title: 'Complete onboarding', category: 'Onboarding', basePriority: 100,
    relevantStages: ['ONBOARDING'], href: '/onboarding/journey',
    expectedImpact: 'Unlocks every integration and capability.',
    why: 'Mandatory setup gates the rest of the platform.',
    expectedOutcome: 'The workspace reaches Platform Ready.',
    isCompleted: (i) => i.platformReady, prereq: () => noPrereq,
  },
  {
    id: 'improve_company_profile', title: 'Improve company profile', category: 'Profile', basePriority: 45,
    relevantStages: ['ONBOARDING', 'ACTIVATED', 'ADOPTING'], href: '/company-profile?onboarding=company-profile',
    expectedImpact: 'Sharper, on-brand AI outputs.',
    why: 'A complete profile grounds every AI output.',
    expectedOutcome: 'Higher-quality generated content and campaigns.',
    isCompleted: (i) => ready(i, 'COMPANY_PROFILE'), prereq: () => noPrereq,
  },
  {
    id: 'connect_social', title: 'Connect social accounts', category: 'Integration', basePriority: 62,
    relevantStages: ['ACTIVATED', 'ADOPTING', 'GROWING', 'MATURE'], href: '/social-platforms',
    expectedImpact: 'Enables publishing and engagement monitoring.',
    why: 'Publishing and campaigns need at least one connected channel.',
    expectedOutcome: 'You can publish and monitor social channels.',
    isCompleted: (i) => ready(i, 'SOCIAL_INTEGRATIONS'), prereq: needsOnboarding,
  },
  {
    id: 'connect_ga4', title: 'Connect Google Analytics', category: 'Integration', basePriority: 56,
    relevantStages: ['ADOPTING', 'GROWING', 'MATURE'], href: '/integrations?focus=data',
    expectedImpact: 'Ties content to real traffic.',
    why: 'Analytics attributes content performance to traffic.',
    expectedOutcome: 'Reports show real traffic outcomes.',
    isCompleted: (i) => ready(i, 'GOOGLE_ANALYTICS'), prereq: needsOnboarding,
  },
  {
    id: 'connect_gsc', title: 'Connect Google Search Console', category: 'Integration', basePriority: 52,
    relevantStages: ['ADOPTING', 'GROWING', 'MATURE'], href: '/integrations?focus=data',
    expectedImpact: 'Surfaces the queries you rank for.',
    why: 'Search Console fuels content planning with real queries.',
    expectedOutcome: 'Search-query insight for content planning.',
    isCompleted: (i) => ready(i, 'GOOGLE_SEARCH_CONSOLE'), prereq: needsOnboarding,
  },
  {
    id: 'generate_first_content', title: 'Generate your first content', category: 'Activation', basePriority: 66,
    relevantStages: ['ACTIVATED', 'ADOPTING'], href: '/content',
    expectedImpact: 'First value from the content engine.',
    why: 'Generating content is the core first win.',
    expectedOutcome: 'Your first on-brand draft exists.',
    isCompleted: (i) => used(i, 'content'), prereq: needsOnboarding,
  },
  {
    id: 'create_first_campaign', title: 'Create your first campaign', category: 'Activation', basePriority: 70,
    relevantStages: ['ACTIVATED', 'ADOPTING'], href: '/campaigns',
    expectedImpact: 'Coordinated multi-channel output.',
    why: 'Campaigns turn content into a coordinated plan.',
    expectedOutcome: 'A campaign plan is live.',
    isCompleted: (i) => used(i, 'campaign'), prereq: needsOnboarding,
  },
  {
    id: 'publish_first_post', title: 'Publish your first post', category: 'Activation', basePriority: 68,
    relevantStages: ['ACTIVATED', 'ADOPTING'], href: '/planner',
    expectedImpact: 'Content goes live to your audience.',
    why: 'Publishing delivers the value to your channels.',
    expectedOutcome: 'Your first post is scheduled/published.',
    isCompleted: (i) => used(i, 'publishing'),
    prereq: (i) => {
      const onb = needsOnboarding(i);
      if (!onb.met) return onb;
      if (!ready(i, 'SOCIAL_INTEGRATIONS') && !ready(i, 'WEBSITE')) {
        return { met: false, blockingFactors: ['No publishing channel connected'], dependencies: ['Connect social accounts'], requiredPrerequisites: ['A connected website or social channel'] };
      }
      return noPrereq;
    },
  },
  {
    id: 'review_recommendations', title: 'Review recommendations', category: 'Growth', basePriority: 48,
    relevantStages: ['ADOPTING', 'GROWING', 'MATURE'], href: '/command-center',
    expectedImpact: 'Act on the highest-value next steps.',
    why: 'Recommendations point to the best next moves.',
    expectedOutcome: 'You apply a recommended improvement.',
    isCompleted: (i) => used(i, 'recommendation'), prereq: needsOnboarding,
  },
  {
    id: 'increase_activity', title: 'Increase workspace activity', category: 'Engagement', basePriority: 82,
    relevantStages: ['DECLINING', 'DORMANT'], href: '/command-center',
    expectedImpact: 'Re-engages the account and improves health.',
    why: 'Activity has dropped — re-engaging protects the account.',
    expectedOutcome: 'Renewed activity and recovering health.',
    isCompleted: (i) => i.usageActiveDays >= 5 && i.healthState !== 'INACTIVE',
    prereq: () => noPrereq,
  },
];

function tierFor(score: number): PriorityTier {
  if (score >= 90) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 45) return 'MEDIUM';
  return 'LOW';
}

function reasonFor(state: ActionState, def: ActionDef, prereq: Prereq): string {
  switch (state) {
    case 'COMPLETED': return `${def.title} is already done.`;
    case 'DISMISSED': return `${def.title} was dismissed.`;
    case 'BLOCKED': return prereq.blockingFactors.join('; ') || 'Prerequisites are not met.';
    case 'DEFERRED': return 'Not the priority at this lifecycle stage yet.';
    case 'AVAILABLE': return def.why;
  }
}

/**
 * Produce the canonical Customer Success plan. Pure + deterministic — the same
 * inputs always yield the same plan (replay/refresh/resume safe, §7).
 */
export function orchestrateCustomerSuccess(inputs: OrchestratorInputs): CustomerSuccessPlan {
  const dismissed = new Set(inputs.dismissedActionIds ?? []);

  const actions: CustomerSuccessAction[] = ACTION_DEFS.map((def) => {
    const prereq = def.prereq(inputs);
    let state: ActionState;
    if (def.isCompleted(inputs)) state = 'COMPLETED';
    else if (dismissed.has(def.id)) state = 'DISMISSED';
    else if (!prereq.met) state = 'BLOCKED';
    else if (!def.relevantStages.includes(inputs.lifecycleStage)) state = 'DEFERRED';
    else state = 'AVAILABLE';

    // Priority (§3): base + relevance boost + urgency; deterministic.
    let priorityScore = def.basePriority;
    if (def.relevantStages.includes(inputs.lifecycleStage)) priorityScore += 10;
    if ((inputs.lifecycleStage === 'DECLINING' || inputs.lifecycleStage === 'DORMANT') && def.category === 'Engagement') priorityScore += 8;
    // Only actionable states carry their full weight in ranking.
    priorityScore = Math.max(0, Math.min(120, priorityScore));

    return {
      id: def.id, title: def.title, category: def.category, state,
      priorityScore, priorityTier: tierFor(priorityScore),
      reason: reasonFor(state, def, prereq),
      blockingFactors: state === 'BLOCKED' ? prereq.blockingFactors : [],
      dependencies: prereq.dependencies,
      expectedImpact: def.expectedImpact,
      explanation: {
        why: def.why,
        whyNow: state === 'AVAILABLE'
          ? `${inputs.lifecycleStage} stage — this is the right next step.`
          : state === 'BLOCKED' ? 'Blocked until prerequisites are met.'
          : state === 'DEFERRED' ? 'Deferred to a more relevant lifecycle stage.'
          : state === 'COMPLETED' ? 'Already complete.' : 'Dismissed.',
        expectedOutcome: def.expectedOutcome,
        requiredPrerequisites: prereq.requiredPrerequisites,
      },
      actionHref: def.href,
    };
  });

  const recommendedActions = actions
    .filter((a) => a.state === 'AVAILABLE')
    .sort((a, b) => b.priorityScore - a.priorityScore || (a.id < b.id ? -1 : 1));

  return {
    companyId: inputs.companyId,
    lifecycleStage: inputs.lifecycleStage,
    healthState: inputs.healthState,
    nextBestAction: recommendedActions[0] ?? null,
    recommendedActions,
    actions,
    evaluatedAt: inputs.now,
  };
}

/** The canonical action ids (so consumers never redefine them). */
export const CUSTOMER_SUCCESS_ACTION_IDS = ACTION_DEFS.map((d) => d.id);
