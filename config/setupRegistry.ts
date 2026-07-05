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

import type { CapabilityCategoryDef, CategoryCapability, FactorEvalResult } from '../lib/shared/capabilityRegistry';

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
  };
  extension: {
    installed: boolean;
  };
  externalApis: {
    available: boolean;
    reason: string | null;
    providers: Array<{ id: string; name: string; configured: boolean }>;
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
      const connected = new Set(s.channels.connected.map((p) => p.toLowerCase()));
      const anyConnected = connected.size > 0;
      // "Only channels the company uses": a CONNECTED platform is a used channel
      // and is scored (done). UNCONNECTED platforms are optional/informational
      // (weight 0) — still shown so the user can add them, but they never block
      // 100%. If NOTHING is connected yet, every platform is scored (weight 1) so
      // the category reads as incomplete until the company connects at least one.
      // This makes Setup 100% reachable without forcing every niche platform.
      return s.channels.supported.map((platform) => {
        const isConnected = connected.has(platform.toLowerCase());
        return {
          id: `channels.${platform.toLowerCase()}`,
          title: platform,
          description: `Publish and engage on ${platform} directly from the app.`,
          weight: anyConnected ? (isConnected ? 1 : 0) : 1,
          evaluate: (): FactorEvalResult =>
            isConnected
              ? { score: 1 }
              : {
                  score: 0,
                  missing: [`${platform} is not connected`],
                  recommendation: `Connect ${platform} to publish and track engagement from one place.`,
                  nextAction: { label: `Connect ${platform}`, actionId: 'channels.connect' },
                },
        };
      });
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
    factors: (s) =>
      s.externalApis.providers.map((p) => ({
        id: `external_apis.${p.id}`,
        title: p.name,
        description: `API key for ${p.name}, powering related automation.`,
        weight: 1,
        evaluate: (): FactorEvalResult =>
          p.configured
            ? { score: 1 }
            : {
                score: 0,
                missing: [`${p.name} is not configured`],
                recommendation: `Add your ${p.name} API key to enable its capabilities.`,
                nextAction: { label: `Configure ${p.name}`, actionId: 'apis.configure' },
              },
      })),
  },
  {
    id: 'oauth_providers',
    title: 'OAuth providers',
    // Capability-only (informational): OAuth availability is platform-managed;
    // the customer-actionable connection lives under Channels. Excluded from score.
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
    factors: () => [],
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    // Capability-only (optional/advanced). Excluded from score so a workspace
    // with no webhooks is not penalized.
    weight: 0,
    capability: (s) =>
      !s.webhooks.supported
        ? { supported: false, enabled: false, available: false, reason: s.webhooks.reason ?? 'Webhooks are not part of this workspace.' }
        : s.webhooks.available
          ? {
              supported: true,
              enabled: true,
              available: true,
              reason:
                s.webhooks.configuredCount > 0
                  ? `${s.webhooks.configuredCount} webhook${s.webhooks.configuredCount === 1 ? '' : 's'} configured.`
                  : 'No webhooks configured (optional).',
            }
          : { supported: true, enabled: true, available: false, reason: s.webhooks.reason ?? 'Webhook status is managed in Integrations.' },
    factors: () => [],
  },
  {
    id: 'ai',
    title: 'AI',
    weight: 0,
    // Capability-aware placeholder — never permanently omitted.
    capability: (s) => ({
      supported: s.ai.supported,
      enabled: s.ai.supported,
      available: s.ai.supported,
      reason: s.ai.reason,
    }),
    factors: () => [],
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
