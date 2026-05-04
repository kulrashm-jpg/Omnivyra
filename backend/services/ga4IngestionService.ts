import axios from 'axios';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { isConversionEvent } from './conversionRegistry';
import { ensureCanonicalDomain, hashKey, normalizeUrl, resolveCompanyWebsite, safeInteger, safeNumber, todayIsoDate } from './ingestionUtils';
import { resolveGa4IngestionContext } from './analyticsIntegrationService';
import { logger } from './logger';
import { normalizeSource as normalizeUnifiedSource } from './sourceNormalizationService';
import { bulkCreateTouchpoints, type TouchpointInput, type TouchpointWriteResult } from './touchpointService';

export interface Ga4SessionRow {
  sessionDate: string;
  pagePath: string;
  sessionId?: string | null;
  trafficSource?: string | null;
  trafficMedium?: string | null;
  campaignName?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  deviceCategory?: string | null;
  sessions?: number | string | null;
  engagedSessions?: number | string | null;
  engagementTimeMsec?: number | string | null;
  screenPageViews?: number | string | null;
  totalUsers?: number | string | null;
  activeUsers?: number | string | null;
  userId?: string | null;
}

export interface Ga4EventRow {
  eventTimestamp: string;
  eventName: string;
  sessionId?: string | null;
  pagePath?: string | null;
  trafficSource?: string | null;
  trafficMedium?: string | null;
  campaignName?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  deviceCategory?: string | null;
  eventCount?: number | string | null;
  eventValue?: number | string | null;
  userId?: string | null;
}

export interface Ga4IngestionInput {
  companyId: string;
  propertyId?: string;
  accessToken?: string;
  rows?: Ga4SessionRow[];
  eventRows?: Ga4EventRow[];
  startDate?: string;
  endDate?: string;
}

export interface Ga4IngestionResult {
  source: 'ga4';
  sessionsProcessed: number;
  sessionsInserted: number;
  usersUpserted: number;
  pageViewsInserted: number;
  eventsProcessed: number;
  eventsInserted: number;
  conversionsInserted: number;
  touchpointsCreated?: number;
  touchpointsSkipped?: number;
}

type CanonicalEventRef = {
  id: string;
  session_id: string;
  event_name: string;
  event_timestamp: string;
};

type CanonicalConversionRef = {
  id: string;
  session_id: string;
  conversion_name: string;
  conversion_timestamp: string;
};

type Ga4SessionTouchpointInput = {
  companyId: string;
  sessionId: string;
  sessionKey: string;
  row: Pick<Ga4SessionRow, 'sessionDate' | 'trafficSource' | 'trafficMedium' | 'campaignName'>;
};

