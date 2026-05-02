/**
 * Live probe + repair: GA property discovery using the saved token.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/fetch-ga-properties.ts
 *
 * Steps:
 *  1. Load every analytics_integration row (provider=GA4) and its decrypted token.
 *  2. Refresh token if expired (uses the same refreshAccessToken path the app uses).
 *  3. Call analyticsadmin.googleapis.com/v1beta/accountSummaries directly. Dump raw JSON.
 *  4. If empty, try /v1beta/accounts and per-account /v1beta/properties (same fallback the app uses).
 *  5. Call fetchGAAccountsAndProperties and syncAnalyticsProperties to actually insert rows.
 *  6. Print summary in the requested output schema.
 */

import {
  fetchGAAccountsAndProperties,
  getValidAccessTokenForIntegration,
} from '../backend/services/analyticsIntegrationService';
import { supabase } from '../backend/db/supabaseClient';

async function rawAdminGet(accessToken: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text().catch(() => '');
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: res.status, ok: res.ok, body: text, parsed };
}

async function tokenInfo(accessToken: string) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: res.status, parsed, body: text };
}

async function main() {
  const { data: integrations, error } = await supabase
    .from('analytics_integrations')
    .select('id, company_id, provider, status, created_at, updated_at')
    .eq('provider', 'GA4');

  if (error) {
    console.error('Failed to load integrations:', error.message);
    process.exit(2);
  }

  if (!integrations || integrations.length === 0) {
    console.log('No GA4 integrations exist.');
    console.log(JSON.stringify({ using_admin_api: true, properties_found: false, properties_count: 0 }, null, 2));
    return;
  }

  let totalPropertiesInserted = 0;

  for (const integration of integrations) {
    console.log(`\n=== Integration ${integration.id} (company=${integration.company_id}, status=${integration.status}) ===`);

    let accessToken: string | null = null;
    try {
      accessToken = await getValidAccessTokenForIntegration(integration.id);
    } catch (err) {
      console.error('  ❌ token retrieval/refresh failed:', (err as Error).message);
      continue;
    }
    if (!accessToken) {
      console.error('  ❌ no access token available (refresh likely failed)');
      continue;
    }
    console.log('  ✅ access token available (len=' + accessToken.length + ')');

    const info = await tokenInfo(accessToken);
    console.log('  tokeninfo.status =', info.status);
    if (info.parsed) {
      console.log('  tokeninfo.scope  =', info.parsed.scope);
      console.log('  tokeninfo.aud    =', info.parsed.aud);
      console.log('  tokeninfo.email  =', info.parsed.email);
      console.log('  tokeninfo.expires_in =', info.parsed.expires_in);
    } else {
      console.log('  tokeninfo.body   =', info.body.slice(0, 300));
    }

    const hasAnalyticsScope = typeof info.parsed?.scope === 'string'
      && info.parsed.scope.includes('analytics.readonly');
    console.log('  has analytics.readonly scope =', hasAnalyticsScope ? '✅ yes' : '❌ NO');

    console.log('\n  → GET /v1beta/accountSummaries');
    const summariesRes = await rawAdminGet(
      accessToken,
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
    );
    console.log('    status =', summariesRes.status);
    if (!summariesRes.ok) {
      console.log('    body   =', summariesRes.body.slice(0, 600));
    } else {
      const summaries = summariesRes.parsed?.accountSummaries ?? [];
      console.log('    accountSummaries.length =', summaries.length);
      for (const s of summaries) {
        const props = s?.propertySummaries ?? [];
        console.log(`    - account=${s?.account} display="${s?.displayName}" properties=${props.length}`);
        for (const p of props) {
          console.log(`        property=${p?.property} display="${p?.displayName}"`);
        }
      }
    }

    console.log('\n  → GET /v1beta/accounts (fallback)');
    const accountsRes = await rawAdminGet(
      accessToken,
      'https://analyticsadmin.googleapis.com/v1beta/accounts?pageSize=200&showDeleted=false',
    );
    console.log('    status =', accountsRes.status);
    if (!accountsRes.ok) {
      console.log('    body   =', accountsRes.body.slice(0, 600));
    } else {
      const accounts = accountsRes.parsed?.accounts ?? [];
      console.log('    accounts.length =', accounts.length);
      for (const a of accounts) {
        console.log(`    - name=${a?.name} display="${a?.displayName}"`);
      }
    }

    console.log('\n  → calling app code path: fetchGAAccountsAndProperties()');
    let appProps: Array<{ propertyId: string; propertyName: string; accountId: string | null; accountName: string | null }> = [];
    try {
      appProps = await fetchGAAccountsAndProperties(accessToken);
      console.log('    properties returned =', appProps.length);
      for (const p of appProps) {
        console.log(`      ${p.propertyId} — "${p.propertyName}" (account=${p.accountName})`);
      }
    } catch (err) {
      console.error('    ❌ threw:', (err as Error).message);
    }

    if (appProps.length > 0) {
      const timestamp = new Date().toISOString();
      const { error: upsertErr } = await supabase
        .from('analytics_properties')
        .upsert(
          appProps.map((p) => ({
            integration_id: integration.id,
            property_id: p.propertyId,
            property_name: p.propertyName,
            account_id: p.accountId,
            updated_at: timestamp,
          })),
          { onConflict: 'integration_id,property_id' },
        );
      if (upsertErr) {
        console.error('    ❌ upsert failed:', upsertErr.message);
      } else {
        console.log(`    ✅ upserted ${appProps.length} properties into analytics_properties`);
        totalPropertiesInserted += appProps.length;
      }
    }
  }

  const { count: finalCount } = await supabase
    .from('analytics_properties')
    .select('id', { count: 'exact', head: true });

  console.log('\n=== summary ===');
  console.log(JSON.stringify({
    using_admin_api: true,
    properties_found: (finalCount ?? 0) > 0,
    properties_count: finalCount ?? 0,
    properties_inserted_this_run: totalPropertiesInserted,
  }, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
