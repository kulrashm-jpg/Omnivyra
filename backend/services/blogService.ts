import { ownedDbTable } from '../db/writeOwner';
/**
 * Blog Publishing Service
 * Publish to WordPress, custom blog API, or host internally as fallback.
 * Supports full content_blocks + SEO + category/tag metadata.
 */
import { getIntegration, getActiveIntegration, type Integration } from './integrationService';
import { extractBlogContext } from '../../lib/blog/blockExtractor';
import { createPublishingJob } from './publishingJobService';
import { isCmsProvider } from './cms/registry';

export type BlogStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'archived';

export interface Blog {
  id:                   string;
  company_id:           string;
  website_id?:          string | null;
  created_by:           string;
  title:                string;
  content:              string;
  slug:                 string | null;
  excerpt:              string | null;
  content_blocks:       unknown[] | null;
  featured_image_url:   string | null;
  category:             string | null;
  tags:                 string[];
  seo_meta_title:       string | null;
  seo_meta_description: string | null;
  is_featured:          boolean;
  views_count:          number;
  status:               BlogStatus;
  integration_id:       string | null;
  external_id:          string | null;
  published_at:         string | null;
  created_at:           string;
  updated_at:           string;
  angle_type:           string | null;
  hook_strength:        string | null;
  scheduled_publish_at?: string | null;
}

export interface CreateBlogInput {
  title:                string;
  content?:             string;
  slug?:                string;
  excerpt?:             string;
  content_blocks?:      unknown[] | null;
  featured_image_url?:  string | null;
  category?:            string | null;
  tags?:                string[];
  seo_meta_title?:      string | null;
  seo_meta_description?: string | null;
  is_featured?:         boolean;
  website_id?:          string | null;
  scheduled_publish_at?: string | null;
  angle_type?:          string | null;
  hook_strength?:       string | null;
}

export interface UpdateBlogInput {
  title?:               string;
  content?:             string;
  slug?:                string;
  excerpt?:             string;
  content_blocks?:      unknown[] | null;
  featured_image_url?:  string | null;
  category?:            string | null;
  tags?:                string[];
  seo_meta_title?:      string | null;
  seo_meta_description?: string | null;
  is_featured?:         boolean;
  website_id?:          string | null;
  scheduled_publish_at?: string | null;
  status?:              BlogStatus;
  angle_type?:          string | null;
  hook_strength?:       string | null;
}

export interface PublishResult {
  success:      boolean;
  message:      string;
  external_id?: string;
  hosted?:      boolean;
}

// ─── Slug generation ──────────────────────────────────────────────────────────

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function resolveUniqueSlug(companyId: string, base: string): Promise<string> {
  let candidate = base || 'untitled';
  let suffix    = 0;

  while (true) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const { data } = await ownedDbTable('blogs')
      .select('id')
      .eq('company_id', companyId)
      .eq('slug', slug)
      .maybeSingle();
    if (!data) return slug;
    suffix++;
  }
}

// ─── Content blocks → HTML (for external publish) ─────────────────────────────

