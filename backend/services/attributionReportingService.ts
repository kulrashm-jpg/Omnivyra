import { ownedDbTable } from '../db/writeOwner';
import { recordAuditEvent } from './auditEventService';

export type DateRange = { from: string; to: string };

export async function getAttributionReport(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
  useCache?: boolean;
}) {
  const range = normalizeRange(input.from, input.to);
  const cacheKey = 'attribution-intelligence-v1';
  if (input.useCache !== false) {
    const cached = await readCache(input.companyId, input.websiteId, cacheKey, range);
    if (cached) return cached;
  }

  const [attributions, conversions, touchpoints, events, blogs] = await Promise.all([
    fetchLeadAttributions(input.companyId, input.websiteId, range),
    fetchFormConversions(input.companyId, input.websiteId, range),
    fetchTouchpoints(input.companyId, input.websiteId, range),
    fetchTrackingEvents(input.companyId, input.websiteId, range),
    fetchBlogs(input.companyId, input.websiteId),
  ]);

  const payload = {
    date_range: range,
    website_id: input.websiteId ?? null,
    top_converting_campaigns: rankByCount(attributions, 'utm_campaign'),
    top_converting_landing_pages: rankByCount(attributions, 'landing_page'),
    traffic_source_conversion: rankTrafficSources(attributions),
    first_touch_analysis: rankJsonTouch(attributions, 'first_touch'),
    last_touch_analysis: rankJsonTouch(attributions, 'last_touch'),
    cta_conversion_analysis: rankCta(events, conversions),
    assisted_conversions: rankAssistedConversions(touchpoints, conversions),
    conversion_journeys: summarizeJourneys(touchpoints, conversions),
    top_converting_blogs: rankBlogs(attributions, blogs),
    website_conversion_summary: {
      conversions: conversions.length,
      attributed_leads: attributions.length,
      touchpoints: touchpoints.length,
      conversion_rate_hint: safeRate(conversions.length, uniqueSessions(events)),
    },
    export_ready: true,
  };

  await writeCache(input.companyId, input.websiteId, cacheKey, range, payload);
  await recordAuditEvent({
    companyId: input.companyId,
    websiteId: input.websiteId,
    actorType: 'system',
    action: 'analytics.attribution_report.read',
    resourceType: 'attribution_report',
    severity: 'info',
    metadata: { range },
  });
  return payload;
}

async function readCache(companyId: string, websiteId: string | null | undefined, key: string, range: DateRange) {
  let query = ownedDbTable('attribution_report_cache')
    .select('payload, expires_at')
    .eq('company_id', companyId)
    .eq('report_key', key)
    .eq('date_from', range.from)
    .eq('date_to', range.to)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  query = websiteId ? query.eq('website_id', websiteId) : query.is('website_id', null);
  const { data } = await query;
  return data?.[0]?.payload ?? null;
}

async function writeCache(companyId: string, websiteId: string | null | undefined, key: string, range: DateRange, payload: unknown) {
  await ownedDbTable('attribution_report_cache').upsert({
    company_id: companyId,
    website_id: websiteId ?? null,
    report_key: key,
    date_from: range.from,
    date_to: range.to,
    payload,
    computed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }, { onConflict: 'company_id,website_id,report_key,date_from,date_to' });
}

async function fetchLeadAttributions(companyId: string, websiteId: string | null | undefined, range: DateRange) {
  let query = ownedDbTable('lead_attributions').select('*').eq('company_id', companyId).gte('created_at', range.from).lte('created_at', endOfDay(range.to));
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchFormConversions(companyId: string, websiteId: string | null | undefined, range: DateRange) {
  let query = ownedDbTable('form_conversions').select('*').eq('company_id', companyId).gte('converted_at', range.from).lte('converted_at', endOfDay(range.to));
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchTouchpoints(companyId: string, websiteId: string | null | undefined, range: DateRange) {
  let query = ownedDbTable('campaign_touchpoints').select('*').eq('company_id', companyId).gte('touched_at', range.from).lte('touched_at', endOfDay(range.to));
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.order('touched_at', { ascending: true }).limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchTrackingEvents(companyId: string, websiteId: string | null | undefined, range: DateRange) {
  let query = ownedDbTable('tracking_events').select('*').eq('company_id', companyId).gte('occurred_at', range.from).lte('occurred_at', endOfDay(range.to));
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data, error } = await query.limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchBlogs(companyId: string, websiteId?: string | null) {
  let query = ownedDbTable('blogs').select('id, title, slug, website_id').eq('company_id', companyId);
  if (websiteId) query = query.eq('website_id', websiteId);
  const { data } = await query.limit(1000);
  return data ?? [];
}

function normalizeRange(from?: string | null, to?: string | null): DateRange {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function endOfDay(day: string): string {
  return `${day}T23:59:59.999Z`;
}

function rankByCount(rows: any[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] || '').trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, conversions]) => ({ name, conversions })).sort((a, b) => b.conversions - a.conversions).slice(0, 20);
}

