import { BaseCmsAdapter } from './BaseCmsAdapter';
import crypto from 'crypto';
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

const WEBFLOW_API = 'https://api.webflow.com/v2';

/**
 * Webflow operational FOUNDATION — Webflow Data API v2 (OAuth2 / site token).
 * Validation, site discovery and CMS collection discovery are production-ready
 * and flow through the universal pipeline + canonical-base abstraction.
 * Publishing is gated on a mapped `collection_id` (architecture-ready; item
 * create is implemented but requires field mapping config).
 */
export class WebflowAdapter extends BaseCmsAdapter {
  readonly provider = 'webflow' as const;

  private token(config: Record<string, string>): string {
    return config.access_token || config.api_token || '';
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const token = this.token(context.config);
    if (!token) {
      return { healthy: false, code: 'MISSING_CREDENTIALS', message: 'A Webflow OAuth access_token (or site api_token) is required.' };
    }
    // site_url is not the API host for Webflow; use the canonical API base.
    const siteUrl = String(context.config.site_url || 'https://webflow.com');
    const timeoutMs = context.timeoutMs ?? 10_000;

    return this.validateViaPipeline(
      context,
      siteUrl,
      async () => {
        try {
          const res = await this.fetchWithTimeout(
            `${WEBFLOW_API}/sites`,
            { headers: { Authorization: `Bearer ${token}`, 'accept-version': '2.0.0' } },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          // Foundation: surface discovered sites + collections for mapping UX.
          let discovery: unknown = null;
          if (res.ok) discovery = await this.discover(token, body, timeoutMs);
          return {
            ok: res.ok,
            status: res.status,
            body: discovery ?? body,
            identityLabel: 'Webflow',
          };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      WEBFLOW_API,
    );
  }

  /** Site + CMS collection discovery (foundation for collection mapping). */
  private async discover(token: string, sitesBody: any, timeoutMs: number): Promise<unknown> {
    const sites = Array.isArray(sitesBody?.sites) ? sitesBody.sites : [];
    const out: Array<{ id: string; name: string; collections: CmsTaxonomyItem[] }> = [];
    for (const s of sites.slice(0, 5)) {
      try {
        const res = await this.fetchWithTimeout(
          `${WEBFLOW_API}/sites/${s.id}/collections`,
          { headers: { Authorization: `Bearer ${token}`, 'accept-version': '2.0.0' } },
          timeoutMs,
        );
        const cb = await res.json().catch(() => null);
        const collections = Array.isArray((cb as any)?.collections)
          ? (cb as any).collections.map((c: any) => ({ id: String(c.id), name: String(c.displayName ?? c.slug), slug: c.slug }))
          : [];
        out.push({ id: String(s.id), name: String(s.displayName ?? s.shortName ?? s.id), collections });
      } catch {
        /* discovery is best-effort */
      }
    }
    return { sites: out };
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const token = this.token(context.config);
    const collectionId = context.config.collection_id;
    if (!token || !collectionId) return [];
    // No native taxonomy; expose the target collection as a single item.
    return [{ id: collectionId, name: context.config.collection_name || 'Collection' }];
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getCategories(context);
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
    const collectionId = context.config.collection_id;
    if (!token) return { success: false, message: 'Webflow integration is missing an access token.' };
    if (!collectionId) {
      return {
        success: false,
        message:
          'Webflow publishing requires a mapped CMS collection. Set "collection_id" (and optional field mappings) on the integration — run validate to discover available collections.',
      };
    }
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };

    const blog = input.blog;
    const fieldData: Record<string, unknown> = {
      name: blog.seo_meta_title || blog.title,
      slug: blog.slug || this.slugify(blog.title),
      [context.config.body_field || 'post-body']: input.htmlContent,
    };
    if (context.config.summary_field && blog.excerpt) fieldData[context.config.summary_field] = blog.excerpt;

    const url = externalId
      ? `${WEBFLOW_API}/collections/${collectionId}/items/${externalId}`
      : `${WEBFLOW_API}/collections/${collectionId}/items`;
    const res = await this.fetchWithTimeout(
      url,
      {
        method: externalId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'accept-version': '2.0.0',
        },
        body: JSON.stringify({ isArchived: false, isDraft: input.status === 'draft', fieldData }),
      },
      context.timeoutMs ?? 15_000,
    );
    const data = await res.json().catch(() => null);
    if (res.ok) {
      const id = (data as any)?.id;
      return {
        success: true,
        message: 'Published to Webflow CMS collection (publish the site to make it live).',
        externalId: id ? String(id) : undefined,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'Webflow authorization failed. Reconnect the OAuth grant.', providerResponse: data };
    }
    return { success: false, message: `Webflow returned status ${res.status}.`, providerResponse: data };
  }

  private slugify(v: string): string {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  }

  async deletePost(context: CmsAdapterContext, externalId: string): Promise<CmsDeleteResult> {
    const token = this.token(context.config);
    const collectionId = context.config.collection_id;
    if (!token) return { success: false, message: 'Webflow integration is missing an access token.' };
    if (!collectionId) return { success: false, message: 'Webflow delete requires collection_id.' };
    const res = await this.fetchWithTimeout(
      `${WEBFLOW_API}/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(externalId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'accept-version': '2.0.0' },
      },
      context.timeoutMs ?? 15_000,
    );
    if (res.ok || res.status === 204) return { success: true, message: 'Item deleted from Webflow (publish the site to apply).' };
    if (res.status === 404) return { success: true, message: 'Item already absent on Webflow.' };
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Webflow authentication failed during delete.' };
    return { success: false, message: `Webflow delete returned status ${res.status}.` };
  }

  async uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    const token = this.token(context.config);
    const siteId = context.config.site_id || context.config.webflow_site_id;
    if (!token || !siteId) return { providerResponse: { error: 'missing_credentials_or_site_id' } };
    try {
      const bytes = input.body instanceof Buffer ? input.body : Buffer.from(input.body as ArrayBuffer);
      const fileHash = crypto.createHash('md5').update(bytes).digest('hex');
      // Webflow asset upload: POST /sites/{site_id}/assets → S3 form upload.
      const step1 = await this.fetchWithTimeout(
        `${WEBFLOW_API}/sites/${encodeURIComponent(siteId)}/assets`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'accept-version': '2.0.0' },
          body: JSON.stringify({ fileName: input.filename, fileHash }),
        },
        context.timeoutMs ?? 15_000,
      );
      const step1Data = await step1.json().catch(() => null);
      const uploadUrl = (step1Data as any)?.uploadUrl;
      const uploadDetails = (step1Data as any)?.uploadDetails;
      const assetUrl = (step1Data as any)?.hostedUrl ?? (step1Data as any)?.url;
      if (!uploadUrl) return { providerResponse: step1Data ?? { error: 'asset_create_failed' } };
      const form = new FormData();
      if (uploadDetails && typeof uploadDetails === 'object') {
        for (const [k, v] of Object.entries(uploadDetails)) form.append(k, String(v as string));
      }
      form.append('file', new Blob([new Uint8Array(bytes)], { type: input.contentType }), input.filename);
      const put = await this.fetchWithTimeout(uploadUrl, { method: 'POST', body: form as any }, context.timeoutMs ?? 30_000);
      if (!put.ok && put.status !== 204) return { providerResponse: { status: put.status, step1: step1Data } };
      return { id: (step1Data as any)?.id ? String((step1Data as any).id) : undefined, url: assetUrl, providerResponse: step1Data };
    } catch (err) {
      return { providerResponse: { error: String(err) } };
    }
  }
}