function normalizePath(path: string | null | undefined): string {
  const value = String(path ?? '/').trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function buildStableExternalKey(prefix: string, parts: Array<string | null | undefined>): string {
  const normalized = parts
    .map((part) => String(part ?? '').trim())
    .map((part) => part.replace(/\|/g, '%7C'))
    .map((part) => (part.length > 0 ? part : 'na'));

  return `${prefix}|${normalized.join('|')}`;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeTimestampKey(value: unknown): string {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? String(value ?? '').trim() : parsed.toISOString();
}

function recordText(record: Record<string, unknown>, key: string): string {
  return String(record[key] ?? '').trim();
}

function eventRecordKey(record: Record<string, unknown>): string {
  return [
    recordText(record, 'company_id'),
    recordText(record, 'session_id'),
    recordText(record, 'event_name'),
    normalizeTimestampKey(record.event_timestamp),
  ].join('|');
}

function eventRefKey(row: CanonicalEventRef, companyId: string): string {
  return [
    companyId,
    row.session_id,
    row.event_name,
    normalizeTimestampKey(row.event_timestamp),
  ].join('|');
}

function conversionRecordKey(record: Record<string, unknown>): string {
  return [
    recordText(record, 'company_id'),
    recordText(record, 'session_id'),
    recordText(record, 'conversion_name'),
    normalizeTimestampKey(record.conversion_timestamp),
  ].join('|');
}

function conversionRefKey(row: CanonicalConversionRef, companyId: string): string {
  return [
    companyId,
    row.session_id,
    row.conversion_name,
    normalizeTimestampKey(row.conversion_timestamp),
  ].join('|');
}

function normalizeGaDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw || todayIsoDate();
}

function normalizeGaTimestamp(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (/^\d{12}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:00.000Z`;
  }
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date(`${todayIsoDate()}T00:00:00.000Z`).toISOString();
}

function normalizeEventCategory(eventName: string | null | undefined): 'navigation' | 'engagement' | 'conversion' {
  const normalized = String(eventName ?? '').trim().toLowerCase();
  if (normalized === 'page_view' || normalized === 'session_start') return 'navigation';
  if (normalized === 'scroll' || normalized === 'click' || normalized === 'engagement_time') return 'engagement';
  if (normalized === 'purchase' || normalized === 'generate_lead' || normalized === 'form_submit' || normalized === 'signup') return 'conversion';
  return isConversionEvent(normalized) ? 'conversion' : 'engagement';
}

function normalizeDevice(device: string | null | undefined): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  const value = String(device ?? '').trim().toLowerCase();
  if (value === 'desktop' || value === 'mobile' || value === 'tablet') return value;
  return 'unknown';
}

function normalizeSource(source: string | null | undefined): 'organic' | 'paid' | 'social' | 'direct' | 'referral' | 'email' | 'unknown' {
  const value = String(source ?? '').trim().toLowerCase();
  if (['organic', 'paid', 'social', 'direct', 'referral', 'email'].includes(value)) {
    return value as ReturnType<typeof normalizeSource>;
  }
  if (value.includes('social')) return 'social';
  if (value.includes('organic')) return 'organic';
  if (value.includes('paid') || value.includes('cpc') || value.includes('ppc')) return 'paid';
  if (value.includes('mail') || value.includes('email')) return 'email';
  return 'unknown';
}

async function fetchGa4Rows(input: Ga4IngestionInput): Promise<Ga4SessionRow[]> {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }

  if (!input.propertyId || !input.accessToken) {
    return [];
  }

  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${input.propertyId}:runReport`,
    {
      dateRanges: [
        {
          startDate: input.startDate ?? '7daysAgo',
          endDate: input.endDate ?? 'today',
        },
      ],
      dimensions: [
        { name: 'date' },
        { name: 'pagePath' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionMedium' },
        { name: 'sessionCampaignName' },
        { name: 'country' },
        { name: 'region' },
        { name: 'city' },
        { name: 'deviceCategory' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'userEngagementDuration' },
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'activeUsers' },
      ],
      limit: 10000,
    },
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      timeout: 15000,
    }
  );

  const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
  return rows.map((row: any) => ({
    sessionDate: row.dimensionValues?.[0]?.value ?? todayIsoDate(),
    pagePath: row.dimensionValues?.[1]?.value ?? '/',
    trafficSource: row.dimensionValues?.[2]?.value ?? 'unknown',
    trafficMedium: row.dimensionValues?.[3]?.value ?? null,
    campaignName: row.dimensionValues?.[4]?.value ?? null,
    country: row.dimensionValues?.[5]?.value ?? null,
    region: row.dimensionValues?.[6]?.value ?? null,
    city: row.dimensionValues?.[7]?.value ?? null,
    deviceCategory: row.dimensionValues?.[8]?.value ?? null,
    sessions: row.metricValues?.[0]?.value ?? 0,
    engagedSessions: row.metricValues?.[1]?.value ?? 0,
    engagementTimeMsec: row.metricValues?.[2]?.value ?? 0,
    screenPageViews: row.metricValues?.[3]?.value ?? 0,
    totalUsers: row.metricValues?.[4]?.value ?? 0,
    activeUsers: row.metricValues?.[5]?.value ?? 0,
  }));
}

