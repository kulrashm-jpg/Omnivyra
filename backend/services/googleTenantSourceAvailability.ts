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

// ── Four separate states (platform configuration ≠ tenant connection ≠ data ≠ freshness) ─────────────

/**
 * 1 providerConfigured  the PLATFORM Google OAuth client is saved and enabled (Super Admin →
 *                       analytics_provider_config 'google_analytics'). Platform-wide; says nothing
 *                       about any company.
 * 2 tenantConnected     THIS company's integration is connected (not revoked) with an active
 *                       property / site.
 * 3 dataAvailable       THIS company has at least one completed import of the source.
 * 4 dataFresh           that latest completed import is within the source's freshness limit.
 * A platform-wide view (no company) reports only (1); a tenant view reports all four.
 */
export type GoogleSourceStates = {
  source: GoogleSource;
  providerConfigured: boolean;
  tenantConnected: boolean | null;
  dataAvailable: boolean | null;
  dataFresh: boolean | null;
  lastSyncedAt: string | null;
  state: TenantSourceState | 'platform_only';
};

/** Pure: combine the platform flag with (optionally) one company's snapshot. */
export function googleSourceStatesFrom(source: GoogleSource, providerConfigured: boolean, snap: TenantSnapshot | null, now: Date): GoogleSourceStates {
  if (!snap) return { source, providerConfigured, tenantConnected: null, dataAvailable: null, dataFresh: null, lastSyncedAt: null, state: 'platform_only' };
  const decided = decideTenantSourceAvailability(source, snap, now);
  const connected = decided.state !== 'not_connected' && decided.state !== 'reauth_required' && decided.state !== 'no_property';
  return {
    source,
    providerConfigured,
    tenantConnected: connected,
    dataAvailable: Boolean(snap.lastCompletedAt),
    dataFresh: decided.state === 'connected',
    lastSyncedAt: snap.lastCompletedAt,
    state: decided.state,
  };
}

/** (1) Whether the platform OAuth client is saved and enabled. Booleans only; credentials never leave. */
export async function isGooglePlatformOauthConfigured(
  deps: { loadConfig?: () => Promise<{ enabled?: boolean; oauth_client_id?: string | null; oauth_client_secret?: string | null } | null> } = {},
): Promise<boolean> {
  try {
    const load = deps.loadConfig
      ?? (async () => (await import('./analyticsProviderConfigService')).getAnalyticsProviderConfig('google_analytics'));
    const config = await load();
    return Boolean(config?.enabled && config.oauth_client_id && config.oauth_client_secret);
  } catch {
    return false;
  }
}

/** All four states for one source; pass a company id for the tenant view, or null for platform-only. */
export async function getGoogleSourceStates(
  companyId: string | null,
  source: GoogleSource,
  deps: { now?: () => Date; load?: typeof loadSnapshot; platformConfigured?: () => Promise<boolean> } = {},
): Promise<GoogleSourceStates> {
  const now = (deps.now ?? (() => new Date()))();
  const providerConfigured = await (deps.platformConfigured ?? (() => isGooglePlatformOauthConfigured()))();
  if (!companyId) return googleSourceStatesFrom(source, providerConfigured, null, now);
  let snap: TenantSnapshot;
  try {
    snap = await (deps.load ?? loadSnapshot)(companyId, source);
  } catch {
    snap = { integration: null, hasActiveProperty: false, lastCompletedAt: null };
  }
  return googleSourceStatesFrom(source, providerConfigured, snap, now);
}
