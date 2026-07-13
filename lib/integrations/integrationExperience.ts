/**
 * integrationExperience.ts — the ONE canonical Integration Experience read-model
 * (ONBOARD-006).
 *
 * PURE and deterministic: it composes the static catalog (integrationCatalog.ts)
 * with the onboarding journey — the SINGLE status + dependency + Platform Ready
 * authority (onboardingJourneyService, surfaced by GET /api/onboarding/journey).
 * It NEVER computes status, dependencies, or readiness itself:
 *   - status comes from the journey stage / social provider state (relabelled
 *     into the canonical status vocabulary — no inference);
 *   - dependencies / unlocks / blocked-by come from the journey stage's
 *     dependencies + guidance (the one dependency authority);
 *   - Platform Ready is read from journey.platformReady (never recomputed).
 * Catalog-only entries (no live authority signal) read as "Available".
 */

import type { OnboardingJourney, JourneyStage } from '../../hooks/useOnboardingJourney';
import {
  INTEGRATION_CATALOG,
  CATEGORY_ORDER,
  type IntegrationDef,
  type IntegrationCategory,
} from './integrationCatalog';

/** §3 — the canonical status vocabulary (relabelled from existing authorities). */
export type IntegrationStatus =
  | 'connected' | 'detected' | 'available' | 'pending'
  | 'blocked' | 'skipped' | 'disconnected' | 'error' | 'expired';

export interface IntegrationView {
  id: string;
  name: string;
  category: IntegrationCategory;
  provider: string;
  required: boolean;
  why: string;
  connectHref: string;
  learnMoreHref: string;
  estimatedMinutes: number;
  supportedProviders?: string[];
  status: IntegrationStatus;
  /** Live detail from the authority (connected platforms, reconnect hints). */
  detail: string | null;
  /** Human-readable dependency titles (from the journey stage). */
  dependsOn: string[];
  /** What connecting this unlocks (from the journey stage guidance). */
  unlocks: string | null;
  /** Unmet dependency titles blocking this integration. */
  blockedBy: string[];
  /** The connected provider name, when known (e.g. CMS platform). */
  connectedProvider: string | null;
  /** True when the canonical authority recommends this next. */
  recommended: boolean;
}

export interface IntegrationCategoryGroup {
  category: IntegrationCategory;
  integrations: IntegrationView[];
}

export interface IntegrationExperience {
  categories: IntegrationCategoryGroup[];
  /** §5 — the canonical next-best integrations (from the authority's ordering). */
  nextRecommended: IntegrationView[];
  /** §5 — integrations already connected. */
  recentlyConnected: IntegrationView[];
  /** §5 — actionable, not-yet-connected integrations still to do. */
  remaining: IntegrationView[];
  /** §5 — deterministic platform-benefit copy (no AI). */
  platformBenefits: string[];
  /** §7 — read straight from the onboarding authority; never recomputed here. */
  platformReady: boolean;
  completionPercentage: number;
}

const CONNECTED_STATUSES: ReadonlySet<IntegrationStatus> = new Set(['connected']);
const ACTIONABLE_STATUSES: ReadonlySet<IntegrationStatus> = new Set([
  'available', 'pending', 'detected', 'expired', 'error', 'disconnected',
]);

/** §5 — deterministic platform benefits (static; never AI-generated). */
const PLATFORM_BENEFITS: ReadonlyArray<string> = [
  'Publish to your website and social channels from one place.',
  'Reports tie your content to real traffic and search demand.',
  'Campaign planning uses the channels you actually operate.',
  'Everything stays in sync with your connected tools.',
];

/** Relabel a journey stage status → canonical integration status (no inference). */
function statusForStage(stageStatus: JourneyStage['status']): IntegrationStatus {
  switch (stageStatus) {
    case 'completed':   return 'connected';
    case 'in_progress': return 'pending';
    case 'blocked':     return 'blocked';
    case 'skipped':     return 'skipped';
    case 'dismissed':   return 'skipped';
    case 'pending':
    case 'not_started':
    default:            return 'available';
  }
}

/** Relabel a social provider state → canonical integration status (no inference). */
function statusForProviderState(state: string): IntegrationStatus {
  switch (state) {
    case 'connected':          return 'connected';
    case 'detected':           return 'detected';
    case 'expired':            return 'expired';
    case 'reconnect_required': return 'expired';
    case 'failed':             return 'error';
    case 'pending':
    default:                   return 'pending';
  }
}

function stageById(journey: OnboardingJourney | null, id: string | undefined): JourneyStage | undefined {
  if (!journey || !id) return undefined;
  return journey.stages.find((s) => s.id === id);
}

