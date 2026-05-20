/**
 * Provider diagnostics — operator-facing summary per CMS provider.
 *
 * Composes EXISTING surfaces:
 *   - describeCmsProvider (capability matrix from cms/registry.ts)
 *   - CMS_PROVIDER_CAPABILITIES (from cmsEnvironmentFramework.ts)
 *   - publishing_jobs (recent success/failure counts per company × provider)
 *   - integration_logs (recent error events, if any)
 *
 * No new schemas, no new background workers. Pure read-only join with the
 * lightCache wrapper for repeat-load amortisation.
 */
import { ownedDbTable } from '../db/writeOwner';
import { describeCmsProvider, isCmsProvider, listCmsProviders } from './cms/registry';
import { CMS_PROVIDER_CAPABILITIES } from './cms/cmsEnvironmentFramework';
import type { CmsProvider } from './cms/types';
import { cached } from './lightCache';

export interface ProviderDiagnosticsCard {
  provider: CmsProvider;
  label: string;
  enabled: boolean;
  authType: string;
  apiDiscoveryMode: string;
  capabilities: {
    publish: boolean;
    update: boolean;
    delete: boolean;
    media: boolean;
    taxonomy: boolean;
    webhook: boolean;
    oauth: boolean;
    localDev: boolean;
  };
  setupHints: string[];
  troubleshootingHints: string[];
  rateLimitNote: string;
  recentPublishAttempts: number;
  recentPublishSuccesses: number;
  recentPublishFailures: number;
  successRate: number;
  recentAuthFailures: number;
  recentErrors: Array<{ at: string; eventName: string; message: string }>;
  health: 'healthy' | 'warning' | 'degraded' | 'unused';
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

const RECENT_WINDOW_MS = 7 * 86_400_000;

// Provider-specific knowledge — kept in this single file so we don't sprinkle
// it across adapters. All copy is operator-grade plain language.
const SETUP_HINTS: Record<string, string[]> = {
  wordpress: [
    'Use an Application Password (Users → Profile → Application Passwords).',
    'Production sites must serve HTTPS — WordPress disables app passwords on plain HTTP by default.',
  ],
  ghost: ['Use a Custom Integration Admin API key (Settings → Integrations).'],
  drupal: ['Enable the core JSON:API module and grant the integration user JSON:API access.'],
  joomla: ['Enable Web Services and create a Joomla API token in Users → Manage.'],
  webflow: ['Generate a Site API token or use OAuth, then pick a target CMS collection_id during validation.'],
  shopify: ['Use a Custom App access token with write_content scope. Defaults pick the first blog if blog_id is unset.'],
  hubspot: ['Private-app token or OAuth access token. Set blog_id (Marketing → Website → Blog → Blog ID).'],
  wix: ['API key + Site ID required. Account ID is only needed for app tokens, not site tokens.'],
  squarespace: ['Reachability-only — Squarespace has no public write API. Publishing is not supported.'],
  custom_blog_api: ['Provide a publishing endpoint URL and an API key for bearer auth.'],
};

const TROUBLESHOOTING_HINTS: Record<string, string[]> = {
  wordpress: [
    '401/403: verify the application password (not the user password) and that the user can publish.',
    'HTTPS_REQUIRED: production must serve HTTPS; localhost / *.local / ngrok are auto-allowed.',
    'rest_no_route: WordPress may be behind a reverse proxy — re-validate to re-discover the API base.',
  ],
  ghost: ['401: regenerate the Admin API key. JWT lifetime is 5 minutes — clock skew can cause failures.'],
  drupal: ['Empty taxonomy: set tag_field on the integration config (default: field_tags).'],
  joomla: ['401: verify "Web Services - Content" is enabled and the API user has Article permissions.'],
  webflow: [
    'Publish error "collection required": validate first to surface site/collection IDs and copy collection_id.',
    'Item published but not visible: Webflow requires a site publish — done manually or via Designer.',
  ],
  shopify: ['401: regenerate the Admin API access token and confirm write_content scope.'],
  hubspot: ['400 contentGroupId required: set blog_id on the integration before publishing.'],
  wix: ['401: rotate the API key. App tokens require wix_account_id; site tokens do NOT.'],
  squarespace: ['No troubleshooting — publishing is intentionally unsupported.'],
  custom_blog_api: ['401: check the API key is sent as Authorization: Bearer <key>.'],
};

const RATE_LIMIT_NOTES: Record<string, string> = {
  wordpress: 'No published rate limit — host-dependent. Worker retries with exponential backoff on 429.',
  ghost: '~100 req/min per IP. Worker backs off on 429.',
  drupal: 'No published limit. Host-dependent.',
  joomla: 'No published limit. Host-dependent.',
  webflow: '60 req/min by default. Worker backs off on 429.',
  shopify: '40 req/sec admin bucket. Worker backs off on 429.',
  hubspot: '100 req/10s per token. Worker backs off on 429.',
  wix: 'Variable per endpoint. Worker backs off on 429.',
  squarespace: 'Not applicable — no API writes.',
  custom_blog_api: 'Operator-defined endpoint — host-dependent.',
};

function capabilityFlagsFor(provider: CmsProvider): ProviderDiagnosticsCard['capabilities'] {
  const caps = CMS_PROVIDER_CAPABILITIES[provider as keyof typeof CMS_PROVIDER_CAPABILITIES];
  const supportsWrite = provider !== 'squarespace';
  return {
    publish: supportsWrite,
    update: supportsWrite,
    delete: supportsWrite,
    // Media upload is implemented in the adapter for the providers below.
    media: supportsWrite && ['wordpress', 'ghost', 'drupal', 'joomla', 'shopify', 'hubspot', 'wix', 'webflow'].includes(provider),
    taxonomy: provider !== 'squarespace' && provider !== 'custom_blog_api',
    webhook: !!caps?.webhookSupport,
    oauth: !!caps?.oauthSupport,
    localDev: !!caps?.localDevSupport,
  };
}

async function loadProviderJobStats(companyId: string, provider: CmsProvider): Promise<{ attempts: number; successes: number; failures: number; lastSuccessAt: string | null; lastFailureAt: string | null; authFailures: number }> {
  const sinceIso = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('publishing_jobs')
      .select('status, completed_at, dead_letter_at, failure_category, updated_at')
      .eq('company_id', companyId)
      .eq('provider', provider)
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: false })
      .limit(500);
    const rows = (data ?? []) as Array<{ status: string; completed_at: string | null; dead_letter_at: string | null; failure_category: string | null; updated_at: string }>;
    let successes = 0, failures = 0, authFailures = 0;
    let lastSuccessAt: string | null = null, lastFailureAt: string | null = null;
    for (const r of rows) {
      if (r.status === 'published') { successes += 1; if (!lastSuccessAt) lastSuccessAt = r.completed_at ?? r.updated_at; }
      else if (r.status === 'failed' || r.status === 'dead_letter') {
        failures += 1;
        if (!lastFailureAt) lastFailureAt = r.dead_letter_at ?? r.updated_at;
        if (r.failure_category === 'auth') authFailures += 1;
      }
    }
    return { attempts: successes + failures, successes, failures, lastSuccessAt, lastFailureAt, authFailures };
  } catch { return { attempts: 0, successes: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null, authFailures: 0 }; }
}

