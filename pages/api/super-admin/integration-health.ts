/**
 * GET /api/super-admin/integration-health
 *
 * Canonical operational visibility for SUPER_ADMIN. Surfaces every
 * provider's per-tenant lifecycle state, last refresh telemetry, and
 * expiry windows. NEVER exposes access tokens, refresh tokens, client
 * secrets, or any decrypted credential material.
 *
 * Authority: requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE, requireStepUp=false)
 * — a read-only listing, gated on the SUPER_ADMIN capability but not on
 * step-up. Mutation routes (POST/DELETE on platform-oauth-configs etc.)
 * keep the full step-up requirement.
 *
 * Shape:
 *   {
 *     platforms: [{platform_key, configured, enabled, ...counts}],
 *     tenants:   [{company_id, company_name, per_platform: [{
 *       platform, connection_state, expires_at,
 *       last_live_check_at, last_live_check_status, last_provider_error,
 *       refresh_status, last_refresh_attempt_at
 *     }]}]
 *   }
 *
 * No tokens. No secrets.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';
import {
  deriveConnectionState,
  type ConnectionState,
} from '../../../backend/services/integrations/connectionState';

/**
 * Provider-taxonomy normalization.
 *
 * The OAuth app credentials for the Meta ecosystem (Facebook · Instagram ·
 * WhatsApp · Threads) live under platform_oauth_configs.platform='facebook'
 * (legacy key from the Facebook Login era), while per-tenant tokens live in
 * meta_oauth_connections (emitted as platform='meta'). They are the same
 * authority. Without normalization the SUPER_ADMIN health tab surfaces them
 * as two separate tiles. Surface-only fix: collapse 'facebook' → 'meta' in
 * the rollup. DB rows, OAuth handlers, refresh helpers, and internal IDs
 * all keep their existing keys.
 */
const META_FAMILY_ALIASES = new Set(['facebook', 'instagram', 'whatsapp', 'threads', 'meta']);
function canonicalPlatformKey(raw: string): string {
  const k = raw.toLowerCase();
  if (META_FAMILY_ALIASES.has(k)) return 'meta';
  return k;
}

type SocialAccountRow = {
  id: string;
  user_id: string;
  company_id: string | null;
  platform: string;
  account_name: string | null;
  username: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  refresh_token: string | null;
  access_token: string | null;
  refresh_status: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_error: string | null;
  connection_state: string | null;
  last_live_check_at: string | null;
  last_live_check_status: string | null;
  last_provider_error: string | null;
};

type AnalyticsIntegrationRow = {
  id: string;
  company_id: string;
  provider: string;
  status: string;
  connection_state: string | null;
  last_live_check_at: string | null;
  last_live_check_status: string | null;
  last_provider_error: string | null;
  updated_at: string;
};

type MetaConnectionRow = {
  id: string;
  company_id: string;
  token_expires_at: string;
  last_refreshed_at: string | null;
  refresh_failed_at: string | null;
  refresh_error: string | null;
  connection_state: string | null;
};

type CompanyRow = { id: string; name: string | null };

type PerPlatformView = {
  platform: string;
  state: ConnectionState;
  expires_at: string | null;
  last_live_check_at: string | null;
  last_live_check_status: string | null;
  last_provider_error: string | null;
  refresh_status: string | null;
  last_refresh_attempt_at: string | null;
};

type TenantView = {
  company_id: string;
  company_name: string;
  per_platform: PerPlatformView[];
};

type PlatformRollup = {
  platform_key: string;
  configured: boolean;
  enabled: boolean;
  client_id_preview: string;
  connected_count: number;
  reauth_required_count: number;
  refresh_required_count: number;
  expired_count: number;
  degraded_count: number;
  rate_limited_count: number;
};

