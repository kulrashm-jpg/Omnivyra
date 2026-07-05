/**
 * Canonical Readiness Registry (capability-aware)
 * -----------------------------------------------
 * Single source of truth for every Readiness category + factor, mirroring the
 * Setup architecture. Every category degrades through the capability model and
 * NEVER disappears; every factor either scores from a canonical signal or
 * renders as a capability note (excluded from scoring, never penalizing). No UI
 * component contains Readiness logic; no hardcoded score.
 *
 * Each scored factor is backed by a canonical provider (see buildReadinessSignals):
 *   Foundation      → /api/website-intelligence/canonical (domain / analytics / tracking)
 *   Audience        → company-profile fields
 *   Distribution    → /api/social-accounts/status (connection + refresh_status)
 *   Content         → /api/blogs · /api/creator-templates/collections · /api/creator-assets
 *   Campaign        → feature-completion (first campaign); objective/CTA/landing = capability providers
 *   Automation      → website snapshot (lead capture, CRM) · /api/automation/config (workflows)
 *   Trust           → website_url scheme (SSL); privacy/cookie/email = capability providers
 *
 * Scored via lib/shared/capabilityRegistry (evaluateCapabilityRegistry).
 */

import type { CapabilityCategoryDef, FactorEvalResult, CategoryCapability } from '../lib/shared/capabilityRegistry';

interface SignalCount {
  available: boolean;
  reason: string | null;
  count: number;
}
interface SignalFlag {
  available: boolean;
  reason: string | null;
  configured: boolean;
}

/** Normalized, canonical, tenant-specific Readiness signals. */
export interface ReadinessSignals {
  features: Record<string, number>;
  profile: {
    companyProfileComplete: boolean;
    industry: boolean;
    regions: boolean;
    targetAudience: boolean;
    /** Derivable from the profile: a defined audience + its context (ICP/industry). */
    personas: boolean;
    websiteUrl: string | null;
  };
  trust: {
    available: boolean;
    reason: string | null;
    /** A privacy / terms / legal page was found in the website crawl. */
    legalPagesPresent: boolean;
  };
  channels: {
    available: boolean;
    reason: string | null;
    connectedCount: number;
    totalCount: number;
    expiredCount: number;
    /** Connected, non-expired, refresh not failed/requires-reconnect. */
    publishReadyCount: number;
    /** Connected but refresh failed / requires reconnect (permission issue). */
    permissionIssueCount: number;
  };
  foundation: {
    available: boolean;
    reason: string | null;
    domainVerified: boolean;
    analyticsConnected: boolean;
    trackingActive: boolean;
  };
  content: {
    library: SignalCount;
    templates: SignalCount;
    media: SignalCount;
  };
  automation: {
    /** Website/blog integration (CMS connected) — the publishing automation source. */
    blog: SignalFlag;
    leadCapture: SignalFlag;
    crm: SignalFlag;
    workflows: SignalFlag;
  };
}

const ALWAYS: CategoryCapability = { supported: true, enabled: true, available: true, reason: null };

const feat = (s: ReadinessSignals, key: string): number => s.features[key] ?? 0;