function rankTrafficSources(rows: any[]) {
  const counts = new Map<string, { source: string; medium: string; conversions: number }>();
  for (const row of rows) {
    const source = String(row.utm_source || row.referrer || 'direct');
    const medium = String(row.utm_medium || 'unknown');
    const key = `${source}:${medium}`;
    const current = counts.get(key) ?? { source, medium, conversions: 0 };
    current.conversions += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.conversions - a.conversions).slice(0, 20);
}

function rankJsonTouch(rows: any[], key: 'first_touch' | 'last_touch') {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const touch = row[key] || {};
    const source = String(touch.utm_source || touch.referrer || row.utm_source || 'direct');
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, conversions]) => ({ source, conversions })).sort((a, b) => b.conversions - a.conversions).slice(0, 20);
}

function rankCta(events: any[], conversions: any[]) {
  const ctaClicks = events.filter((event) => event.event_name === 'cta_click');
  const conversionSessions = new Set(conversions.map((conversion) => conversion.visitor_session_id).filter(Boolean));
  const counts = new Map<string, { clicks: number; conversions: number }>();
  for (const event of ctaClicks) {
    const label = String(event.metadata?.cta_id || event.metadata?.label || event.page_url || 'unknown');
    const current = counts.get(label) ?? { clicks: 0, conversions: 0 };
    current.clicks += 1;
    if (event.visitor_session_id && conversionSessions.has(event.visitor_session_id)) current.conversions += 1;
    counts.set(label, current);
  }
  return [...counts.entries()].map(([cta, stats]) => ({ cta, ...stats, conversion_rate: safeRate(stats.conversions, stats.clicks) })).sort((a, b) => b.conversions - a.conversions).slice(0, 20);
}

function rankAssistedConversions(touchpoints: any[], conversions: any[]) {
  const conversionSessions = new Set(conversions.map((conversion) => conversion.visitor_session_id).filter(Boolean));
  const counts = new Map<string, number>();
  for (const touchpoint of touchpoints) {
    if (!touchpoint.visitor_session_id || !conversionSessions.has(touchpoint.visitor_session_id)) continue;
    const source = String(touchpoint.source || 'unknown');
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, assisted_conversions]) => ({ source, assisted_conversions })).sort((a, b) => b.assisted_conversions - a.assisted_conversions).slice(0, 20);
}

function summarizeJourneys(touchpoints: any[], conversions: any[]) {
  const bySession = new Map<string, string[]>();
  for (const touchpoint of touchpoints) {
    if (!touchpoint.visitor_session_id) continue;
    const label = touchpoint.campaign || touchpoint.source || touchpoint.page_url || touchpoint.touchpoint_type;
    bySession.set(touchpoint.visitor_session_id, [...(bySession.get(touchpoint.visitor_session_id) ?? []), String(label)]);
  }
  return conversions.slice(0, 50).map((conversion) => ({
    conversion_id: conversion.id,
    form_id: conversion.form_id,
    lead_id: conversion.lead_id,
    journey: bySession.get(conversion.visitor_session_id) ?? [],
    converted_at: conversion.converted_at,
  }));
}

function rankBlogs(attributions: any[], blogs: any[]) {
  const blogBySlug = new Map(blogs.map((blog) => [String(blog.slug || '').toLowerCase(), blog]));
  const counts = new Map<string, number>();
  for (const row of attributions) {
    const page = String(row.landing_page || row.current_page || '').toLowerCase();
    const match = [...blogBySlug.entries()].find(([slug]) => slug && page.includes(slug));
    if (match) counts.set(match[1].title, (counts.get(match[1].title) ?? 0) + 1);
  }
  return [...counts.entries()].map(([title, conversions]) => ({ title, conversions })).sort((a, b) => b.conversions - a.conversions).slice(0, 20);
}

