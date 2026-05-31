import { ownedDbTable } from '../db/writeOwner';
/**
 * Blog Publishing Service
 * Publish to WordPress, custom blog API, or host internally as fallback.
 * Supports full content_blocks + SEO + category/tag metadata.
 */
import { getIntegration, getActiveIntegration, type Integration } from './integrationService';
import { extractBlogContext } from '../../lib/blog/blockExtractor';
import { createPublishingJob, executePublishingJob } from './publishingJobService';
import { isCmsProvider } from './cms/registry';
import { captureBlogPublishSnapshotSafely } from './publishSnapshotCaptureService';

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
  content_type?:        string | null;
  status:               BlogStatus;
  integration_id:       string | null;
  external_id:          string | null;
  external_url?:        string | null;
  published_at:         string | null;
  created_at:           string;
  updated_at:           string;
  angle_type:           string | null;
  hook_strength?:       string | null;
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
  content_type?:        string | null;
  status?:              BlogStatus;
  published_at?:        string | null;
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
  content_type?:        string | null;
  published_at?:        string | null;
}

export interface PublishResult {
  success:      boolean;
  message:      string;
  external_id?: string;
  external_url?: string;
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

function legacyBlocksToHtml(blocks: unknown[]): string {
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
      case 'creator_asset': {
        // P1-A — publishAllVariants honors the operator's "Publish all"
        // toggle on CreatorAssetBlock. When the flag is true AND the
        // block carries `variants[]`, iterate every successfully-
        // generated variant and emit one figure each. When the flag is
        // false / absent OR variants[] missing, fall back to the legacy
        // single-asset render using the block's mirrored top-level
        // fields (which point at `selectedVariantId`).
        const title = typeof b['title'] === 'string' ? b['title'] : '';
        const caption = typeof b['caption'] === 'string' ? b['caption'] : '';
        const variants = Array.isArray(b['variants']) ? b['variants'] as Array<Record<string, unknown>> : null;
        const publishAll = b['publishAllVariants'] === true;
        if (publishAll && variants && variants.length > 0) {
          // Multi-variant publish: one <figure> per generated variant.
          // Variants in `'generated'` state with a `url` are emitted;
          // failed / pending variants are skipped.
          for (const v of variants) {
            if (!v || typeof v !== 'object') continue;
            const state = typeof v['state'] === 'string' ? v['state'] : 'generated';
            if (state !== 'generated') continue;
            const variantUrl = typeof v['url'] === 'string' ? v['url'] : '';
            if (!variantUrl) continue;
            const variantFamily = typeof v['variant_family'] === 'string' ? v['variant_family'] : '';
            const variantCaption = typeof v['caption'] === 'string' ? v['caption'] : caption;
            const altText = title || caption || variantFamily.toUpperCase() || 'Creator asset';
            const figureCaption = variantCaption || (variantFamily ? `Variant ${variantFamily.toUpperCase()}` : '');
            parts.push(figureCaption
              ? `<figure><img src="${variantUrl}" alt="${altText}" /><figcaption>${figureCaption}</figcaption></figure>`
              : `<img src="${variantUrl}" alt="${altText}" />`);
          }
        } else {
          // Single-variant publish (legacy behavior). Mirrors the
          // block's `url` (which already points at `selectedVariantId`'s
          // asset when variants exist; otherwise the original single
          // asset).
          const url = typeof b['url'] === 'string' ? b['url'] : '';
          if (url) {
            const altText = title || caption || 'Creator asset';
            parts.push(caption
              ? `<figure><img src="${url}" alt="${altText}" /><figcaption>${caption}</figcaption></figure>`
              : `<img src="${url}" alt="${altText}" />`);
          }
        }
        break;
      }
    }
  }

  return parts.join('\n');
}