async function fetchGa4EventRows(input: Ga4IngestionInput): Promise<Ga4EventRow[]> {
  if (Array.isArray(input.eventRows)) {
    return input.eventRows;
  }

  if (!input.propertyId || !input.accessToken) {
    return [];
  }

  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${input.propertyId}:runReport`,
    {
      dateRanges: [
        {
          startDate: input.startDate ?? '7daysAgo',
          endDate: input.endDate ?? 'today',
        },
      ],
      // GA4 runReport allows at most 9 dimensions per request. Campaign name
      // is intentionally omitted here — it is already captured by the
      // session-level report in fetchGa4Rows() and is propagated into
      // canonical_sessions.source_campaign, so canonical_events can retrieve
      // it via session_id. Adding sessionCampaignName here would push the
      // request to 10 dimensions and fail with INVALID_ARGUMENT.
      dimensions: [
        { name: 'dateHourMinute' },
        { name: 'eventName' },
        { name: 'pagePath' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionMedium' },
        { name: 'country' },
        { name: 'region' },
        { name: 'city' },
        { name: 'deviceCategory' },
      ],
      metrics: [
        { name: 'eventCount' },
        { name: 'totalRevenue' },
      ],
      limit: 10000,
    },
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      timeout: 15000,
    }
  );

  const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
  return rows.map((row: any) => ({
    eventTimestamp: row.dimensionValues?.[0]?.value ?? todayIsoDate(),
    eventName: row.dimensionValues?.[1]?.value ?? 'unknown_event',
    pagePath: row.dimensionValues?.[2]?.value ?? '/',
    trafficSource: row.dimensionValues?.[3]?.value ?? 'unknown',
    trafficMedium: row.dimensionValues?.[4]?.value ?? null,
    campaignName: null,
    country: row.dimensionValues?.[5]?.value ?? null,
    region: row.dimensionValues?.[6]?.value ?? null,
    city: row.dimensionValues?.[7]?.value ?? null,
    deviceCategory: row.dimensionValues?.[8]?.value ?? null,
    eventCount: row.metricValues?.[0]?.value ?? 0,
    eventValue: row.metricValues?.[1]?.value ?? null,
  }));
}

async function upsertPage(companyId: string, domainId: string, baseUrl: string, pagePath: string): Promise<string> {
  const url = normalizeUrl(new URL(normalizePath(pagePath), baseUrl).toString());
  const pageType = url.endsWith('/') || new URL(url).pathname === '/' ? 'home' : 'landing';

  const { data, error } = await supabase
    .from('canonical_pages')
    .upsert(
      {
        company_id: companyId,
        domain_id: domainId,
        url,
        page_type: pageType,
      },
      { onConflict: 'company_id,url' }
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert canonical page for ${pagePath}: ${error.message}`);
  }

  return (data as { id: string }).id;
}

