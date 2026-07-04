/**
 * Canonical Telemetry — Signal Providers
 * --------------------------------------
 * Reusable, deterministic providers that turn the append-only ledger into
 * canonical signals. Every provider returns the SAME contract
 * (TelemetryProviderResult) — the single interface consumed by Setup, Readiness,
 * Mastery, Reports, and AI. No feature-specific implementations; no UI coupling;
 * no derived scores stored. All values are computed on read from telemetry.
 *
 * Fail-soft: until the telemetry table is provisioned, the ledger reads empty
 * and every provider returns supported:true, available:false, value:0.
 *
 * NOTE: exposed here for future consumption. Wiring these into Command Center
 * scoring (Mastery etc.) is a separate task — this phase does not modify scoring.
 */

import {
  getWindowEvents,
  countOf,
  distinctActors,
  distinctMetadataValues,
  activeWeeks,
  latestOccurredAt,
  WINDOW_DAYS,
} from './telemetryAggregator';
import type { TelemetryEventRecord, TelemetryEventType, TelemetryWindow, TelemetryProviderResult } from '../../../lib/telemetry/telemetryTypes';

const clamp01 = (n: number): number => (Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n)));
const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** Deterministic confidence from data volume: saturates at `saturation` events. */
function confidenceFromVolume(events: TelemetryEventRecord[], saturation: number): number {
  return clamp01(events.length / Math.max(1, saturation));
}

function build(
  events: TelemetryEventRecord[],
  value: number,
  supportingMetrics: Record<string, number>,
  saturation: number,
  contributingTypes: TelemetryEventType[],
): TelemetryProviderResult {
  return {
    supported: true,
    available: events.length > 0,
    value,
    confidence: confidenceFromVolume(events, saturation),
    lastUpdated: latestOccurredAt(events, contributingTypes),
    supportingMetrics,
  };
}

interface ProviderOpts {
  window?: TelemetryWindow;
  now?: Date;
  rollingSince?: string | null;
  /** Preloaded events (aggregate several providers from one fetch). */
  preloaded?: TelemetryEventRecord[];
}

async function fetch(organizationId: string, types: TelemetryEventType[], opts?: ProviderOpts): Promise<{ events: TelemetryEventRecord[]; window: TelemetryWindow }> {
  const window = opts?.window ?? '30d';
  const events = await getWindowEvents(organizationId, window, { now: opts?.now, types, rollingSince: opts?.rollingSince, preloaded: opts?.preloaded });
  return { events, window };
}

const perWeek = (count: number, window: TelemetryWindow): number =>
  window === '7d' || window === '30d' || window === '90d' ? count / (WINDOW_DAYS[window] / 7) : count;

// ── Providers ────────────────────────────────────────────────────────────────

export async function publishingCadence(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events, window } = await fetch(orgId, ['content.published'], opts);
  const published = countOf(events, 'content.published');
  return build(events, perWeek(published, window), { published, activeWeeks: activeWeeks(events, 'content.published'), perWeek: perWeek(published, window) }, 8, ['content.published']);
}

export async function campaignCadence(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events, window } = await fetch(orgId, ['campaign.created', 'campaign.launched'], opts);
  const launched = countOf(events, 'campaign.launched');
  return build(events, perWeek(launched, window), { created: countOf(events, 'campaign.created'), launched, perWeek: perWeek(launched, window) }, 5, ['campaign.launched']);
}

export async function campaignCompletionRate(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['campaign.created', 'campaign.completed'], { window: 'lifetime', ...opts });
  const created = countOf(events, 'campaign.created');
  const completed = countOf(events, 'campaign.completed');
  return build(events, ratio(completed, created), { created, completed }, 5, ['campaign.created', 'campaign.completed']);
}

export async function contentDiversity(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['content.created', 'content.published'], { window: 'lifetime', ...opts });
  const types = new Set([...distinctMetadataValues(events, 'content.created', 'contentType'), ...distinctMetadataValues(events, 'content.published', 'contentType')]);
  return build(events, types.size, { distinctContentTypes: types.size }, 4, ['content.created', 'content.published']);
}

export async function templateUtilization(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['content.template_used'], opts);
  const used = countOf(events, 'content.template_used');
  return build(events, used, { templateUsed: used, distinctTemplates: distinctMetadataValues(events, 'content.template_used', 'templateId').length }, 5, ['content.template_used']);
}

export async function mediaUtilization(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['content.media_uploaded', 'ai.generated'], opts);
  const media = countOf(events, 'content.media_uploaded');
  const ai = countOf(events, 'ai.generated');
  return build(events, media + ai, { mediaUploaded: media, aiGenerated: ai }, 8, ['content.media_uploaded', 'ai.generated']);
}

export async function aiAcceptanceRate(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['ai.accepted', 'ai.rejected'], opts);
  const accepted = countOf(events, 'ai.accepted');
  const rejected = countOf(events, 'ai.rejected');
  return build(events, ratio(accepted, accepted + rejected), { accepted, rejected }, 10, ['ai.accepted', 'ai.rejected']);
}