// ─── Creator → Lead attribution rollups ──────────────────────────────────────
// Read helpers for "which strategy / variant / asset generated leads?".
// They read the same lead_attributions snapshot rows the rest of this service
// consumes — the creator id columns are populated by recordLeadAttribution.
// No dashboard/UI work; these are query helpers only.

type CreatorAttributionRow = {
  value: string;
  conversions: number;
  lead_ids: string[];
  /** Distinct campaigns (utm_campaign = campaignId) the conversions came from. */
  campaigns: string[];
};

async function fetchLeadAttributionsByColumn(
  column: 'creator_strategy_id' | 'variant_id' | 'asset_id',
  input: { companyId: string; websiteId?: string | null; from?: string | null; to?: string | null }
): Promise<CreatorAttributionRow[]> {
  const range = normalizeRange(input.from, input.to);
  // utm_campaign is already on the snapshot row (it stores the campaignId) — we
  // surface it here so callers get "associated campaigns" without a second
  // query. Pure read of the existing reporting table; no new calculation.
  let query = ownedDbTable('lead_attributions')
    .select(`${column}, lead_id, utm_campaign`)
    .eq('company_id', input.companyId)
    .not(column, 'is', null)
    .gte('created_at', range.from)
    .lte('created_at', endOfDay(range.to));
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);

  const counts = new Map<string, CreatorAttributionRow & { _campaigns: Set<string> }>();
  for (const row of (data ?? []) as any[]) {
    const value = String(row[column] || '').trim();
    if (!value) continue;
    const current =
      counts.get(value) ?? { value, conversions: 0, lead_ids: [], campaigns: [], _campaigns: new Set<string>() };
    current.conversions += 1;
    if (row.lead_id) current.lead_ids.push(String(row.lead_id));
    const campaign = String(row.utm_campaign || '').trim();
    if (campaign) current._campaigns.add(campaign);
    counts.set(value, current);
  }
  return [...counts.values()]
    .map((r) => ({ value: r.value, conversions: r.conversions, lead_ids: r.lead_ids, campaigns: [...r._campaigns] }))
    .sort((a, b) => b.conversions - a.conversions);
}

