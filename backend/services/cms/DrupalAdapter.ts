import { BaseCmsAdapter } from './BaseCmsAdapter';
import type {
  CmsAdapterContext,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

const JSONAPI = 'application/vnd.api+json';

/**
 * Production Drupal adapter — JSON:API + bearer token. REST root (`/jsonapi`)
 * is publicly discoverable so it flows through the universal pipeline's
 * rest_root_probe + the canonical API base resolver (subdir/proxy-safe).
 */
export class DrupalAdapter extends BaseCmsAdapter {
  readonly provider = 'drupal' as const;

  private bearer(config: Record<string, string>): string {
    return config.bearer_token || config.api_token || config.access_token || '';
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const { site_url } = context.config;
    const token = this.bearer(context.config);
    if (!site_url || !token) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'site_url and bearer_token are required.' };
    }
    const siteUrl = site_url.replace(/\/+$/, '');
    const timeoutMs = context.timeoutMs ?? 10_000;

    return this.validateViaPipeline(context, siteUrl, async (apiBase) => {
      try {
        const res = await this.fetchWithTimeout(
          `${apiBase}/node/article?page[limit]=1`,
          { headers: { Authorization: `Bearer ${token}`, Accept: JSONAPI } },
          timeoutMs,
        );
        const body = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, body, identityLabel: 'Drupal JSON:API' };
      } catch (err) {
        return { ok: false, status: null, body: { error: String(err) } };
      }
    });
  }

  private async base(context: CmsAdapterContext): Promise<string> {
    const siteUrl = String(context.config.site_url || '').replace(/\/+$/, '');
    const resolved = await this.canonicalApiBase(context, siteUrl).catch(() => '');
    return resolved && /\/jsonapi/.test(resolved) ? resolved : `${siteUrl}/jsonapi`;
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
    const token = this.bearer(context.config);
    if (!context.config.site_url || !token) {
      return { success: false, message: 'Drupal integration is missing credentials.' };
    }
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };

    const base = await this.base(context);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': JSONAPI,
      Accept: JSONAPI,
    };
    const timeoutMs = context.timeoutMs ?? 15_000;
    const blog = input.blog;
    const bundle = context.config.node_bundle || 'article';

    const attributes: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      body: { value: input.htmlContent, format: context.config.text_format || 'full_html' },
      status: input.status === 'future' ? false : input.status !== 'draft',
    };
    if (blog.slug) attributes.path = { alias: `/${blog.slug.replace(/^\/+/, '')}` };

    const tagIds = blog.tags?.length ? await this.ensureTerms(context, base, headers, blog.tags) : [];
    const relationships =
      tagIds.length && context.config.tag_field
        ? {
            [context.config.tag_field]: {
              data: tagIds.map((id) => ({ type: 'taxonomy_term--tags', id })),
            },
          }
        : undefined;

    const payload = {
      data: {
        type: `node--${bundle}`,
        ...(externalId ? { id: externalId } : {}),
        attributes,
        ...(relationships ? { relationships } : {}),
      },
    };

    const url = externalId ? `${base}/node/${bundle}/${externalId}` : `${base}/node/${bundle}`;
    const res = await this.fetchWithTimeout(
      url,
      { method: externalId ? 'PATCH' : 'POST', headers, body: JSON.stringify(payload) },
      timeoutMs,
    );
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const node = (data as any)?.data;
      const link =
        node?.attributes?.path?.alias
          ? `${String(context.config.site_url).replace(/\/+$/, '')}${node.attributes.path.alias}`
          : (data as any)?.data?.links?.self?.href;
      return {
        success: true,
        message: `Published to Drupal${link ? ': ' + link : '.'}`,
        externalId: node?.id ? String(node.id) : undefined,
        externalUrl: link,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Drupal authentication failed. Check the bearer token / permissions.', providerResponse: data };
    }
    return { success: false, message: `Drupal returned status ${res.status}.`, providerResponse: data };
  }

  private async ensureTerms(
    context: CmsAdapterContext,
    base: string,
    headers: Record<string, string>,
    names: string[],
  ): Promise<string[]> {
    const vocab = context.config.tag_vocabulary || 'tags';
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      try {
        const q = `${base}/taxonomy_term/${vocab}?filter[name]=${encodeURIComponent(name)}&page[limit]=1`;
        const found = await this.fetchWithTimeout(q, { headers }, context.timeoutMs ?? 10_000);
        const fb = await found.json().catch(() => null);
        const existing = (fb as any)?.data?.[0]?.id;
        if (existing) {
          ids.push(existing);
          continue;
        }
        const created = await this.fetchWithTimeout(
          `${base}/taxonomy_term/${vocab}`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ data: { type: `taxonomy_term--${vocab}`, attributes: { name } } }),
          },
          context.timeoutMs ?? 10_000,
        );
        const cb = await created.json().catch(() => null);
        if ((cb as any)?.data?.id) ids.push((cb as any).data.id);
      } catch {
        // Term sync is best-effort; publishing proceeds without the tag.
      }
    }
    return ids;
  }

  async uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    const token = this.bearer(context.config);
    if (!context.config.site_url || !token) return { providerResponse: { error: 'missing_credentials' } };
    const base = await this.base(context);
    const bundle = context.config.node_bundle || 'article';
    const field = context.config.image_field || 'field_image';
    try {
      const bytes = input.body instanceof Buffer ? input.body : Buffer.from(input.body as ArrayBuffer);
      const res = await this.fetchWithTimeout(
        `${base}/node/${bundle}/${field}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: JSONAPI,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `file; filename="${input.filename.replace(/"/g, '')}"`,
          },
          body: bytes as any,
        },
        context.timeoutMs ?? 30_000,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) return { providerResponse: data ?? { status: res.status } };
      const file = (data as any)?.data;
      return { id: file?.id ? String(file.id) : undefined, url: file?.attributes?.uri?.url, providerResponse: data };
    } catch (err) {
      return { providerResponse: { error: String(err) } };
    }
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const token = this.bearer(context.config);
    if (!context.config.site_url || !token) return [];
    const base = await this.base(context);
    const vocab = context.config.tag_vocabulary || 'tags';
    const res = await this.fetchWithTimeout(
      `${base}/taxonomy_term/${vocab}?page[limit]=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: JSONAPI } },
      context.timeoutMs ?? 10_000,
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const terms = (data as any)?.data;
    return Array.isArray(terms)
      ? terms.map((t: any) => ({ id: String(t.id), name: String(t.attributes?.name ?? ''), slug: t.attributes?.path?.alias }))
      : [];
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getTags(context);
  }
}
