import axios from 'axios';
import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeUrl, resolveCompanyWebsite, safeNumber, slugifyKeyword, todayIsoDate } from './ingestionUtils';

export interface GscKeywordRow {
  date?: string | null;
  keyword: string;
  pageUrl?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  ctr?: number | string | null;
  avgPosition?: number | string | null;
  country?: string | null;
  device?: string | null;
}

export interface GscIngestionInput {
  companyId: string;
  siteUrl?: string;
  accessToken?: string;
  rows?: GscKeywordRow[];
  startDate?: string;
  endDate?: string;
}

export interface GscIngestionResult {
  source: 'gsc';
  keywordsProcessed: number;
  keywordsInserted: number;
  metricsInserted: number;
}

async function fetchGscRows(input: GscIngestionInput): Promise<GscKeywordRow[]> {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }

  if (!input.siteUrl || !input.accessToken) {
    return [];
  }

  const response = await axios.post(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
    {
      startDate: input.startDate ?? todayIsoDate(),
      endDate: input.endDate ?? todayIsoDate(),
      dimensions: ['query', 'page', 'country', 'device', 'date'],
      rowLimit: 25000,
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
    date: row.keys?.[4] ?? todayIsoDate(),
    keyword: row.keys?.[0] ?? '',
    pageUrl: row.keys?.[1] ?? null,
    country: row.keys?.[2] ?? null,
    device: row.keys?.[3] ?? null,
    impressions: row.impressions ?? 0,
    clicks: row.clicks ?? 0,
    ctr: row.ctr ?? 0,
    avgPosition: row.position ?? 0,
  }));
}

async function ensureKeyword(companyId: string, keyword: string, pageUrl: string | null): Promise<string> {
  const landingPageUrl = pageUrl ? normalizeUrl(pageUrl) : '';
  const { data, error } = await supabase
    .from('canonical_keywords')
    .upsert(
      {
        company_id: companyId,
        keyword,
        keyword_normalized: slugifyKeyword(keyword),
        landing_page_url: landingPageUrl,
        source: 'gsc',
      },
      { onConflict: 'company_id,keyword_normalized,landing_page_url' }
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to upsert GSC keyword ${keyword}: ${error.message}`);
  }

  return (data as { id: string }).id;
}

export async function ingestGscData(input: GscIngestionInput): Promise<GscIngestionResult> {
  const rows = await fetchGscRows(input);
  const website = input.siteUrl || (await resolveCompanyWebsite(input.companyId));
  if (website) {
    await ensureCanonicalDomain(input.companyId, website);
  }

  let keywordsInserted = 0;
  let metricsInserted = 0;

  for (const row of rows) {
    if (!row.keyword?.trim()) continue;

    const keywordId = await ensureKeyword(input.companyId, row.keyword.trim(), row.pageUrl ?? null);
    const pageUrl = row.pageUrl ? normalizeUrl(row.pageUrl) : '';
    const { error } = await supabase
      .from('keyword_metrics')
      .upsert(
        {
          company_id: input.companyId,
          keyword_id: keywordId,
          metric_date: row.date ?? todayIsoDate(),
          page_url: pageUrl,
          impressions: Math.max(0, Math.round(safeNumber(row.impressions, 0))),
          clicks: Math.max(0, Math.round(safeNumber(row.clicks, 0))),
          ctr: Math.max(0, safeNumber(row.ctr, 0)),
          avg_position: safeNumber(row.avgPosition, 0),
          dimension_values: {
            country: row.country ?? null,
            device: row.device ?? null,
          },
        },
        { onConflict: 'company_id,keyword_id,metric_date,page_url' }
      );

    if (error) {
      throw new Error(`Failed to upsert keyword metrics for ${row.keyword}: ${error.message}`);
    }

    keywordsInserted += 1;
    metricsInserted += 1;
  }

  return {
    source: 'gsc',
    keywordsProcessed: rows.length,
    keywordsInserted,
    metricsInserted,
  };
}

export function buildGscRunKey(input: GscIngestionInput): string {
  return hashKey('gsc', input.companyId, input.siteUrl, input.startDate ?? '', input.endDate ?? '', Array.isArray(input.rows) ? input.rows.length : 'api');
}
