/**
 * Squarespace adapter — HONEST capability-limited.
 *
 * Squarespace does not expose a public write API for blog posts (the Content
 * API is announcement/read-only and the Commerce API targets products, not
 * blog publishing). We refuse to fabricate a publish path. This adapter:
 *
 *   - validates connectivity via the public site's RSS feed (`/blog?format=rss`
 *     is the most stable signal; `/sitemap.xml` is a fallback). Both are
 *     reachable without credentials.
 *   - refuses publish/update/uploadMedia with a clear, machine-readable
 *     `CMS_PUBLISH_UNSUPPORTED` code.
 *   - returns empty taxonomy (no API).
 *
 * Provider capability matrix (registry.describeCmsProvider + capabilities) is
 * the source of truth for the UI — operators see "publish: not supported"
 * upfront, not after a failed publish attempt.
 */
import { BaseCmsAdapter, CmsAdapterError } from './BaseCmsAdapter';
import type {
  CmsAdapterContext,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsTaxonomyItem,
} from './types';

export class SquarespaceAdapter extends BaseCmsAdapter {
  readonly provider = 'squarespace' as const;

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const site = String(context.config.site_url || '').trim().replace(/\/+$/, '');
    if (!site) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'site_url is required (e.g. https://yoursite.squarespace.com).' };
    }
    const timeoutMs = context.timeoutMs ?? 10_000;
    const probes = [`${site}/blog?format=rss`, `${site}/sitemap.xml`];
    for (const url of probes) {
      try {
        const res = await this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
        if (res.ok) {
          const txt = await res.text().catch(() => '');
          // Cheap sanity: RSS feeds are XML; sitemaps are XML. A 200 with no
          // XML markers is almost certainly a 404-rewritten HTML page.
          const looksLikeXml = /<\?xml|<rss|<urlset/i.test(txt.slice(0, 512));
          if (looksLikeXml) {
            return {
              healthy: true,
              code: 'OK',
              message: 'Squarespace site reachable. Note: publish is NOT supported (no public write API).',
            };
          }
        }
      } catch { /* try next probe */ }
    }
    return {
      healthy: false,
      code: 'PROVIDER_UNREACHABLE',
      message: 'Could not reach the Squarespace site RSS or sitemap. Check site_url and that the blog is published.',
    };
  }

  async publishPost(_context: CmsAdapterContext, _input: CmsPostInput): Promise<CmsPublishResult> {
    return {
      success: false,
      message: 'Squarespace does not expose a public write API for blog posts. Publish is not supported.',
    };
  }

  async updatePost(_context: CmsAdapterContext, externalId: string, _input: CmsPostInput): Promise<CmsPublishResult> {
    return {
      success: false,
      message: `Squarespace does not expose a public write API; cannot update post ${externalId}.`,
    };
  }

  async uploadMedia(_context: CmsAdapterContext, _input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    throw new CmsAdapterError(
      'Squarespace media upload is not available via public API.',
      this.provider,
      'CMS_MEDIA_UNSUPPORTED',
    );
  }

  async getCategories(_context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> { return []; }
  async getTags(_context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> { return []; }
}
