/**
 * Real OAuth token refresh — provider-correct HTTP, env-gated, encrypted.
 *
 * NO FABRICATION: a refresh is attempted ONLY when (a) the provider has a real
 * refresh flow and (b) the provider OAuth app credentials are configured in
 * env AND an encrypted refresh_token is stored. Otherwise an honest state is
 * returned (`not_refreshable_by_design` | `app_not_configured` |
 * `no_refresh_token`) — never a faked success.
 *
 * Encryption at rest: tokens are read/written via the EXISTING
 * integrationCredentialService (refresh_token/access_token are SECRET_CONFIG
 * keys → AES-encrypted in integration_credentials). No new table.
 *
 * Audit: every attempt is append-only via compliance audit
 * (resource_type='oauth_refresh').
 */
import { getWebsiteConnection, updateWebsiteConnection } from '../websiteService';
import { getConnectionCredentials, upsertConnectionCredentials } from '../integrationCredentialService';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type RefreshState =
  | 'refreshed'
  | 'not_refreshable_by_design'
  | 'app_not_configured'
  | 'no_refresh_token'
  | 'failed'
  | 'unknown_provider';

export interface RefreshResult {
  connectionId: string;
  provider: string;
  state: RefreshState;
  detail: string;
}

interface ProviderRefreshSpec {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

// Only providers with a REAL documented refresh-token grant are wired.
const PROVIDER_REFRESH: Record<string, ProviderRefreshSpec | 'no_expiry' | undefined> = {
  hubspot: {
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
  },
  // Shopify offline access tokens do not expire — refreshing them is not a
  // real operation; we say so honestly rather than fake a renewal.
  shopify: 'no_expiry',
  // Webflow v2 OAuth access tokens are long-lived (no standard refresh grant)
  // unless an app is configured with rotation — treated as no_expiry here.
  webflow: 'no_expiry',
};

async function audit(
  companyId: string | null,
  connectionId: string,
  provider: string,
  state: RefreshState,
  detail: string,
): Promise<void> {
  await recordComplianceAudit({
    companyId: companyId ?? 'unknown',
    actor: { userId: null, type: 'worker', label: 'oauth-refresh' },
    action: `oauth_refresh.${state}`,
    resourceType: 'oauth_refresh',
    resourceId: connectionId,
    entityLineage: ['company', 'website_connection', provider, 'oauth_refresh'],
    severity: state === 'failed' ? 'warning' : 'info',
    outcome: state === 'refreshed' ? 'success' : state === 'failed' ? 'failure' : 'success',
    detail: { provider, state, detail },
  }).catch(() => undefined);
}

/** Refresh one connection's OAuth token (real HTTP when possible). */
/**
 * PHASE-1A / T-1: `companyId` is REQUIRED, not optional.
 *
 * It was optional, and this function decrypts a refresh token — so an omitted
 * tenant meant an unverifiable credential read. All three callers (the
 * lifecycle route, the rotation service and the refresh worker) already had a
 * tenant to hand, so requiring it costs nothing and closes the hole rather than
 * documenting it.
 */
export async function refreshConnectionToken(
  connectionId: string,
  companyId: string,
): Promise<RefreshResult> {
  const conn = await getWebsiteConnection(connectionId).catch(() => null);
  if (!conn) {
    return { connectionId, provider: 'unknown', state: 'failed', detail: 'connection not found' };
  }
  const provider = conn.provider;
  const spec = PROVIDER_REFRESH[provider];

  if (spec === undefined) {
    await audit(companyId ?? null, connectionId, provider, 'unknown_provider', 'no refresh flow');
    return { connectionId, provider, state: 'unknown_provider', detail: 'provider has no OAuth refresh flow' };
  }
  if (spec === 'no_expiry') {
    await audit(companyId ?? null, connectionId, provider, 'not_refreshable_by_design', 'tokens do not expire');
    return { connectionId, provider, state: 'not_refreshable_by_design', detail: 'provider tokens do not expire — guided reconnect on revoke' };
  }

  const clientId = process.env[spec.clientIdEnv];
  const clientSecret = process.env[spec.clientSecretEnv];
  if (!clientId || !clientSecret) {
    await audit(companyId ?? null, connectionId, provider, 'app_not_configured', `${spec.clientIdEnv}/${spec.clientSecretEnv} unset`);
    return { connectionId, provider, state: 'app_not_configured', detail: `set ${spec.clientIdEnv} & ${spec.clientSecretEnv} to enable automatic refresh` };
  }

  const creds = await getConnectionCredentials(companyId, connectionId).catch(() => ({} as Record<string, string>));
  const refreshToken = creds.refresh_token;
  if (!refreshToken) {
    await audit(companyId ?? null, connectionId, provider, 'no_refresh_token', 'no stored refresh_token');
    return { connectionId, provider, state: 'no_refresh_token', detail: 'no encrypted refresh_token stored — reconnect required' };
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    // HARDEN-005A: spec.tokenUrl comes from the provider spec (DB) — SSRF-safe fetch.
    const { safeFetch } = await import('../../../lib/security/safeFetch');
    const res = await safeFetch(spec.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, { maxBytes: 2 * 1024 * 1024 });
    const data = await res.json().catch(() => null);
    if (!res.ok || !(data as any)?.access_token) {
      await updateWebsiteConnection(connectionId, { health_status: 'degraded', last_error: `oauth_refresh ${res.status}` }).catch(() => undefined);
      await audit(companyId ?? null, connectionId, provider, 'failed', `status ${res.status}`);
      return { connectionId, provider, state: 'failed', detail: `provider returned ${res.status}` };
    }
    // Persist rotated tokens encrypted (existing credential service).
    const next: Record<string, string> = { access_token: String((data as any).access_token) };
    if ((data as any).refresh_token) next.refresh_token = String((data as any).refresh_token);
    await upsertConnectionCredentials(companyId, connectionId, next);
    await updateWebsiteConnection(connectionId, { health_status: 'healthy', last_error: null }).catch(() => undefined);
    await audit(companyId ?? null, connectionId, provider, 'refreshed', 'token rotated');
    return { connectionId, provider, state: 'refreshed', detail: 'access token refreshed & re-encrypted' };
  } catch (err) {
    await audit(companyId ?? null, connectionId, provider, 'failed', err instanceof Error ? err.message : 'network error');
    return { connectionId, provider, state: 'failed', detail: err instanceof Error ? err.message : 'network error' };
  }
}