export async function aiRefinementRate(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['ai.generated', 'ai.refined', 'ai.regenerated'], opts);
  const generated = countOf(events, 'ai.generated');
  const refined = countOf(events, 'ai.refined') + countOf(events, 'ai.regenerated');
  return build(events, ratio(refined, generated), { generated, refined }, 10, ['ai.refined', 'ai.regenerated']);
}

export async function automationAdoption(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['automation.enabled', 'automation.disabled', 'automation.executed', 'automation.failed'], opts);
  const enabled = countOf(events, 'automation.enabled');
  const disabled = countOf(events, 'automation.disabled');
  const executed = countOf(events, 'automation.executed');
  return build(events, executed, { netEnabled: Math.max(0, enabled - disabled), executed, failed: countOf(events, 'automation.failed') }, 5, ['automation.executed', 'automation.enabled']);
}

export async function recommendationAdoption(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['recommendations.shown', 'recommendations.accepted', 'recommendations.dismissed', 'recommendations.ignored'], opts);
  const shown = countOf(events, 'recommendations.shown');
  const accepted = countOf(events, 'recommendations.accepted');
  return build(events, ratio(accepted, shown), { shown, accepted, dismissed: countOf(events, 'recommendations.dismissed'), ignored: countOf(events, 'recommendations.ignored') }, 10, ['recommendations.shown', 'recommendations.accepted']);
}

export async function collaborationDepth(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['collaboration.approval_completed', 'collaboration.comment_added', 'collaboration.task_completed', 'collaboration.review_requested'], opts);
  return build(events, distinctActors(events), {
    distinctActors: distinctActors(events),
    approvals: countOf(events, 'collaboration.approval_completed'),
    comments: countOf(events, 'collaboration.comment_added'),
    tasks: countOf(events, 'collaboration.task_completed'),
    reviews: countOf(events, 'collaboration.review_requested'),
  }, 6, ['collaboration.approval_completed', 'collaboration.comment_added', 'collaboration.task_completed']);
}

export async function reportUsage(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['reports.generated', 'reports.exported', 'reports.shared'], opts);
  const generated = countOf(events, 'reports.generated');
  return build(events, generated + countOf(events, 'reports.exported'), { generated, exported: countOf(events, 'reports.exported'), shared: countOf(events, 'reports.shared') }, 5, ['reports.generated', 'reports.exported']);
}

export async function dashboardEngagement(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['analytics.dashboard_viewed', 'analytics.kpi_reviewed', 'analytics.comparison_generated'], opts);
  return build(events, events.length, {
    dashboards: countOf(events, 'analytics.dashboard_viewed'),
    kpis: countOf(events, 'analytics.kpi_reviewed'),
    comparisons: countOf(events, 'analytics.comparison_generated'),
  }, 8, ['analytics.dashboard_viewed', 'analytics.kpi_reviewed']);
}

export async function leadWorkflowAdoption(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['lead.captured', 'lead.qualified', 'lead.assigned', 'lead.workflow_triggered'], opts);
  return build(events, countOf(events, 'lead.workflow_triggered'), {
    captured: countOf(events, 'lead.captured'),
    qualified: countOf(events, 'lead.qualified'),
    assigned: countOf(events, 'lead.assigned'),
    workflowTriggered: countOf(events, 'lead.workflow_triggered'),
  }, 6, ['lead.workflow_triggered', 'lead.captured']);
}

export async function integrationHealth(orgId: string, opts?: ProviderOpts): Promise<TelemetryProviderResult> {
  const { events } = await fetch(orgId, ['integration.connected', 'integration.disconnected', 'integration.synchronized'], opts);
  const connected = countOf(events, 'integration.connected');
  const disconnected = countOf(events, 'integration.disconnected');
  return build(events, Math.max(0, connected - disconnected), { connected, disconnected, synchronized: countOf(events, 'integration.synchronized') }, 4, ['integration.connected', 'integration.synchronized']);
}

/** All providers keyed by canonical id — for generic/registry-driven consumption. */
export const TELEMETRY_PROVIDERS = {
  publishing_cadence: publishingCadence,
  campaign_cadence: campaignCadence,
  campaign_completion_rate: campaignCompletionRate,
  content_diversity: contentDiversity,
  template_utilization: templateUtilization,
  media_utilization: mediaUtilization,
  ai_acceptance_rate: aiAcceptanceRate,
  ai_refinement_rate: aiRefinementRate,
  automation_adoption: automationAdoption,
  recommendation_adoption: recommendationAdoption,
  collaboration_depth: collaborationDepth,
  report_usage: reportUsage,
  dashboard_engagement: dashboardEngagement,
  lead_workflow_adoption: leadWorkflowAdoption,
  integration_health: integrationHealth,
} as const;

export type TelemetryProviderId = keyof typeof TELEMETRY_PROVIDERS;
