/**
 * platformActivation.ts — the ONE canonical Platform Activation read-model
 * (ONBOARD-007).
 *
 * PURE and deterministic. It composes the EXISTING authorities:
 *   - the onboarding journey (the single readiness / Platform Ready authority)
 *   - the integration experience (ONBOARD-006, itself derived from the journey)
 * into a capability-availability view. It NEVER computes readiness and NEVER
 * introduces a second readiness model — `platformReady` is read straight from
 * the journey. Capability status is derived only from existing integration /
 * onboarding signals. No IO, no writes (§6/§7).
 */

import type { OnboardingJourney } from '../../hooks/useOnboardingJourney';
import {
  buildIntegrationExperience,
  type IntegrationView,
} from '../integrations/integrationExperience';
import { INTEGRATION_BY_ID } from '../integrations/integrationCatalog';
import {
  CAPABILITY_CATALOG,
  SIGNAL_PUBLISH_CHANNEL,
  type CapabilityDef,
  type CapabilitySignal,
} from './capabilityCatalog';

/** §2 — capability availability statuses. */
export type CapabilityStatus =
  | 'available' | 'limited' | 'requires_setup' | 'unavailable' | 'recommended';

export interface CapabilityView {
  id: string;
  name: string;
  why: string;
  status: CapabilityStatus;
  /** §4 — human labels of the missing prerequisites (required first). */
  missingPrerequisites: string[];
  /** §4 — what becomes available once prerequisites are met. */
  unlocks: string;
  /** Where to go to satisfy the first missing prerequisite (existing surface). */
  actionHref: string | null;
  /** True when satisfying a prerequisite is the authority's recommended next step. */
  recommended: boolean;
}

export interface OptionalImprovement {
  id: string;
  label: string;
  why: string;
  href: string;
}

export interface NextImprovement {
  integrationId: string;
  name: string;
  href: string;
  /** Capability names this integration unlocks or improves. */
  unlocks: string[];
}

export interface PlatformActivation {
  /** §6/§7 — read straight from the onboarding authority; never recomputed. */
  platformReady: boolean;
  completionPercentage: number;
  capabilities: CapabilityView[];
  /** §3 — capabilities that are operational now (available/limited). */
  recentlyUnlocked: CapabilityView[];
  /** §3 — next recommended improvements, following the authority's ordering. */
  nextRecommended: NextImprovement[];
  /** §5 — optional enhancements (never blocking). */
  optionalImprovements: OptionalImprovement[];
}

const OPERATIONAL: ReadonlySet<CapabilityStatus> = new Set(['available', 'limited']);

/** Signal resolution context built once from the existing authorities. */
interface SignalContext {
  stageCompleted: (id: string) => boolean;
  integrationById: (id: string) => IntegrationView | undefined;
  publishChannelConnected: boolean;
  /** Journey-recommended stage ids (the authority's next-best ordering). */
  recommendedStageIds: Set<string>;
}

function isMet(signal: CapabilitySignal, ctx: SignalContext): boolean {
  if (signal === SIGNAL_PUBLISH_CHANNEL) return ctx.publishChannelConnected;
  const integration = INTEGRATION_BY_ID.get(signal);
  if (integration) return ctx.integrationById(signal)?.status === 'connected';
  // Otherwise a journey stage id.
  return ctx.stageCompleted(signal);
}

/** Is an unmet signal hard-blocked (a prerequisite that isn't yet actionable)? */
function isBlocked(signal: CapabilitySignal, ctx: SignalContext): boolean {
  if (signal === SIGNAL_PUBLISH_CHANNEL) return false; // always actionable
  const integration = INTEGRATION_BY_ID.get(signal);
  if (integration) return ctx.integrationById(signal)?.status === 'blocked';
  return false;
}

/** Human label + action href for a signal (reuses existing metadata). */
function signalLabel(signal: CapabilitySignal, ctx: SignalContext): { label: string; href: string | null } {
  if (signal === SIGNAL_PUBLISH_CHANNEL) return { label: 'a connected website or social channel', href: '/onboarding/integrations' };
  const integration = INTEGRATION_BY_ID.get(signal);
  if (integration) return { label: integration.name, href: integration.connectHref };
  if (signal === 'company') return { label: 'company setup', href: '/onboarding/company' };
  if (signal === 'company_review') return { label: 'a reviewed company profile', href: '/company-profile?onboarding=company-profile' };
  return { label: signal, href: null };
}

/** Does an unmet signal correspond to a journey-recommended next step? */
function signalIsRecommended(signal: CapabilitySignal, ctx: SignalContext): boolean {
  if (signal === SIGNAL_PUBLISH_CHANNEL) {
    return ctx.recommendedStageIds.has('website_cms') || ctx.recommendedStageIds.has('social_accounts');
  }
  const def = INTEGRATION_BY_ID.get(signal);
  if (def?.journeyStage) return ctx.recommendedStageIds.has(def.journeyStage);
  return ctx.recommendedStageIds.has(signal);
}

