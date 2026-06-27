/**
 * Campaign Package Handoff — the package is the ONE canonical handoff object.
 *
 * Downstream modules (publishing / scheduling / calendar / analytics / engagement)
 * consume the CampaignPackage through lightweight, pure ADAPTERS instead of
 * rebuilding campaign/asset state. Adapters only TRANSFORM the package — they own
 * no state, never regenerate or duplicate storage, and pass asset references
 * (ids / urls / files) + metadata through. Every adapter item carries traceability
 * back to the package, asset, template, and generation. Ready flags reuse the
 * existing package consistency — no duplicated validation.
 *
 * The CampaignPackage structure itself is unchanged (this layer sits on top).
 */

import type { CampaignPackage, PackageAsset } from './campaignPackage';

/* ── Ready flags (derived from existing package consistency) ──────────── */

export interface PackageReadiness {
  readyForPublishing: boolean;
  readyForScheduling: boolean;
  readyForCalendar: boolean;
  readyForAnalytics: boolean;
  readyForEngagement: boolean;
}

export function packageReadiness(pkg: CampaignPackage): PackageReadiness {
  const hasAssets = pkg.includedAssets.length > 0;
  const hasPlatforms = pkg.metadata.platforms.length > 0;
  return {
    readyForPublishing: pkg.readyForPublishing,
    readyForScheduling: pkg.readyForScheduling,
    // Calendar placement = scheduling-ready (assets + platforms, no failures).
    readyForCalendar: pkg.readyForScheduling,
    // Analytics needs something to measure — any completed asset.
    readyForAnalytics: hasAssets,
    // Engagement needs live, platform-targeted, publishable assets.
    readyForEngagement: pkg.readyForPublishing && hasPlatforms,
  };
}

/* ── Traceability (read-only links back to package/asset/template/gen) ── */

export interface AssetTrace {
  package: string;
  assetId: string | null;
  template: string | null;
  templateId: string | null;
  generatedAt: string | null;
}
function traceFor(pkg: CampaignPackage, a: PackageAsset): AssetTrace {
  return { package: pkg.metadata.name, assetId: a.id, template: a.template, templateId: a.templateId, generatedAt: a.generatedAt };
}

/** Minimal, read-only campaign reference for adapters (the canonical source of
 *  truth remains pkg.metadata — this is a projection, not a second copy). */
export interface CampaignRef { name: string; objective: string | null; platforms: string[] }
function campaignRef(pkg: CampaignPackage): CampaignRef {
  return { name: pkg.metadata.name, objective: pkg.metadata.objective, platforms: pkg.metadata.platforms };
}

/* ── Adapters (pure transforms; references only) ─────────────────────── */

export interface PublishingItem {
  assetId: string | null;
  assetType: string;
  template: string | null;
  platform: string | null;
  url: string | null;
  files: string[];
  caption: string | null;
  cta: string | null;
  trace: AssetTrace;
}
export interface PublishingHandoff { channel: 'publishing'; campaign: CampaignRef; items: PublishingItem[]; ready: boolean; warnings: string[] }
export function PublishingAdapter(pkg: CampaignPackage): PublishingHandoff {
  return {
    channel: 'publishing',
    campaign: campaignRef(pkg),
    items: pkg.includedAssets.map((a) => ({
      assetId: a.id, assetType: a.assetType, template: a.template, platform: a.platform,
      url: a.url, files: a.files, caption: a.caption ?? pkg.caption, cta: a.cta ?? pkg.cta, trace: traceFor(pkg, a),
    })),
    ready: pkg.readyForPublishing,
    warnings: pkg.warnings,
  };
}

export interface SchedulingItem { assetId: string | null; assetType: string; platform: string | null; scheduledAt: string | null; trace: AssetTrace }
export interface SchedulingHandoff { channel: 'scheduling'; campaign: CampaignRef; items: SchedulingItem[]; ready: boolean }
export function SchedulingAdapter(pkg: CampaignPackage): SchedulingHandoff {
  return {
    channel: 'scheduling',
    campaign: campaignRef(pkg),
    items: pkg.includedAssets.map((a) => ({ assetId: a.id, assetType: a.assetType, platform: a.platform, scheduledAt: a.scheduledAt ?? null, trace: traceFor(pkg, a) })),
    ready: pkg.readyForScheduling,
  };
}

export interface CalendarEntry { assetId: string | null; title: string; platform: string | null; date: string | null; trace: AssetTrace }
export interface CalendarHandoff { channel: 'calendar'; campaign: CampaignRef; entries: CalendarEntry[]; ready: boolean }
export function CalendarAdapter(pkg: CampaignPackage): CalendarHandoff {
  const r = packageReadiness(pkg);
  return {
    channel: 'calendar',
    campaign: campaignRef(pkg),
    entries: pkg.includedAssets.map((a) => ({ assetId: a.id, title: a.template ?? a.assetType, platform: a.platform, date: a.scheduledAt ?? null, trace: traceFor(pkg, a) })),
    ready: r.readyForCalendar,
  };
}

export interface AnalyticsTarget { assetId: string | null; assetType: string; template: string | null; variant: string | null; platform: string | null; trace: AssetTrace }
export interface AnalyticsHandoff { channel: 'analytics'; campaign: CampaignRef; targets: AnalyticsTarget[]; ready: boolean }
export function AnalyticsAdapter(pkg: CampaignPackage): AnalyticsHandoff {
  const r = packageReadiness(pkg);
  return {
    channel: 'analytics',
    campaign: campaignRef(pkg),
    targets: pkg.includedAssets.map((a) => ({ assetId: a.id, assetType: a.assetType, template: a.template, variant: a.variant, platform: a.platform, trace: traceFor(pkg, a) })),
    ready: r.readyForAnalytics,
  };
}

export interface EngagementSurface { assetId: string | null; platform: string | null; cta: string | null; caption: string | null; trace: AssetTrace }
export interface EngagementHandoff { channel: 'engagement'; campaign: CampaignRef; surfaces: EngagementSurface[]; ready: boolean }
export function EngagementAdapter(pkg: CampaignPackage): EngagementHandoff {
  const r = packageReadiness(pkg);
  return {
    channel: 'engagement',
    campaign: campaignRef(pkg),
    surfaces: pkg.includedAssets.map((a) => ({ assetId: a.id, platform: a.platform, cta: a.cta ?? pkg.cta, caption: a.caption ?? pkg.caption, trace: traceFor(pkg, a) })),
    ready: r.readyForEngagement,
  };
}

/* ── The single canonical handoff object ─────────────────────────────── */

export interface CampaignHandoff {
  /** The canonical package (referenced, not duplicated). */
  package: CampaignPackage;
  readiness: PackageReadiness;
  publishing: PublishingHandoff;
  scheduling: SchedulingHandoff;
  calendar: CalendarHandoff;
  analytics: AnalyticsHandoff;
  engagement: EngagementHandoff;
}

/**
 * Build the one handoff object every downstream module consumes. It references
 * the package + provides per-channel adapter views. No state is rebuilt and no
 * campaign metadata is duplicated — the package remains the single source.
 */
export function buildCampaignHandoff(pkg: CampaignPackage): CampaignHandoff {
  return {
    package: pkg,
    readiness: packageReadiness(pkg),
    publishing: PublishingAdapter(pkg),
    scheduling: SchedulingAdapter(pkg),
    calendar: CalendarAdapter(pkg),
    analytics: AnalyticsAdapter(pkg),
    engagement: EngagementAdapter(pkg),
  };
}
