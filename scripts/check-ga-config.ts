/**
 * Simulation: verify Google OAuth + GA provider configuration.
 * Run: npx tsx scripts/check-ga-config.ts
 *
 * What it does (without opening a browser or actually connecting):
 *  1. Loads env (.env.local).
 *  2. Reads `analytics_provider_config` row for `google_analytics` via service role.
 *  3. Reports presence/preview of client_id, client_secret, scopes, redirect_uri, enabled flag.
 *  4. Builds the Google authorization URL the same way connectGoogleAnalytics does.
 *  5. Pings Google's token endpoint with a deliberately invalid `code` to validate that
 *     Google actually recognizes the client_id/secret pair (response classifies them):
 *       - invalid_client     → credentials are wrong (or app deleted/secret rotated)
 *       - invalid_grant      → credentials are GOOD; only the code is bad (expected here)
 *       - redirect_uri_mismatch → credentials are GOOD but redirect_uri not registered
 *  6. Counts integration / token / property rows.
 */

// Run with: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/check-ga-config.ts
import { getAnalyticsProviderConfig } from '../backend/services/analyticsProviderConfigService';
import { connectGoogleAnalytics } from '../backend/services/analyticsIntegrationService';
import { supabase } from '../backend/db/supabaseClient';

function preview(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return '(empty)';
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)} (len=${value.length})`;
}

async function probeGoogleTokenEndpoint(clientId: string, clientSecret: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: 'sentinel_invalid_code_for_credential_probe',
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const body = await res.text().catch(() => '');
  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch { /* leave raw */ }
  return { status: res.status, body, parsed };
}

async function main() {
  console.log('=== GA OAuth Configuration Simulation ===\n');

  console.log('[1] env');
  console.log('  NEXT_PUBLIC_APP_URL =', process.env.NEXT_PUBLIC_APP_URL ?? '(unset)');
  console.log('  APP_URL             =', process.env.APP_URL ?? '(unset)');
  console.log('  SUPABASE_URL        =', process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(unset)');
  console.log('  SERVICE_ROLE_KEY    =', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : '(unset)');
  console.log('  ENCRYPTION_KEY      =', process.env.ENCRYPTION_KEY ? 'present' : '(unset)');
  console.log();

  console.log('[2] analytics_provider_config row');
  let config: Awaited<ReturnType<typeof getAnalyticsProviderConfig>> = null;
  try {
    config = await getAnalyticsProviderConfig('google_analytics');
  } catch (err) {
    console.error('  load failed:', (err as Error).message);
    process.exit(2);
  }

  if (!config) {
    console.log('  ❌ NO row exists for provider=google_analytics — provider has never been configured.');
    console.log('  → Configure in Super Admin → APIs, or via backend/scripts/seedPlatformOauthConfigsFromEnv.ts');
    process.exit(0);
  }

  console.log('  enabled              =', config.enabled);
  console.log('  status               =', config.status);
  console.log('  oauth_client_id      =', preview(config.oauth_client_id));
  console.log('  oauth_client_secret  =', config.oauth_client_secret ? `(present, len=${config.oauth_client_secret.length})` : '(missing)');
  console.log('  scopes               =', config.scopes);
  console.log('  redirect_uri         =', config.redirect_uri ?? '(falls back to default)');
  console.log('  updated_at           =', config.updated_at);
  console.log();

  const ready = Boolean(config.enabled && config.oauth_client_id && config.oauth_client_secret);
  console.log('  configured?          =', ready ? '✅ yes' : '❌ no');
  console.log();

  if (!config.oauth_client_id || !config.oauth_client_secret) {
    console.log('Stopping — cannot probe Google without both client_id and client_secret.');
    process.exit(0);
  }

  console.log('[3] simulate connectGoogleAnalytics() — building authorization URL');
  try {
    const { authorizationUrl } = await connectGoogleAnalytics(
      '00000000-0000-0000-0000-000000000000',
      { userId: 'sim-user', returnTo: '/integrations?focus=data', requestBaseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' },
    );
    const u = new URL(authorizationUrl);
    console.log('  url origin           =', u.origin + u.pathname);
    console.log('  redirect_uri         =', u.searchParams.get('redirect_uri'));
    console.log('  scope                =', u.searchParams.get('scope'));
    console.log('  client_id (suffix)   =', (u.searchParams.get('client_id') ?? '').slice(-12));
    console.log('  access_type          =', u.searchParams.get('access_type'));
    console.log('  prompt               =', u.searchParams.get('prompt'));
    console.log('  ✅ authorization URL builds cleanly\n');
  } catch (err) {
    console.error('  ❌ connectGoogleAnalytics threw:', (err as Error).message);
    console.log('  (expected if companyId does not exist — DB insert into analytics_integrations may FK-fail)\n');
  }

  console.log('[4] probe Google token endpoint with sentinel code (validates credential pair)');
  const redirectUri =
    config.redirect_uri ||
    `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/analytics/connect/google/callback`;
  console.log('  redirect_uri sent    =', redirectUri);
  const probe = await probeGoogleTokenEndpoint(config.oauth_client_id, config.oauth_client_secret, redirectUri);
  console.log('  HTTP status          =', probe.status);
  console.log('  google.error         =', probe.parsed?.error ?? '(none)');
  console.log('  google.error_desc    =', probe.parsed?.error_description ?? '(none)');
  console.log('  raw body             =', probe.body.slice(0, 400));

  let verdict = 'unknown';
  const err = probe.parsed?.error;
  if (err === 'invalid_grant') verdict = '✅ credentials are VALID (only the dummy code was rejected, as expected)';
  else if (err === 'invalid_client') verdict = '❌ credentials INVALID — Google does not recognize this client_id/secret pair';
  else if (err === 'redirect_uri_mismatch') verdict = '⚠️  credentials valid but redirect_uri NOT registered in Google Cloud Console for this OAuth client';
  else if (err === 'unauthorized_client') verdict = '❌ OAuth client not authorized for authorization_code grant';
  else if (err === 'invalid_request') verdict = '⚠️  malformed request — check redirect_uri formatting';
  console.log('  verdict              =', verdict);
  console.log();

  console.log('[5] DB integration state');
  const { count: integrationsCount } = await supabase
    .from('analytics_integrations').select('id', { count: 'exact', head: true }).eq('provider', 'GA4');
  const { count: tokensCount } = await supabase
    .from('analytics_tokens').select('id', { count: 'exact', head: true });
  const { count: propertiesCount } = await supabase
    .from('analytics_properties').select('id', { count: 'exact', head: true });
  console.log('  analytics_integrations rows =', integrationsCount ?? 0);
  console.log('  analytics_tokens rows       =', tokensCount ?? 0);
  console.log('  analytics_properties rows   =', propertiesCount ?? 0);
  console.log();

  console.log('=== summary ===');
  console.log(JSON.stringify({
    provider_row_exists: true,
    enabled: config.enabled,
    client_id_present: Boolean(config.oauth_client_id),
    client_secret_present: Boolean(config.oauth_client_secret),
    redirect_uri: redirectUri,
    google_credential_verdict: verdict,
    integrations_count: integrationsCount ?? 0,
    tokens_count: tokensCount ?? 0,
    properties_count: propertiesCount ?? 0,
  }, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
