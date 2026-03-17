/**
 * Blog Publishing Service
 * Publish to WordPress, custom blog API, or host internally as fallback.
 */
import { supabase } from '../db/supabaseClient';
import { getIntegration, getActiveIntegration, Integration } from './integrationService';

export type BlogStatus = 'draft' | 'published' | 'failed';

export interface Blog {
  id: string;
  company_id: string;
  created_by: string;
  title: string;
  content: string;
  status: BlogStatus;
  integration_id: string | null;
  external_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishResult {
  success: boolean;
  message: string;
  external_id?: string;
  hosted?: boolean;       // true when published internally (no integration)
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createBlog(
  companyId: string,
  userId: string,
  title: string,
  content = '',
): Promise<Blog> {
  const { data, error } = await supabase
    .from('blogs')
    .insert({ company_id: companyId, created_by: userId, title, content, status: 'draft' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Blog;
}

export async function getBlog(id: string, companyId: string): Promise<Blog | null> {
  const { data, error } = await supabase
    .from('blogs').select('*').eq('id', id).eq('company_id', companyId).single();
  if (error) return null;
  return data as Blog;
}

export async function getBlogs(companyId: string, status?: BlogStatus): Promise<Blog[]> {
  let q = supabase
    .from('blogs').select('*').eq('company_id', companyId)
    .order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Blog[];
}

export async function updateBlog(
  id: string,
  companyId: string,
  updates: { title?: string; content?: string },
): Promise<Blog> {
  const { data, error } = await supabase
    .from('blogs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId)
    .select('*').single();
  if (error) throw new Error(error.message);
  return data as Blog;
}

export async function deleteBlog(id: string, companyId: string): Promise<void> {
  const { error } = await supabase
    .from('blogs').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

// ─── PUBLISH ─────────────────────────────────────────────────────────────────

/**
 * Publish a blog post.
 * - If integrationId provided: use that specific integration.
 * - Else: try the company's active WordPress, then custom_blog_api integration.
 * - If no integration found: publish internally (hosted fallback).
 */
export async function publishBlogPost(
  id: string,
  companyId: string,
  integrationId?: string | null,
): Promise<PublishResult> {
  const blog = await getBlog(id, companyId);
  if (!blog) throw new Error('Blog not found');
  if (!blog.title?.trim()) throw new Error('A title is required before publishing');

  let integration: Integration | null = null;

  if (integrationId) {
    integration = await getIntegration(integrationId, companyId);
  } else {
    // Auto-detect: prefer WordPress, then custom_blog_api
    integration =
      await getActiveIntegration(companyId, 'wordpress') ||
      await getActiveIntegration(companyId, 'custom_blog_api');
  }

  let result: PublishResult;
  let usedIntegrationId: string | null = null;

  if (integration) {
    usedIntegrationId = integration.id;
    result = await publishToExternal(integration, blog);
  } else {
    // Hosted fallback — store internally, no external platform needed
    result = {
      success: true,
      message: 'Published on your Virality platform. Connect a blog integration to also publish externally.',
      hosted: true,
    };
  }

  // Persist updated status
  await supabase.from('blogs').update({
    status: result.success ? 'published' : 'failed',
    published_at: result.success ? new Date().toISOString() : null,
    external_id: result.external_id ?? null,
    integration_id: usedIntegrationId,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('company_id', companyId);

  return result;
}

// ─── Internal: publish to external platform ──────────────────────────────────

async function publishToExternal(integration: Integration, blog: Blog): Promise<PublishResult> {
  const { type, config } = integration;
  const timeout = 15_000;

  if (type === 'wordpress') {
    if (!config.site_url || !config.username || !config.app_password) {
      return { success: false, message: 'WordPress integration is missing credentials.' };
    }
    const siteUrl = config.site_url.replace(/\/$/, '');
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    try {
      const res = await fetchWithTimeout(`${siteUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({ title: blog.title, content: blog.content, status: 'publish' }),
      }, timeout);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return {
          success: true,
          message: `Published to WordPress${data?.link ? ': ' + data.link : '.'}`,
          external_id: data?.id ? String(data.id) : undefined,
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'WordPress authentication failed. Check your credentials.' };
      }
      return { success: false, message: `WordPress returned status ${res.status}.` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'WordPress request failed.' };
    }
  }

  if (type === 'custom_blog_api') {
    if (!config.endpoint_url || !config.api_key) {
      return { success: false, message: 'Custom blog API integration is missing credentials.' };
    }
    const authHeader = config.auth_header || 'Authorization';
    try {
      const res = await fetchWithTimeout(config.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [authHeader]: `Bearer ${config.api_key}`,
        },
        body: JSON.stringify({ title: blog.title, content: blog.content }),
      }, timeout);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return {
          success: true,
          message: 'Published to your blog API.',
          external_id: data?.id ? String(data.id) : undefined,
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'API rejected the key. Check your api_key in Integrations.' };
      }
      return { success: false, message: `Blog API returned status ${res.status}.` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Blog API request failed.' };
    }
  }

  return { success: false, message: `Unsupported integration type: ${type}` };
}

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
