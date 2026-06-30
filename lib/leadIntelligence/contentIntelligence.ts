/**
 * Content & campaign intelligence builders (pure).
 *
 * Aggregate what a lead consumed/engaged with from EXISTING tracking inputs
 * (visitor sessions, tracking events, blog sessions, touchpoints) without modifying
 * any source. Nothing tracked is discarded — raw inputs flow into typed summaries.
 */

import type { CanonicalLead, CanonicalLeadInput } from './types';

export interface ContentIntelligence {
  pagesViewed: string[];
  blogs: string[];
  assets: string[];
  forms: string[];
  downloads: string[];
  campaignsTouched: string[];
  timeSpentSeconds: number;
  maxScrollDepth: number;
  conversions: number;
  engagementEvents: number;
  journeySummary: string;
}

export interface ContentIntelligenceInputs {
  /** tracking_events rows ({ event_name/event_category/page_url/metadata }). */
  events?: Array<Record<string, unknown>>;
  /** blog_read_sessions / blog_analytics rows. */
  blogSessions?: Array<Record<string, unknown>>;
  /** campaign_touchpoints rows. */
  touchpoints?: Array<Record<string, unknown>>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const uniq = (xs: Array<string | null>): string[] => Array.from(new Set(xs.filter((x): x is string => !!x)));

export function buildContentIntelligence(inputs: ContentIntelligenceInputs): ContentIntelligence {
  const events = inputs.events ?? [];
  const blogs = inputs.blogSessions ?? [];
  const touchpoints = inputs.touchpoints ?? [];

  const pagesViewed = uniq(events.filter((e) => str(e.event_category) === 'navigation' || str(e.event_name) === 'pageview').map((e) => str(e.page_url)));
  const formEvents = events.filter((e) => String(e.event_name ?? '').includes('form'));
  const downloadEvents = events.filter((e) => String(e.event_name ?? '').includes('download'));
  const conversionEvents = events.filter((e) => str(e.event_category) === 'conversion');
  const assetMeta = events.map((e) => str((e.metadata as Record<string, unknown> | undefined)?.asset_id)).filter(Boolean) as string[];

  const timeSpentSeconds = events.reduce((acc, e) => acc + n(e.time_on_page) + n(e.time_seconds), 0)
    + blogs.reduce((acc, b) => acc + n(b.time_seconds) + n(b.time_on_page), 0);
  const maxScrollDepth = Math.max(0, ...events.map((e) => n(e.scroll_depth)), ...blogs.map((b) => n(b.scroll_depth)));

  const out: ContentIntelligence = {
    pagesViewed,
    blogs: uniq(blogs.map((b) => str(b.url_slug) ?? str(b.blog_id) ?? str(b.url))),
    assets: uniq(assetMeta),
    forms: uniq(formEvents.map((e) => str((e.metadata as Record<string, unknown> | undefined)?.form_id) ?? str(e.form_id))),
    downloads: uniq(downloadEvents.map((e) => str(e.page_url) ?? str((e.metadata as Record<string, unknown> | undefined)?.asset_id))),
    campaignsTouched: uniq(touchpoints.map((t) => str(t.campaign))),
    timeSpentSeconds,
    maxScrollDepth,
    conversions: conversionEvents.length,
    engagementEvents: events.filter((e) => str(e.event_category) === 'engagement').length,
    journeySummary: '',
  };
  out.journeySummary = `${out.pagesViewed.length} pages, ${out.blogs.length} blogs, ${out.conversions} conversions, ${Math.round(out.timeSpentSeconds)}s, scroll ${out.maxScrollDepth}%`;
  return out;
}

export interface CampaignIntelligence {
  campaign: string | null;
  campaignId: string | null;
  campaignType: string | null;
  channel: string | null;
  contentId: string | null;
  contentType: string | null;
  contentTitle: string | null;
  assetId: string | null;
}

/** Campaign intelligence captured at ingestion from the lead's attribution + metadata. */
export function buildCampaignIntelligence(lead: CanonicalLead | CanonicalLeadInput): CampaignIntelligence {
  const meta = lead.attribution.sourceMetadata;
  const m = (k: string): string | null => str(meta[k]);
  return {
    campaign: lead.attribution.campaign,
    campaignId: m('campaign_id') ?? m('campaignId'),
    campaignType: m('campaign_type') ?? m('campaignType') ?? m('opportunity_type') ?? m('signal_category'),
    channel: lead.attribution.originalChannel,
    contentId: m('content_id') ?? m('contentId') ?? m('omn_asset_id'),
    contentType: m('content_type') ?? m('contentType'),
    contentTitle: str(lead.display?.title) ?? m('content_title'),
    assetId: m('asset_id') ?? m('omn_asset_id'),
  };
}
