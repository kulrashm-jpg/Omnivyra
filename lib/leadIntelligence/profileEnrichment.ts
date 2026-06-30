/**
 * Lead-profile enrichment projections (pure).
 *
 * Promotes the rich website attribution Phase 8 captured (stored in the canonical
 * view's `attribution.sourceMetadata.metadata.web_attribution` + the legacy
 * `attribution` column) into first-class profile sections. No source data is
 * queried here (projections transform; the repository hydrates), and the UI never
 * parses metadata — it renders these typed sections. Additive over LeadProfile.
 */

import type { CanonicalLeadView } from './types';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';
import { buildContentIntelligence } from './contentIntelligence';
import type { LeadProfile } from './profileTypes';
import type { BuyingIntentProfile } from './buyingIntent';
import type { LeadActionPlan } from './leadActions';
import type { CompanyIntelligenceSummary } from './companyIntelligence';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const numv = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Unified web-attribution map: web_attribution (most complete) over the legacy attribution column. */
function webAttr(view: CanonicalLeadView): Record<string, unknown> {
  const sm = obj(view.attribution.sourceMetadata);
  const meta = obj(sm.metadata);
  return { ...obj(sm.attribution), ...obj(meta.web_attribution) };
}
function leadMeta(view: CanonicalLeadView): Record<string, unknown> {
  return obj(obj(view.attribution.sourceMetadata).metadata);
}

export interface VisitorJourneyProjection {
  firstLandingPage: string | null;
  currentLandingPage: string | null;
  entryUrl: string | null;
  exitUrl: string | null;
  referrer: string | null;
  firstReferrer: string | null;
  sessionId: string | null;
  visitorId: string | null;
  journeyId: string | null;
  returnVisitor: boolean | null;
  visitCount: number | null;
}

export function visitorJourneyProjection(view: CanonicalLeadView, sessions: Array<Record<string, unknown>> = []): VisitorJourneyProjection {
  const w = webAttr(view);
  const sm = obj(view.attribution.sourceMetadata);
  const visitCount = sessions.length > 0 ? sessions.length : null;
  return {
    firstLandingPage: str(w.landing_page) ?? str(w.first_landing_page) ?? str(sm.first_landing_page),
    currentLandingPage: str(w.current_page) ?? str(sm.last_current_page),
    entryUrl: str(w.landing_page) ?? str(sm.first_landing_page),
    exitUrl: str(w.current_page) ?? str(sm.last_current_page),
    referrer: str(w.referrer) ?? view.referrer ?? str(sm.last_referrer),
    firstReferrer: str(w.first_referrer) ?? str(sm.first_referrer),
    sessionId: str(w.session_id) ?? str(sm.visitor_session_id) ?? view.identity.anonymousId ?? null,
    visitorId: str(w.anonymous_id) ?? view.unifiedPersonId ?? view.identity.unifiedPersonId ?? null,
    journeyId: str(w.journey_id),
    returnVisitor: visitCount != null ? visitCount > 1 : null,
    visitCount,
  };
}

export interface CampaignAttributionProjection {
  campaignId: string | null;
  campaignName: string | null;
  campaignType: string | null;
  campaignSource: string | null;
  campaignMedium: string | null;
  campaignContent: string | null;
  campaignTerm: string | null;
}

export function campaignAttributionProjection(view: CanonicalLeadView): CampaignAttributionProjection {
  const w = webAttr(view);
  return {
    campaignId: str(w.campaign_id),
    campaignName: str(w.utm_campaign) ?? view.campaign ?? view.utm.campaign,
    campaignType: str(w.utm_medium) ?? view.utm.medium,
    campaignSource: str(w.utm_source) ?? view.utm.source ?? view.attribution.originalSource,
    campaignMedium: str(w.utm_medium) ?? view.utm.medium ?? view.attribution.originalChannel,
    campaignContent: str(w.utm_content) ?? view.content ?? view.utm.content,
    campaignTerm: str(w.utm_term) ?? view.utm.term,
  };
}

