import axios from 'axios';
import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeUrl, resolveCompanyWebsite, safeInteger, safeNumber, todayIsoDate } from './ingestionUtils';

export interface Ga4SessionRow {
  sessionDate: string;
  pagePath: string;
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

export interface Ga4IngestionInput {
  companyId: string;
  propertyId?: string;
  accessToken?: string;
  rows?: Ga4SessionRow[];
  startDate?: string;
  endDate?: string;
}

export interface Ga4IngestionResult {
  source: 'ga4';
  sessionsProcessed: number;
  sessionsInserted: number;
  usersUpserted: number;
  pageViewsInserted: number;
}

function normalizePath(path: string | null | undefined): string {
  const value = String(path ?? '/').trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeGaDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw || todayIsoDate();
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
    .eq('external_session_key', input.sessionKey)
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
}): Promise<void> {
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
    return;
  }

  const { error } = await supabase.from('canonical_users').insert(payload);
  if (error) {
    throw new Error(`Failed to insert GA4 user: ${error.message}`);
  }
}

export async function ingestGa4Data(input: Ga4IngestionInput): Promise<Ga4IngestionResult> {
  const rows = await fetchGa4Rows(input);
  const website = input.companyId ? await resolveCompanyWebsite(input.companyId) : null;
  if (!website) {
    throw new Error(`No website configured for company ${input.companyId}`);
  }

  const domain = await ensureCanonicalDomain(input.companyId, website);

  let sessionsInserted = 0;
  let usersUpserted = 0;
  let pageViewsInserted = 0;

  for (const row of rows) {
    const pageId = await upsertPage(input.companyId, domain.id, website, row.pagePath);
    const userKey = row.userId?.trim() || hashKey('ga4-user', input.companyId, row.country, row.region, row.city, row.deviceCategory);
    const sessionKey = hashKey(
      'ga4-session',
      input.companyId,
      row.sessionDate,
      row.pagePath,
      row.trafficSource,
      row.trafficMedium,
      row.country,
      row.region,
      row.city,
      row.deviceCategory
    );

    const sessionId = await upsertSession({
      companyId: input.companyId,
      domainId: domain.id,
      sessionKey,
      row,
    });

    await upsertUser({
      companyId: input.companyId,
      userKey,
      sessionId,
      row,
    });

    const { error: viewError } = await supabase
      .from('canonical_page_views')
      .insert({
        company_id: input.companyId,
        page_id: pageId,
        session_id: sessionId,
        viewed_at: new Date(normalizeGaDate(row.sessionDate)).toISOString(),
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

    sessionsInserted += 1;
    usersUpserted += 1;
    pageViewsInserted += 1;
  }

  return {
    source: 'ga4',
    sessionsProcessed: rows.length,
    sessionsInserted,
    usersUpserted,
    pageViewsInserted,
  };
}

export function buildGa4RunKey(input: Ga4IngestionInput): string {
  return hashKey('ga4', input.companyId, input.propertyId, input.startDate ?? '', input.endDate ?? '', Array.isArray(input.rows) ? input.rows.length : 'api');
}
