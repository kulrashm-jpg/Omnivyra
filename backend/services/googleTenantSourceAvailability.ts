/**
 * Is Google Analytics (GA4) / Search Console (GSC) usable for THIS company right now?
 *
 * Replaces the env-only signal (`isGa4ProviderAvailable` / `isSearchConsoleProviderAvailable`, which
 * read GA4_PROPERTY_ID / GA4_OAUTH / GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET — names the real
 * OAuth flow never uses) for every engine that has a company in scope. The answer is the company's own
 * state, read without side effects (no token refresh, no Google call):
 *   integration   analytics_integrations row for (company, provider): status and connection_state
 *   property      an active analytics_properties row for that integration
 *   freshness     the company's latest COMPLETED ingestion run of that source (ingestion_runs)
 *
 * States: not_connected · reauth_required · no_property · never_synced · stale · connected.
 * Only `connected` is available. Stale = the last completed import is older than the source's limit
 * (GA4 3 days, GSC 5 days — GSC data itself lags ~3 days and syncs daily).
 */
import { ANTICIPATED_PROVIDERS } from './evidencePlatform';
import { ownedDbTable } from '../db/writeOwner';

export type GoogleSource = 'ga4' | 'gsc';
export type TenantSourceState = 'connected' | 'stale' | 'never_synced' | 'no_property' | 'reauth_required' | 'not_connected';

export type TenantSourceAvailability = {
  source: GoogleSource;
  state: TenantSourceState;
  available: boolean;
  lastSyncedAt: string | null;
  reason: string;
};

export const STALE_AFTER_DAYS: Record<GoogleSource, number> = { ga4: 3, gsc: 5 };
const PROVIDER: Record<GoogleSource, 'GA4' | 'GSC'> = { ga4: 'GA4', gsc: 'GSC' };
const LABEL: Record<GoogleSource, string> = { ga4: 'Google Analytics', gsc: 'Search Console' };

export type TenantSnapshot = {
  integration: { id: string; status: string | null; connection_state?: string | null } | null;
  hasActiveProperty: boolean;
  lastCompletedAt: string | null;
};

/** Pure decision from the company's own snapshot. */
export function decideTenantSourceAvailability(source: GoogleSource, snap: TenantSnapshot, now: Date): TenantSourceAvailability {
  const label = LABEL[source];
  const out = (state: TenantSourceState, reason: string): TenantSourceAvailability =>
    ({ source, state, available: state === 'connected', lastSyncedAt: snap.lastCompletedAt, reason });
  const i = snap.integration;
  if (!i || i.status === 'disconnected' || i.status == null) return out('not_connected', `${label} is not connected for this company.`);
  if (i.status === 'error' || i.connection_state === 'PROVIDER_REAUTH_REQUIRED' || i.connection_state === 'DISCONNECTED') {
    return out('reauth_required', `${label} access was revoked or expired; the company needs to reconnect.`);
  }
  if (!snap.hasActiveProperty) return out('no_property', `${label} is connected but no ${source === 'gsc' ? 'site' : 'property'} is selected.`);
  if (!snap.lastCompletedAt) return out('never_synced', `${label} is connected but no import has completed yet.`);
  const ageDays = (now.getTime() - Date.parse(snap.lastCompletedAt)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > STALE_AFTER_DAYS[source]) {
    return out('stale', `${label} data is stale: the last completed import was ${Number.isFinite(ageDays) ? `${Math.floor(ageDays)} days` : 'too long'} ago.`);
  }
  return out('connected', `${label} is connected and was imported within ${STALE_AFTER_DAYS[source]} days.`);
}

async function loadSnapshot(companyId: string, source: GoogleSource): Promise<TenantSnapshot> {
  const { data: integration, error } = await ownedDbTable('analytics_integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', PROVIDER[source])
    .maybeSingle();
  if (error || !integration) return { integration: null, hasActiveProperty: false, lastCompletedAt: null };
  const row = integration as { id: string; status: string | null; connection_state?: string | null };
  const [{ data: property }, { data: run }] = await Promise.all([
    ownedDbTable('analytics_properties').select('id').eq('integration_id', row.id).eq('is_active', true).limit(1).maybeSingle(),
    ownedDbTable('ingestion_runs').select('completed_at').eq('company_id', companyId).eq('source', source).eq('status', 'completed')
      .order('completed_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    integration: { id: row.id, status: row.status, connection_state: row.connection_state ?? null },
    hasActiveProperty: Boolean(property),
    lastCompletedAt: (run as { completed_at?: string | null } | null)?.completed_at ?? null,
  };
}

/** The company's availability for one source. Never throws: a read failure means "not available". */
export async function getTenantSourceAvailability(
  companyId: string,
  source: GoogleSource,
  deps: { now?: () => Date; load?: typeof loadSnapshot } = {},
): Promise<TenantSourceAvailability> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    return decideTenantSourceAvailability(source, await (deps.load ?? loadSnapshot)(companyId, source), now);
  } catch {
    return { source, state: 'not_connected', available: false, lastSyncedAt: null, reason: `${LABEL[source]} status could not be read.` };
  }
}

const RELIABILITY_PROVIDER_ID: Record<GoogleSource, string> = { ga4: 'analytics.ga4', gsc: 'search_console' };

/**
 * The provider-reliability factor engines feed to deriveDecisionConfidence: the provider's documented
 * reliability when this company's source is connected and fresh, otherwise null (no lift).
 */
export async function tenantProviderReliability(companyId: string, source: GoogleSource, deps?: Parameters<typeof getTenantSourceAvailability>[2]): Promise<number | null> {
  const availability = await getTenantSourceAvailability(companyId, source, deps);
  if (!availability.available) return null;
  return ANTICIPATED_PROVIDERS.find((p) => p.providerId === RELIABILITY_PROVIDER_ID[source])?.providerReliability ?? null;
}