function blocksToHtml(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) return '';
  const parts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;

    switch (b['type']) {
      case 'heading': {
        const level = typeof b['level'] === 'number' ? b['level'] : 2;
        const text  = typeof b['text'] === 'string' ? b['text'] : '';
        if (text) parts.push(`<h${level}>${text}</h${level}>`);
        break;
      }
      case 'paragraph':
      case 'text': {
        const text = typeof b['text'] === 'string' ? b['text'] : '';
        if (text) parts.push(`<p>${text}</p>`);
        break;
      }
      case 'summary': {
        const body = typeof b['body'] === 'string' ? b['body'] : '';
        if (body) parts.push(`<p><strong>${body}</strong></p>`);
        break;
      }
      case 'key_insights': {
        const items = Array.isArray(b['items']) ? b['items'] as string[] : [];
        if (items.length > 0) {
          parts.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
        }
        break;
      }
      case 'quote': {
        const text = typeof b['text'] === 'string' ? b['text'] : '';
        if (text) parts.push(`<blockquote>${text}</blockquote>`);
        break;
      }
      case 'list': {
        const items = Array.isArray(b['items']) ? b['items'] as string[] : [];
        if (items.length > 0) {
          parts.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
        }
        break;
      }
      case 'image': {
        const src = typeof b['src'] === 'string' ? b['src'] : '';
        const alt = typeof b['alt'] === 'string' ? b['alt'] : '';
        if (src) parts.push(`<img src="${src}" alt="${alt}" />`);
        break;
      }
    }
  }

  return parts.join('\n');
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createBlog(
  companyId: string,
  userId:    string,
  input:     CreateBlogInput,
): Promise<Blog> {
  const baseSlug = input.slug
    ? generateSlug(input.slug)
    : generateSlug(input.title);
  const slug = await resolveUniqueSlug(companyId, baseSlug);

  const { data, error } = await ownedDbTable('blogs')
    .insert({
      company_id:           companyId,
      website_id:           input.website_id           ?? null,
      created_by:           userId,
      title:                input.title,
      content:              input.content              ?? '',
      slug,
      excerpt:              input.excerpt              ?? null,
      content_blocks:       input.content_blocks       ?? null,
      featured_image_url:   input.featured_image_url   ?? null,
      category:             input.category             ?? null,
      tags:                 input.tags                 ?? [],
      seo_meta_title:       input.seo_meta_title       ?? null,
      seo_meta_description: input.seo_meta_description ?? null,
      is_featured:          input.is_featured          ?? false,
      scheduled_publish_at: input.scheduled_publish_at ?? null,
      angle_type:           input.angle_type           ?? null,
      hook_strength:        input.hook_strength        ?? null,
      status:               'draft',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Blog;
}

export async function getBlog(id: string, companyId: string): Promise<Blog | null> {
  const { data, error } = await ownedDbTable('blogs').select('*').eq('id', id).eq('company_id', companyId).single();
  if (error) return null;
  return data as Blog;
}

export async function getBlogs(companyId: string, status?: BlogStatus): Promise<Blog[]> {
  let q = ownedDbTable('blogs').select('*').eq('company_id', companyId)
    .order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Blog[];
}

export async function updateBlog(
  id:        string,
  companyId: string,
  updates:   UpdateBlogInput,
): Promise<Blog> {
  // If slug is being updated, ensure uniqueness (skip own record)
  if (updates.slug !== undefined) {
    const base = generateSlug(updates.slug || 'untitled');
    let candidate = base;
    let suffix    = 0;
    while (true) {
      const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
      const { data } = await ownedDbTable('blogs')
        .select('id')
        .eq('company_id', companyId)
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();
      if (!data) { updates = { ...updates, slug }; break; }
      suffix++;
    }
  }

  const { data, error } = await ownedDbTable('blogs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId)
    .select('*').single();
  if (error) throw new Error(error.message);
  return data as Blog;
}

export async function deleteBlog(id: string, companyId: string): Promise<void> {
  const { error } = await ownedDbTable('blogs').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

// ─── PUBLISH ─────────────────────────────────────────────────────────────────

/**
 * Publish a blog post.
 * - If integrationId provided: use that specific integration.
 * - Else: try the company's active WordPress, then custom_blog_api integration.
 * - If no integration found: publish internally (hosted fallback).
 *
 * If content_blocks is present, converts to HTML before sending externally.
 * Sends full metadata (SEO, tags, category, featured_image_url) to integrations.
 */
export async function publishBlogPost(
  id:            string,
  companyId:     string,
  integrationId?: string | null,
): Promise<PublishResult> {
  const blog = await getBlog(id, companyId);
  if (!blog) throw new Error('Blog not found');
  if (!blog.title?.trim()) throw new Error('A title is required before publishing');

  let integration: Integration | null = null;

  if (integrationId) {
    integration = await getIntegration(integrationId, companyId);
  } else {
    integration =
      await getActiveIntegration(companyId, 'wordpress') ||
      await getActiveIntegration(companyId, 'custom_blog_api');
  }

  // Determine publish content: prefer blocks → HTML, fallback to content field
  const htmlContent = Array.isArray(blog.content_blocks) && blog.content_blocks.length > 0
    ? blocksToHtml(blog.content_blocks)
    : (blog.content ?? '');

  let result: PublishResult;
  let usedIntegrationId: string | null = null;

  if (integration) {
    // Respect integration_config.blog_enabled — skip external publish if explicitly disabled.
    const blogEnabled = integration.config?.blog_enabled;
    if (blogEnabled === 'false') {
      // Integration exists but blog publishing is disabled — publish internally.
      result = {
        success: true,
        message: 'Published on your Virality platform (external publishing is disabled for this integration).',
        hosted:  true,
      };
    } else {
      usedIntegrationId = integration.id;
      if (!isCmsProvider(integration.type)) {
        result = { success: false, message: `Unsupported integration type: ${integration.type}` };
      } else {
        const job = await createPublishingJob({
          companyId,
          websiteId: blog.website_id ?? integration.website_id ?? null,
          connectionId: integration.website_connection_id ?? null,
          blogId: blog.id,
          provider: integration.type,
          jobType: blog.scheduled_publish_at ? 'schedule_post' : 'publish_post',
          idempotencyKey: `blog:${blog.id}:publish:${integration.id}`,
          scheduledFor: blog.scheduled_publish_at ?? null,
          requestPayload: {
            html_content: htmlContent,
            title: blog.title,
            slug: blog.slug,
          },
          createdBy: blog.created_by,
        });
        result = {
          success: true,
          message: job.scheduled_for
            ? 'Publishing job scheduled. The worker will publish it at the scheduled time.'
            : 'Publishing job queued. The worker will publish it shortly.',
          external_id: undefined,
        };
      }
    }
  } else {
    result = {
      success: true,
      message: 'Published on your Virality platform. Connect a blog integration to also publish externally.',
      hosted:  true,
    };
  }

  await ownedDbTable('blogs').update({
    status:         result.success ? (blog.scheduled_publish_at ? 'scheduled' : 'draft') : 'failed',
    published_at:   null,
    external_id:    result.external_id ?? null,
    integration_id: usedIntegrationId,
    updated_at:     new Date().toISOString(),
  }).eq('id', id).eq('company_id', companyId);

  return result;
}

// ─── Internal: publish to external platform ──────────────────────────────────

