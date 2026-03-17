/**
 * Integration Service — company_integrations table
 * Supports: lead_webhook | wordpress | custom_blog_api
 */
import { supabase } from '../db/supabaseClient';

export type IntegrationType = 'lead_webhook' | 'wordpress' | 'custom_blog_api';
export type IntegrationStatus = 'connected' | 'failed' | 'pending';

export interface Integration {
  id: string;
  company_id: string;
  created_by: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
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
  config: Record<string, string>
): Promise<Integration> {
  const { data, error } = await supabase
    .from('company_integrations')
    .insert({
      company_id: companyId,
      created_by: userId,
      type,
      name,
      config,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Integration;
}

export async function updateIntegration(
  id: string,
  companyId: string,
  updates: { name?: string; config?: Record<string, string> }
): Promise<Integration> {
  const { data, error } = await supabase
    .from('company_integrations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Integration;
}

export async function deleteIntegration(id: string, companyId: string): Promise<void> {
  const { error } = await supabase
    .from('company_integrations')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

export async function getIntegration(id: string, companyId: string): Promise<Integration | null> {
  const { data, error } = await supabase
    .from('company_integrations')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single();
  if (error) return null;
  return data as Integration;
}

export async function getIntegrations(companyId: string, type?: IntegrationType): Promise<Integration[]> {
  let query = supabase
    .from('company_integrations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (type) query = query.eq('type', type);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as Integration[];
}

// Reusable by other modules: get first active integration of a type
export async function getActiveIntegration(
  companyId: string,
  type: IntegrationType
): Promise<Integration | null> {
  const { data, error } = await supabase
    .from('company_integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', type)
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as Integration;
}

// ─── TEST CONNECTION ─────────────────────────────────────────────────────────

export interface TestResult {
  success: boolean;
  message: string;
}

export async function validateIntegration(id: string, companyId: string): Promise<TestResult> {
  const integration = await getIntegration(id, companyId);
  if (!integration) return { success: false, message: 'Integration not found.' };

  let result: TestResult;
  try {
    result = await testConnection(integration);
  } catch (err) {
    result = { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }

  // Persist result
  await supabase
    .from('company_integrations')
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

async function testConnection(integration: Integration): Promise<TestResult> {
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

  if (type === 'wordpress') {
    if (!config.site_url || !config.username || !config.app_password) {
      return { success: false, message: 'site_url, username, and app_password are required.' };
    }
    const siteUrl = config.site_url.replace(/\/$/, '');
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    const res = await fetchWithTimeout(`${siteUrl}/wp-json/wp/v2/users/me`, {
      method: 'GET',
      headers: { Authorization: `Basic ${credentials}` },
    }, timeout);
    if (res.ok) {
      const user = await res.json().catch(() => null);
      const displayName = user?.name || 'unknown';
      return { success: true, message: `Connected as "${displayName}".` };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Authentication failed. Check username and application password.' };
    }
    return { success: false, message: `WordPress site returned status ${res.status}.` };
  }

  if (type === 'custom_blog_api') {
    if (!config.endpoint_url || !config.api_key) {
      return { success: false, message: 'endpoint_url and api_key are required.' };
    }
    const authHeader = config.auth_header || 'Authorization';
    const testPayload: BlogPayload = { title: 'Test Post', content: 'Integration test', author: 'system' };
    const res = await fetchWithTimeout(config.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [authHeader]: `Bearer ${config.api_key}`,
        'X-Integration-Test': 'true',
      },
      body: JSON.stringify(testPayload),
    }, timeout);
    if (res.ok || res.status === 200 || res.status === 201 || res.status === 204) {
      return { success: true, message: `API responded with ${res.status}.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'API rejected the key. Check api_key.' };
    }
    return { success: false, message: `API returned status ${res.status}.` };
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

  if (type === 'wordpress') {
    const siteUrl = integration.config.site_url.replace(/\/$/, '');
    const credentials = Buffer.from(
      `${integration.config.username}:${integration.config.app_password}`
    ).toString('base64');
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({ title: payload.title, content: payload.content, status: 'publish' }),
    });
    if (res.ok) return { success: true, message: 'Post published to WordPress.' };
    return { success: false, message: `WordPress returned ${res.status}.` };
  }

  if (type === 'custom_blog_api') {
    const authHeader = integration.config.auth_header || 'Authorization';
    const res = await fetch(integration.config.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [authHeader]: `Bearer ${integration.config.api_key}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { success: true, message: 'Post published to custom API.' };
    return { success: false, message: `API returned ${res.status}.` };
  }

  return { success: false, message: 'Unsupported integration type.' };
}
