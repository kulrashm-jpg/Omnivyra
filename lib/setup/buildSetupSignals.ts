/**
 * buildSetupSignals — normalize raw, canonical, tenant-specific data fetched by
 * the command-center hook into the SetupSignals contract the registry evaluates.
 *
 * This is the ONLY place raw API shapes are read for Setup. No scoring (engine),
 * no UI. Channels come from the canonical social-accounts connection endpoint
 * (never profile URLs). Categories with no readable signal are marked
 * available:false with a canonical reason so the engine renders a capability
 * note instead of hiding them.
 */

import type { SetupSignals } from '../../config/setupRegistry';
import type { FeatureStatus } from '../../backend/services/commandCenterReadinessService';

const nonEmpty = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return Boolean(v);
};

export interface RawSetupInputs {
  /** profileData.profile from /api/company-profile (or null). */
  profile: Record<string, unknown> | null;
  /** Feature-completion features (backend-computed). */
  features: FeatureStatus[];
  /**
   * Canonical social connection rows from /api/social-accounts/status
   * (accounts[]), or null when that endpoint was not readable.
   */
  socialAccounts: Array<{
    platform_key?: string;
    platform_label?: string;
    category?: string;
    connected?: boolean;
    oauth_configured?: boolean;
  }> | null;
  /** Membership summary from /api/company/team-summary, or null when unreadable. */
  teamSummary: { ownerExists: boolean; memberCount: number } | null;
  /** External-API catalog (every supported provider). */
  apiCatalog: Array<{ id: string; name: string }>;
  /** Ids of providers with an enabled config for this tenant. */
  configuredApiIds: Set<string>;
  /** Whether the API catalog request succeeded. */
  apiCatalogAvailable: boolean;
  /** Subscription tier from /api/user/subscription, or null when unreadable. */
  subscriptionTier: string | null;
}

function featureDone(features: FeatureStatus[], key: string): boolean {
  const f = features.find((x) => x.key === key);
  return Boolean(f && (f.status === 'completed' || f.score >= 1));
}

export function buildSetupSignals(input: RawSetupInputs): SetupSignals {
  const p = input.profile ?? {};

  const companySize = nonEmpty(p['team_size']) || nonEmpty(p['company_size']) || nonEmpty(p['size']);

  // Channels — canonical connection truth from social_accounts (never URLs).
  let channels: SetupSignals['channels'];
  let oauthProviders: SetupSignals['oauthProviders'];
  if (Array.isArray(input.socialAccounts)) {
    const social = input.socialAccounts.filter((a) => (a.category ?? 'social') === 'social');
    const supported = social
      .map((a) => a.platform_label || a.platform_key || '')
      .filter((v) => v.length > 0);
    const connected = social
      .filter((a) => a.connected === true)
      .map((a) => a.platform_label || a.platform_key || '')
      .filter((v) => v.length > 0);
    channels = { available: true, reason: null, supported, connected };
    const availableCount = input.socialAccounts.filter((a) => a.oauth_configured === true).length;
    oauthProviders = {
      available: true,
      reason: null,
      availableCount,
      totalCount: input.socialAccounts.length,
    };
  } else {
    channels = {
      available: false,
      reason: 'Channel connection status could not be loaded. It will refresh automatically.',
      supported: [],
      connected: [],
    };
    oauthProviders = { available: false, reason: null, availableCount: 0, totalCount: 0 };
  }

  // Team — from the lightweight membership summary readable by every member.
  const team: SetupSignals['team'] = input.teamSummary
    ? {
        available: true,
        reason: null,
        ownerExists: input.teamSummary.ownerExists,
        memberExists: input.teamSummary.memberCount > 0,
      }
    : {
        available: false,
        reason: 'Team summary could not be loaded. It will refresh automatically.',
        ownerExists: false,
        memberExists: false,
      };

  const providers = input.apiCatalog.map((api) => ({
    id: api.id,
    name: api.name,
    configured: input.configuredApiIds.has(api.id),
  }));

  const tier = input.subscriptionTier;

  return {
    identity: {
      companyName: nonEmpty(p['name']),
      industry: nonEmpty(p['industry']) || nonEmpty(p['industry_list']),
      companySize,
      websiteConnected: nonEmpty(p['website_url']) || featureDone(input.features, 'website_connected'),
    },
    brand: {
      logo: nonEmpty(p['logo_url']),
      voice: nonEmpty(p['brand_voice']) || nonEmpty(p['brand_voice_list']),
      positioning: nonEmpty(p['brand_positioning']),
    },
    team,
    channels,
    extension: {
      installed: featureDone(input.features, 'chrome_extension_installed'),
    },
    externalApis: {
      available: input.apiCatalogAvailable,
      reason: input.apiCatalogAvailable ? null : 'The integration catalog could not be loaded. It will refresh automatically.',
      providers,
    },
    oauthProviders,
    webhooks: {
      // Webhooks are supported product-wide but their status is managed in
      // Integrations; a dedicated count is not wired into Setup yet (deferred),
      // so this is a capability note, not a scored/penalizing factor.
      supported: true,
      available: false,
      reason: 'Webhook configuration is managed in Integrations.',
      configuredCount: 0,
    },
    ai: {
      // No tenant-specific AI-configuration signal is client-readable; AI is
      // provisioned at the platform level for every workspace.
      supported: false,
      reason: 'AI generation is configured at the platform level for every workspace.',
    },
    billing: {
      available: tier !== null,
      reason: tier !== null ? null : 'Billing information could not be loaded.',
      tier,
      hasPaidPlan: tier !== null && tier.toLowerCase() !== 'free',
    },
  };
}
