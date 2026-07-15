import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/oauth-health
 *
 * Read-only OAuth diagnostics for platform operators. Aggregates the
 * structural state we CAN query without introducing a new log-persistence
 * pipeline:
 *   - Per-provider integration counts from analytics_integrations + social_accounts.
 *   - Canonical-callback-URL validation per provider (computed from
 *     NEXT_PUBLIC_APP_URL via getCanonicalAppUrl).
 *   - Env presence flags (boolean only — never the value) for each
 *     provider's OAuth client_id / client_secret.
 *   - Recent integration timestamps (last_updated) per provider.
 *   - Last 20 analytics_integrations rows with status + last_provider_error.
 *
 * Live `[OAUTH]` telemetry events are emitted to Vercel logs by
 * backend/auth/oauthTelemetry.ts but NOT persisted to a DB table — so
 * this endpoint does NOT show "last failure_point per provider". That
 * would require a new oauth_events table; out of Phase 11 scope.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW capability — server-side enforced.
 * Never returns tokens, refresh tokens, OAuth codes, or secrets.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCanonicalAppUrl } from '../../../backend/config/getCanonicalAppUrl';

type ProviderHealth = {
  provider: string;
  display_name: string;
  callback_url: string;
  callback_url_ok: boolean;
  callback_url_notes: string[];
  env_present: { client_id: boolean; client_secret: boolean } | { config_source: 'db'; note: string };
  integrations: {
    connected: number;
    disconnected: number;
    error: number;
    other: number;
    last_updated_at: string | null;
  };
};

type RecentIntegrationRow = {
  id: string;
  provider: string;
  company_id: string;
  status: string;
  updated_at: string;
  last_provider_error: string | null;
};

type OAuthHealthResponse = {
  status: 'ok';
  canonical_host: string;
  providers: ProviderHealth[];
  recent_integrations: RecentIntegrationRow[];
  observability: {
    log_tag: string;
    note: string;
  };
};

const FORBIDDEN_HOST_PATTERNS = [
  /\bapp\.omnivyra\.com\b/i,
  /\bvercel\.app\b/i,
  /^https?:\/\/localhost[:/]/i,
  /^https?:\/\/127\.0\.0\.1[:/]/i,
];

/**
 * Provider catalogue. Each entry lists the callback path the server is
 * expected to use, plus the env vars (if any) whose presence we'll surface
 * as a boolean. Provider OAuth credentials live in BOTH env vars and DB
 * tables (analytics_provider_config, community_ai_oauth_credentials) —
 * for the env-driven providers (the legacy auth/* routes) we check env;
 * for the DB-driven providers we note that and skip env probing.
 */
const PROVIDER_CATALOGUE: Array<{
  provider: string;
  display_name: string;
  callback_path: string;
  env_client_id?: string;
  env_client_secret?: string;
  config_source?: 'db';
}> = [
  { provider: 'google_analytics', display_name: 'Google Analytics', callback_path: '/api/analytics/connect/google/callback', config_source: 'db' },
  { provider: 'google_search_console', display_name: 'Google Search Console', callback_path: '/api/analytics/connect/google/callback', config_source: 'db' },
  { provider: 'linkedin', display_name: 'LinkedIn', callback_path: '/api/auth/linkedin/callback', env_client_id: 'LINKEDIN_CLIENT_ID', env_client_secret: 'LINKEDIN_CLIENT_SECRET' },
  { provider: 'linkedin_community_ai', display_name: 'LinkedIn (Community AI)', callback_path: '/api/community-ai/connectors/linkedin/callback', config_source: 'db' },
  { provider: 'facebook', display_name: 'Facebook / Meta', callback_path: '/api/auth/facebook/callback', env_client_id: 'META_CLIENT_ID', env_client_secret: 'META_CLIENT_SECRET' },
  { provider: 'instagram', display_name: 'Instagram', callback_path: '/api/auth/instagram/callback', env_client_id: 'META_CLIENT_ID', env_client_secret: 'META_CLIENT_SECRET' },
  { provider: 'youtube', display_name: 'YouTube', callback_path: '/api/auth/youtube/callback', env_client_id: 'GOOGLE_CLIENT_ID', env_client_secret: 'GOOGLE_CLIENT_SECRET' },
  { provider: 'tiktok', display_name: 'TikTok', callback_path: '/api/auth/tiktok/callback', config_source: 'db' },
  { provider: 'x', display_name: 'X / Twitter', callback_path: '/api/auth/x/callback', env_client_id: 'X_CLIENT_ID', env_client_secret: 'X_CLIENT_SECRET' },
  { provider: 'pinterest', display_name: 'Pinterest', callback_path: '/api/auth/pinterest/callback', config_source: 'db' },
  { provider: 'spotify', display_name: 'Spotify', callback_path: '/api/auth/spotify/callback', config_source: 'db' },
  { provider: 'meta_community_ai', display_name: 'Meta (Community AI)', callback_path: '/api/community-ai/connectors/meta/callback', config_source: 'db' },
  { provider: 'reddit_community_ai', display_name: 'Reddit (Community AI)', callback_path: '/api/community-ai/connectors/reddit/callback', config_source: 'db' },
  { provider: 'instagram_community_ai', display_name: 'Instagram (Community AI)', callback_path: '/api/community-ai/connectors/instagram/callback', config_source: 'db' },
];