export async function getLeadsByStrategy(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<Array<{ creator_strategy_id: string; conversions: number; lead_ids: string[]; campaigns: string[] }>> {
  const rows = await fetchLeadAttributionsByColumn('creator_strategy_id', input);
  return rows.map((row) => ({ creator_strategy_id: row.value, conversions: row.conversions, lead_ids: row.lead_ids, campaigns: row.campaigns }));
}

export async function getLeadsByVariant(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<Array<{ variant_id: string; conversions: number; lead_ids: string[]; campaigns: string[] }>> {
  const rows = await fetchLeadAttributionsByColumn('variant_id', input);
  return rows.map((row) => ({ variant_id: row.value, conversions: row.conversions, lead_ids: row.lead_ids, campaigns: row.campaigns }));
}

export async function getLeadsByAsset(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<Array<{ asset_id: string; conversions: number; lead_ids: string[]; campaigns: string[] }>> {
  const rows = await fetchLeadAttributionsByColumn('asset_id', input);
  return rows.map((row) => ({ asset_id: row.value, conversions: row.conversions, lead_ids: row.lead_ids, campaigns: row.campaigns }));
}

// ─── Conversion-rate quality indicators (display-only) ────────────────────────
// Leads ÷ distinct exposed sessions, per strategy / asset. The denominator is
// the count of distinct visitor_session_id in campaign_touchpoints carrying the
// same creator id (a page-view tagged with that strategy/asset). Read-only —
// these helpers do NOT feed ranking, recommendation, governance, or learning.
// No schema change: both columns already exist (migration 20260819).

export type ConversionConfidence = 'insufficient' | 'low' | 'medium' | 'high';

export type ConversionRateRow = {
  id: string;
  conversions: number;
  exposed_sessions: number;
  /** null when there are no exposed sessions to divide by (avoids /0). */
  conversion_rate: number | null;
  confidence: ConversionConfidence;
  campaigns: string[];
};

/**
 * Two-axis confidence (volume AND exposure), per the Conversion Signal Quality
 * audit. Below the Low floor a row is 'insufficient' — callers must show
 * "Insufficient Data" rather than a fabricated leader.
 */
export function classifyConversionConfidence(conversions: number, exposedSessions: number): ConversionConfidence {
  if (conversions >= 50 && exposedSessions >= 1000) return 'high';
  if (conversions >= 25 && exposedSessions >= 400) return 'medium';
  if (conversions >= 10 && exposedSessions >= 100) return 'low';
  return 'insufficient';
}

/** Distinct exposed sessions per creator id from campaign_touchpoints. */
async function fetchExposedSessionsByColumn(
  column: 'creator_strategy_id' | 'variant_id' | 'asset_id',
  input: { companyId: string; websiteId?: string | null; from?: string | null; to?: string | null }
): Promise<Map<string, number>> {
  const range = normalizeRange(input.from, input.to);
  let query = ownedDbTable('campaign_touchpoints')
    .select(`${column}, visitor_session_id`)
    .eq('company_id', input.companyId)
    .not(column, 'is', null)
    .gte('touched_at', range.from)
    .lte('touched_at', endOfDay(range.to));
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(20000);
  if (error) throw new Error(error.message);

  const sessionsByValue = new Map<string, Set<string>>();
  for (const row of (data ?? []) as any[]) {
    const value = String(row[column] || '').trim();
    const sessionId = row.visitor_session_id ? String(row.visitor_session_id) : '';
    if (!value || !sessionId) continue;
    const set = sessionsByValue.get(value) ?? new Set<string>();
    set.add(sessionId);
    sessionsByValue.set(value, set);
  }
  return new Map([...sessionsByValue.entries()].map(([k, v]) => [k, v.size]));
}

async function conversionRateByColumn(
  column: 'creator_strategy_id' | 'variant_id' | 'asset_id',
  input: { companyId: string; websiteId?: string | null; from?: string | null; to?: string | null }
): Promise<ConversionRateRow[]> {
  const [leads, exposure] = await Promise.all([
    fetchLeadAttributionsByColumn(column, input),
    fetchExposedSessionsByColumn(column, input),
  ]);
  return leads.map((row) => {
    const exposed = exposure.get(row.value) ?? 0;
    const rate = exposed > 0 ? Number((row.conversions / exposed).toFixed(4)) : null;
    return {
      id: row.value,
      conversions: row.conversions,
      exposed_sessions: exposed,
      conversion_rate: rate,
      confidence: classifyConversionConfidence(row.conversions, exposed),
      campaigns: row.campaigns,
    };
  });
}

export async function getStrategyConversionRate(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ConversionRateRow[]> {
  return conversionRateByColumn('creator_strategy_id', input);
}

export async function getAssetConversionRate(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ConversionRateRow[]> {
  return conversionRateByColumn('asset_id', input);
}

// Variant conversion rate. The denominator (campaign_touchpoints.variant_id) is
// populated by the creator-asset link binding, so this is now meaningful. Same
// formula + confidence thresholds as strategy/asset — no new thresholds.
export async function getVariantConversionRate(input: {
  companyId: string;
  websiteId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ConversionRateRow[]> {
  return conversionRateByColumn('variant_id', input);
}

// ─── Marketing-effectiveness conversion rates (campaign / platform / content) ─
// Same leads ÷ distinct-exposed-sessions formula and confidence model as the
// creator dimensions, but over the utm_* columns that ALREADY exist. The
// numerator (lead_attributions.utm_*) and denominator (campaign_touchpoints
// .{campaign,source,content}) have different column names, so these use a value
// pair. No new attribution / tracking / columns — pure read over existing data.

type RateScope = { companyId: string; websiteId?: string | null; from?: string | null; to?: string | null };
type LeadAgg = { conversions: number; lead_ids: string[]; campaigns: Set<string> };

/** Content-type lives in utm_content as `${contentType}_wN_dN` (the tracking
 *  link format). Parse the type prefix; fall back to the raw value if it does
 *  not follow the pattern. */
function parseContentType(raw: string): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  const idx = v.indexOf('_w');
  return idx > 0 ? v.slice(0, idx) : v;
}

async function fetchLeadsByValueCol(
  valueCol: 'utm_campaign' | 'utm_source' | 'utm_content',
  input: RateScope,
  transform?: (raw: string) => string | null,
): Promise<Map<string, LeadAgg>> {
  const range = normalizeRange(input.from, input.to);
  const cols = [...new Set([valueCol, 'lead_id', 'utm_campaign'])].join(', ');
  let query = ownedDbTable('lead_attributions')
    .select(cols)
    .eq('company_id', input.companyId)
    .not(valueCol, 'is', null)
    .gte('created_at', range.from)
    .lte('created_at', endOfDay(range.to));
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(error.message);

  const map = new Map<string, LeadAgg>();
  for (const row of (data ?? []) as any[]) {
    const raw = String(row[valueCol] || '').trim();
    const value = transform ? transform(raw) : raw;
    if (!value) continue;
    const cur = map.get(value) ?? { conversions: 0, lead_ids: [], campaigns: new Set<string>() };
    cur.conversions += 1;
    if (row.lead_id) cur.lead_ids.push(String(row.lead_id));
    const campaign = String(row.utm_campaign || '').trim();
    if (campaign) cur.campaigns.add(campaign);
    map.set(value, cur);
  }
  return map;
}

async function fetchSessionsByValueCol(
  valueCol: 'campaign' | 'source' | 'content',
  input: RateScope,
  transform?: (raw: string) => string | null,
): Promise<Map<string, number>> {
  const range = normalizeRange(input.from, input.to);
  let query = ownedDbTable('campaign_touchpoints')
    .select(`${valueCol}, visitor_session_id`)
    .eq('company_id', input.companyId)
    .not(valueCol, 'is', null)
    .gte('touched_at', range.from)
    .lte('touched_at', endOfDay(range.to));
  if (input.websiteId) query = query.eq('website_id', input.websiteId);
  const { data, error } = await query.limit(20000);
  if (error) throw new Error(error.message);

  const sessions = new Map<string, Set<string>>();
  for (const row of (data ?? []) as any[]) {
    const raw = String(row[valueCol] || '').trim();
    const value = transform ? transform(raw) : raw;
    const sessionId = row.visitor_session_id ? String(row.visitor_session_id) : '';
    if (!value || !sessionId) continue;
    const set = sessions.get(value) ?? new Set<string>();
    set.add(sessionId);
    sessions.set(value, set);
  }
  return new Map([...sessions.entries()].map(([k, v]) => [k, v.size]));
}

async function conversionRateByValuePair(
  numeratorCol: 'utm_campaign' | 'utm_source' | 'utm_content',
  denominatorCol: 'campaign' | 'source' | 'content',
  input: RateScope,
  transform?: (raw: string) => string | null,
): Promise<ConversionRateRow[]> {
  const [leads, exposure] = await Promise.all([
    fetchLeadsByValueCol(numeratorCol, input, transform),
    fetchSessionsByValueCol(denominatorCol, input, transform),
  ]);
  return [...leads.entries()]
    .map(([value, agg]) => {
      const exposed = exposure.get(value) ?? 0;
      const rate = exposed > 0 ? Number((agg.conversions / exposed).toFixed(4)) : null;
      return {
        id: value,
        conversions: agg.conversions,
        exposed_sessions: exposed,
        conversion_rate: rate,
        confidence: classifyConversionConfidence(agg.conversions, exposed),
        campaigns: [...agg.campaigns],
      };
    })
    .sort((a, b) => b.conversions - a.conversions);
}

export async function getCampaignConversionRate(input: RateScope): Promise<ConversionRateRow[]> {
  return conversionRateByValuePair('utm_campaign', 'campaign', input);
}

export async function getPlatformConversionRate(input: RateScope): Promise<ConversionRateRow[]> {
  return conversionRateByValuePair('utm_source', 'source', input);
}

export async function getContentTypeConversionRate(input: RateScope): Promise<ConversionRateRow[]> {
  return conversionRateByValuePair('utm_content', 'content', input, parseContentType);
}

function uniqueSessions(events: any[]): number {
  return new Set(events.map((event) => event.visitor_session_id || event.anonymous_id).filter(Boolean)).size;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
