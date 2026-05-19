/**
 * OAuth refresh worker (opt-in, idempotent). Thin scheduler entrypoint around
 * the real refreshConnectionToken service. NOT auto-registered in cron —
 * wiring a token-expiry schedule is an operational decision (deploy
 * discipline; the actual refresh only does real work when provider OAuth env
 * credentials are configured). Safe to run repeatedly.
 */
import { ownedDbTable } from '../db/writeOwner';
import { refreshConnectionToken, type RefreshResult } from '../services/intelligence/oauthRefreshService';

let running = false;
const OAUTH_PROVIDERS = ['hubspot', 'shopify', 'webflow'];

export async function runOAuthRefreshWorker(
  companyId?: string,
): Promise<{ scanned: number; results: RefreshResult[] } | { skipped: true; reason: string }> {
  if (running) return { skipped: true, reason: 'oauth refresh already in progress' };
  running = true;
  try {
    let q = ownedDbTable('company_integrations').select('company_id, website_connection_id, type');
    if (companyId) q = q.eq('company_id', companyId);
    const { data } = await q;
    const rows = ((data ?? []) as Array<{ company_id: string; website_connection_id: string | null; type: string }>)
      .filter((r) => OAUTH_PROVIDERS.includes(r.type) && r.website_connection_id);

    const results: RefreshResult[] = [];
    for (const r of rows) {
      results.push(await refreshConnectionToken(r.website_connection_id as string, r.company_id));
    }
    console.warn(`[oauthRefreshWorker] done ${JSON.stringify({ companyId: companyId ?? 'all', scanned: rows.length, refreshed: results.filter((x) => x.state === 'refreshed').length })}`);
    return { scanned: rows.length, results };
  } catch (err) {
    console.error(`[oauthRefreshWorker] failed ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    running = false;
  }
}
