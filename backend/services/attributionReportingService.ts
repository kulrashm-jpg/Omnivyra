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

function uniqueSessions(events: any[]): number {
  return new Set(events.map((event) => event.visitor_session_id || event.anonymous_id).filter(Boolean)).size;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
