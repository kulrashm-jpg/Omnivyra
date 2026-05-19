import { BaseCmsAdapter } from './BaseCmsAdapter';
import { ownedDbTable } from '../../db/writeOwner';
import { runCmsValidationPipeline } from './cmsEnvironmentFramework';
import {
  invalidateApiBaseCache,
  persistCanonicalApiBase,
  rediscoverAndRepairApiBase,
  resolveCanonicalApiBase,
} from './cmsApiBaseResolver';
import type {
  CmsAdapterContext,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

export class WordPressAdapter extends BaseCmsAdapter {
  readonly provider = 'wordpress' as const;

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const config = context.config;
    const timeoutMs = context.timeoutMs ?? 10_000;

    if (!config.site_url || !config.username || !config.app_password) {
      return {
        healthy: false,
        code: 'MISSING_CREDENTIALS',
        message: 'site_url, username, and app_password are required.',
      };
    }

    const siteUrl = config.site_url.replace(/\/+$/, '');
    const credentials = Buffer.from(
      `${config.username}:${config.app_password}`,
    ).toString('base64');

    // Re-detect: drop any cached resolution so a fresh probe + persist wins.
    if (context.forceApiRediscovery) invalidateApiBaseCache(context.connectionId);

    // All environment/HTTPS/REST/error logic now lives in the canonical
    // pipeline; WordPress only supplies the Basic-auth probe against the
    // discovered REST base (apiBase already includes the wp/v2 namespace).
    const result = await runCmsValidationPipeline({
      provider: 'wordpress',
      siteUrl,
      timeoutMs,
      fetchFn: (url) => this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs),
      authProbe: async (apiBase) => {
        const res = await this.fetchWithTimeout(
          `${apiBase}/users/me?context=edit`,
          { method: 'GET', headers: { Authorization: `Basic ${credentials}` } },
          timeoutMs,
        );
        const body = await res.json().catch(() => null);
        return {
          ok: res.ok,
          status: res.status,
          body,
          identityLabel: (body as any)?.name,
        };
      },
    });

    // Promote a validated discovery into the canonical operational base so
    // publish/sync/media/reconciliation immediately use the correct root.
    if (result.healthy && context.connectionId && result.report?.apiBase) {
      await persistCanonicalApiBase(context.connectionId, {
        apiBase: result.report.apiBase,
        detectedApiRoot: result.report.detectedApiRoot,
        metadata: {
          discoveredVia: 'validate_connection',
          environmentType: result.report.environmentType,
        },
      });
      invalidateApiBaseCache(context.connectionId);
    }

    return {
      healthy: result.healthy,
      message: result.message,
      code: result.code,
      providerResponse: result.providerResponse,
      diagnostics: result.report,
    };
  }

  /** Resolve the canonical wp/v2 base for this connection (cached/persisted). */
  private async getApiBase(
    context: CmsAdapterContext,
    forceRediscover = false,
  ): Promise<string> {
    const timeoutMs = context.timeoutMs ?? 10_000;
    const resolved = await resolveCanonicalApiBase({
      provider: 'wordpress',
      siteUrl: String(context.config.site_url || '').replace(/\/+$/, ''),
      connectionId: context.connectionId,
      fetchFn: (url) => this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs),
      forceRediscover,
    });
    return resolved.apiBase;
  }

  async publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsertPost(context, undefined, input);
  }

  async updatePost(context: CmsAdapterContext, externalId: string, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsertPost(context, externalId, input);
  }

  async schedulePost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.upsertPost(context, undefined, { ...input, status: 'future' });
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.fetchTaxonomy(context, 'categories');
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.fetchTaxonomy(context, 'tags');
  }

  async uploadMedia(
    context: CmsAdapterContext,
    input: CmsMediaUploadInput,
    apiBaseOverride?: string,
  ): Promise<CmsMediaUploadResult> {
    const config = context.config;
    if (!config.site_url || !config.username || !config.app_password) {
      return { providerResponse: { error: 'missing_credentials' } };
    }
    const apiBase = apiBaseOverride ?? (await this.getApiBase(context));
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    const res = await this.fetchWithTimeout(`${apiBase}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Disposition': `attachment; filename="${input.filename.replace(/"/g, '')}"`,
        'Content-Type': input.contentType,
      },
      body: input.body as any,
    }, context.timeoutMs ?? 30_000);

    const data = await res.json().catch(() => null);
    if (!res.ok) return { providerResponse: data ?? { status: res.status } };

    if (input.altText && data?.id) {
      await this.fetchWithTimeout(`${apiBase}/media/${data.id}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ alt_text: input.altText }),
      }, context.timeoutMs ?? 10_000).catch(() => null);
    }

    return {
      id: data?.id ? String(data.id) : undefined,
      url: data?.source_url,
      providerResponse: data,
    };
  }

  private async upsertPost(
    context: CmsAdapterContext,
    externalId: string | undefined,
    input: CmsPostInput,
  ): Promise<CmsPublishResult> {
    const config = context.config;
    if (!config.site_url || !config.username || !config.app_password) {
      return { success: false, message: 'WordPress integration is missing credentials.' };
    }
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    const blog = input.blog;
    const validation = this.validatePostInput(input);
    if (!validation.success) return validation;

    let apiBase = await this.getApiBase(context);
    const categories = blog.category ? await this.ensureTaxonomyTerms(context, 'categories', [blog.category], apiBase) : [];
    const tags = blog.tags?.length ? await this.ensureTaxonomyTerms(context, 'tags', blog.tags, apiBase) : [];
    const featuredMedia = await this.resolveFeaturedMedia(context, blog.featured_image_url, blog.title, apiBase);
    const authorId = await this.resolveAuthorId(context, apiBase);
    const payload: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      content: input.htmlContent,
      status: input.status ?? 'publish',
      slug: blog.slug ?? undefined,
      meta: {
        _omnivera_seo_title: blog.seo_meta_title ?? blog.title,
        _omnivera_seo_description: blog.seo_meta_description ?? blog.excerpt ?? '',
      },
    };

    if (input.scheduledFor) payload.date = input.scheduledFor;
    if (blog.excerpt) payload.excerpt = blog.excerpt;
    if (tags.length) payload.tags = tags;
    if (categories.length) payload.categories = categories;
    if (featuredMedia?.id) payload.featured_media = Number(featuredMedia.id);
    if (authorId) payload.author = authorId;

    const postPath = (base: string) =>
      externalId
        ? `${base}/posts/${encodeURIComponent(externalId)}`
        : `${base}/posts`;

    const doRequest = (base: string) =>
      this.fetchWithTimeout(postPath(base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
        body: JSON.stringify(payload),
      }, context.timeoutMs ?? 15_000);

    let res = await doRequest(apiBase);

    // Self-healing: a 404 on a previously-working base means the REST root
    // moved (install relocated / subdir or proxy change). Rediscover once,
    // persist the repaired base, and retry — rate-limited inside the resolver.
    if (res.status === 404) {
      const repaired = await rediscoverAndRepairApiBase({
        provider: 'wordpress',
        siteUrl: String(config.site_url || '').replace(/\/+$/, ''),
        connectionId: context.connectionId,
        fetchFn: (url) => this.fetchWithTimeout(url, { method: 'GET' }, context.timeoutMs ?? 10_000),
      });
      if (repaired.apiBase && repaired.apiBase !== apiBase) {
        apiBase = repaired.apiBase;
        res = await doRequest(apiBase);
      }
    }

    const data = await res.json().catch(() => null);
    if (res.ok) {
      return {
        success: true,
        message: `Published to WordPress${data?.link ? ': ' + data.link : '.'}`,
        externalId: data?.id ? String(data.id) : undefined,
        externalUrl: data?.link,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'WordPress authentication failed. Check your credentials.', providerResponse: data };
    }
    return { success: false, message: `WordPress returned status ${res.status}.`, providerResponse: data };
  }

  private async fetchTaxonomy(
    context: CmsAdapterContext,
    taxonomy: 'categories' | 'tags',
    apiBaseOverride?: string,
  ): Promise<CmsTaxonomyItem[]> {
    const config = context.config;
    if (!config.site_url || !config.username || !config.app_password) return [];
    const apiBase = apiBaseOverride ?? (await this.getApiBase(context));
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    const res = await this.fetchWithTimeout(`${apiBase}/${taxonomy}?per_page=100`, {
      headers: { Authorization: `Basic ${credentials}` },
    }, context.timeoutMs ?? 10_000);
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    const mapped = Array.isArray(data)
      ? data.map((item) => ({ id: String(item.id), name: String(item.name), slug: item.slug }))
      : [];
    await this.cacheTaxonomy(context, taxonomy === 'categories' ? 'category' : 'tag', mapped);
    return mapped;
  }

  private validatePostInput(input: CmsPostInput): CmsPublishResult {
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };
    if (input.status === 'future' && !input.scheduledFor) return { success: false, message: 'Scheduled WordPress posts require scheduledFor.' };
    return { success: true, message: 'ok' };
  }

  private async ensureTaxonomyTerms(context: CmsAdapterContext, taxonomy: 'categories' | 'tags', names: string[], apiBase: string): Promise<number[]> {
    const existing = await this.fetchTaxonomy(context, taxonomy, apiBase);
    const ids: number[] = [];
    const config = context.config;
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');

    for (const rawName of names) {
      const name = rawName.trim();
      if (!name) continue;
      const found = existing.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.slug === this.slugify(name));
      if (found) {
        ids.push(Number(found.id));
        continue;
      }
      const res = await this.fetchWithTimeout(`${apiBase}/${taxonomy}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: this.slugify(name) }),
      }, context.timeoutMs ?? 10_000);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.id) {
        ids.push(Number(data.id));
        await this.cacheTaxonomy(context, taxonomy === 'categories' ? 'category' : 'tag', [{ id: String(data.id), name: data.name, slug: data.slug }]);
      }
    }
    return ids;
  }

  private async resolveFeaturedMedia(context: CmsAdapterContext, sourceUrl: string | null | undefined, title: string, apiBase: string): Promise<CmsMediaUploadResult | null> {
    if (!sourceUrl) return null;
    const cached = await ownedDbTable('cms_media_assets')
      .select('external_id, external_url')
      .eq('connection_id', context.connectionId)
      .eq('source_url', sourceUrl)
      .eq('upload_status', 'uploaded')
      .maybeSingle();
    if (cached.data?.external_id) return { id: String(cached.data.external_id), url: cached.data.external_url ?? undefined };

    const mediaRes = await fetch(sourceUrl).catch(() => null);
    if (!mediaRes?.ok) return null;
    const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';
    const bytes = Buffer.from(await mediaRes.arrayBuffer());
    const filename = this.filenameFromUrl(sourceUrl, contentType);
    const uploaded = await this.uploadMedia(context, { filename, contentType, body: bytes, altText: title }, apiBase);
    if (uploaded.id) {
      try {
        if (context.companyId) {
          await ownedDbTable('cms_media_assets').insert({
            company_id: context.companyId,
            website_id: context.websiteId ?? null,
            connection_id: context.connectionId ?? null,
            provider: this.provider,
            source_url: sourceUrl,
            external_id: uploaded.id,
            external_url: uploaded.url ?? null,
            content_type: contentType,
            upload_status: 'uploaded',
            metadata: { title },
          });
        }
      } catch {
        // Media cache writes are best-effort; publishing can proceed without them.
      }
    }
    return uploaded;
  }

  private async resolveAuthorId(context: CmsAdapterContext, apiBase: string): Promise<number | null> {
    const configured = context.config.author_id;
    if (configured && Number.isFinite(Number(configured))) return Number(configured);
    if (!context.config.author_username) return null;
    const config = context.config;
    const credentials = Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
    const res = await this.fetchWithTimeout(`${apiBase}/users?search=${encodeURIComponent(config.author_username)}`, {
      headers: { Authorization: `Basic ${credentials}` },
    }, context.timeoutMs ?? 10_000);
    if (!res.ok) return null;
    const data = await res.json().catch(() => []);
    const user = Array.isArray(data) ? data[0] : null;
    if (user?.id) {
      await this.cacheTaxonomy(context, 'author', [{ id: String(user.id), name: user.name || config.author_username, slug: user.slug }]);
      return Number(user.id);
    }
    return null;
  }

  private async cacheTaxonomy(context: CmsAdapterContext, type: 'category' | 'tag' | 'author', items: CmsTaxonomyItem[]): Promise<void> {
    if (!context.connectionId || items.length === 0) return;
    await ownedDbTable('cms_taxonomy_cache')
      .upsert(items.map((item) => ({
        connection_id: context.connectionId,
        provider: this.provider,
        taxonomy_type: type,
        external_id: item.id,
        name: item.name,
        slug: item.slug ?? null,
        metadata: {},
        synced_at: new Date().toISOString(),
      })), { onConflict: 'connection_id,taxonomy_type,external_id' });
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  }

  private filenameFromUrl(sourceUrl: string, contentType: string): string {
    try {
      const pathname = new URL(sourceUrl).pathname;
      const name = pathname.split('/').pop();
      if (name && name.includes('.')) return name;
    } catch {}
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    return `omnivera-featured-image.${ext}`;
  }
}