void legacyBlocksToHtml;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBlocks(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const wpStyles = {
  article: 'font-family:Inter,Arial,sans-serif;color:#3D4F61;line-height:1.75;font-size:17px;max-width:760px;margin:0 auto;',
  h2: 'font-size:30px;line-height:1.22;color:#0B1F33;font-weight:750;margin:48px 0 18px;border-bottom:1px solid #E5E7EB;padding-bottom:12px;',
  h3: 'font-size:23px;line-height:1.3;color:#0B1F33;font-weight:700;margin:34px 0 14px;',
  paragraphWrap: 'margin:0 0 22px;color:#3D4F61;line-height:1.75;',
  panel: 'margin:32px 0;border:1px solid #DBEAFE;background:#F5F9FF;border-radius:16px;padding:22px;',
  panelTitle: 'margin:0 0 12px;color:#0A66C2;font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:750;',
  callout: 'margin:32px 0;border-left:4px solid #0A66C2;background:#F5F9FF;border-radius:0 14px 14px 0;padding:18px 22px;',
  quote: 'margin:32px 0;border-left:4px solid #0A66C2;background:#F5F9FF;border-radius:0 14px 14px 0;padding:18px 22px;color:#3D4F61;',
  figure: 'margin:34px 0;',
  image: 'display:block;width:100%;height:auto;border-radius:16px;box-shadow:0 12px 28px rgba(15,23,42,.12);',
  caption: 'margin-top:10px;text-align:center;color:#6B7C93;font-size:14px;font-style:italic;',
  assetFrame: 'margin:0 0 18px;padding:12px;border:1px solid #EDE9FE;background:#FAF5FF;border-radius:16px;',
  assetLabel: 'margin:0 0 8px;color:#6D28D9;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:750;',
  linkCard: 'display:block;margin:30px 0;border:1px solid #DBEAFE;background:#F8FBFF;border-radius:16px;padding:18px;text-decoration:none;color:#0B1F33;',
};

function styled(tag: string, style: string, body: string, attrs = ''): string {
  return `<${tag}${attrs} style="${escapeAttribute(style)}">${body}</${tag}>`;
}

function styleParagraphHtml(html: string): string {
  if (!html) return '';
  return `<div style="${escapeAttribute(wpStyles.paragraphWrap)}">${html}</div>`;
}

function renderListItems(items: unknown[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const rendered = items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const text = readString(item, 'text');
      const children = renderListItems(readBlocks(item.children), ordered);
      if (!text && !children) return '';
      return `<li style="margin:8px 0;color:#3D4F61;line-height:1.65;">${text || ''}${children}</li>`;
    })
    .filter(Boolean)
    .join('');
  return rendered ? `<${tag} style="margin:18px 0 24px;padding-left:26px;">${rendered}</${tag}>` : '';
}

function renderCreatorAsset(block: Record<string, unknown>): string {
  const title = readString(block, 'title') || 'Creator asset';
  const caption = readString(block, 'caption');
  const files = readBlocks(block.files)
    .map((file) => typeof file === 'string' ? file.trim() : '')
    .filter(Boolean);
  const primaryUrl = readString(block, 'url');
  const variants = readBlocks(block.variants)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  const publishAll = block.publishAllVariants === true;
  const selectedVariantId = readString(block, 'selectedVariantId');
  const selectedVariantFiles = !publishAll && selectedVariantId
    ? variants.flatMap((variant) => {
        if (readString(variant, 'variant_id') !== selectedVariantId) return [];
        const variantUrl = readString(variant, 'url');
        const variantFileUrls = readBlocks(variant.files)
          .map((file) => typeof file === 'string' ? file.trim() : '')
          .filter(Boolean);
        return variantFileUrls.length > 0 ? variantFileUrls : (variantUrl ? [variantUrl] : []);
      })
    : [];
  const variantFiles = publishAll
    ? variants.flatMap((variant) => {
        const state = readString(variant, 'state') || 'generated';
        if (state !== 'generated') return [];
        const variantUrl = readString(variant, 'url');
        const variantFileUrls = readBlocks(variant.files)
          .map((file) => typeof file === 'string' ? file.trim() : '')
          .filter(Boolean);
        return variantFileUrls.length > 0 ? variantFileUrls : (variantUrl ? [variantUrl] : []);
      })
    : [];
  const urls = [...variantFiles, ...selectedVariantFiles, ...(files.length > 0 ? files : primaryUrl ? [primaryUrl] : [])]
    .filter((url, index, all) => all.indexOf(url) === index);
  if (urls.length === 0) return '';
  const images = urls.map((url, index) =>
    `<div style="${escapeAttribute(wpStyles.assetFrame)}">${urls.length > 1 ? `<p style="${escapeAttribute(wpStyles.assetLabel)}">Asset ${index + 1} of ${urls.length}</p>` : ''}<img src="${escapeAttribute(url)}" alt="${escapeAttribute(urls.length > 1 ? `${title} ${index + 1}` : title)}" style="${escapeAttribute(wpStyles.image)}" /></div>`,
  ).join('\n');
  return caption
    ? `<figure style="${escapeAttribute(wpStyles.figure)}">${images}<figcaption style="${escapeAttribute(wpStyles.caption)}">${escapeHtml(caption)}</figcaption></figure>`
    : `<figure style="${escapeAttribute(wpStyles.figure)}">${images}</figure>`;
}

