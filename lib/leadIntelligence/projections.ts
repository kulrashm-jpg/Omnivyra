/**
 * Projection builders (pure, independently testable).
 *
 * Each enriches a canonical lead from EXISTING source data passed in by the caller
 * — projections never query or modify source systems themselves. The repository
 * fetches; projections transform. This keeps every projection a pure unit.
 */

import type { CanonicalLeadView } from './types';
import type { TimelineEvent } from './timeline';
import { buildContentIntelligence, type ContentIntelligence, type ContentIntelligenceInputs } from './contentIntelligence';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface IdentityProjection { unifiedPersonId: string | null; email: string | null; phone: string | null; platforms: string[]; externalKeys: Record<string, unknown> }
export function identityProjection(lead: CanonicalLeadView, unifiedPerson?: Record<string, unknown> | null): IdentityProjection {
  const up = unifiedPerson ?? {};
  const platforms = new Set<string>();
  if (lead.identity.platform) platforms.add(lead.identity.platform);
  return {
    unifiedPersonId: lead.unifiedPersonId ?? str(up.id),
    email: lead.identity.email ?? str(up.primary_email),
    phone: lead.identity.phone ?? str(up.primary_phone),
    platforms: Array.from(platforms),
    externalKeys: { ...(lead.identity.externalKeys ?? {}), ...((up.external_keys as Record<string, unknown>) ?? {}) },
  };
}

export interface CampaignProjection { campaign: string | null; campaignId: string | null; channel: string | null; touchpointCount: number }
export function campaignProjection(lead: CanonicalLeadView, touchpoints: Array<Record<string, unknown>> = []): CampaignProjection {
  return {
    campaign: lead.campaign,
    campaignId: str(lead.attribution.sourceMetadata.campaign_id),
    channel: lead.attribution.originalChannel,
    touchpointCount: touchpoints.length,
  };
}

export interface JourneyStep { occurredAt: string | null; source: string; page: string | null; campaign: string | null }
export function journeyProjection(lead: CanonicalLeadView, touchpoints: Array<Record<string, unknown>> = []): JourneyStep[] {
  const steps: JourneyStep[] = touchpoints.map((t) => ({
    occurredAt: str(t.touched_at) ?? str(t.created_at),
    source: str(t.source) ?? lead.source,
    page: str(t.page_url),
    campaign: str(t.campaign),
  }));
  return steps.sort((a, b) => Date.parse(a.occurredAt ?? '') - Date.parse(b.occurredAt ?? ''));
}

export function contentProjection(_lead: CanonicalLeadView, inputs: ContentIntelligenceInputs): ContentIntelligence {
  return buildContentIntelligence(inputs);
}

export interface ActivityProjection { events: TimelineEvent[]; lastActivityAt: string | null; count: number }
export function activityProjection(_lead: CanonicalLeadView, events: TimelineEvent[]): ActivityProjection {
  const sorted = [...events].sort((a, b) => Date.parse(b.occurredAt ?? '') - Date.parse(a.occurredAt ?? ''));
  return { events: sorted, lastActivityAt: sorted[0]?.occurredAt ?? null, count: events.length };
}

export interface OpportunityProjection { opportunityTypes: string[]; topScore: number | null }
export function opportunityProjection(lead: CanonicalLeadView, opportunities: Array<Record<string, unknown>> = []): OpportunityProjection {
  const types = new Set<string>();
  const ot = str(lead.attribution.sourceMetadata.opportunity_type);
  if (ot) types.add(ot);
  let top: number | null = lead.scores.total ?? null;
  for (const o of opportunities) { const t = str(o.opportunity_type); if (t) types.add(t); const sc = num(o.total_score) ?? num(o.opportunity_score); if (sc != null) top = Math.max(top ?? 0, sc); }
  return { opportunityTypes: Array.from(types), topScore: top };
}

export interface MarketPulseProjection { signalCategories: string[]; riskClass: string | null }
export function marketPulseProjection(lead: CanonicalLeadView, signals: Array<Record<string, unknown>> = []): MarketPulseProjection {
  const cats = new Set<string>();
  const c = str(lead.attribution.sourceMetadata.signal_category);
  if (c) cats.add(c);
  for (const s of signals) { const sc = str(s.signal_category); if (sc) cats.add(sc); }
  return { signalCategories: Array.from(cats), riskClass: str(lead.attribution.sourceMetadata.opportunity_risk_class) };
}

export interface CrmProjection { status: string | null; revenue: number | null; qualificationScore: number | null }
export function crmProjection(lead: CanonicalLeadView, revenueEvents: Array<Record<string, unknown>> = []): CrmProjection {
  const revenue = revenueEvents.reduce((acc, r) => acc + (num(r.revenue_amount) ?? 0), 0);
  return { status: lead.status, revenue: revenueEvents.length ? revenue : null, qualificationScore: lead.scores.total ?? null };
}

export interface EngagementProjection { threads: number; lastMessageAt: string | null }
export function engagementProjection(_lead: CanonicalLeadView, threads: Array<Record<string, unknown>> = []): EngagementProjection {
  const times = threads.map((t) => str(t.updated_at) ?? str(t.created_at)).filter(Boolean) as string[];
  times.sort((a, b) => Date.parse(b) - Date.parse(a));
  return { threads: threads.length, lastMessageAt: times[0] ?? null };
}

export interface AnalyticsProjection { intent: number | null; icp: number | null; confidence: number | null; total: number | null }
export function analyticsProjection(lead: CanonicalLeadView): AnalyticsProjection {
  return { intent: lead.scores.intent ?? null, icp: lead.scores.icp ?? null, confidence: lead.scores.confidence ?? null, total: lead.scores.total ?? null };
}