// Maps a catalogue provider key to the actual `provider` value used in the
// `analytics_integrations` or `social_accounts` tables. Some entries don't
// have a DB-backed integrations table (community-ai variants live in
// community_ai_platform_tokens instead) — we omit them from the rollup
// here rather than fabricate counts.
const DB_PROVIDER_MAP: Record<string, { table: 'analytics_integrations' | 'social_accounts'; column: 'provider' | 'platform'; value: string }> = {
  google_analytics: { table: 'analytics_integrations', column: 'provider', value: 'GA4' },
  google_search_console: { table: 'analytics_integrations', column: 'provider', value: 'GSC' },
  linkedin: { table: 'social_accounts', column: 'platform', value: 'linkedin' },
  facebook: { table: 'social_accounts', column: 'platform', value: 'facebook' },
  instagram: { table: 'social_accounts', column: 'platform', value: 'instagram' },
  youtube: { table: 'social_accounts', column: 'platform', value: 'youtube' },
  tiktok: { table: 'social_accounts', column: 'platform', value: 'tiktok' },
  x: { table: 'social_accounts', column: 'platform', value: 'x' },
  pinterest: { table: 'social_accounts', column: 'platform', value: 'pinterest' },
  spotify: { table: 'social_accounts', column: 'platform', value: 'spotify' },
};

function validateCallbackUrl(url: string): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, notes: ['malformed URL'] }; }
  if (parsed.protocol !== 'https:') notes.push(`non-https protocol: ${parsed.protocol}`);
  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (pattern.test(url)) notes.push(`forbidden host pattern matched: ${pattern}`);
  }
  if (!parsed.host.includes('omnivyra.com') && !parsed.host.includes('localhost')) {
    notes.push(`host does not contain canonical domain: ${parsed.host}`);
  }
  return { ok: notes.length === 0, notes };
}

async function rollupIntegrationCounts(
  table: 'analytics_integrations' | 'social_accounts',
  column: 'provider' | 'platform',
  value: string,
): Promise<ProviderHealth['integrations']> {
  const empty: ProviderHealth['integrations'] = { connected: 0, disconnected: 0, error: 0, other: 0, last_updated_at: null };
  try {
    const { data, error } = await supabase
      .from(table)
      .select('status, updated_at')
      .eq(column, value)
      .order('updated_at', { ascending: false });
    if (error || !data) return empty;
    const out = { ...empty };
    for (const row of data as Array<{ status: string | null; updated_at: string | null }>) {
      const s = (row.status || '').toLowerCase();
      if (s === 'connected') out.connected += 1;
      else if (s === 'disconnected') out.disconnected += 1;
      else if (s === 'error') out.error += 1;
      else out.other += 1;
    }
    if (data.length > 0) out.last_updated_at = (data[0] as { updated_at: string | null }).updated_at;
    return out;
  } catch {
    return empty;
  }
}

async function recentAnalyticsIntegrationRows(limit: number): Promise<RecentIntegrationRow[]> {
  try {
    const { data, error } = await supabase
      .from('analytics_integrations')
      .select('id, provider, company_id, status, updated_at, last_provider_error')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as RecentIntegrationRow[]).map((r) => ({
      id: r.id,
      provider: r.provider,
      company_id: r.company_id,
      status: r.status,
      updated_at: r.updated_at,
      last_provider_error: r.last_provider_error ?? null,
    }));
  } catch {
    return [];
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse<OAuthHealthResponse | { status: 'error'; message: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'oauth-health diagnostics',
  });
  if (guard.ok !== true) return;

  const canonicalHost = getCanonicalAppUrl();
  const providers: ProviderHealth[] = [];

  for (const entry of PROVIDER_CATALOGUE) {
    const callbackUrl = `${canonicalHost}${entry.callback_path}`;
    const { ok, notes } = validateCallbackUrl(callbackUrl);

    // Env-presence boolean (never the value)
    let envPresent: ProviderHealth['env_present'];
    if (entry.config_source === 'db') {
      envPresent = { config_source: 'db', note: 'OAuth credentials sourced from DB (analytics_provider_config / community_ai_oauth_credentials), not env vars' };
    } else {
      envPresent = {
        client_id: !!entry.env_client_id && !!process.env[entry.env_client_id],
        client_secret: !!entry.env_client_secret && !!process.env[entry.env_client_secret],
      };
    }

    // DB rollup (best-effort; absent if no mapping)
    const dbMap = DB_PROVIDER_MAP[entry.provider];
    const integrations = dbMap
      ? await rollupIntegrationCounts(dbMap.table, dbMap.column, dbMap.value)
      : { connected: 0, disconnected: 0, error: 0, other: 0, last_updated_at: null };

    providers.push({
      provider: entry.provider,
      display_name: entry.display_name,
      callback_url: callbackUrl,
      callback_url_ok: ok,
      callback_url_notes: notes,
      env_present: envPresent,
      integrations,
    });
  }

  const recent = await recentAnalyticsIntegrationRows(20);

  return res.status(200).json({
    status: 'ok',
    canonical_host: canonicalHost,
    providers,
    recent_integrations: recent,
    observability: {
      log_tag: '[OAUTH]',
      note: 'Provider events are emitted as single-line JSON tagged [OAUTH] in Vercel logs. Live event aggregation requires a separate log-persistence pipeline (out of Phase 11 scope).',
    },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/oauth-health' });