function blockToHtml(block: unknown): string {
  if (!block || typeof block !== 'object') return '';
  const b = block as Record<string, unknown>;
  const type = readString(b, 'type');

  switch (type) {
    case 'heading': {
      const rawLevel = typeof b.level === 'number' ? b.level : 2;
      const level = rawLevel === 3 ? 3 : 2;
      const text = readString(b, 'text');
      const anchor = readString(b, 'anchor');
      return text
        ? styled(`h${level}`, level === 2 ? wpStyles.h2 : wpStyles.h3, escapeHtml(text), anchor ? ` id="${escapeAttribute(anchor)}"` : '')
        : '';
    }
    case 'paragraph':
    case 'text': {
      const html = readString(b, 'html');
      const text = readString(b, 'text');
      if (html) return styleParagraphHtml(html);
      return text ? styled('p', wpStyles.paragraphWrap, escapeHtml(text)) : '';
    }
    case 'summary': {
      const body = readString(b, 'body');
      return body
        ? `<section class="omnivera-summary" style="${escapeAttribute(wpStyles.panel)}">${styled('p', wpStyles.panelTitle, 'Summary')}${styled('p', wpStyles.paragraphWrap, `<strong>${escapeHtml(body)}</strong>`)}</section>`
        : '';
    }
    case 'key_insights': {
      const title = readString(b, 'title') || 'Key Insights';
      const items = readBlocks(b.items)
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
      return items.length > 0
        ? `<section class="omnivera-key-insights" style="${escapeAttribute(wpStyles.panel)}">${styled('h3', wpStyles.panelTitle, escapeHtml(title))}<ol style="margin:0;padding-left:22px;">${items.map((item) => `<li style="margin:8px 0;line-height:1.6;">${escapeHtml(item)}</li>`).join('')}</ol></section>`
        : '';
    }
    case 'callout': {
      const title = readString(b, 'title');
      const body = readString(b, 'body');
      if (!title && !body) return '';
      return `<aside class="omnivera-callout" style="${escapeAttribute(wpStyles.callout)}">${title ? styled('h3', wpStyles.panelTitle, escapeHtml(title)) : ''}${body ? styled('p', wpStyles.paragraphWrap, escapeHtml(body)) : ''}</aside>`;
    }
    case 'quote': {
      const text = readString(b, 'text');
      const author = readString(b, 'author');
      const source = readString(b, 'source');
      return text
        ? `<blockquote style="${escapeAttribute(wpStyles.quote)}">${styled('p', 'margin:0 0 10px;font-size:18px;line-height:1.65;font-style:italic;', escapeHtml(text))}${author || source ? `<footer style="color:#6B7C93;font-size:14px;">${escapeHtml([author, source].filter(Boolean).join(' - '))}</footer>` : ''}</blockquote>`
        : '';
    }
    case 'list':
      return renderListItems(readBlocks(b.items), readString(b, 'listType') === 'numbered');
    case 'image': {
      const url = readString(b, 'url') || readString(b, 'src');
      const alt = readString(b, 'alt');
      const caption = readString(b, 'caption');
      if (!url) return '';
      return caption
        ? `<figure style="${escapeAttribute(wpStyles.figure)}"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" style="${escapeAttribute(wpStyles.image)}" /><figcaption style="${escapeAttribute(wpStyles.caption)}">${escapeHtml(caption)}</figcaption></figure>`
        : `<figure style="${escapeAttribute(wpStyles.figure)}"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" style="${escapeAttribute(wpStyles.image)}" /></figure>`;
    }
    case 'media': {
      const url = readString(b, 'url');
      const title = readString(b, 'title') || url;
      const description = readString(b, 'description');
      return url
        ? `<p style="${escapeAttribute(wpStyles.linkCard)}"><a href="${escapeAttribute(url)}" style="color:#0A66C2;font-weight:700;">${escapeHtml(title)}</a>${description ? `<br />${escapeHtml(description)}` : ''}</p>`
        : '';
    }
    case 'divider':
      return '<hr style="margin:36px 0;border:0;border-top:1px solid #E5E7EB;" />';
    case 'references': {
      const items = readBlocks(b.items)
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => {
          const title = readString(item, 'title');
          const url = readString(item, 'url');
          if (!title && !url) return '';
          return url
            ? `<li><a href="${escapeAttribute(url)}">${escapeHtml(title || url)}</a></li>`
            : `<li>${escapeHtml(title)}</li>`;
        })
        .filter(Boolean)
        .join('');
      return items ? `<section class="omnivera-references" style="${escapeAttribute(wpStyles.panel)}">${styled('h3', wpStyles.panelTitle, 'References')}<ol style="margin:0;padding-left:22px;">${items}</ol></section>` : '';
    }
    case 'internal_link': {
      const slug = readString(b, 'slug');
      const title = readString(b, 'title') || slug;
      const excerpt = readString(b, 'excerpt');
      return slug
        ? `<a href="/blog/${escapeAttribute(slug)}" style="${escapeAttribute(wpStyles.linkCard)}"><strong>${escapeHtml(title)}</strong>${excerpt ? `<br />${escapeHtml(excerpt)}` : ''}</a>`
        : '';
    }
    case 'columns': {
      const columns = readBlocks(b.columns)
        .filter((column): column is Record<string, unknown> => !!column && typeof column === 'object')
        .map((column) => readBlocks(column.blocks).map(blockToHtml).filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n');
      return columns ? `<div class="omnivera-columns" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin:28px 0;">${columns}</div>` : '';
    }
    case 'creator_asset':
      return renderCreatorAsset(b);
    default: {
      const html = readString(b, 'html');
      const text = readString(b, 'text') || readString(b, 'body');
      if (html) return html;
      return text ? styled('p', wpStyles.paragraphWrap, escapeHtml(text)) : '';
    }
  }
}

