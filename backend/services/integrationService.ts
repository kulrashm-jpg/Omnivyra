import { ownedDbTable } from '../db/writeOwner';
/**
 * Integration Service — company_integrations table
 * Supports: lead_webhook | wordpress | custom_blog_api
 */
import { createWebsiteConnection, resolveWebsiteForCompany } from './websiteService';
import {
  mergeConnectionConfig,
  splitSecretConfig,
  upsertConnectionCredentials,
} from './integrationCredentialService';
import { getCmsAdapter, isCmsProvider } from './cms/registry';
import { ensureCanonicalConnectionForIntegration } from './cms/cmsConnectionNormalizationService';

export type IntegrationType =
  | 'lead_webhook'
  | 'wordpress'
  | 'custom_blog_api'
  | 'ghost'
  | 'drupal'
  | 'joomla'
  | 'webflow'
  | 'shopify'
  | 'hubspot'
  | 'wix'
  | 'squarespace';
export type IntegrationStatus = 'connected' | 'failed' | 'pending';

/** Connection auth_type per CMS provider (drives website_connections.auth_type). */
const PROVIDER_AUTH_TYPE: Record<string, string> = {
  wordpress: 'basic',
  ghost: 'admin_api_key',
  drupal: 'bearer_token',
  joomla: 'api_token',
  webflow: 'oauth2',
  shopify: 'api_token',
  hubspot: 'oauth2',
  wix: 'api_token',
  squarespace: 'api_token',
  custom_blog_api: 'api_key',
};

export interface Integration {
  id: string;
  company_id: string;
  created_by: string;
  website_id?: string | null;
  website_connection_id?: string | null;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
  non_secret_config?: Record<string, string>;
  credential_migration_status?: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// Lead payload contract
export interface LeadPayload {
  name: string;
  email: string;
  phone?: string;
  source?: string;
}

// Blog payload contract
export interface BlogPayload {
  title: string;
  content: string;
  author?: string;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createIntegration(
  companyId: string,
  userId: string,
  type: IntegrationType,
  name: string,
  config: Record<string, string>,
  options: { websiteId?: string | null; authType?: string } = {},
): Promise<Integration> {
  const normalizedConfig = normalizeIntegrationConfig(type, config);
  const { nonSecretConfig, credentials } = splitSecretConfig(normalizedConfig);
  const website = await resolveWebsiteForCompany(companyId, options.websiteId ?? null, userId);
  const connection = await createWebsiteConnection({
    websiteId: website.id,
    provider: type,
    authType: options.authType ?? PROVIDER_AUTH_TYPE[type] ?? 'api_key',
    nonSecretConfig,
    status: 'pending',
  });
  await upsertConnectionCredentials(connection.id, credentials);

  const { data, error } = await ownedDbTable('company_integrations')
    .insert({
      company_id: companyId,
      created_by: userId,
      website_id: website.id,
      website_connection_id: connection.id,
      type,
      name,
      config: nonSecretConfig,
      non_secret_config: nonSecretConfig,
      credential_migration_status: 'encrypted',
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return hydrateIntegration(data as Integration);
}

export async function updateIntegration(
  id: string,
  companyId: string,
  updates: { name?: string; config?: Record<string, string>; websiteId?: string | null }
): Promise<Integration> {
  const existing = await getIntegration(id, companyId);
  if (!existing) throw new Error('Integration not found');

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name) payload.name = updates.name;
  if (updates.websiteId !== undefined) {
    const website = await resolveWebsiteForCompany(companyId, updates.websiteId, existing.created_by);
    payload.website_id = website.id;
    if (existing.website_connection_id) {
      await ownedDbTable('website_connections')
        .update({ website_id: website.id, updated_at: new Date().toISOString() })
        .eq('id', existing.website_connection_id);
    }
  }
  if (updates.config) {
    const normalizedConfig = normalizeIntegrationConfig(existing.type, updates.config);
    const { nonSecretConfig, credentials } = splitSecretConfig(normalizedConfig);
    if (existing.website_connection_id) {
      await upsertConnectionCredentials(existing.website_connection_id, credentials);
      await ownedDbTable('website_connections')
        .update({ non_secret_config: nonSecretConfig, updated_at: new Date().toISOString() })
        .eq('id', existing.website_connection_id);
    }
    payload.config = nonSecretConfig;
    payload.non_secret_config = nonSecretConfig;
    payload.credential_migration_status = existing.website_connection_id ? 'encrypted' : 'legacy_missing_connection';
  }

  const { data, error } = await ownedDbTable('company_integrations')
    .update(payload)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return hydrateIntegration(data as Integration);
}

function normalizeIntegrationConfig(
  type: IntegrationType,
  config: Record<string, string>,
): Record<string, string> {
  const normalized = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, String(value ?? '').trim()]),
  ) as Record<string, string>;

  if (isCmsProvider(type) && normalized.site_url) {
    normalized.site_url = normalizeCmsSiteUrl(normalized.site_url);
  }

  return normalized;
}

function normalizeCmsSiteUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase();
    const isDevelopmentHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.test');

    if (url.protocol === 'http:' && !isDevelopmentHost) {
      url.protocol = 'https:';
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

export async function deleteIntegration(id: string, companyId: string): Promise<void> {
  const { error } = await ownedDbTable('company_integrations')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

export async function getIntegration(id: string, companyId: string): Promise<Integration | null> {
  const { data, error } = await ownedDbTable('company_integrations')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single();
  if (error) return null;
  return hydrateIntegration(data as Integration);
}

export async function getIntegrations(companyId: string, type?: IntegrationType): Promise<Integration[]> {
  let query = ownedDbTable('company_integrations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Promise.all(((data || []) as Integration[]).map(hydrateIntegration));
}

// Reusable by other modules: get first active integration of a type
export async function getActiveIntegration(
  companyId: string,
  type: IntegrationType
): Promise<Integration | null> {
  const { data, error } = await ownedDbTable('company_integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', type)
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return hydrateIntegration(data as Integration);
}

async function hydrateIntegration(row: Integration): Promise<Integration> {
  const nonSecretConfig = (row.non_secret_config ?? row.config ?? {}) as Record<string, string>;
  const config = await mergeConnectionConfig(row.website_connection_id, nonSecretConfig, row.config);
  return {
    ...row,
    non_secret_config: nonSecretConfig,
    config,
  };
}

// ─── TEST CONNECTION ─────────────────────────────────────────────────────────

export interface TestResult {
  success: boolean;
  message: string;
  /** Machine-readable failure code (e.g. WordPress HTTPS_REQUIRED). */
  code?: string;
  /** Structured WordPress environment / REST / auth diagnostics, when available. */
  diagnostics?: unknown;
}

export async function validateIntegration(
  id: string,
  companyId: string,
  opts: { rediscover?: boolean } = {},
): Promise<TestResult> {
  const integration = await getIntegration(id, companyId);
  if (!integration) return { success: false, message: 'Integration not found.' };
  const normalizedConfig = normalizeIntegrationConfig(integration.type, integration.config);
  if (JSON.stringify(normalizedConfig) !== JSON.stringify(integration.config)) {
    integration.config = normalizedConfig;
    const { nonSecretConfig } = splitSecretConfig(normalizedConfig);
    await ownedDbTable('company_integrations')
      .update({
        config: nonSecretConfig,
        non_secret_config: nonSecretConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', companyId);
    if (integration.website_connection_id) {
      await ownedDbTable('website_connections')
        .update({ non_secret_config: nonSecretConfig, updated_at: new Date().toISOString() })
        .eq('id', integration.website_connection_id);
    }
  }

  // Enforcement: no CMS operation runs without a canonical connection.
  if (isCmsProvider(integration.type) && !integration.website_connection_id) {
    const connId = await ensureCanonicalConnectionForIntegration(integration).catch(() => null);
    if (connId) integration.website_connection_id = connId;
  }

  let result: TestResult;
  try {
    result = await testConnection(integration, opts);
  } catch (err) {
    result = { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }

  // Persist result
  await ownedDbTable('company_integrations')
    .update({
      status: result.success ? 'connected' : 'failed',
      last_tested_at: new Date().toISOString(),
      last_error: result.success ? null : result.message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId);

  return result;
}

async function testConnection(
  integration: Integration,
  opts: { rediscover?: boolean } = {},
): Promise<TestResult> {
  const { type, config } = integration;
  const timeout = 10_000;

  if (type === 'lead_webhook') {
    if (!config.webhook_url) return { success: false, message: 'webhook_url is required.' };
    const testPayload: LeadPayload = { name: 'Test Lead', email: 'test@example.com', source: 'integration_test' };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) headers['X-Webhook-Secret'] = config.secret;
    const res = await fetchWithTimeout(config.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
    }, timeout);
    if (res.ok || res.status === 200 || res.status === 201 || res.status === 204) {
      return { success: true, message: `Webhook responded with ${res.status}.` };
    }
    return { success: false, message: `Webhook returned status ${res.status}.` };
  }

  if (type === 'wordpress' || isCmsProvider(type)) {
    const health = await getCmsAdapter(type).validateConnection({
      provider: type,
      companyId: integration.company_id,
      connectionId: integration.website_connection_id,
      websiteId: integration.website_id,
      config,
      timeoutMs: timeout,
      forceApiRediscovery: opts.rediscover === true,
    });
    return {
      success: health.healthy,
      message: health.message,
      code: health.code,
      diagnostics: health.diagnostics,
    };
  }

  return { success: false, message: `Unknown integration type: ${type}` };
}

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── REUSABLE SENDERS ────────────────────────────────────────────────────────

/** Send a lead to the configured lead_webhook integration */
export async function sendLead(companyId: string, payload: LeadPayload): Promise<void> {
  const integration = await getActiveIntegration(companyId, 'lead_webhook');
  if (!integration) return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (integration.config.secret) headers['X-Webhook-Secret'] = integration.config.secret;
  await fetch(integration.config.webhook_url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch(() => null);
}

/** Publish a blog post via wordpress or custom_blog_api integration */
export async function publishBlog(
  companyId: string,
  payload: BlogPayload,
  preferType?: 'wordpress' | 'custom_blog_api'
): Promise<{ success: boolean; message: string }> {
  const type = preferType || 'wordpress';
  const integration = await getActiveIntegration(companyId, type);
  if (!integration) return { success: false, message: `No active ${type} integration found.` };
  // Enforcement: ensure the canonical connection exists before publishing.
  const connId =
    integration.website_connection_id ??
    (await ensureCanonicalConnectionForIntegration(integration).catch(() => null));
  const adapter = getCmsAdapter(type);
  const result = await adapter.publishPost({
    provider: type,
    companyId,
    connectionId: connId,
    websiteId: integration.website_id,
    config: integration.config,
  }, {
    blog: {
      id: 'direct-publish',
      company_id: companyId,
      created_by: '',
      title: payload.title,
      content: payload.content,
      slug: null,
      excerpt: null,
      content_blocks: null,
      featured_image_url: null,
      category: null,
      tags: [],
      seo_meta_title: null,
      seo_meta_description: null,
      is_featured: false,
      views_count: 0,
      status: 'draft',
      integration_id: integration.id,
      external_id: null,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      angle_type: null,
      hook_strength: null,
    },
    htmlContent: payload.content,
  });
  return { success: result.success, message: result.message };
}