function stateFromColumnOrDerive(
  persisted: string | null,
  derivation: () => ConnectionState,
): ConnectionState {
  if (persisted) return persisted as ConnectionState;
  return derivation();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
    reason: 'integration health read',
    requireStepUp: false,
  });
  if (guard.ok !== true) return;

  // ── 1. Pull the four source surfaces in parallel.
  const [
    socialRowsRes,
    analyticsRowsRes,
    metaRowsRes,
    platformConfigsRes,
    companiesRes,
  ] = await Promise.all([
    supabase
      .from('social_accounts')
      .select('id, user_id, company_id, platform, account_name, username, is_active, token_expires_at, refresh_token, access_token, refresh_status, last_refresh_attempt_at, last_refresh_error, connection_state, last_live_check_at, last_live_check_status, last_provider_error')
      .not('platform_user_id', 'like', 'planning_%'),
    supabase
      .from('analytics_integrations')
      .select('id, company_id, provider, status, connection_state, last_live_check_at, last_live_check_status, last_provider_error, updated_at'),
    supabase
      .from('meta_oauth_connections')
      .select('id, company_id, token_expires_at, last_refreshed_at, refresh_failed_at, refresh_error, connection_state'),
    supabase
      .from('platform_oauth_configs')
      .select('platform, enabled, oauth_client_id_encrypted, updated_at'),
    supabase
      .from('companies')
      .select('id, name'),
  ]);

  const socialRows  = (socialRowsRes.data ?? []) as SocialAccountRow[];
  const analyticsRows = (analyticsRowsRes.data ?? []) as AnalyticsIntegrationRow[];
  const metaRows    = (metaRowsRes.data ?? []) as MetaConnectionRow[];
  const platformConfigs = (platformConfigsRes.data ?? []) as Array<{ platform: string; enabled: boolean; oauth_client_id_encrypted: string | null; updated_at: string }>;
  const companies   = (companiesRes.data ?? []) as CompanyRow[];

  const companyName = new Map<string, string>();
  for (const c of companies) companyName.set(c.id, c.name ?? '');

  // ── 2. Build tenant view per (company, platform). Use persisted
  // connection_state when present; fall back to deriveConnectionState
  // so the response is meaningful even before the migration is applied.
  const tenants = new Map<string, TenantView>();

  function ensureTenant(companyId: string): TenantView {
    let t = tenants.get(companyId);
    if (!t) {
      t = {
        company_id: companyId,
        company_name: companyName.get(companyId) ?? '',
        per_platform: [],
      };
      tenants.set(companyId, t);
    }
    return t;
  }

  for (const row of socialRows) {
    const companyId = row.company_id;
    if (!companyId) continue;
    const state = stateFromColumnOrDerive(row.connection_state, () =>
      deriveConnectionState({
        tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
        isExplicitlyDisconnected: !row.is_active,
        lastRefreshStatus: (row.refresh_status as 'success' | 'failed' | 'requires_reconnect' | null) ?? null,
        hasRefreshToken: !!row.refresh_token,
        hasAccessToken: !!row.access_token,
        lastLiveCheckStatus: (row.last_live_check_status as 'ok' | 'unauthorised' | 'forbidden' | 'rate_limited' | 'server_error' | null) ?? null,
        lastLiveCheckAt: row.last_live_check_at ? new Date(row.last_live_check_at) : null,
      }),
    );
    ensureTenant(companyId).per_platform.push({
      platform: canonicalPlatformKey(row.platform),
      state,
      expires_at: row.token_expires_at,
      last_live_check_at: row.last_live_check_at,
      last_live_check_status: row.last_live_check_status,
      last_provider_error: row.last_provider_error ?? row.last_refresh_error,
      refresh_status: row.refresh_status,
      last_refresh_attempt_at: row.last_refresh_attempt_at,
    });
  }

  for (const row of analyticsRows) {
    const state = stateFromColumnOrDerive(row.connection_state, () => {
      // Conservative legacy fallback when migration hasn't been applied.
      if (row.status === 'connected') return 'CONNECTED';
      if (row.status === 'error') return 'PROVIDER_REAUTH_REQUIRED';
      return 'DISCONNECTED';
    });
    // analytics_integrations carries provider='GA4' etc. GA4 isn't in the
    // Meta family — canonicalPlatformKey is a no-op for it — but routing
    // through the helper keeps every emit on the same normalization path.
    ensureTenant(row.company_id).per_platform.push({
      platform: canonicalPlatformKey(row.provider),
      state,
      expires_at: null,
      last_live_check_at: row.last_live_check_at,
      last_live_check_status: row.last_live_check_status,
      last_provider_error: row.last_provider_error,
      refresh_status: null,
      last_refresh_attempt_at: row.updated_at,
    });
  }

  for (const row of metaRows) {
    const state = stateFromColumnOrDerive(row.connection_state, () =>
      deriveConnectionState({
        tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
        isExplicitlyDisconnected: false,
        lastRefreshStatus: row.refresh_failed_at ? 'failed' : null,
        hasRefreshToken: false,
        hasAccessToken: true,
      }),
    );
    ensureTenant(row.company_id).per_platform.push({
      platform: 'meta',
      state,
      expires_at: row.token_expires_at,
      last_live_check_at: null,
      last_live_check_status: null,
      last_provider_error: row.refresh_error,
      refresh_status: row.refresh_failed_at ? 'failed' : 'success',
      last_refresh_attempt_at: row.last_refreshed_at,
    });
  }

  // ── 3. Roll up platform-level counts for the SUPER_ADMIN summary.
  // Normalize platform_oauth_configs keys the same way so Meta-family
  // app credentials (stored under 'facebook') roll up under the same
  // 'meta' tile as the per_platform emissions above. We `or` configured
  // and enabled across all aliases so the 'meta' rollup reflects the
  // operator-set state truthfully.
  const configByPlatform = new Map<string, { platform: string; enabled: boolean; oauth_client_id_encrypted: string | null; updated_at: string }>();
  for (const cfg of platformConfigs) {
    const canon = canonicalPlatformKey(cfg.platform);
    const existing = configByPlatform.get(canon);
    if (!existing) {
      configByPlatform.set(canon, cfg);
    } else {
      // Merge — prefer the row that actually carries credentials.
      const merged = {
        platform: canon,
        enabled: existing.enabled || cfg.enabled,
        oauth_client_id_encrypted: existing.oauth_client_id_encrypted ?? cfg.oauth_client_id_encrypted,
        updated_at: (existing.updated_at > cfg.updated_at) ? existing.updated_at : cfg.updated_at,
      };
      configByPlatform.set(canon, merged);
    }
  }
  const allPlatformKeys = new Set<string>([
    ...Array.from(configByPlatform.keys()),
    ...Array.from(tenants.values()).flatMap((t) => t.per_platform.map((p) => p.platform)),
  ]);

  const platforms: PlatformRollup[] = Array.from(allPlatformKeys).map((key) => {
    const cfg = configByPlatform.get(key);
    const rollup: PlatformRollup = {
      platform_key: key,
      configured: !!cfg?.oauth_client_id_encrypted,
      enabled: cfg?.enabled ?? false,
      client_id_preview: '', // never decrypt secrets in this endpoint
      connected_count: 0,
      reauth_required_count: 0,
      refresh_required_count: 0,
      expired_count: 0,
      degraded_count: 0,
      rate_limited_count: 0,
    };
    for (const tenant of tenants.values()) {
      for (const p of tenant.per_platform) {
        if (p.platform !== key) continue;
        switch (p.state) {
          case 'CONNECTED':
          case 'LIVE_VERIFIED':            rollup.connected_count += 1; break;
          case 'TOKEN_REFRESH_REQUIRED':   rollup.refresh_required_count += 1; break;
          case 'TOKEN_EXPIRED':            rollup.expired_count += 1; break;
          case 'PROVIDER_REAUTH_REQUIRED': rollup.reauth_required_count += 1; break;
          case 'DEGRADED':                 rollup.degraded_count += 1; break;
          case 'RATE_LIMITED':             rollup.rate_limited_count += 1; break;
          default: break;
        }
      }
    }
    return rollup;
  }).sort((a, b) => a.platform_key.localeCompare(b.platform_key));

  return res.status(200).json({
    platforms,
    tenants: Array.from(tenants.values()).sort((a, b) =>
      (a.company_name || a.company_id).localeCompare(b.company_name || b.company_id),
    ),
    generated_at: new Date().toISOString(),
  });
}