const scored = (
  ok: boolean,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult => (ok ? { score: 1 } : { score: 0, missing: [missing], recommendation, nextAction });

/** Score a count-backed factor (present when count > 0). */
const fromCount = (
  sig: SignalCount,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  !sig.available
    ? { available: false, reason: sig.reason ?? 'Signal temporarily unavailable.' }
    : sig.count > 0
      ? { score: 1 }
      : { score: 0, missing: [missing], recommendation, nextAction };

const fromFlag = (
  sig: SignalFlag,
  missing: string,
  recommendation: string,
  nextAction: { actionId: string; label?: string },
): FactorEvalResult =>
  !sig.available
    ? { available: false, reason: sig.reason ?? 'Signal temporarily unavailable.' }
    : sig.configured
      ? { score: 1 }
      : { score: 0, missing: [missing], recommendation, nextAction };

/** Signal temporarily unreadable (will refresh). */
const unavailable = (reason: string): FactorEvalResult => ({ available: false, reason });

/** Capability provider: no canonical signal exists for this factor in the platform. */
const noCanonicalSignal = (reason: string): FactorEvalResult => ({ available: false, reason });

export const READINESS_REGISTRY: CapabilityCategoryDef<ReadinessSignals>[] = [
  {
    id: 'foundation',
    title: 'Foundation',
    weight: 25,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'foundation.company_profile',
        title: 'Company profile',
        description: 'A complete company profile personalizes every downstream output.',
        weight: 3,
        evaluate: (s) => ({ score: feat(s, 'company_profile_completed') }),
      },
      {
        id: 'foundation.website',
        title: 'Website',
        description: 'A connected website is crawled for content, authority, and gaps.',
        weight: 2,
        evaluate: (s) =>
          scored(feat(s, 'website_connected') >= 1 || Boolean(s.profile.websiteUrl), 'No website connected', 'Connect your website to unlock analysis and readiness insights.', {
            label: 'Connect website',
            actionId: 'profile.edit',
          }),
      },
      {
        id: 'foundation.domain_verification',
        title: 'Domain verification',
        description: 'Verifying domain ownership enables tracking and lead capture.',
        weight: 1,
        evaluate: (s) =>
          !s.foundation.available
            ? unavailable(s.foundation.reason ?? 'Website status is temporarily unavailable.')
            : scored(s.foundation.domainVerified, 'Domain not verified', 'Verify domain ownership to enable tracking and lead capture.', {
                label: 'Verify domain',
                actionId: 'website.setup',
              }),
      },
      {
        id: 'foundation.analytics',
        title: 'Analytics',
        description: 'A connected analytics source powers performance intelligence.',
        weight: 1,
        evaluate: (s) =>
          !s.foundation.available
            ? unavailable(s.foundation.reason ?? 'Website status is temporarily unavailable.')
            : scored(s.foundation.analyticsConnected, 'Analytics not connected', 'Connect Google Analytics (GA4) to measure traffic and performance.', {
                label: 'Connect analytics',
                actionId: 'website.setup',
              }),
      },
      {
        id: 'foundation.tracking',
        title: 'Tracking',
        description: 'On-site tracking captures visitor and conversion signals.',
        weight: 1,
        evaluate: (s) =>
          !s.foundation.available
            ? unavailable(s.foundation.reason ?? 'Website status is temporarily unavailable.')
            : scored(s.foundation.trackingActive, 'On-site tracking not active', 'Install and activate on-site tracking to capture visitor signals.', {
                label: 'Set up tracking',
                actionId: 'website.setup',
              }),
      },
    ],
  },
  {
    id: 'audience',
    title: 'Audience',
    weight: 15,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'audience.target_audience',
        title: 'Target audience',
        description: 'A defined target audience sharpens content and campaigns.',
        weight: 2,
        evaluate: (s) =>
          scored(s.profile.targetAudience, 'Target audience not defined', 'Define your target audience so output matches who you sell to.', {
            label: 'Define audience',
            actionId: 'profile.edit',
          }),
      },
      {
        id: 'audience.industry',
        title: 'Industry',
        description: 'Your industry benchmarks positioning and recommendations.',
        weight: 1,
        evaluate: (s) =>
          scored(s.profile.industry, 'Industry not set', 'Select your industry to benchmark your position.', {
            label: 'Add industry',
            actionId: 'profile.edit',
          }),
      },
      {
        id: 'audience.regions',
        title: 'Regions',
        description: 'Target regions calibrate geography-aware strategy.',
        weight: 1,
        evaluate: (s) =>
          scored(s.profile.regions, 'Target regions not set', 'Add the regions you serve so strategy is geography-aware.', {
            label: 'Add regions',
            actionId: 'profile.edit',
          }),
      },
      {
        id: 'audience.languages',
        title: 'Languages',
        description: 'The platform generates in English, the supported language.',
        weight: 1,
        // English is the only supported language today, so there is no multi-language
        // setup step for the company to complete — this reads as satisfied.
        evaluate: (): FactorEvalResult => ({ score: 1 }),
      },
      {
        id: 'audience.personas',
        title: 'Personas',
        description: 'Buyer personas refine messaging and campaign targeting.',
        weight: 1,
        // Derived from the company profile: with a defined audience + its context
        // (ideal customer profile or industry), personas can be constructed.
        evaluate: (s) =>
          scored(s.profile.personas, 'Personas cannot be derived yet', 'Add your target audience and ideal-customer details so personas can be built.', {
            label: 'Complete audience',
            actionId: 'profile.edit',
          }),
      },
    ],
  },
  {
    id: 'distribution',
    title: 'Distribution',
    weight: 20,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'distribution.connected_channels',
        title: 'Connected channels',
        description: 'Connected channels let you publish and engage from the app.',
        weight: 3,
        evaluate: (s): FactorEvalResult => {
          if (!s.channels.available) return unavailable(s.channels.reason ?? 'Channel status is temporarily unavailable.');
          // One connected channel proves distribution — now, or ever (latched
          // social_accounts_connected). Which platforms to add is the company's call,
          // so this is never gated on connecting all of them.
          return s.channels.connectedCount > 0 || feat(s, 'social_accounts_connected') >= 1
            ? { score: 1 }
            : {
                score: 0,
                missing: ['No channels connected'],
                recommendation: 'Connect at least one channel to publish and track engagement.',
                nextAction: { label: 'Connect channels', actionId: 'channels.connect' },
              };
        },
      },
      {
        id: 'distribution.channel_health',
        title: 'Channel health',
        description: 'Connected channels have valid, unexpired credentials.',
        // Weight 0: informational, non-penalizing. Expired credentials on SOME
        // channels surface here as an actionable warning, but never drag the section
        // score — one working channel already proves distribution.
        weight: 0,
        evaluate: (s): FactorEvalResult => {
          if (!s.channels.available) return unavailable(s.channels.reason ?? 'Channel status is temporarily unavailable.');
          if (s.channels.connectedCount === 0) return unavailable('No channels connected yet.');
          return s.channels.expiredCount === 0
            ? { score: 1 }
            : {
                score: 0,
                missing: [`${s.channels.expiredCount} channel connection(s) expired`],
                recommendation: 'Reconnect expired channels so publishing keeps working.',
                nextAction: { label: 'Review channels', actionId: 'channels.connect' },
              };
        },
      },
      {
        id: 'distribution.publishing_permissions',
        title: 'Publishing permissions',
        description: 'Connected channels have valid tokens with publishing access.',
        // Weight 0: informational, non-penalizing (see channel health).
        weight: 0,
        evaluate: (s): FactorEvalResult => {
          if (!s.channels.available) return unavailable(s.channels.reason ?? 'Channel status is temporarily unavailable.');
          if (s.channels.connectedCount === 0) return unavailable('No channels connected yet.');
          return s.channels.publishReadyCount >= s.channels.connectedCount
            ? { score: 1 }
            : {
                score: 0,
                missing: [`${s.channels.permissionIssueCount || (s.channels.connectedCount - s.channels.publishReadyCount)} channel(s) need re-authorization to publish`],
                recommendation: 'Reconnect channels whose publishing authorization has lapsed.',
                nextAction: { label: 'Reconnect channels', actionId: 'channels.connect' },
              };
        },
      },
    ],
  },
  {
    id: 'content',
    title: 'Content',
    weight: 15,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'content.first_content',
        title: 'First content',
        description: 'Your first created content proves the content workflow end-to-end.',
        weight: 2,
        evaluate: (s) =>
          scored(feat(s, 'blog_created') >= 1 || (s.content.library.available && s.content.library.count > 0), 'No content created yet', 'Create your first content asset to activate the content workflow.', {
            label: 'Create content',
            actionId: 'content.create',
          }),
      },
      {
        id: 'content.library',
        title: 'Content library',
        description: 'A library of created content assets to reuse and repurpose.',
        weight: 1,
        evaluate: (s) =>
          fromCount(s.content.library, 'No content in your library yet', 'Build a content library you can reuse and repurpose.', {
            label: 'Create content',
            actionId: 'content.create',
          }),
      },
      {
        id: 'content.templates',
        title: 'Templates',
        description: 'Saved template collections accelerate consistent creation.',
        weight: 1,
        evaluate: (s) =>
          fromCount(s.content.templates, 'No saved template collections yet', 'Save a template collection to speed up consistent creation.', {
            label: 'Manage templates',
            actionId: 'creator.open',
          }),
      },
      {
        id: 'content.media_assets',
        title: 'Media assets',
        description: 'Uploaded media assets enrich creator output.',
        weight: 1,
        evaluate: (s) =>
          fromCount(s.content.media, 'No media assets yet', 'Upload media assets to enrich your creator output.', {
            label: 'Add media',
            actionId: 'creator.open',
          }),
      },
    ],
  },
  {
    id: 'campaign',
    title: 'Campaign',
    weight: 15,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'campaign.first_campaign',
        title: 'First campaign',
        description: 'Your first campaign proves the planning-to-launch workflow.',
        weight: 2,
        evaluate: (s) =>
          scored(feat(s, 'campaign_created') >= 1, 'No campaign created yet', 'Create your first campaign to activate the launch workflow.', {
            label: 'Create campaign',
            actionId: 'campaign.create',
          }),
      },
      {
        id: 'campaign.objective',
        title: 'Campaign objective',
        description: 'A clear objective focuses campaign strategy.',
        weight: 1,
        // Objective is not a first-class stored campaign field (it is auto-derived
        // with fallbacks); no canonical "user-defined objective" signal exists.
        evaluate: () => noCanonicalSignal('Campaign objective is not stored as a canonical field yet.'),
      },
      {
        id: 'campaign.cta',
        title: 'Call to action',
        description: 'A defined CTA converts campaign engagement.',
        weight: 1,
        evaluate: () => noCanonicalSignal('Campaign CTA is not stored as a canonical field yet.'),
      },
      {
        id: 'campaign.landing',
        title: 'Landing destination',
        description: 'A landing destination captures campaign traffic.',
        weight: 1,
        evaluate: () => noCanonicalSignal('Landing destination is not a first-class campaign field yet.'),
      },
    ],
  },
  {
    id: 'automation',
    title: 'Automation',
    weight: 5,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'automation.blog',
        title: 'Blog / website integration',
        description: 'A connected CMS/website automates blog publishing and distribution.',
        weight: 2,
        evaluate: (s) =>
          fromFlag(s.automation.blog, 'No website/blog integration connected', 'Connect your CMS or website so blog publishing can be automated.', {
            label: 'Connect website',
            actionId: 'website.setup',
          }),
      },
      {
        id: 'automation.lead_capture',
        title: 'Lead capture',
        description: 'Active lead capture turns engagement into pipeline.',
        weight: 2,
        evaluate: (s) =>
          fromFlag(s.automation.leadCapture, 'Lead capture not configured', 'Configure a lead source (form, landing page, webhook, or capture SDK).', {
            label: 'Set up lead capture',
            actionId: 'leads.setup',
          }),
      },
      {
        id: 'automation.crm',
        title: 'CRM',
        description: 'A connected CRM syncs leads to your pipeline.',
        weight: 1,
        evaluate: (s) =>
          fromFlag(s.automation.crm, 'No CRM connected', 'Connect a CRM to sync captured leads to your pipeline.', {
            label: 'Connect CRM',
            actionId: 'integrations.manage',
          }),
      },
      {
        id: 'automation.workflows',
        title: 'Workflows',
        description: 'Automation workflows reduce manual steps.',
        weight: 1,
        evaluate: (s) =>
          fromFlag(s.automation.workflows, 'No automation workflow enabled', 'Enable an automation workflow to reduce manual steps.', {
            label: 'Configure automation',
            actionId: 'engagement.open',
          }),
      },
    ],
  },
  {
    id: 'trust',
    title: 'Trust',
    weight: 5,
    capability: () => ALWAYS,
    factors: () => [
      {
        id: 'trust.ssl',
        title: 'SSL',
        description: 'Your website is served over HTTPS.',
        weight: 2,
        evaluate: (s): FactorEvalResult => {
          if (!s.profile.websiteUrl) return unavailable('Connect a website to evaluate SSL.');
          return /^https:\/\//i.test(s.profile.websiteUrl)
            ? { score: 1 }
            : {
                score: 0,
                missing: ['Website is not served over HTTPS'],
                recommendation: 'Serve your site over HTTPS so visitors and search engines trust it.',
                nextAction: { label: 'Review website', actionId: 'profile.edit' },
              };
        },
      },
      {
        id: 'trust.privacy_policy',
        title: 'Privacy policy',
        description: 'A published privacy / legal page builds visitor trust.',
        weight: 1,
        // Canonical: the Content Intelligence crawl detects a privacy/terms/legal page.
        evaluate: (s): FactorEvalResult =>
          !s.trust.available
            ? unavailable(s.trust.reason ?? 'Website crawl is temporarily unavailable.')
            : scored(s.trust.legalPagesPresent, 'No privacy / legal page found on the site', 'Publish a privacy policy (and terms) page so visitors and search engines trust the site.', {
                label: 'Review website',
                actionId: 'profile.edit',
              }),
      },
      {
        id: 'trust.cookie_banner',
        title: 'Cookie banner',
        description: 'A cookie banner supports privacy compliance.',
        weight: 1,
        evaluate: () => noCanonicalSignal('Cookie-banner presence is not a canonical crawl signal yet.'),
      },
      {
        id: 'trust.email_auth',
        title: 'Email authentication',
        description: 'SPF/DKIM/DMARC protect your sending domain.',
        weight: 1,
        // Sending-domain email auth is not supported by any canonical signal.
        evaluate: () => noCanonicalSignal('Email authentication is not supported by a canonical signal in this workspace.'),
      },
    ],
  },
];
