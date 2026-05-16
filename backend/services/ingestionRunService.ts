import { createHash } from 'node:crypto';
import { supabase } from '../db/supabaseClient';
import type { UnifiedSource } from './sourceNormalizationService';
import { ownedDbTable } from '../db/writeOwner';

export type IngestionSource = 'crawler' | 'ga4' | 'gsc' | 'crm' | 'ads';
export type IngestionRunStatus = 'running' | 'completed' | 'failed' | 'partial' | 'skipped';

export interface IngestionRunCounts {
  processed: number;
  inserted?: number;
  updated?: number;
  eventsProcessed?: number;
  eventsInserted?: number;
  conversionsInserted?: number;
}

export interface IngestionRunRecord {
  id: string;
  company_id: string;
  source: IngestionSource;
  status: IngestionRunStatus;
  started_at: string;
  completed_at: string | null;
  records_processed: number;
  records_inserted: number;
  records_updated: number;
  events_processed?: number;
  events_inserted?: number;
  conversions_inserted?: number;
  retry_count: number;
  error_message: string | null;
  cursor_payload: Record<string, unknown>;
  unified_source?: UnifiedSource | null;
}

export function buildIngestionIdempotencyKey(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
}

export async function beginIngestionRun(params: {
  companyId: string;
  source: IngestionSource;
  idempotencyKey: string;
  cursorPayload?: Record<string, unknown>;
  retryCount?: number;
  unifiedSource?: UnifiedSource;
}): Promise<IngestionRunRecord> {
  const payload = {
    company_id: params.companyId,
    source: params.source,
    idempotency_key: params.idempotencyKey,
    status: 'running' as const,
    completed_at: null,
    records_processed: 0,
    records_inserted: 0,
    records_updated: 0,
    events_processed: 0,
    events_inserted: 0,
    conversions_inserted: 0,
    error_message: null,
    retry_count: params.retryCount ?? 0,
    cursor_payload: params.cursorPayload ?? {},
    ...(params.unifiedSource ? { unified_source: params.unifiedSource } : {}),
  };

  const { data, error } = await ownedDbTable('ingestion_runs')
    .upsert(payload, { onConflict: 'company_id,source,idempotency_key' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to begin ingestion run for ${params.source}: ${error.message}`);
  }

  return data as IngestionRunRecord;
}

export async function findIngestionRunByKey(params: {
  companyId: string;
  source: IngestionSource;
  idempotencyKey: string;
}): Promise<IngestionRunRecord | null> {
  const { data, error } = await ownedDbTable('ingestion_runs')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('source', params.source)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ingestion run by key for ${params.source}: ${error.message}`);
  }

  return (data as IngestionRunRecord | null) ?? null;
}

export async function completeIngestionRun(params: {
  runId: string;
  status: Exclude<IngestionRunStatus, 'running'>;
  counts: IngestionRunCounts;
  errorMessage?: string | null;
}): Promise<void> {
  const { error } = await ownedDbTable('ingestion_runs')
    .update({
      status: params.status,
      completed_at: new Date().toISOString(),
      records_processed: params.counts.processed,
      records_inserted: params.counts.inserted ?? 0,
      records_updated: params.counts.updated ?? 0,
      events_processed: params.counts.eventsProcessed ?? 0,
      events_inserted: params.counts.eventsInserted ?? 0,
      conversions_inserted: params.counts.conversionsInserted ?? 0,
      error_message: params.errorMessage ?? null,
    })
    .eq('id', params.runId);

  if (error) {
    throw new Error(`Failed to complete ingestion run ${params.runId}: ${error.message}`);
  }
}

export async function setDataSourceStatus(params: {
  companyId: string;
  source: 'crawler' | 'ga' | 'gsc' | 'crm' | 'ads';
  status: 'connected' | 'syncing' | 'error' | 'missing';
  lastSyncedAt?: string | null;
  errorMessage?: string | null;
  unifiedSource?: UnifiedSource;
}): Promise<void> {
  const { error } = await ownedDbTable('data_source_status')
    .upsert(
      {
        company_id: params.companyId,
        source: params.source,
        status: params.status,
        last_synced_at: params.lastSyncedAt ?? null,
        error_message: params.errorMessage ?? null,
        ...(params.unifiedSource ? { unified_source: params.unifiedSource } : {}),
      },
      { onConflict: 'company_id,source' }
    );

  if (error) {
    throw new Error(`Failed to update data source status for ${params.source}: ${error.message}`);
  }
}

export async function hasRunningIngestion(companyId: string, source: IngestionSource): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ownedDbTable('ingestion_runs')
    .select('id, started_at, completed_at')
    .eq('company_id', companyId)
    .eq('source', source)
    .eq('status', 'running')
    .is('completed_at', null)
    .gte('started_at', staleBefore)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check running ingestion for ${source}: ${error.message}`);
  }

  return Boolean(data && data.length > 0);
}

export async function getLatestCompletedRun(
  companyId: string,
  source: IngestionSource
): Promise<IngestionRunRecord | null> {
  const { data, error } = await ownedDbTable('ingestion_runs')
    .select('*')
    .eq('company_id', companyId)
    .eq('source', source)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest completed run for ${source}: ${error.message}`);
  }

  return (data as IngestionRunRecord | null) ?? null;
}

export async function getLatestRun(
  companyId: string,
  source: IngestionSource
): Promise<IngestionRunRecord | null> {
  const { data, error } = await ownedDbTable('ingestion_runs')
    .select('*')
    .eq('company_id', companyId)
    .eq('source', source)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest ingestion run for ${source}: ${error.message}`);
  }

  return (data as IngestionRunRecord | null) ?? null;
}

export async function getRetryableFailedRuns(params: {
  companyId: string;
  source?: IngestionSource;
  maxRetries: number;
}): Promise<IngestionRunRecord[]> {
  let query = ownedDbTable('ingestion_runs')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('status', 'failed')
    .lt('retry_count', params.maxRetries)
    .order('started_at', { ascending: true });

  if (params.source) {
    query = query.eq('source', params.source);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load retryable ingestion runs: ${error.message}`);
  }

  return (data ?? []) as IngestionRunRecord[];
}
