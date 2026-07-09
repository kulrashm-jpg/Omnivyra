import crypto from 'crypto';
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

/**
 * Production Ghost adapter — Ghost Admin API (v5), JWT auth from an Admin API
 * key (`id:hexsecret`). Uses the universal validation pipeline; the canonical
 * API base is deterministic (`${siteUrl}/ghost/api/admin`) so it is persisted
 * via the shared resolver path (no runtime-only path).
 */
export class GhostAdapter extends BaseCmsAdapter {
  readonly provider = 'ghost' as const;

  private base(siteUrl: string): string {
    return `${siteUrl.replace(/\/+$/, '')}/ghost/api/admin`;
  }

  /** Build a short-lived Ghost Admin JWT (HS256, 5-min expiry). */
  private token(adminApiKey: string): string {
    const [id, secret] = String(adminApiKey || '').split(':');
    if (!id || !secret) throw new Error('Ghost admin_api_key must be in "id:secret" form');
    const header = { alg: 'HS256', typ: 'JWT', kid: id };
    const iat = Math.floor(Date.now() / 1000);
    const payload = { iat, exp: iat + 300, aud: '/admin/' };
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${b64(header)}.${b64(payload)}`;
    const sig = crypto
      .createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(data)
      .digest('base64url');
    return `${data}.${sig}`;
  }

  private authHeaders(adminApiKey: string): Record<string, string> {
    return {
      Authorization: `Ghost ${this.token(adminApiKey)}`,
      'Accept-Version': 'v5.0',
    };
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const { site_url, admin_api_key } = context.config;
    if (!site_url || !admin_api_key) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'site_url and admin_api_key are required.' };
    }
    const siteUrl = site_url.replace(/\/+$/, '');
    const base = this.base(siteUrl);
    const timeoutMs = context.timeoutMs ?? 10_000;

    return this.validateViaPipeline(
      context,
      siteUrl,
      async () => {
        try {
          const res = await this.fetchWithTimeout(
            `${base}/site/`,
            { method: 'GET', headers: this.authHeaders(admin_api_key) },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          return {
            ok: res.ok,
            status: res.status,
            body,
            identityLabel: (body as any)?.site?.title,
          };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      base,
    );
  }

  private async resolveBase(context: CmsAdapterContext): Promise<string> {
    const siteUrl = String(context.config.site_url || '').replace(/\/+$/, '');
    // Ghost base is deterministic; the resolver still gives us persisted/
    // cached + degraded tracking for diagnostics parity with WordPress.
    const resolved = await this.canonicalApiBase(context, siteUrl).catch(() => '');
    return resolved && resolved.includes('/ghost/api/admin') ? resolved : this.base(siteUrl);
  }

  async publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsert(context, undefined, input);
  }

  async updatePost(context: CmsAdapterContext, externalId: string, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsert(context, externalId, input);
  }

  async schedulePost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsert(context, undefined, { ...input, status: 'future' });
  }

  async deletePost(context: CmsAdapterContext, externalId: string): Promise<CmsDeleteResult> {
    const { site_url, admin_api_key } = context.config;
    if (!site_url || !admin_api_key) return { success: false, message: 'Ghost integration is missing credentials.' };
    const base = await this.resolveBase(context);
    const res = await this.fetchWithTimeout(
      `${base}/posts/${encodeURIComponent(externalId)}/`,
      { method: 'DELETE', headers: this.authHeaders(admin_api_key) },
      context.timeoutMs ?? 15_000,
    );
    if (res.ok || res.status === 204) return { success: true, message: 'Post deleted from Ghost.' };
    if (res.status === 404) return { success: true, message: 'Post already absent on Ghost.' };
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Ghost authentication failed during delete.' };
    return { success: false, message: `Ghost delete returned status ${res.status}.` };
  }

  private async upsert(
    context: CmsAdapterContext,
    externalId: string | undefined,
    input: CmsPostInput,
  ): Promise<CmsPublishResult> {
    const { site_url, admin_api_key } = context.config;
    if (!site_url || !admin_api_key) {
      return { success: false, message: 'Ghost integration is missing credentials.' };
    }
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };

    const base = await this.resolveBase(context);
    const headers = { ...this.authHeaders(admin_api_key), 'Content-Type': 'application/json' };
    const timeoutMs = context.timeoutMs ?? 15_000;
    const blog = input.blog;

    const feature = await this.resolveFeaturedImage(context, base, admin_api_key, blog.featured_image_url);
    const post: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      html: input.htmlContent,
      status: input.status === 'future' ? 'scheduled' : input.status ?? 'published',
      tags: (blog.tags ?? []).filter(Boolean).map((t) => ({ name: t })),
      custom_excerpt: blog.excerpt ?? blog.seo_meta_description ?? undefined,
      slug: blog.slug ?? undefined,
      meta_title: blog.seo_meta_title ?? undefined,
      meta_description: blog.seo_meta_description ?? undefined,
    };
    if (blog.category) post.tags = [{ name: blog.category }, ...(post.tags as any[])];
    if (feature) post.feature_image = feature;
    if (context.config.author_email) post.authors = [{ email: context.config.author_email }];
    if (input.status === 'future' && input.scheduledFor) post.published_at = input.scheduledFor;

    let res: Response;
    if (externalId) {
      // Ghost requires the current updated_at as an optimistic-lock token.
      const cur = await this.fetchWithTimeout(`${base}/posts/${externalId}/`, { headers }, timeoutMs);
      const curBody = await cur.json().catch(() => null);
      const updatedAt = (curBody as any)?.posts?.[0]?.updated_at;
      if (updatedAt) post.updated_at = updatedAt;
      res = await this.fetchWithTimeout(
        `${base}/posts/${externalId}/?source=html`,
        { method: 'PUT', headers, body: JSON.stringify({ posts: [post] }) },
        timeoutMs,
      );
    } else {
      res = await this.fetchWithTimeout(
        `${base}/posts/?source=html`,
        { method: 'POST', headers, body: JSON.stringify({ posts: [post] }) },
        timeoutMs,
      );
    }

    const data = await res.json().catch(() => null);
    if (res.ok) {
      const created = (data as any)?.posts?.[0];
      return {
        success: true,
        message: `Published to Ghost${created?.url ? ': ' + created.url : '.'}`,
        externalId: created?.id ? String(created.id) : undefined,
        externalUrl: created?.url,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Ghost authentication failed. Check the Admin API key.', providerResponse: data };
    }
    return { success: false, message: `Ghost returned status ${res.status}.`, providerResponse: data };
  }

  async uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    const { site_url, admin_api_key } = context.config;
    if (!site_url || !admin_api_key) return { providerResponse: { error: 'missing_credentials' } };
    const base = await this.resolveBase(context);
    try {
      const form = new FormData();
      const bytes = input.body instanceof Buffer ? input.body : Buffer.from(input.body as ArrayBuffer);
      form.append('file', new Blob([new Uint8Array(bytes)], { type: input.contentType }), input.filename);
      form.append('purpose', 'image');
      const res = await this.fetchWithTimeout(
        `${base}/images/upload/`,
        { method: 'POST', headers: this.authHeaders(admin_api_key), body: form as any },
        context.timeoutMs ?? 30_000,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) return { providerResponse: data ?? { status: res.status } };
      const url = (data as any)?.images?.[0]?.url;
      return { url, providerResponse: data };
    } catch (err) {
      return { providerResponse: { error: String(err) } };
    }
  }

  private async resolveFeaturedImage(
    context: CmsAdapterContext,
    base: string,
    adminApiKey: string,
    sourceUrl: string | null | undefined,
  ): Promise<string | null> {
    if (!sourceUrl) return null;
    // HARDEN-005: sourceUrl is user/generated media — SSRF-safe download.
    const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
    const src = await safeFetch(sourceUrl, { method: 'GET' }).catch(() => null);
    if (!src?.ok) return sourceUrl; // Ghost can ingest a remote URL directly
    const contentType = src.headers.get('content-type') || 'image/jpeg';
    const bytes = await readCapped(src);
    const uploaded = await this.uploadMedia(context, {
      filename: `featured.${contentType.includes('png') ? 'png' : 'jpg'}`,
      contentType,
      body: bytes,
    });
    return uploaded.url ?? sourceUrl;
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const { site_url, admin_api_key } = context.config;
    if (!site_url || !admin_api_key) return [];
    const base = await this.resolveBase(context);
    const res = await this.fetchWithTimeout(
      `${base}/tags/?limit=all`,
      { headers: this.authHeaders(admin_api_key) },
      context.timeoutMs ?? 10_000,
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const tags = (data as any)?.tags;
    return Array.isArray(tags)
      ? tags.map((t: any) => ({ id: String(t.id), name: String(t.name), slug: t.slug }))
      : [];
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    // Ghost has no separate category taxonomy — tags double as categories.
    return this.getTags(context);
  }
}
