/**
 * Canonical Workspace Setup Registry (capability-aware)
 * -----------------------------------------------------
 * Single source of truth for every Workspace Setup category + factor. Every
 * Setup card/panel is generated from this registry; NO setup logic lives in a
 * component and NO completion value is hardcoded.
 *
 * Capability model (COMMAND-CENTER-SETUP-002):
 *   Every category exposes { supported, enabled, available, reason } via
 *   `capability(signals)`. Categories NEVER silently disappear — an
 *   unsupported / unavailable category is still returned with an explicit
 *   reason and rendered as a capability note. Only categories that are
 *   supported && enabled && available with weight > 0 contribute to the score.
 *
 * All completion signals are canonical + tenant-specific (see SetupSignals),
 * assembled once in lib/setup/buildSetupSignals — no profile-URL heuristics.
 *
 * Uses the SHARED capability engine + contract (lib/shared/capabilityRegistry):
 * one engine, one evaluation pipeline, one capability model across Setup +
 * Readiness (+ future Mastery). Evaluated by evaluateCapabilityRegistry.
 */

import type { CapabilityCategoryDef, CapabilityFactorDef, CategoryCapability, FactorEvalResult } from '../lib/shared/capabilityRegistry';

/** Canonical, tenant-specific signals the registry evaluates. */
export interface SetupSignals {
  identity: {
    companyName: boolean;
    industry: boolean;
    companySize: boolean;
    websiteConnected: boolean;
  };
  brand: {
    logo: boolean;
    voice: boolean;
    positioning: boolean;
  };
  team: {
    available: boolean;
    reason: string | null;
    ownerExists: boolean;
    memberExists: boolean;
  };
  channels: {
    available: boolean;
    reason: string | null;
    /** Product-supported platforms (display labels). */
    supported: string[];
    /** Canonically connected platforms (display labels), from social_accounts. */
    connected: string[];
    /** Sticky: the company has connected a channel at least once (latched feature).
     *  Keeps the capability credited even when no connection is currently live. */
    everConnected: boolean;
  };
  extension: {
    installed: boolean;
  };
  externalApis: {
    available: boolean;
    reason: string | null;
    providers: Array<{ id: string; name: string; configured: boolean }>;
    /** Sticky: the company has configured an external API at least once (latched). */
    everConfigured: boolean;
  };
  oauthProviders: {
    available: boolean;
    reason: string | null;
    availableCount: number;
    totalCount: number;
  };
  webhooks: {
    supported: boolean;
    available: boolean;
    reason: string | null;
    configuredCount: number;
  };
  ai: {
    supported: boolean;
    reason: string;
  };
  billing: {
    available: boolean;
    reason: string | null;
    tier: string | null;
    hasPaidPlan: boolean;
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const ALWAYS: CategoryCapability = { supported: true, enabled: true, available: true, reason: null };

const need = (
  ok: boolean,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  ok ? { score: 1 } : { score: 0, missing: [missing], recommendation, nextAction };

// ---------------------------------------------------------------------------
// Registry.
// ---------------------------------------------------------------------------

export const SETUP_REGISTRY: CapabilityCategoryDef<SetupSignals>[] = [
  {
    id: 'identity',
    title: 'Identity',
    weight: 30,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'identity.company_name',
        title: 'Company name',
        description: 'The workspace company name used across reports, content, and campaigns.',
        weight: 1,
        evaluate: (s) =>
          need(s.identity.companyName, 'Company name is not set', 'Add your company name so generated work is branded correctly.', {
            label: 'Add company name',
            actionId: 'profile.ai_fill',
          }),
      },
      {
        id: 'identity.industry',
        title: 'Industry',
        description: 'Your industry, used to benchmark and tailor recommendations.',
        weight: 1,
        evaluate: (s) =>
          need(s.identity.industry, 'Industry is not set', 'Select your industry to benchmark your position and tailor output.', {
            label: 'Add industry',
            actionId: 'profile.ai_fill',
          }),
      },
      {
        id: 'identity.organization',
        title: 'Organization details',
        description: 'Company size / team size used to calibrate strategy.',
        weight: 1,
        evaluate: (s) =>
          need(s.identity.companySize, 'Company size is not set', 'Add your company size so planning matches your organization.', {
            label: 'Add organization details',
            actionId: 'profile.ai_fill',
          }),
      },
      {
        id: 'identity.website',
        title: 'Website',
        description: 'Your website, crawled for content, authority, and gap analysis.',
        weight: 2,
        evaluate: (s) =>
          need(s.identity.websiteConnected, 'No website connected', 'Connect your website to unlock content analysis and readiness insights.', {
            label: 'Connect website',
            actionId: 'profile.edit',
          }),
      },
    ],
  },
  {
    id: 'brand',
    title: 'Brand',
    weight: 15,
    capability: () => ALWAYS,
    factors: (s) => [
      {
        id: 'brand.logo',
        title: 'Logo',
        description: 'Your logo, applied to generated visual assets.',
        weight: 2,
        evaluate: () =>
          need(s.brand.logo, 'No logo uploaded', 'Upload your logo so creator assets are on-brand.', {
            label: 'Upload logo',
            actionId: 'profile.edit',
          }),
      },
      {
        id: 'brand.voice',
        title: 'Brand voice',
        description: 'Your brand voice, used to keep generated copy on-tone.',
        weight: 1,
        evaluate: () =>
          need(s.brand.voice, 'Brand voice not defined', 'Define your brand voice so written content stays on-tone.', {
            label: 'Define brand voice',
            actionId: 'profile.ai_fill',
          }),
      },
      {
        id: 'brand.positioning',
        title: 'Brand positioning',
        description: 'Your positioning statement, used to align messaging.',
        weight: 1,
        evaluate: () =>
          need(s.brand.positioning, 'Brand positioning not defined', 'Add your positioning so campaigns align to your market stance.', {
            label: 'Add positioning',
            actionId: 'profile.ai_fill',
          }),
      },
    ],
  },
  {
    id: 'team',
    title: 'Team',
    weight: 10,
    // Team is available to every member via the membership-summary endpoint —
    // never hidden by permission. Unavailable only if the summary can't load.
    capability: (s) =>
      s.team.available
        ? ALWAYS
        : { supported: true, enabled: true, available: false, reason: s.team.reason ?? 'Team summary is temporarily unavailable.' },
    factors: (s) => [
      {
        id: 'team.owner',
        title: 'Workspace owner',
        description: 'An owner/administrator is assigned to this workspace.',
        weight: 2,
        evaluate: () =>
          need(s.team.ownerExists, 'No workspace owner assigned', 'Assign a workspace owner to manage members and settings.', {
            label: 'Manage team',
            actionId: 'team.manage',
          }),
      },
      {
        id: 'team.members',
        title: 'Team members',
        description: 'Members collaborate in this workspace.',
        weight: 1,
        evaluate: () =>
          need(s.team.memberExists, 'No active team members', 'Invite teammates so work can be shared and reviewed.', {
            label: 'Invite members',
            actionId: 'team.manage',
          }),
      },
    ],
  },
  {
    id: 'channels',
    title: 'Channels',
    weight: 25,
    capability: (s) =>
      s.channels.available
        ? ALWAYS
        : { supported: true, enabled: true, available: false, reason: s.channels.reason ?? 'Channel connection status is temporarily unavailable.' },
    factors: (s) => {
      const connectedSet = new Set(s.channels.connected.map((p) => p.toLowerCase()));
      const connectedPlatforms = s.channels.supported.filter((p) => connectedSet.has(p.toLowerCase()));
      const anyConnected = connectedPlatforms.length > 0;
      // Capability is proven the moment ONE channel is connected — now (anyConnected)
      // or ever (everConnected, a latched feature that survives disconnection).
      const capabilityProven = anyConnected || s.channels.everConnected;

      // Show ONLY the channels the company has connected. Which platforms to add is
      // the company's call, so UNCONNECTED platforms are never listed here as pending
      // tasks — that keeps the card about what's live, not a nag list.
      const factors: CapabilityFactorDef<SetupSignals>[] = connectedPlatforms.map((platform) => ({
        id: `channels.${platform.toLowerCase()}`,
        title: platform,
        description: `Publish and engage on ${platform} directly from the app.`,
        weight: 1,
        evaluate: (): FactorEvalResult => ({ score: 1 }),
      }));

      if (!anyConnected) {
        if (capabilityProven) {
          // Connected a channel before but none is live now — carry the proven credit.
          factors.push({
            id: 'channels.capability_proven',
            title: 'Channel integration',
            description: 'You have connected a channel before — the integration capability is proven.',
            weight: 1,
            evaluate: (): FactorEvalResult => ({ score: 1 }),
          });
        } else {
          // Never connected — a SINGLE call-to-action to connect the first channel,
          // not the full list of platforms.
          factors.push({
            id: 'channels.connect_first',
            title: 'Connect a channel',
            description: 'Connect at least one channel to publish and engage.',
            weight: 1,
            evaluate: (): FactorEvalResult => ({
              score: 0,
              missing: ['No channel is connected yet'],
              recommendation: 'Connect a channel to publish and track engagement from one place.',
              nextAction: { label: 'Connect a channel', actionId: 'channels.connect' },
            }),
          });
        }
      }

      return factors;
    },
  },
  {
    id: 'extension',
    title: 'Browser extension',
    weight: 5,
    capability: () => ALWAYS,
    factors: (s) => [
      {
        id: 'extension.installed',
        title: 'Chrome extension',
        description: 'The browser extension for inline replies and faster engagement.',
        weight: 1,
        evaluate: () =>
          need(s.extension.installed, 'Chrome extension not installed', 'Install the extension to reply and follow conversations from your browser.', {
            label: 'Install extension',
            actionId: 'extension.install',
          }),
      },
    ],
  },
  {
    id: 'external_apis',
    title: 'External APIs',
    weight: 10,
    capability: (s) =>
      s.externalApis.available
        ? s.externalApis.providers.length > 0
          ? ALWAYS
          : { supported: true, enabled: true, available: false, reason: 'No external-API providers are offered for this workspace.' }
        : { supported: true, enabled: true, available: false, reason: s.externalApis.reason ?? 'API catalog is temporarily unavailable.' },
    factors: (s) => {
      const anyConfigured = s.externalApis.providers.some((p) => p.configured);
      // Capability proven by configuring ONE API — now, or ever (latched).
      const capabilityProven = anyConfigured || s.externalApis.everConfigured;
      const factors = s.externalApis.providers.map((p) => ({
        id: `external_apis.${p.id}`,
        title: p.name,
        description: `API key for ${p.name}, powering related automation.`,
        // One configured API proves the capability; the rest are optional (weight 0)
        // — still shown so the user can add them, never blocking 100%.
        weight: capabilityProven ? (p.configured ? 1 : 0) : 1,
        evaluate: (): FactorEvalResult =>
          p.configured
            ? { score: 1 }
            : {
                score: 0,
                missing: [`${p.name} is not configured`],
                recommendation: `Add your ${p.name} API key to enable its capabilities.`,
                nextAction: { label: `Configure ${p.name}`, actionId: 'apis.configure' },
              },
      }));

      // Sticky credit: configured an API before but none is live now.
      if (capabilityProven && !anyConfigured) {
        factors.push({
          id: 'external_apis.capability_proven',
          title: 'External API integration',
          description: 'You have configured an external API before — the integration capability is proven.',
          weight: 1,
          evaluate: (): FactorEvalResult => ({ score: 1 }),
        });
      }

      return factors;
    },
  },
  {
    id: 'oauth_providers',
    title: 'OAuth providers',
    // Capability-only (informational, excluded from score). Connecting even ONE
    // account via OAuth proves the user understands the setup — so once any channel
    // is connected (now or ever), this reads as accomplished rather than a to-do.
    weight: 0,
    capability: (s) =>
      s.oauthProviders.available
        ? {
            supported: true,
            enabled: true,
            available: true,
            reason:
              s.oauthProviders.reason ??
              `${s.oauthProviders.availableCount} of ${s.oauthProviders.totalCount} providers are available to connect. Connect accounts under Channels.`,
          }
        : { supported: true, enabled: true, available: false, reason: s.oauthProviders.reason ?? 'Provider availability is temporarily unavailable.' },
    factors: (s) => {
      const oauthProven = s.channels.connected.length > 0 || s.channels.everConnected;
      // Only surface an accomplished row once a connection exists; otherwise the
      // capability note ("N of M providers available to connect") is shown instead.
      return oauthProven
        ? [
            {
              id: 'oauth_providers.connected',
              title: 'OAuth connection established',
              description: 'You have connected an account via OAuth — the setup capability is proven.',
              weight: 0,
              evaluate: (): FactorEvalResult => ({ score: 1 }),
            },
          ]
        : [];
    },
  },
  {
    id: 'ai',
    title: 'AI',
    weight: 0,
    // AI generation is provisioned platform-wide for every workspace — always
    // available, no per-tenant setup. Surfaced as an accomplished capability.
    capability: (s) => ({
      supported: s.ai.supported,
      enabled: s.ai.supported,
      available: s.ai.supported,
      reason: s.ai.reason,
    }),
    factors: (s) =>
      s.ai.supported
        ? [
            {
              id: 'ai.available',
              title: 'AI generation available',
              description: 'AI generation is provisioned at the platform level for every workspace.',
              weight: 0,
              evaluate: (): FactorEvalResult => ({ score: 1 }),
            },
          ]
        : [],
  },
  {
    id: 'billing',
    title: 'Billing',
    // Capability-only: differentiate unsupported / supported-incomplete /
    // supported-complete via capability + reason. Excluded from score (a free
    // plan must not penalize Setup).
    weight: 0,
    capability: (s) =>
      !s.billing.available
        ? { supported: true, enabled: true, available: false, reason: s.billing.reason ?? 'Billing information is temporarily unavailable.' }
        : {
            supported: true,
            enabled: true,
            available: true,
            reason: s.billing.hasPaidPlan
              ? `Plan: ${s.billing.tier ?? 'paid'}.`
              : 'Free plan — no billing setup required. Upgrade to unlock premium capabilities.',
          },
    factors: () => [],
  },
];
