/**
 * Multi-region recommendation job execution.
 * Reuses existing external API layer only; no duplicate API execution paths.
 * Flow: load job → validate → run APIs per region (controlled concurrency) → store raw signals → READY_FOR_ANALYSIS → trigger consolidation.
 */

import { supabase } from '../db/supabaseClient';
import { fetchExternalTrends } from './externalApiService';
import { normalizeExternalTrends } from './trendNormalizationService';
import { consolidateMultiRegionSignals } from './recommendationConsolidator';

const MAX_REGIONS = 5;
const CONCURRENCY = 3;

const ISO2_REGIONS = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW', 'GLOBAL',
]);

export type RecommendationJobRow = {
  id: string;
  company_id: string;
  created_by_user_id: string | null;
  selected_api_ids: string[];
  regions: string[];
  keyword: string | null;
  goal: string | null;
  use_company_profile: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * Normalize comma-separated region input: uppercase ISO-2, remove invalid, max 5.
 * "GLOBAL" as single entry means no region param to APIs.
 */
export function parseRegions(input: string | null | undefined): string[] {
  if (input == null || String(input).trim() === '') return [];
  const parts = String(input)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const valid: string[] = [];
  for (const p of parts) {
    if (valid.length >= MAX_REGIONS) break;
    if (p === 'GLOBAL' || ISO2_REGIONS.has(p)) valid.push(p);
  }
  return valid;
}

async function runInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Execute a recommendation job: run external APIs per region, store raw signals, then trigger consolidation.
 * Idempotent: if job is already RUNNING/COMPLETED/FAILED, no-op or return early as appropriate.
 */
export async function executeRecommendationJob(jobId: string): Promise<void> {
  const { data: job, error: jobError } = await supabase
    .from('recommendation_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const row = job as RecommendationJobRow;
  if (row.status !== 'QUEUED' && row.status !== 'RUNNING') {
    return;
  }

  await supabase
    .from('recommendation_jobs')
    .update({ status: 'RUNNING', updated_at: new Date().toISOString() })
    .eq('id', jobId);

  const companyId = row.company_id;
  const userId = row.created_by_user_id ?? undefined;
  const selectedApiIds = Array.isArray(row.selected_api_ids) ? row.selected_api_ids : [];
  const regions = Array.isArray(row.regions) && row.regions.length > 0
    ? row.regions
    : parseRegions('GLOBAL');
  const category = row.goal ?? undefined;
  const geoOverride = row.use_company_profile ? undefined : (row.keyword ? { category: row.keyword } : undefined);

  let anySuccess = false;

  const runRegion = async (regionCode: string): Promise<void> => {
    const geo = regionCode === 'GLOBAL' ? undefined : regionCode;
    const summary = await fetchExternalTrends(companyId, geo, category, {
      selectedApiIds: selectedApiIds.length > 0 ? selectedApiIds : undefined,
      userId: userId ?? null,
      feature: 'multi_region_recommendation',
      recordHealth: true,
      runtimeOverrides: geoOverride ?? undefined,
    });

    for (const result of summary.results) {
      const normalized = normalizeExternalTrends({
        source: result.source,
        payload: result.payload,
        health: result.health ?? null,
        geo: geo ?? undefined,
        category,
      });
      const signalStatus = result.payload != null ? 'SUCCESS' : 'FAILED';
      if (signalStatus === 'SUCCESS') anySuccess = true;
      await supabase.from('recommendation_raw_signals').insert({
        job_id: jobId,
        region_code: regionCode,
        api_id: result.source.id,
        normalized_trends_json: normalized,
        raw_payload_json: result.payload,
        latency_ms: null,
        status: signalStatus,
      });
    }
  };

  try {
    await runInBatches(regions, CONCURRENCY, runRegion);
  } catch (err) {
    console.error('RECOMMENDATION_JOB_EXECUTION_ERROR', { jobId, error: err });
    await supabase
      .from('recommendation_jobs')
      .update({ status: 'FAILED', updated_at: new Date().toISOString() })
      .eq('id', jobId);
    throw err;
  }

  const nextStatus = anySuccess ? 'READY_FOR_ANALYSIS' : 'FAILED';
  await supabase
    .from('recommendation_jobs')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (nextStatus === 'READY_FOR_ANALYSIS') {
    await consolidateMultiRegionSignals(jobId);
  }
}
