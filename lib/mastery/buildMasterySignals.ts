/**
 * buildMasterySignals — normalize raw, canonical, tenant-specific data into the
 * MasterySignals contract. The ONLY place raw API shapes are read for Mastery.
 * Every signal is real adoption (artifacts created / configured), never
 * feature-usage. No scoring, no UI.
 *
 * Canonical providers consumed (all already fetched by the command-center hook):
 *   /api/blogs                          → published content count + written surface
 *   /api/campaigns                      → campaigns completed count
 *   /api/reports                        → reports generated count
 *   /api/creator-assets                 → AI-generated + media asset count + creator surface
 *   /api/creator-templates/collections  → template utilization count
 *   /api/company/team-summary           → team participation (member count)
 *   /api/automation/config              → recurring automation
 *   /api/website-intelligence/canonical → lead automation (readiness.checks[leads])
 *   /api/company-profile                → competitors declared (monitoring)
 */

import type { MasterySignals } from '../../config/masteryRegistry';
import type { TelemetryProviderResult } from '../../lib/telemetry/telemetryTypes';

const REFRESH_MSG = 'This will refresh automatically.';

/** id → canonical provider result, as returned by /api/telemetry/providers. */
export type MasteryTelemetry = Record<string, TelemetryProviderResult> | null | undefined;

export interface RawMasteryInputs {
  profile: Record<string, unknown> | null;
  blogsCount: number | null;
  campaignsCount: number | null;
  reportsCount: number | null;
  /** creator assets = AI-generated + media library. */
  mediaCount: number | null;
  templatesCount: number | null;
  teamSummary: { memberCount: number } | null;
  automation: { enabled: boolean; autoReply: boolean; autoDm: boolean } | null;
  /** website snapshot readiness checks (for lead automation). */
  websiteSnapshot: { readiness?: { checks?: Array<{ id?: string; done?: boolean }> } | null } | null;
  /**
   * Canonical telemetry provider results (from /api/telemetry/providers). When a
   * provider is supported+available its count SUPERSEDES the proxy; otherwise the
   * proxy is used. Absent/dark telemetry → proxy everywhere → no behavior change.
   */
  telemetry?: MasteryTelemetry;
}

const count = (n: number | null): { available: boolean; reason: string | null; count: number } =>
  n === null ? { available: false, reason: `Could not be loaded. ${REFRESH_MSG}`, count: 0 } : { available: true, reason: null, count: n };

/** True when a provider result carries real, usable telemetry for this org. */
const hasTelemetry = (r: TelemetryProviderResult | undefined): r is TelemetryProviderResult =>
  Boolean(r && r.supported && r.available);

/**
 * Telemetry-preferred count: use the provider's supporting metric when the
 * provider is supported+available; otherwise fall back to the proxy count. This
 * is the single seam through which Mastery consumes telemetry — it never reads
 * telemetry storage, only the resolved ProviderResult.
 */
const telCount = (
  telemetry: MasteryTelemetry,
  providerId: string,
  metric: string,
  proxyN: number | null,
): { available: boolean; reason: string | null; count: number } => {
  const r = telemetry?.[providerId];
  if (hasTelemetry(r)) {
    const v = r.supportingMetrics?.[metric];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return { available: true, reason: null, count: v };
    }
  }
  return count(proxyN);
};

const competitorCount = (profile: Record<string, unknown> | null): number => {
  const p = profile ?? {};
  const list = p['competitors_list'] ?? p['competitors'];
  if (Array.isArray(list)) return list.filter((v) => typeof v === 'string' && v.trim().length > 0).length;
  if (typeof list === 'string') return list.split(',').map((v) => v.trim()).filter(Boolean).length;
  return 0;
};

export function buildMasterySignals(input: RawMasteryInputs): MasterySignals {
  const tel = input.telemetry;

  // Telemetry-preferred adoption counts (proxy fallback when telemetry is dark).
  const publishedSignal = telCount(tel, 'publishing_cadence', 'published', input.blogsCount);
  const templatesSignal = telCount(tel, 'template_utilization', 'templateUsed', input.templatesCount);
  const mediaSignal = telCount(tel, 'media_utilization', 'mediaUploaded', input.mediaCount);
  const aiAssetsSignal = telCount(tel, 'media_utilization', 'aiGenerated', input.mediaCount);
  const campaignCompletedSignal = telCount(tel, 'campaign_completion_rate', 'completed', input.campaignsCount);
  const reportsSignal = telCount(tel, 'report_usage', 'generated', input.reportsCount);

  // Surfaces derive from the RESOLVED (telemetry-preferred) written/creator counts
  // so they follow telemetry when it is live and the proxy otherwise.
  const writtenSurface = publishedSignal.available && publishedSignal.count > 0 ? 1 : 0;
  const creatorSurface = mediaSignal.available && mediaSignal.count > 0 ? 1 : 0;

  const leadsCheck = input.websiteSnapshot?.readiness?.checks?.find((c) => c.id === 'leads');

  // Automation adoption: prefer telemetry (ever-enabled workflows) over the
  // config-flag proxy; fall back to the config flag when telemetry is dark.
  const automationTel = tel?.['automation_adoption'];
  const automationWorkflows = hasTelemetry(automationTel)
    ? { available: true, reason: null, configured: (automationTel.supportingMetrics?.netEnabled ?? 0) > 0 }
    : input.automation
      ? { available: true, reason: null, configured: input.automation.enabled && (input.automation.autoReply || input.automation.autoDm) }
      : { available: false, reason: `Automation status could not be loaded. ${REFRESH_MSG}`, configured: false };

  return {
    content: {
      published: publishedSignal,
      templates: templatesSignal,
      media: mediaSignal,
      surfaces: writtenSurface + creatorSurface,
    },
    campaign: {
      completed: campaignCompletedSignal,
    },
    ai: {
      // Creator assets are produced with AI assistance — the canonical
      // AI-generated-artifact count.
      assets: aiAssetsSignal,
    },
    intelligence: {
      competitors: competitorCount(input.profile),
      competitorsAvailable: input.profile !== null,
    },
    analytics: {
      reports: reportsSignal,
    },
    collaboration: input.teamSummary
      ? { available: true, reason: null, memberCount: input.teamSummary.memberCount }
      : { available: false, reason: `Team summary could not be loaded. ${REFRESH_MSG}`, memberCount: 0 },
    automation: {
      workflows: automationWorkflows,
      leadAutomation: input.websiteSnapshot
        ? { available: true, reason: null, configured: Boolean(leadsCheck?.done) }
        : { available: false, reason: `Lead status could not be loaded. ${REFRESH_MSG}`, configured: false },
    },
  };
}