function blocksToHtml(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) return '';
  const body = blocks.map(blockToHtml).filter(Boolean).join('\n');
  return body ? `<article class="omnivera-published-blog" style="${escapeAttribute(wpStyles.article)}">${body}</article>` : '';
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
      content_type:         input.content_type         ?? 'blog',
      status:               input.status               ?? 'draft',
      published_at:         input.published_at         ?? null,
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
        const jobType = blog.external_id
          ? 'update_post'
          : blog.scheduled_publish_at
            ? 'schedule_post'
            : 'publish_post';
        const idempotencyKey = blog.external_id
          ? `blog:${blog.id}:update:${integration.id}:${new Date().toISOString().slice(0, 16)}`
          : `blog:${blog.id}:publish:${integration.id}`;
        const job = await createPublishingJob({
          companyId,
          websiteId: blog.website_id ?? integration.website_id ?? null,
          connectionId: integration.website_connection_id ?? null,
          blogId: blog.id,
          provider: integration.type,
          jobType,
          idempotencyKey,
          scheduledFor: blog.scheduled_publish_at ?? null,
          requestPayload: {
            ...(blog.external_id ? { external_id: blog.external_id } : {}),
            html_content: htmlContent,
            title: blog.title,
            slug: blog.slug,
          },
          createdBy: blog.created_by,
        });
        if (job.scheduled_for) {
          result = {
            success: true,
            message: 'Publishing job scheduled. The worker will publish it at the scheduled time.',
            external_id: undefined,
            external_url: undefined,
          };
        } else {
          const execution = await executePublishingJob(job.id, 'blog-publish-api');
          result = {
            success: execution.success,
            message: execution.message,
            external_id: execution.external_id,
            external_url: execution.external_url,
          };
        }
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
    status:         result.success ? (blog.scheduled_publish_at ? 'scheduled' : 'published') : 'failed',
    published_at:   result.success && !blog.scheduled_publish_at ? new Date().toISOString() : null,
    external_id:    result.external_id ?? null,
    external_url:   result.external_url ?? null,
    integration_id: usedIntegrationId,
    updated_at:     new Date().toISOString(),
  }).eq('id', id).eq('company_id', companyId);

  // Non-executing publish-snapshot capture at the scheduling/finalization
  // boundary. Off by default; gated behind PUBLISH_SNAPSHOT_CAPTURE_ENABLED.
  // Best-effort and non-throwing — it never affects the publish result.
  if (process.env.PUBLISH_SNAPSHOT_CAPTURE_ENABLED === 'true' && result.success) {
    await captureBlogPublishSnapshotSafely({
      blog: blog as unknown as Record<string, unknown>,
      renderedHtml: htmlContent,
      integrationType: integration?.type ?? null,
      lifecyclePhase: blog.scheduled_publish_at ? 'scheduling' : 'finalization',
      captureSource: 'blog_publish_lifecycle',
    });
  }

  return result;
}

// ─── Internal: publish to external platform ──────────────────────────────────
