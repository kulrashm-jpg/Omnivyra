import { BaseCmsAdapter } from './BaseCmsAdapter';
import type {
  CmsAdapterContext,
  CmsHealthResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

const API_VERSION = '2024-01';

/**
 * Shopify Blog operational FOUNDATION — Admin REST API, access-token auth.
 * Validation, shop identity and blog discovery are production-ready and flow
 * through the universal pipeline + canonical-base abstraction. Article
 * publishing is implemented (auto-selects the first blog when `blog_id` is
 * unset).
 */
export class ShopifyAdapter extends BaseCmsAdapter {
  readonly provider = 'shopify' as const;

  private shop(config: Record<string, string>): string {
    const raw = String(config.shop_domain || config.site_url || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
    if (!raw) return '';
    return raw.includes('.myshopify.com') ? raw : `${raw}.myshopify.com`;
  }

  private base(config: Record<string, string>): string {
    return `https://${this.shop(config)}/admin/api/${API_VERSION}`;
  }

  private token(config: Record<string, string>): string {
    return config.shopify_access_token || config.access_token || config.api_token || '';
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const shop = this.shop(context.config);
    const token = this.token(context.config);
    if (!shop || !token) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'shop_domain and a Shopify access token are required.' };
    }
    const base = this.base(context.config);
    const timeoutMs = context.timeoutMs ?? 10_000;

    return this.validateViaPipeline(
      context,
      `https://${shop}`,
      async () => {
        try {
          const res = await this.fetchWithTimeout(
            `${base}/shop.json`,
            { headers: { 'X-Shopify-Access-Token': token } },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          let discovery: unknown = body;
          if (res.ok) {
            const blogs = await this.fetchWithTimeout(
              `${base}/blogs.json`,
              { headers: { 'X-Shopify-Access-Token': token } },
              timeoutMs,
            );
            discovery = {
              shop: (body as any)?.shop?.myshopify_domain ?? shop,
              blogs: (await blogs.json().catch(() => null) as any)?.blogs ?? [],
            };
          }
          return {
            ok: res.ok,
            status: res.status,
            body: discovery,
            identityLabel: (body as any)?.shop?.name ?? shop,
          };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      base,
    );
  }

  private async resolveBlogId(context: CmsAdapterContext, base: string, token: string): Promise<string | null> {
    if (context.config.blog_id) return context.config.blog_id;
    try {
      const res = await this.fetchWithTimeout(
        `${base}/blogs.json`,
        { headers: { 'X-Shopify-Access-Token': token } },
        context.timeoutMs ?? 10_000,
      );
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const first = (data as any)?.blogs?.[0]?.id;
      return first ? String(first) : null;
    } catch {
      return null;
    }
  }

  async publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsert(context, undefined, input);
  }

  async updatePost(context: CmsAdapterContext, externalId: string, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsert(context, externalId, input);
  }

  private async upsert(
    context: CmsAdapterContext,
    externalId: string | undefined,
    input: CmsPostInput,
  ): Promise<CmsPublishResult> {
    const shop = this.shop(context.config);
    const token = this.token(context.config);
    if (!shop || !token) return { success: false, message: 'Shopify integration is missing credentials.' };
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };

    const base = this.base(context.config);
    const blogId = await this.resolveBlogId(context, base, token);
    if (!blogId) {
      return { success: false, message: 'No Shopify blog found. Set "blog_id" on the integration (run validate to discover blogs).' };
    }

    const blog = input.blog;
    const article: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      body_html: input.htmlContent,
      published: input.status !== 'draft' && input.status !== 'future',
      tags: (blog.tags ?? []).join(', '),
      handle: blog.slug ?? undefined,
      summary_html: blog.excerpt ?? undefined,
    };
    if (input.status === 'future' && input.scheduledFor) article.published_at = input.scheduledFor;

    const url = externalId
      ? `${base}/blogs/${blogId}/articles/${externalId}.json`
      : `${base}/blogs/${blogId}/articles.json`;
    const res = await this.fetchWithTimeout(
      url,
      {
        method: externalId ? 'PUT' : 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ article }),
      },
      context.timeoutMs ?? 15_000,
    );
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const created = (data as any)?.article;
      return {
        success: true,
        message: 'Published to Shopify blog.',
        externalId: created?.id ? String(created.id) : undefined,
        externalUrl: created?.handle ? `https://${shop}/blogs/${blogId}/${created.handle}` : undefined,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Shopify authentication failed. Check the access token & scopes (write_content).', providerResponse: data };
    }
    return { success: false, message: `Shopify returned status ${res.status}.`, providerResponse: data };
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const token = this.token(context.config);
    if (!this.shop(context.config) || !token) return [];
    const res = await this.fetchWithTimeout(
      `${this.base(context.config)}/blogs.json`,
      { headers: { 'X-Shopify-Access-Token': token } },
      context.timeoutMs ?? 10_000,
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const blogs = (data as any)?.blogs;
    return Array.isArray(blogs)
      ? blogs.map((b: any) => ({ id: String(b.id), name: String(b.title), slug: b.handle }))
      : [];
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getCategories(context);
  }
}