async function loadRecentProviderErrors(companyId: string, provider: CmsProvider, limit = 5): Promise<Array<{ at: string; eventName: string; message: string }>> {
  const sinceIso = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('integration_logs')
      .select('created_at, event_name, message, level')
      .eq('company_id', companyId)
      .eq('provider', provider)
      .eq('level', 'error')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as Array<{ created_at: string; event_name: string; message: string }>)
      .map((r) => ({ at: r.created_at, eventName: r.event_name, message: r.message }));
  } catch { return []; }
}

function deriveHealth(stats: { attempts: number; successes: number; failures: number; authFailures: number }): ProviderDiagnosticsCard['health'] {
  if (stats.attempts === 0) return 'unused';
  if (stats.authFailures > 0) return 'degraded';
  const rate = stats.successes / Math.max(1, stats.attempts);
  if (rate < 0.5) return 'degraded';
  if (rate < 0.9) return 'warning';
  return 'healthy';
}

export async function buildProviderDiagnosticsCard(companyId: string, provider: CmsProvider): Promise<ProviderDiagnosticsCard> {
  return cached(`provider-diag:${companyId}:${provider}`, 60_000, async () => {
    const desc = describeCmsProvider(provider);
    const [stats, recentErrors] = await Promise.all([
      loadProviderJobStats(companyId, provider),
      loadRecentProviderErrors(companyId, provider),
    ]);
    const successRate = stats.attempts > 0 ? Number((stats.successes / stats.attempts).toFixed(3)) : 0;
    return {
      provider,
      label: desc.label,
      enabled: desc.enabled,
      authType: desc.authType,
      apiDiscoveryMode: desc.apiDiscoveryMode,
      capabilities: capabilityFlagsFor(provider),
      setupHints: SETUP_HINTS[provider] ?? [],
      troubleshootingHints: TROUBLESHOOTING_HINTS[provider] ?? [],
      rateLimitNote: RATE_LIMIT_NOTES[provider] ?? 'Host-dependent.',
      recentPublishAttempts: stats.attempts,
      recentPublishSuccesses: stats.successes,
      recentPublishFailures: stats.failures,
      successRate,
      recentAuthFailures: stats.authFailures,
      recentErrors,
      health: deriveHealth(stats),
      lastSuccessAt: stats.lastSuccessAt,
      lastFailureAt: stats.lastFailureAt,
    };
  });
}

export async function buildAllProviderDiagnostics(companyId: string): Promise<ProviderDiagnosticsCard[]> {
  const providers = listCmsProviders();
  const cards = await Promise.all(providers.map((p) => buildProviderDiagnosticsCard(companyId, p)));
  // Sort: degraded > warning > unused > healthy → operator sees attention items first.
  const order = { degraded: 0, warning: 1, unused: 2, healthy: 3 };
  return cards.sort((a, b) => order[a.health] - order[b.health]);
}

export function listAllCmsProviders(): CmsProvider[] {
  return listCmsProviders();
}
