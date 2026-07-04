/**
 * Canonical Provider Sync-Health (per-tenant)
 * -------------------------------------------
 * Extends the operational provider health (providerHealthService — env/kill/
 * budget derived) with per-tenant INGESTION sync state read from the canonical
 * `data_source_status` table (the single sync-state surface written by
 * ingestionScheduler.runIngestionForCompany). One place to answer, per provider
 * per tenant:
 *
 *   reachable · authenticated · quota · enabled · lastSync · nextSync · syncHealth
 *
 * Read-only. No paid probe. Reuses the Phase-0A catalog/governor for the
 * operational half and the existing sync-state table for the ingestion half —
 * no new store, no duplicate scheduler.
 */

import { supabase } from '../../db/supabaseClient';
import { getProviderHealth } from './providerHealthService';

/** Catalog provider id → the source key used in `data_source_status`. */
const PROVIDER_TO_SOURCE: Record<string, string> = {
  search_console: 'gsc',
  ga4: 'ga',
  commercial: 'crm',
  // Reviews/Reputation ingestion is architecturally complete but not yet
  // scheduled (no per-source fetcher / migration applied), so this reads no
  // sync-state and honestly reports disabled/no-sync until activation lands.
  reviews: 'reviews',
};

/** Ingestion cron cadence (canonical: daily 02:00 UTC — see cron/analytics-ingestion). */
const DAILY_SYNC_HOUR_UTC = 2;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000; // > one daily cycle + margin

export type SyncHealth = 'healthy' | 'stale' | 'error' | 'never' | 'disabled' | 'not_scheduled';

export interface ProviderSyncHealth {
  id: string;
  reachable: boolean;
  authenticated: boolean;
  quota: number | null;
  enabled: boolean;
  lastSync: string | null;
  nextSync: string | null;
  syncHealth: SyncHealth;
  lastError: string | null;
}

function nextDailyRunIso(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_SYNC_HOUR_UTC, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

interface StatusRow {
  status?: string | null;
  last_synced_at?: string | null;
  error_message?: string | null;
}

async function readStatus(companyId: string, source: string): Promise<StatusRow | null> {
  try {
    const { data, error } = await supabase
      .from('data_source_status')
      .select('status, last_synced_at, error_message')
      .eq('company_id', companyId)
      .eq('source', source)
      .maybeSingle();
    if (error || !data) return null;
    return data as StatusRow;
  } catch {
    return null; // fail-soft: missing table / read error → no sync state
  }
}

/**
 * Per-tenant sync health for one provider. Merges operational health (catalog +
 * governor) with ingestion sync state (data_source_status). Never throws.
 */
export async function getProviderSyncHealth(companyId: string, providerId: string, now: Date = new Date()): Promise<ProviderSyncHealth | null> {
  const op = getProviderHealth(providerId);
  if (!op) return null;
  const source = PROVIDER_TO_SOURCE[providerId];
  const status = source ? await readStatus(companyId, source) : null;

  const lastSync = status?.last_synced_at ?? null;
  const lastError = status?.error_message ?? null;
  // Per-tenant authentication: a connected/syncing integration or a prior sync.
  const authenticated = Boolean(status && (status.status === 'connected' || status.status === 'syncing' || lastSync));
  const enabled = op.enabled;

  let syncHealth: SyncHealth;
  if (!enabled) syncHealth = 'disabled';
  else if (!source) syncHealth = 'not_scheduled';
  else if (status?.status === 'error') syncHealth = 'error';
  else if (!lastSync) syncHealth = 'never';
  else syncHealth = now.getTime() - new Date(lastSync).getTime() > STALE_AFTER_MS ? 'stale' : 'healthy';

  const scheduled = enabled && Boolean(source);
  return {
    id: providerId,
    reachable: op.reachable,
    authenticated,
    quota: op.quotaRemaining,
    enabled,
    lastSync,
    nextSync: scheduled ? nextDailyRunIso(now) : null,
    syncHealth,
    lastError,
  };
}

/** Sync health for all first-party ingestion providers of a tenant. */
export async function getAllProviderSyncHealth(companyId: string, now: Date = new Date()): Promise<ProviderSyncHealth[]> {
  const ids = Object.keys(PROVIDER_TO_SOURCE);
  const out = await Promise.all(ids.map((id) => getProviderSyncHealth(companyId, id, now)));
  return out.filter((h): h is ProviderSyncHealth => h !== null);
}
