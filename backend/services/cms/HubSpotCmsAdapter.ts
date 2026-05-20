import { BaseCmsAdapter } from './BaseCmsAdapter';
import type {
  CmsAdapterContext,
  CmsDeleteResult,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

const HUBSPOT_API = 'https://api.hubapi.com';

/**
 * HubSpot CMS adapter — REAL Blog Posts API (cms/v3/blogs/posts).
 * Auth: Bearer access token stored in integration_credentials (`access_token`).
 * The token may be a private-app token or an OAuth access token; refresh is
 * handled by the existing oauthRefreshService when HUBSPOT_CLIENT_ID/SECRET
 * are configured. This adapter does NOT mint tokens; it consumes whatever is
 * already encrypted-at-rest for the connection.
 *
 * Honest gate: if no `access_token` is present, validate fails with
 * MISSING_CREDENTIALS — the adapter never fabricates auth.
 */
export class HubSpotCmsAdapter extends BaseCmsAdapter {
  readonly provider = 'hubspot' as const;

  private token(config: Record<string, string>): string {
    return config.access_token || config.api_token || '';
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const token = this.token(context.config);
    if (!token) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'HubSpot access_token (private-app token or OAuth) is required.' };
    }
    const timeoutMs = context.timeoutMs ?? 10_000;
    return this.validateViaPipeline(
      context,
      HUBSPOT_API,
      async () => {
        try {
          // Cheapest auth probe: list one blog post (or 0 if none).
          const res = await this.fetchWithTimeout(
            `${HUBSPOT_API}/cms/v3/blogs/posts?limit=1`,
            { headers: this.headers(token) },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          return { ok: res.ok, status: res.status, body, identityLabel: 'HubSpot CMS' };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      HUBSPOT_API,
    );
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
    const token = this.token(context.config);
    if (!token) return { success: false, message: 'HubSpot integration is missing an access token.' };
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };

    const blogId = context.config.blog_id;
    if (!blogId) {
      return {
        success: false,
        message:
          'HubSpot publishing requires a target blog. Set "blog_id" on the integration (use the Blog ID from HubSpot → Marketing → Website → Blog).',
      };
    }

    const blog = input.blog;
    const body: Record<string, unknown> = {
      contentGroupId: blogId,
      name: blog.seo_meta_title || blog.title,
      postBody: input.htmlContent,
      slug: blog.slug ?? undefined,
      metaDescription: blog.seo_meta_description ?? blog.excerpt ?? undefined,
      state: input.status === 'draft' || input.status === 'future' ? 'DRAFT' : 'PUBLISHED',
    };
    if (input.status === 'future' && input.scheduledFor) body.publishDate = input.scheduledFor;

    const url = externalId
      ? `${HUBSPOT_API}/cms/v3/blogs/posts/${encodeURIComponent(externalId)}`
      : `${HUBSPOT_API}/cms/v3/blogs/posts`;

    const res = await this.fetchWithTimeout(
      url,
      { method: externalId ? 'PATCH' : 'POST', headers: this.headers(token), body: JSON.stringify(body) },
      context.timeoutMs ?? 15_000,
    );
    const data = await res.json().catch(() => null);

    if (res.ok) {
      const id = (data as any)?.id;
      const externalUrl = (data as any)?.url;
      return {
        success: true,
        message: `Published to HubSpot${externalUrl ? ': ' + externalUrl : '.'}`,
        externalId: id ? String(id) : undefined,
        externalUrl,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'HubSpot authentication failed. Verify the token & scopes (content).', providerResponse: data };
    }
    return { success: false, message: `HubSpot returned status ${res.status}.`, providerResponse: data };
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const token = this.token(context.config);
    if (!token) return [];
    try {
      const res = await this.fetchWithTimeout(
        `${HUBSPOT_API}/cms/v3/blogs/tags?limit=100`,
        { headers: this.headers(token) },
        context.timeoutMs ?? 10_000,
      );
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const results = (data as any)?.results;
      return Array.isArray(results)
        ? results.map((t: any) => ({ id: String(t.id), name: String(t.name ?? ''), slug: t.slug }))
        : [];
    } catch { return []; }
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getCategories(context);
  }

  async deletePost(context: CmsAdapterContext, externalId: string): Promise<CmsDeleteResult> {
    const token = this.token(context.config);
    if (!token) return { success: false, message: 'HubSpot integration is missing an access token.' };
    const res = await this.fetchWithTimeout(
      `${HUBSPOT_API}/cms/v3/blogs/posts/${encodeURIComponent(externalId)}`,
      { method: 'DELETE', headers: this.headers(token) },
      context.timeoutMs ?? 15_000,
    );
    if (res.ok || res.status === 204) return { success: true, message: 'Post deleted from HubSpot.' };
    if (res.status === 404) return { success: true, message: 'Post already absent on HubSpot.' };
    if (res.status === 401 || res.status === 403) return { success: false, message: 'HubSpot authentication failed during delete.' };
    return { success: false, message: `HubSpot delete returned status ${res.status}.` };
  }

  async uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    const token = this.token(context.config);
    if (!token) return { providerResponse: { error: 'missing_credentials' } };
    try {
      const bytes = input.body instanceof Buffer ? input.body : Buffer.from(input.body as ArrayBuffer);
      // HubSpot Files v3 multipart upload.
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: input.contentType }), input.filename);
      form.append('folderPath', context.config.hubspot_folder || '/blog-media');
      form.append('options', JSON.stringify({
        access: 'PUBLIC_INDEXABLE',
        overwrite: false,
        duplicateValidationStrategy: 'NONE',
        duplicateValidationScope: 'EXACT_FOLDER',
      }));
      const res = await this.fetchWithTimeout(
        `${HUBSPOT_API}/files/v3/files`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form as any },
        context.timeoutMs ?? 30_000,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) return { providerResponse: data ?? { status: res.status } };
      const file = data as any;
      return { id: file?.id ? String(file.id) : undefined, url: file?.url, providerResponse: data };
    } catch (err) {
      return { providerResponse: { error: String(err) } };
    }
  }
}
