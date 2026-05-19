/**
 * Legacy CMS connection normalization.
 *
 * Backfills the canonical Website Connection model for integrations created
 * before it existed (or before a provider was operationalized):
 *   - missing website_connection_id  → create connection + migrate secrets
 *   - missing api_discovery           → run discovery + persist canonical base
 *
 * Strategy: idempotent RUNTIME job (NOT a destructive migration — the prod
 * migration ledger is fragile, so no schema/bulk db:push). Existing
 * integrations, publish history, attribution and reconciliation rows are
 * untouched (we only add the connection link + encrypt secrets in place).
 */
import { ownedDbTable } from '../../db/writeOwner';
import {
  createWebsiteConnection,
  getWebsiteConnection,
  resolveWebsiteForCompany,
  updateWebsiteConnection,
} from '../websiteService';
import {
  splitSecretConfig,
  upsertConnectionCredentials,
} from '../integrationCredentialService';
import { isCmsProvider } from './registry';
import { resolveCanonicalApiBase } from './cmsApiBaseResolver';

const PROVIDER_AUTH_TYPE: Record<string, string> = {
  wordpress: 'basic',
  ghost: 'admin_api_key',
  drupal: 'bearer_token',
  joomla: 'api_token',
  webflow: 'oauth2',
  shopify: 'api_token',
  custom_blog_api: 'api_key',
};

export interface NormalizationSummary {
  scanned: number;
  connectionsBackfilled: number;
  apiBasesDiscovered: number;
  degraded: number;
  skipped: number;
  errors: Array<{ integrationId: string; error: string }>;
}

interface LegacyIntegrationRow {
  id: string;
  company_id: string;
  created_by: string | null;
  type: string;
  name: string;
  config: Record<string, string> | null;
  non_secret_config: Record<string, string> | null;
  website_id: string | null;
  website_connection_id: string | null;
}

/**
 * Ensure a single integration is normalized onto the canonical connection
 * model. Idempotent — safe to call from publish/validate paths (enforcement).
 * Returns the connectionId (existing or freshly created), or null if N/A.
 */
export async function ensureCanonicalConnectionForIntegration(integration: {
  id: string;
  company_id: string;
  created_by?: string | null;
  type: string;
  website_id?: string | null;
  website_connection_id?: string | null;
  config?: Record<string, string> | null;
}): Promise<string | null> {
  if (!isCmsProvider(integration.type)) return null;
  if (integration.website_connection_id) return integration.website_connection_id;

  const website = await resolveWebsiteForCompany(
    integration.company_id,
    integration.website_id ?? null,
    integration.created_by ?? null,
  );
  const { nonSecretConfig, credentials } = splitSecretConfig(integration.config ?? {});
  const connection = await createWebsiteConnection({
    websiteId: website.id,
    provider: integration.type,
    authType: PROVIDER_AUTH_TYPE[integration.type] ?? 'api_key',
    nonSecretConfig,
    status: 'pending',
  });
  await upsertConnectionCredentials(connection.id, credentials);

  await ownedDbTable('company_integrations')
    .update({
      website_id: website.id,
      website_connection_id: connection.id,
      config: nonSecretConfig,
      non_secret_config: nonSecretConfig,
      credential_migration_status: 'encrypted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', integration.id)
    .eq('company_id', integration.company_id);

  return connection.id;
}

/** Bulk normalization job (admin-triggered or scheduled). */
export async function normalizeCmsConnections(
  companyId?: string,
): Promise<NormalizationSummary> {
  const summary: NormalizationSummary = {
    scanned: 0,
    connectionsBackfilled: 0,
    apiBasesDiscovered: 0,
    degraded: 0,
    skipped: 0,
    errors: [],
  };

  let query = ownedDbTable('company_integrations')
    .select('id, company_id, created_by, type, name, config, non_secret_config, website_id, website_connection_id')
    .in('type', ['wordpress', 'custom_blog_api', 'ghost', 'drupal', 'joomla', 'webflow', 'shopify']);
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as LegacyIntegrationRow[]) {
    summary.scanned += 1;
    try {
      // (1) Backfill canonical connection if missing.
      let connectionId = row.website_connection_id;
      if (!connectionId) {
        connectionId = await ensureCanonicalConnectionForIntegration(row);
        if (connectionId) summary.connectionsBackfilled += 1;
      }
      if (!connectionId) {
        summary.skipped += 1;
        continue;
      }

      // (2) Backfill api_discovery if missing.
      const connection = await getWebsiteConnection(connectionId);
      const persisted = (connection?.non_secret_config as any)?.api_discovery;
      if (!persisted?.canonical_api_base) {
        const cfg = (connection?.non_secret_config ?? row.non_secret_config ?? row.config ?? {}) as Record<string, string>;
        const siteUrl = String(cfg.site_url || cfg.endpoint_url || cfg.shop_domain || '').replace(/\/+$/, '');
        if (siteUrl) {
          const resolved = await resolveCanonicalApiBase({
            provider: row.type,
            siteUrl,
            connectionId,
            fetchFn: (url) => fetch(url),
            forceRediscover: true,
          });
          if (resolved.source === 'runtime_discovery') {
            summary.apiBasesDiscovered += 1;
          }
          if (resolved.degraded) {
            summary.degraded += 1;
            // Degraded-state tracking on the connection (visible in diagnostics).
            await updateWebsiteConnection(connectionId, {
              health_status: 'degraded',
              last_error: 'API base unresolved — running on legacy fallback root',
            }).catch(() => undefined);
          }
        } else {
          summary.skipped += 1;
        }
      }
    } catch (err) {
      summary.errors.push({
        integrationId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