function resolveCapability(def: CapabilityDef, ctx: SignalContext): CapabilityView {
  const unmetRequired = def.requiredSignals.filter((s) => !isMet(s, ctx));
  const unmetEnhancing = def.enhancingSignals.filter((s) => !isMet(s, ctx));

  let status: CapabilityStatus;
  if (unmetRequired.length > 0) {
    // A hard-blocked required prerequisite → Unavailable; else Requires Setup.
    status = unmetRequired.some((s) => isBlocked(s, ctx)) ? 'unavailable' : 'requires_setup';
  } else if (unmetEnhancing.length > 0) {
    status = 'limited';
  } else {
    status = 'available';
  }

  // The missing prerequisites shown to the user (required first, then enhancing).
  const missingSignals = [...unmetRequired, ...unmetEnhancing];
  const missingPrerequisites = missingSignals.map((s) => signalLabel(s, ctx).label);

  // Recommended overlay: a not-fully-available capability whose missing signal
  // is the authority's recommended next step reads as "Recommended".
  const recommended = missingSignals.some((s) => signalIsRecommended(s, ctx));
  if ((status === 'requires_setup' || status === 'limited') && recommended) {
    status = 'recommended';
  }

  const firstMissing = missingSignals[0];
  const actionHref = firstMissing ? signalLabel(firstMissing, ctx).href : null;

  return {
    id: def.id, name: def.name, why: def.why, status,
    missingPrerequisites, unlocks: def.unlocksCopy, actionHref, recommended,
  };
}

/** §5 — optional enhancement catalog (deterministic; never blocking). */
function buildOptionalImprovements(
  integrations: IntegrationView[],
  ctx: SignalContext,
): OptionalImprovement[] {
  const out: OptionalImprovement[] = [];

  // Connect more of the optional integration categories (not yet connected).
  for (const it of integrations) {
    const optionalCategory = it.category === 'Social' || it.category === 'CRM'
      || it.category === 'Advertising' || it.category === 'Communication';
    if (!optionalCategory) continue;
    if (it.status === 'connected') continue;
    out.push({
      id: `connect_${it.id}`,
      label: `Connect ${it.name}`,
      why: it.why,
      href: it.connectHref,
    });
  }

  // Improve the company profile (when the optional review isn't completed).
  if (!ctx.stageCompleted('company_review')) {
    out.push({
      id: 'improve_company_profile',
      label: 'Improve your company profile',
      why: 'A reviewed profile sharpens every AI output.',
      href: '/company-profile?onboarding=company-profile',
    });
    out.push({
      id: 'upload_brand_assets',
      label: 'Upload brand assets',
      why: 'Logos and brand colors make generated creatives on-brand.',
      href: '/company-profile?onboarding=company-profile',
    });
  }

  return out;
}

/**
 * Build the canonical Platform Activation view from the onboarding journey.
 * Deterministic and pure — same journey → same activation (refresh/resume/replay
 * safe). Platform Ready is read from the journey, never recomputed.
 */
export function buildPlatformActivation(journey: OnboardingJourney | null): PlatformActivation {
  const integration = buildIntegrationExperience(journey);
  const integrationById = new Map(
    integration.categories.flatMap((c) => c.integrations).map((i) => [i.id, i]),
  );

  const stageCompleted = (id: string): boolean =>
    !!journey?.stages.find((s) => s.id === id && s.status === 'completed');

  const anySocialConnected = [...integrationById.values()].some(
    (i) => i.category === 'Social' && i.status === 'connected',
  );
  const publishChannelConnected =
    anySocialConnected || integrationById.get('website_cms')?.status === 'connected';

  const ctx: SignalContext = {
    stageCompleted,
    integrationById: (id) => integrationById.get(id),
    publishChannelConnected: !!publishChannelConnected,
    recommendedStageIds: new Set((journey?.readiness?.recommendations ?? []).map((r) => r.id)),
  };

  const capabilities = CAPABILITY_CATALOG.map((def) => resolveCapability(def, ctx));

  const recentlyUnlocked = capabilities.filter((c) => OPERATIONAL.has(c.status));

  // §3 Next recommended improvements — reuse the integration experience's
  // authority-ordered recommendations; annotate the capabilities each unlocks.
  const nextRecommended: NextImprovement[] = integration.nextRecommended.map((it) => ({
    integrationId: it.id,
    name: it.name,
    href: it.connectHref,
    unlocks: capabilitiesUnlockedBy(it.id, capabilities),
  }));

  const optionalImprovements = buildOptionalImprovements(
    integration.categories.flatMap((c) => c.integrations),
    ctx,
  );

  return {
    platformReady: integration.platformReady,
    completionPercentage: integration.completionPercentage,
    capabilities,
    recentlyUnlocked,
    nextRecommended,
    optionalImprovements,
  };
}

/** Names of capabilities whose required/enhancing signals include this integration. */
function capabilitiesUnlockedBy(integrationId: string, capabilities: CapabilityView[]): string[] {
  const names: string[] = [];
  for (const def of CAPABILITY_CATALOG) {
    const usesIt = def.requiredSignals.includes(integrationId) || def.enhancingSignals.includes(integrationId)
      || ((def.requiredSignals.includes(SIGNAL_PUBLISH_CHANNEL) || def.enhancingSignals.includes(SIGNAL_PUBLISH_CHANNEL))
          && isPublishChannelIntegration(integrationId));
    if (!usesIt) continue;
    const view = capabilities.find((c) => c.id === def.id);
    if (view && view.status !== 'available') names.push(def.name);
  }
  return names;
}

function isPublishChannelIntegration(integrationId: string): boolean {
  const def = INTEGRATION_BY_ID.get(integrationId);
  return def?.category === 'Social' || def?.id === 'website_cms';
}
