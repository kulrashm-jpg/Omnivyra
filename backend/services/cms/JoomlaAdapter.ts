import { BaseCmsAdapter } from './BaseCmsAdapter';
import type {
  CmsAdapterContext,
  CmsHealthResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

/**
 * Production Joomla adapter — Joomla 4/5 Web Services API, token auth
 * (`X-Joomla-Token`). The API is token-gated so the base is deterministic
 * (`${siteUrl}/api/index.php/v1`) and persisted via the shared resolver path.
 */
export class JoomlaAdapter extends BaseCmsAdapter {
  readonly provider = 'joomla' as const;

  private apiBase(siteUrl: string): string {
    return `${siteUrl.replace(/\/+$/, '')}/api/index.php/v1`;
  }

  private headers(token: string): Record<string, string> {
    return {
      'X-Joomla-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.api+json',
    };
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const { site_url, api_token } = context.config;
    if (!site_url || !api_token) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'site_url and api_token are required.' };
    }
    const siteUrl = site_url.replace(/\/+$/, '');
    const base = this.apiBase(siteUrl);
    const timeoutMs = context.timeoutMs ?? 10_000;

    return this.validateViaPipeline(
      context,
      siteUrl,
      async () => {
        try {
          const res = await this.fetchWithTimeout(
            `${base}/content/articles?page[limit]=1`,
            { headers: this.headers(api_token) },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          return { ok: res.ok, status: res.status, body, identityLabel: 'Joomla Web Services' };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      base,
    );
  }

  private async base(context: CmsAdapterContext): Promise<string> {
    const siteUrl = String(context.config.site_url || '').replace(/\/+$/, '');
    const resolved = await this.canonicalApiBase(context, siteUrl).catch(() => '');
    return resolved && resolved.includes('/api/index.php/v1') ? resolved : this.apiBase(siteUrl);
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
    const { site_url, api_token } = context.config;
    if (!site_url || !api_token) return { success: false, message: 'Joomla integration is missing credentials.' };
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };

    const base = await this.base(context);
    const blog = input.blog;
    const catid = Number(context.config.default_catid || (await this.resolveCategory(context, base, blog.category)) || 2);

    const body: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      articletext: input.htmlContent,
      catid,
      language: context.config.language || '*',
      state: input.status === 'future' ? 0 : input.status === 'draft' ? 0 : 1,
      alias: blog.slug ?? undefined,
      metadesc: blog.seo_meta_description ?? undefined,
    };
    if (input.status === 'future' && input.scheduledFor) body.publish_up = input.scheduledFor;

    const url = externalId ? `${base}/content/articles/${externalId}` : `${base}/content/articles`;
    const res = await this.fetchWithTimeout(
      url,
      { method: externalId ? 'PATCH' : 'POST', headers: this.headers(api_token), body: JSON.stringify(body) },
      context.timeoutMs ?? 15_000,
    );
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const id = (data as any)?.data?.id;
      return {
        success: true,
        message: 'Published to Joomla.',
        externalId: id ? String(id) : undefined,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Joomla authentication failed. Check the API token & user permissions.', providerResponse: data };
    }
    return { success: false, message: `Joomla returned status ${res.status}.`, providerResponse: data };
  }

  private async resolveCategory(
    context: CmsAdapterContext,
    base: string,
    name: string | null | undefined,
  ): Promise<number | null> {
    if (!name) return null;
    try {
      const res = await this.fetchWithTimeout(
        `${base}/content/categories`,
        { headers: this.headers(context.config.api_token) },
        context.timeoutMs ?? 10_000,
      );
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const list = (data as any)?.data;
      const match = Array.isArray(list)
        ? list.find((c: any) => String(c?.attributes?.title ?? '').toLowerCase() === name.toLowerCase())
        : null;
      return match?.id ? Number(match.id) : null;
    } catch {
      return null;
    }
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const { site_url, api_token } = context.config;
    if (!site_url || !api_token) return [];
    const base = await this.base(context);
    const res = await this.fetchWithTimeout(
      `${base}/content/categories`,
      { headers: this.headers(api_token) },
      context.timeoutMs ?? 10_000,
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const list = (data as any)?.data;
    return Array.isArray(list)
      ? list.map((c: any) => ({ id: String(c.id), name: String(c.attributes?.title ?? ''), slug: c.attributes?.alias }))
      : [];
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getCategories(context);
  }
}