/** Resolve one catalog entry against the journey authority. Pure. */
function resolveIntegration(
  def: IntegrationDef,
  journey: OnboardingJourney | null,
  recommendedStageIds: Set<string>,
): IntegrationView {
  const base = {
    id: def.id, name: def.name, category: def.category, provider: def.provider,
    required: def.required, why: def.why, connectHref: def.connectHref,
    learnMoreHref: def.learnMoreHref, estimatedMinutes: def.estimatedMinutes,
    supportedProviders: def.supportedProviders,
  };

  // Catalog-only → Available; no live authority signal.
  if (def.catalogOnly || !journey) {
    return {
      ...base, status: 'available', detail: null, dependsOn: [], unlocks: null,
      blockedBy: [], connectedProvider: null, recommended: false,
    };
  }

  const stage = stageById(journey, def.journeyStage);
  const dependsOn = (stage?.dependencies ?? []).map((d) => d.title);
  const blockedBy = (stage?.dependencies ?? []).filter((d) => !d.met).map((d) => d.title);
  const unlocks = stage?.guidance?.unlocks ?? null;

  // Social: per-platform status from the social stage's providers[].
  if (def.socialPlatform && stage) {
    const entry = (stage.providers ?? []).find(
      (p) => p.platform.toLowerCase() === def.socialPlatform!.toLowerCase(),
    );
    let status: IntegrationStatus;
    if (entry) status = statusForProviderState(entry.state);
    else if (stage.status === 'blocked') status = 'blocked';
    else if (stage.status === 'skipped' || stage.status === 'dismissed') status = 'skipped';
    else status = 'available';
    return {
      ...base, status,
      detail: entry ? `${def.name}: ${entry.state.replace(/_/g, ' ')}` : null,
      dependsOn, unlocks, blockedBy,
      connectedProvider: entry?.state === 'connected' ? def.name : null,
      recommended: recommendedStageIds.has('social_accounts') && ACTIONABLE_STATUSES.has(status),
    };
  }

  // Website/CMS/GA/GSC: status straight from the mapped stage.
  if (stage) {
    const status = statusForStage(stage.status);
    const connectedProvider = status === 'connected' ? (stage.providers?.[0]?.platform ?? null) : null;
    return {
      ...base, status, detail: stage.detail, dependsOn, unlocks, blockedBy,
      connectedProvider,
      recommended: recommendedStageIds.has(def.journeyStage!) && ACTIONABLE_STATUSES.has(status),
    };
  }

  // Mapped to a stage id the journey didn't return → Available (defensive).
  return {
    ...base, status: 'available', detail: null, dependsOn, unlocks, blockedBy,
    connectedProvider: null, recommended: false,
  };
}

/**
 * Build the canonical Integration Experience from the onboarding journey.
 * Deterministic — the same journey always yields the same experience (resume /
 * refresh safe). No IO, no status/readiness computation.
 */
export function buildIntegrationExperience(journey: OnboardingJourney | null): IntegrationExperience {
  const recommendedStageIds = new Set((journey?.readiness?.recommendations ?? []).map((r) => r.id));

  const views = INTEGRATION_CATALOG.map((def) => resolveIntegration(def, journey, recommendedStageIds));
  const byId = new Map(views.map((v) => [v.id, v]));

  // Categories — the full canonical list, grouped in category order.
  const categories: IntegrationCategoryGroup[] = CATEGORY_ORDER
    .map((category) => ({ category, integrations: views.filter((v) => v.category === category) }))
    .filter((g) => g.integrations.length > 0);

  // §5 Next Recommended — follow the authority's recommendation ordering; one
  // representative actionable integration per recommended stage, capped at 3.
  const nextRecommended: IntegrationView[] = [];
  for (const rec of journey?.readiness?.recommendations ?? []) {
    const candidate = views.find(
      (v) => !nextRecommended.includes(v)
        && ACTIONABLE_STATUSES.has(v.status)
        && (INTEGRATION_CATALOG.find((d) => d.id === v.id)?.journeyStage === rec.id),
    );
    if (candidate) nextRecommended.push(candidate);
    if (nextRecommended.length >= 3) break;
  }

  const recentlyConnected = views.filter((v) => CONNECTED_STATUSES.has(v.status));
  const nextIds = new Set(nextRecommended.map((v) => v.id));
  const remaining = views.filter(
    (v) => !nextIds.has(v.id) && !CONNECTED_STATUSES.has(v.status) && v.status !== 'skipped',
  );

  void byId;
  return {
    categories,
    nextRecommended,
    recentlyConnected,
    remaining,
    platformBenefits: [...PLATFORM_BENEFITS],
    platformReady: journey?.platformReady ?? false,
    completionPercentage: journey?.readiness?.completionPercentage ?? 0,
  };
}
