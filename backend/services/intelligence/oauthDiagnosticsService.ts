/**
 * OAuth / token lifecycle diagnostics (READ-ONLY).
 *
 * Inspects EXISTING website_connections for OAuth/token providers (Webflow,
 * Shopify, future HubSpot) and reports token health WITHOUT calling the
 * provider, refreshing, rotating, or mutating anything. Real refresh/rotation
 * requires provider OAuth apps + secret storage that do not exist yet — this
 * surfaces the gap honestly with reconnect guidance instead of faking it.
 */
import { ownedDbTable } from '../../db/writeOwner';

export type TokenHealth = 'healthy' | 'unknown' | 'degraded' | 'expired' | 'missing';

export interface OAuthConnectionDiagnostic {
  connectionId: string;
  provider: string;
  authType: string;
  tokenPresent: boolean;
  tokenHealth: TokenHealth;
  connectionStatus: string;
  healthStatus: string | null;
  lastValidatedAt: string | null;
  ageDays: number | null;
  /** Heuristic: provider reported an auth failure in last_error. */
  permissionDriftSuspected: boolean;
  reconnectGuidance: string | null;
}

export interface OAuthDiagnosticsReport {
  companyId: string;
  generatedAt: string;
  oauthProviders: string[];
  connections: OAuthConnectionDiagnostic[];
  summary: {
    total: number;
    healthy: number;
    needsReconnect: number;
  };
  /** Honest capability note — refresh/rotation NOT implemented. */
  capabilityNote: string;
}

const OAUTH_PROVIDERS = new Set(['webflow', 'shopify', 'hubspot']);
const TOKEN_KEYS = ['access_token', 'api_token', 'shopify_access_token', 'refresh_token'];

interface ConnRow {
  id: string;
  provider: string;
  auth_type: string;
  status: string;
  health_status: string | null;
  last_error: string | null;
  last_sync_at: string | null;
  updated_at: string | null;
  non_secret_config: Record<string, unknown> | null;
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

export async function buildOAuthDiagnostics(
  companyId: string,
): Promise<OAuthDiagnosticsReport> {
  // Resolve this company's CMS connection ids (multi-tenant scoped).
  let connectionIds: string[] = [];
  try {
    const { data } = await ownedDbTable('company_integrations')
      .select('website_connection_id')
      .eq('company_id', companyId);
    connectionIds = ((data ?? []) as Array<{ website_connection_id: string | null }>)
      .map((r) => r.website_connection_id)
      .filter((v): v is string => Boolean(v));
  } catch {
    connectionIds = [];
  }

  let rows: ConnRow[] = [];
  if (connectionIds.length > 0) {
    try {
      const { data } = await ownedDbTable('website_connections')
        .select('id, provider, auth_type, status, health_status, last_error, last_sync_at, updated_at, non_secret_config')
        .in('id', connectionIds);
      rows = ((data ?? []) as ConnRow[]).filter((c) => OAUTH_PROVIDERS.has(c.provider));
    } catch {
      rows = [];
    }
  }

  const connections: OAuthConnectionDiagnostic[] = rows.map((c) => {
    // Token presence is inferred WITHOUT decrypting secrets: secrets live in
    // integration_credentials, but a connected/validated status implies a
    // usable token. We never read the secret itself here.
    const cfg = (c.non_secret_config ?? {}) as Record<string, unknown>;
    const tokenHinted =
      TOKEN_KEYS.some((k) => Boolean(cfg[k])) || c.status === 'connected';
    const authFailure = /401|403|unauthor|invalid_grant|token|expired|oauth/i.test(
      String(c.last_error ?? ''),
    );

    let tokenHealth: TokenHealth;
    if (!tokenHinted && c.status !== 'connected') tokenHealth = 'missing';
    else if (authFailure && /expired|invalid_grant/i.test(String(c.last_error ?? ''))) tokenHealth = 'expired';
    else if (authFailure || c.health_status === 'failed') tokenHealth = 'degraded';
    else if (c.status === 'connected' && (c.health_status === 'healthy' || c.health_status == null)) tokenHealth = 'healthy';
    else tokenHealth = 'unknown';

    const needsReconnect = tokenHealth === 'expired' || tokenHealth === 'degraded' || tokenHealth === 'missing';
    return {
      connectionId: c.id,
      provider: c.provider,
      authType: c.auth_type,
      tokenPresent: tokenHinted,
      tokenHealth,
      connectionStatus: c.status,
      healthStatus: c.health_status,
      lastValidatedAt: c.last_sync_at ?? c.updated_at ?? null,
      ageDays: ageDays(c.last_sync_at ?? c.updated_at ?? null),
      permissionDriftSuspected: authFailure,
      reconnectGuidance: needsReconnect
        ? `Reconnect ${c.provider}: generate a fresh token/OAuth grant and re-validate the connection (Integrations → Test).`
        : null,
    };
  });

  const healthy = connections.filter((c) => c.tokenHealth === 'healthy').length;
  const needsReconnect = connections.filter(
    (c) => c.tokenHealth === 'expired' || c.tokenHealth === 'degraded' || c.tokenHealth === 'missing',
  ).length;

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    oauthProviders: Array.from(OAUTH_PROVIDERS),
    connections,
    summary: { total: connections.length, healthy, needsReconnect },
    capabilityNote:
      'Automatic refresh-token rotation is NOT implemented (no provider OAuth app/secret store). Diagnostics + guided reconnect only.',
  };
}