export interface ContentReferenceProjection {
  contentId: string | null;
  contentType: string | null;
  contentTitle: string | null;
  assetId: string | null;
  ctaId: string | null;
  formId: string | null;
  websiteId: string | null;
}

export function contentReferenceProjection(view: CanonicalLeadView): ContentReferenceProjection {
  const w = webAttr(view);
  const meta = leadMeta(view);
  const sm = obj(view.attribution.sourceMetadata);
  return {
    contentId: str(w.content_id),
    contentType: str(meta.intent) ?? str(meta.primary_interest),
    contentTitle: view.content ?? str(meta.primary_interest),
    assetId: str(w.asset_id),
    ctaId: str(w.cta_id),
    formId: str(w.form_id) ?? str(sm.form_id),
    websiteId: str(w.website_id) ?? str(sm.website_id),
  };
}

export interface WebsiteBehaviourProjection {
  timeOnSiteSeconds: number;
  timeOnPageSeconds: number;
  scrollDepth: number;
  pagesViewed: number;
  downloads: number;
  assetsViewed: number;
  ctaClicks: number;
  blogPagesViewed: number;
  returnVisits: number;
}

/** Reuses buildContentIntelligence over the EXISTING tracking inputs (no new telemetry). */
export function websiteBehaviourProjection(
  inputs: { events?: Array<Record<string, unknown>>; touchpoints?: Array<Record<string, unknown>>; blogSessions?: Array<Record<string, unknown>>; sessionCount?: number } = {},
): WebsiteBehaviourProjection {
  const events = inputs.events ?? [];
  const ci = buildContentIntelligence({ events, touchpoints: inputs.touchpoints, blogSessions: inputs.blogSessions });
  const ctaClicks = events.filter((e) => String(e.event_name ?? '').toLowerCase().includes('cta')).length;
  const blogPagesViewed = ci.pagesViewed.filter((p) => /\/blog/i.test(p)).length || ci.blogs.length;
  const timeOnPageSeconds = events.reduce((m, e) => Math.max(m, numv(e.time_on_page) + numv(e.time_seconds)), 0);
  return {
    timeOnSiteSeconds: ci.timeSpentSeconds,
    timeOnPageSeconds,
    scrollDepth: ci.maxScrollDepth,
    pagesViewed: ci.pagesViewed.length,
    downloads: ci.downloads.length,
    assetsViewed: ci.assets.length,
    ctaClicks,
    blogPagesViewed,
    returnVisits: Math.max(0, (inputs.sessionCount ?? 0) - 1),
  };
}

export interface SourceDetailProjection {
  source: string;
  path: string[];
  label: string;
}

const humanizeIntent = (v: string): string =>
  v.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function sourceDetailProjection(view: CanonicalLeadView): SourceDetailProjection {
  const w = webAttr(view);
  const meta = leadMeta(view);
  const sourceLabel = CANONICAL_LEAD_SOURCE_LABELS[view.source] ?? view.source;
  const channel = str(w.utm_source) ?? view.utm.source;
  const campaign = str(w.utm_campaign) ?? view.campaign ?? view.utm.campaign;
  const content = str(w.utm_content) ?? view.content;
  const cta = str(w.cta_id) ? `CTA ${str(w.cta_id)}` : str(meta.intent) ? humanizeIntent(String(meta.intent)) : null;

  const path = [
    sourceLabel,
    channel && channel.toLowerCase() !== sourceLabel.toLowerCase() ? channel : null,
    campaign,
    content,
    cta,
  ].filter((x): x is string => !!x);

  // Always at least the source label.
  if (path.length === 0) path.push(sourceLabel);
  return { source: view.source, path, label: path.join(' → ') };
}

export interface EnrichedLeadProfile extends LeadProfile {
  visitorJourney: VisitorJourneyProjection;
  campaignAttribution: CampaignAttributionProjection;
  contentReferences: ContentReferenceProjection;
  websiteBehaviour: WebsiteBehaviourProjection;
  sourceDetail: SourceDetailProjection;
  buyingIntent: BuyingIntentProfile;
  actionPlan: LeadActionPlan;
  company: CompanyIntelligenceSummary | null;
}