async function upsertSession(input: {
  companyId: string;
  domainId: string;
  sessionKey: string;
  row: Ga4SessionRow;
}): Promise<string> {
  const payload = {
    company_id: input.companyId,
    domain_id: input.domainId,
    external_session_id: input.sessionKey,
    external_session_key: input.sessionKey,
    source: normalizeSource(input.row.trafficSource),
    device: normalizeDevice(input.row.deviceCategory),
    started_at: new Date(normalizeGaDate(input.row.sessionDate)).toISOString(),
    session_count: Math.max(1, safeInteger(input.row.sessions, 1)),
    source_medium: input.row.trafficMedium ?? null,
    source_campaign: input.row.campaignName ?? null,
    geo_country: input.row.country ?? null,
    geo_region: input.row.region ?? null,
    geo_city: input.row.city ?? null,
    engagement_time_msec: safeInteger(input.row.engagementTimeMsec, 0),
    is_engaged: safeInteger(input.row.engagedSessions, 0) > 0,
    page_view_count: safeInteger(input.row.screenPageViews, 0),
    session_metadata: {
      active_users: safeInteger(input.row.activeUsers, 0),
      total_users: safeInteger(input.row.totalUsers, 0),
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from('canonical_sessions')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('external_session_id', input.sessionKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check existing GA4 session: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('canonical_sessions').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update GA4 session: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('canonical_sessions').insert(payload).select('id').single();
  if (error) {
    throw new Error(`Failed to insert GA4 session: ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function upsertUser(input: {
  companyId: string;
  userKey: string;
  sessionId: string;
  row: Ga4SessionRow;
}): Promise<string> {
  const payload = {
    company_id: input.companyId,
    external_user_key: input.userKey,
    session_id: input.sessionId,
    user_type: input.row.userId ? 'known' : 'anonymous',
    geo: input.row.country ?? null,
    device: normalizeDevice(input.row.deviceCategory),
    user_metadata: {
      region: input.row.region ?? null,
      city: input.row.city ?? null,
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from('canonical_users')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('external_user_key', input.userKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check existing GA4 user: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('canonical_users').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update GA4 user: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('canonical_users').insert(payload).select('id').single();
  if (error || !data) {
    throw new Error(`Failed to insert GA4 user: ${error.message}`);
  }
  return (data as { id: string }).id;
}

function buildUserKey(companyId: string, row: { userId?: string | null; country?: string | null; region?: string | null; city?: string | null; deviceCategory?: string | null }): string {
  return row.userId?.trim() || buildStableExternalKey('ga4-user', [
    companyId,
    row.country,
    row.region,
    row.city,
    row.deviceCategory,
  ]);
}

function buildSessionKey(companyId: string, row: {
  sessionId?: string | null;
  sessionDate?: string | null;
  pagePath?: string | null;
  trafficSource?: string | null;
  trafficMedium?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  deviceCategory?: string | null;
}): string {
  const externalSessionId = row.sessionId?.trim();
  if (externalSessionId) {
    return externalSessionId;
  }

  return buildStableExternalKey('ga4-session', [
    companyId,
    row.sessionDate,
    row.pagePath,
    row.trafficSource,
    row.trafficMedium,
    row.country,
    row.region,
    row.city,
    row.deviceCategory,
  ]);
}

function buildCanonicalEventRecord(input: {
  companyId: string;
  sessionId: string;
  userId: string;
  pageUrl: string | null;
  eventTimestamp: string;
  row: Ga4EventRow;
}): Record<string, unknown> {
  const eventCategory = normalizeEventCategory(input.row.eventName);
  return {
    company_id: input.companyId,
    session_id: input.sessionId,
    user_id: input.userId,
    event_name: input.row.eventName,
    event_category: eventCategory,
    page_url: input.pageUrl,
    event_timestamp: input.eventTimestamp,
    source: 'GA4',
    metadata: {
      source_medium: input.row.trafficMedium ?? null,
      campaign_name: input.row.campaignName ?? null,
      traffic_source: input.row.trafficSource ?? null,
      country: input.row.country ?? null,
      region: input.row.region ?? null,
      city: input.row.city ?? null,
      device_category: input.row.deviceCategory ?? null,
      event_value: safeNumber(input.row.eventValue, 0),
      aggregated_event_count: Math.max(1, safeInteger(input.row.eventCount, 1)),
    },
  };
}

function buildCanonicalConversionRecord(input: {
  companyId: string;
  sessionId: string;
  userId: string;
  pageUrl: string | null;
  eventTimestamp: string;
  row: Ga4EventRow;
}): Record<string, unknown> | null {
  if (!isConversionEvent(input.row.eventName)) {
    return null;
  }

  const totalValue = input.row.eventValue == null ? null : safeNumber(input.row.eventValue, 0);
  return {
    company_id: input.companyId,
    session_id: input.sessionId,
    user_id: input.userId,
    conversion_name: input.row.eventName,
    conversion_value: totalValue,
    page_url: input.pageUrl,
    conversion_timestamp: input.eventTimestamp,
    source: 'GA4',
    metadata: {
      source_medium: input.row.trafficMedium ?? null,
      campaign_name: input.row.campaignName ?? null,
      traffic_source: input.row.trafficSource ?? null,
      country: input.row.country ?? null,
      region: input.row.region ?? null,
      city: input.row.city ?? null,
      device_category: input.row.deviceCategory ?? null,
      aggregated_event_count: Math.max(1, safeInteger(input.row.eventCount, 1)),
      aggregated_total_value: totalValue,
    },
  };
}

function buildGa4SessionTouchpoint(input: Ga4SessionTouchpointInput): TouchpointInput {
  const channel = normalizeSource(input.row.trafficSource);
  const unifiedSource = normalizeUnifiedSource('ga4', {
    sourceType: 'integration',
    channel: channel === 'unknown' ? undefined : channel,
  });

  return {
    companyId: input.companyId,
    unifiedPersonId: null,
    source: 'ga4',
    unifiedSource,
    touchpointType: 'session',
    referenceTable: 'canonical_sessions',
    referenceId: input.sessionId,
    occurredAt: new Date(normalizeGaDate(input.row.sessionDate)).toISOString(),
    metadata: {
      source: input.row.trafficSource ?? null,
      medium: input.row.trafficMedium ?? null,
      campaign: input.row.campaignName ?? null,
      external_session_key: input.sessionKey,
    },
  };
}

async function persistBehavioralBatch(input: {
  events: Record<string, unknown>[];
  conversions: Record<string, unknown>[];
}): Promise<{ eventsInserted: number; conversionsInserted: number }> {
  if (input.events.length === 0 && input.conversions.length === 0) {
    return { eventsInserted: 0, conversionsInserted: 0 };
  }

  const { data, error } = await supabase.rpc('omnivyra_upsert_behavioral_analytics', {
    p_events: input.events,
    p_conversions: input.conversions,
  });

  if (error) {
    throw new Error(`Failed to persist GA4 behavioral batch: ${error.message}`);
  }

  return {
    eventsInserted: Number((data as { events_inserted?: number } | null)?.events_inserted ?? 0),
    conversionsInserted: Number((data as { conversions_inserted?: number } | null)?.conversions_inserted ?? 0),
  };
}

async function loadCanonicalEventRefs(
  companyId: string,
  records: Record<string, unknown>[]
): Promise<CanonicalEventRef[]> {
  if (records.length === 0) return [];

  const refsById = new Map<string, CanonicalEventRef>();
  for (const recordChunk of chunk(records, 250)) {
    const expectedKeys = new Set(recordChunk.map(eventRecordKey));
    const { data, error } = await supabase
      .from('canonical_events')
      .select('id, session_id, event_name, event_timestamp')
      .eq('company_id', companyId)
      .in('session_id', uniqueStrings(recordChunk.map((record) => record.session_id)))
      .in('event_name', uniqueStrings(recordChunk.map((record) => record.event_name)))
      .in('event_timestamp', uniqueStrings(recordChunk.map((record) => normalizeTimestampKey(record.event_timestamp))));

    if (error) {
      throw new Error(`Failed to load canonical GA4 events for touchpoints: ${error.message}`);
    }

    for (const row of (data ?? []) as CanonicalEventRef[]) {
      if (expectedKeys.has(eventRefKey(row, companyId))) {
        refsById.set(row.id, row);
      }
    }
  }

  return [...refsById.values()];
}

async function loadCanonicalConversionRefs(
  companyId: string,
  records: Record<string, unknown>[]
): Promise<CanonicalConversionRef[]> {
  if (records.length === 0) return [];

  const refsById = new Map<string, CanonicalConversionRef>();
  for (const recordChunk of chunk(records, 250)) {
    const expectedKeys = new Set(recordChunk.map(conversionRecordKey));
    const { data, error } = await supabase
      .from('canonical_conversions')
      .select('id, session_id, conversion_name, conversion_timestamp')
      .eq('company_id', companyId)
      .in('session_id', uniqueStrings(recordChunk.map((record) => record.session_id)))
      .in('conversion_name', uniqueStrings(recordChunk.map((record) => record.conversion_name)))
      .in('conversion_timestamp', uniqueStrings(recordChunk.map((record) => normalizeTimestampKey(record.conversion_timestamp))));

    if (error) {
      throw new Error(`Failed to load canonical GA4 conversions for touchpoints: ${error.message}`);
    }

    for (const row of (data ?? []) as CanonicalConversionRef[]) {
      if (expectedKeys.has(conversionRefKey(row, companyId))) {
        refsById.set(row.id, row);
      }
    }
  }

  return [...refsById.values()];
}

async function createGa4BehaviorTouchpoints(input: {
  companyId: string;
  sessionTouchpoints: TouchpointInput[];
  eventRecords: Record<string, unknown>[];
  conversionRecords: Record<string, unknown>[];
}): Promise<TouchpointWriteResult> {
  const [eventRefs, conversionRefs] = await Promise.all([
    loadCanonicalEventRefs(input.companyId, input.eventRecords),
    loadCanonicalConversionRefs(input.companyId, input.conversionRecords),
  ]);
  const unifiedSource = normalizeUnifiedSource('ga4', { sourceType: 'integration' });
  const touchpoints = [
    ...input.sessionTouchpoints,
    ...eventRefs.map((event) => ({
      companyId: input.companyId,
      unifiedPersonId: null,
      source: 'ga4',
      unifiedSource,
      touchpointType: 'event',
      referenceTable: 'canonical_events',
      referenceId: event.id,
      occurredAt: event.event_timestamp,
      metadata: {
        event_name: event.event_name,
        session_id: event.session_id,
      },
    })),
    ...conversionRefs.map((conversion) => ({
      companyId: input.companyId,
      unifiedPersonId: null,
      source: 'ga4',
      unifiedSource,
      touchpointType: 'conversion',
      referenceTable: 'canonical_conversions',
      referenceId: conversion.id,
      occurredAt: conversion.conversion_timestamp,
      metadata: {
        conversion_name: conversion.conversion_name,
        session_id: conversion.session_id,
      },
    })),
  ];

  return bulkCreateTouchpoints(touchpoints, {
    companyId: input.companyId,
    source: 'ga4',
    service: 'ga4IngestionService',
    sessionTouchpointsAttempted: input.sessionTouchpoints.length,
    eventTouchpointsAttempted: eventRefs.length,
    conversionTouchpointsAttempted: conversionRefs.length,
  });
}

export async function ingestGa4Data(input: Ga4IngestionInput): Promise<Ga4IngestionResult> {
  let propertyId = input.propertyId;
  let accessToken = input.accessToken;

  if (!Array.isArray(input.rows) && (!propertyId || !accessToken)) {
    const context = await resolveGa4IngestionContext(input.companyId);
    propertyId = context.property.property_id;
    accessToken = context.accessToken;
  }

  const rows = await fetchGa4Rows({
    ...input,
    propertyId,
    accessToken,
  });
  const eventRows = await fetchGa4EventRows({
    ...input,
    propertyId,
    accessToken,
  });
  const website = input.companyId ? await resolveCompanyWebsite(input.companyId) : null;
  if (!website) {
    throw new Error(`No website configured for company ${input.companyId}`);
  }

  const domain = await ensureCanonicalDomain(input.companyId, website);

  let sessionsInserted = 0;
  let usersUpserted = 0;
  let pageViewsInserted = 0;
  const sessionTouchpoints: TouchpointInput[] = [];
  const eventRecords: Record<string, unknown>[] = [];
  const conversionRecords: Record<string, unknown>[] = [];

  for (const row of rows) {
    const pageId = await upsertPage(input.companyId, domain.id, website, row.pagePath);
    const userKey = buildUserKey(input.companyId, row);
    const sessionKey = buildSessionKey(input.companyId, row);

    const sessionId = await upsertSession({
      companyId: input.companyId,
      domainId: domain.id,
      sessionKey,
      row,
    });
    sessionTouchpoints.push(
      buildGa4SessionTouchpoint({
        companyId: input.companyId,
        sessionId,
        sessionKey,
        row,
      })
    );

    await upsertUser({
      companyId: input.companyId,
      userKey,
      sessionId,
      row,
    });

    const pageUrl = normalizeUrl(new URL(normalizePath(row.pagePath), website).toString());
    const viewedAt = new Date(normalizeGaDate(row.sessionDate)).toISOString();

    // The unique index on (company_id, page_url, viewed_at, session_id) is
    // PARTIAL (WHERE page_url IS NOT NULL), so supabase-js .upsert()'s
    // onConflict cannot bind to it. Mirror the existence-check pattern used
    // by upsertSession() above instead of relying on ON CONFLICT.
    const { data: existingView, error: existingViewError } = await supabase
      .from('canonical_page_views')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('page_url', pageUrl)
      .eq('viewed_at', viewedAt)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existingViewError) {
      throw new Error(`Failed to check existing GA4 page view: ${existingViewError.message}`);
    }

    if (!existingView) {
      const { error: viewError } = await supabase.from('canonical_page_views').insert({
        company_id: input.companyId,
        page_id: pageId,
        page_url: pageUrl,
        session_id: sessionId,
        viewed_at: viewedAt,
        view_count: Math.max(1, safeInteger(row.screenPageViews, 1)),
        engagement_time_msec: safeInteger(row.engagementTimeMsec, 0),
        view_metadata: {
          source_medium: row.trafficMedium ?? null,
          campaign_name: row.campaignName ?? null,
        },
      });

      if (viewError) {
        throw new Error(`Failed to insert GA4 page view: ${viewError.message}`);
      }
    }

    sessionsInserted += 1;
    usersUpserted += 1;
    pageViewsInserted += 1;
  }

  for (const row of eventRows) {
    const eventTimestamp = normalizeGaTimestamp(row.eventTimestamp);
    const pageUrl = row.pagePath ? normalizeUrl(new URL(normalizePath(row.pagePath), website).toString()) : null;
    const sessionDate = eventTimestamp.slice(0, 10);
    const userKey = buildUserKey(input.companyId, row);
    const sessionKey = buildSessionKey(input.companyId, {
      sessionId: row.sessionId,
      sessionDate,
      pagePath: row.pagePath ?? '/',
      trafficSource: row.trafficSource,
      trafficMedium: row.trafficMedium,
      country: row.country,
      region: row.region,
      city: row.city,
      deviceCategory: row.deviceCategory,
    });

    const sessionId = await upsertSession({
      companyId: input.companyId,
      domainId: domain.id,
      sessionKey,
      row: {
        sessionDate,
        pagePath: row.pagePath ?? '/',
        trafficSource: row.trafficSource,
        trafficMedium: row.trafficMedium,
        campaignName: row.campaignName,
        country: row.country,
        region: row.region,
        city: row.city,
        deviceCategory: row.deviceCategory,
        sessions: 1,
        engagedSessions: normalizeEventCategory(row.eventName) === 'engagement' ? 1 : 0,
        engagementTimeMsec: 0,
        screenPageViews: row.eventName === 'page_view' ? safeInteger(row.eventCount, 1) : 0,
        totalUsers: 1,
        activeUsers: 1,
        userId: row.userId ?? null,
      },
    });
    sessionTouchpoints.push(
      buildGa4SessionTouchpoint({
        companyId: input.companyId,
        sessionId,
        sessionKey,
        row: {
          sessionDate,
          trafficSource: row.trafficSource,
          trafficMedium: row.trafficMedium,
          campaignName: row.campaignName,
        },
      })
    );

    const userId = await upsertUser({
      companyId: input.companyId,
      userKey,
      sessionId,
      row: {
        sessionDate,
        pagePath: row.pagePath ?? '/',
        trafficSource: row.trafficSource,
        trafficMedium: row.trafficMedium,
        campaignName: row.campaignName,
        country: row.country,
        region: row.region,
        city: row.city,
        deviceCategory: row.deviceCategory,
        sessions: 1,
        engagedSessions: 0,
        engagementTimeMsec: 0,
        screenPageViews: 0,
        totalUsers: 1,
        activeUsers: 1,
        userId: row.userId ?? null,
      },
    });

    // canonical_events.session_id and canonical_conversions.session_id are
    // TEXT and have an FK to canonical_sessions.external_session_id (NOT to
    // canonical_sessions.id). Pass the external key, not the UUID returned
    // by upsertSession().
    eventRecords.push(buildCanonicalEventRecord({
      companyId: input.companyId,
      sessionId: sessionKey,
      userId,
      pageUrl,
      eventTimestamp,
      row,
    }));

    const conversionRecord = buildCanonicalConversionRecord({
      companyId: input.companyId,
      sessionId: sessionKey,
      userId,
      pageUrl,
      eventTimestamp,
      row,
    });
    if (conversionRecord) {
      conversionRecords.push(conversionRecord);
    }
  }

  const { eventsInserted, conversionsInserted } = await persistBehavioralBatch({
    events: eventRecords,
    conversions: conversionRecords,
  });
  let touchpointsCreated: number | undefined;
  let touchpointsSkipped: number | undefined;

  try {
    const touchpointResult = await createGa4BehaviorTouchpoints({
      companyId: input.companyId,
      sessionTouchpoints,
      eventRecords,
      conversionRecords,
    });
    touchpointsCreated = touchpointResult.created;
    touchpointsSkipped = touchpointResult.skipped;
  } catch (error) {
    logger.error('ga4_behavior_touchpoints_failed', {
      companyId: input.companyId,
      events: eventRecords.length,
      conversions: conversionRecords.length,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    source: 'ga4',
    sessionsProcessed: rows.length,
    sessionsInserted,
    usersUpserted,
    pageViewsInserted,
    eventsProcessed: eventRows.reduce((sum, row) => sum + Math.max(1, safeInteger(row.eventCount, 1)), 0),
    eventsInserted,
    conversionsInserted,
    touchpointsCreated,
    touchpointsSkipped,
  };
}

export function buildGa4RunKey(input: Ga4IngestionInput): string {
  return hashKey(
    'ga4',
    input.companyId,
    input.propertyId ?? 'active',
    input.startDate ?? '',
    input.endDate ?? '',
    Array.isArray(input.rows) ? input.rows.length : 'api',
    Array.isArray(input.eventRows) ? input.eventRows.length : 'events-api'
  );
}
