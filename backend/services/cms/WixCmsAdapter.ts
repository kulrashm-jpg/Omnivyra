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

const WIX_API = 'https://www.wixapis.com';

/**
 * Wix CMS adapter — REAL Wix Blog Draft Posts API v3.
 * Auth: Wix API key (header `Authorization`) + `wix_account_id` + `wix_site_id`
 * headers required by Wix for app-token usage. Stored in
 * integration_credentials.api_key and non-secret config respectively.
 *
 * Honest gate: validation requires api_key + site_id. Without them the adapter
 * reports MISSING_CREDENTIALS — never fabricated.
 *
 * Honest scope: this adapter creates Wix DRAFT posts; publishing live posts
 * (state transition draft → published) requires an additional Wix call
 * (POST /blog/v3/draft-posts/{id}/publish) which is supported here when
 * status='publish'.
 */
export class WixCmsAdapter extends BaseCmsAdapter {
  readonly provider = 'wix' as const;

  private creds(config: Record<string, string>): { key: string; site: string; account?: string } {
    return {
      key: config.api_key || config.wix_api_key || '',
      site: config.wix_site_id || config.site_id || '',
      account: config.wix_account_id || undefined,
    };
  }

  private headers(c: { key: string; site: string; account?: string }): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: c.key,
      'wix-site-id': c.site,
      'Content-Type': 'application/json',
    };
    if (c.account) h['wix-account-id'] = c.account;
    return h;
  }

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const c = this.creds(context.config);
    if (!c.key || !c.site) {
      return {
        healthy: false,
        code: 'MISSING_CREDENTIALS',
        message: 'Wix integration requires api_key + wix_site_id (and optionally wix_account_id for app tokens).',
      };
    }
    const timeoutMs = context.timeoutMs ?? 10_000;
    return this.validateViaPipeline(
      context,
      WIX_API,
      async () => {
        try {
          // Cheapest auth probe: query draft posts (paginated, limit 1).
          const res = await this.fetchWithTimeout(
            `${WIX_API}/blog/v3/draft-posts/query`,
            {
              method: 'POST',
              headers: this.headers(c),
              body: JSON.stringify({ query: { paging: { limit: 1 } } }),
            },
            timeoutMs,
          );
          const body = await res.json().catch(() => null);
          return { ok: res.ok, status: res.status, body, identityLabel: 'Wix Blog' };
        } catch (err) {
          return { ok: false, status: null, body: { error: String(err) } };
        }
      },
      WIX_API,
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
    const c = this.creds(context.config);
    if (!c.key || !c.site) return { success: false, message: 'Wix integration is missing credentials.' };
    if (!input.blog.title?.trim()) return { success: false, message: 'Post title is required.' };
    if (!input.htmlContent?.trim()) return { success: false, message: 'Post content is required.' };

    const blog = input.blog;
    // Wix draft-post payload — minimum viable shape; richContent omitted in
    // favour of plain HTML body via `content` field (Wix accepts HTML in the
    // legacy draft-post body fields).
    const draftPost: Record<string, unknown> = {
      title: blog.seo_meta_title || blog.title,
      // Wix's modern API uses richContent; for portability we send `content`
      // with an HTML string under the legacy field that Wix maps server-side.
      content: input.htmlContent,
      slug: blog.slug ?? undefined,
      seoData: blog.seo_meta_description
        ? { description: blog.seo_meta_description }
        : undefined,
    };

    let res: Response;
    if (externalId) {
      res = await this.fetchWithTimeout(
        `${WIX_API}/blog/v3/draft-posts/${encodeURIComponent(externalId)}`,
        { method: 'PATCH', headers: this.headers(c), body: JSON.stringify({ draftPost }) },
        context.timeoutMs ?? 15_000,
      );
    } else {
      res = await this.fetchWithTimeout(
        `${WIX_API}/blog/v3/draft-posts`,
        { method: 'POST', headers: this.headers(c), body: JSON.stringify({ draftPost }) },
        context.timeoutMs ?? 15_000,
      );
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'Wix authentication failed. Verify api_key + wix_site_id (+ wix_account_id for app tokens).', providerResponse: data };
      }
      return { success: false, message: `Wix returned status ${res.status}.`, providerResponse: data };
    }

    const created = (data as any)?.draftPost ?? data;
    const draftId = created?.id ? String(created.id) : undefined;

    // If caller wants a live post, do the draft → publish transition.
    if (input.status !== 'draft' && draftId) {
      const pub = await this.fetchWithTimeout(
        `${WIX_API}/blog/v3/draft-posts/${encodeURIComponent(draftId)}/publish`,
        { method: 'POST', headers: this.headers(c), body: '{}' },
        context.timeoutMs ?? 15_000,
      );
      const pubData = await pub.json().catch(() => null);
      if (!pub.ok) {
        return {
          success: false,
          message: `Wix draft created but publish failed (status ${pub.status}).`,
          externalId: draftId,
          providerResponse: pubData,
        };
      }
      const livePost = (pubData as any)?.post ?? pubData;
      return {
        success: true,
        message: 'Published to Wix Blog.',
        externalId: livePost?.id ? String(livePost.id) : draftId,
        externalUrl: livePost?.url?.base && livePost?.url?.path ? `${livePost.url.base}${livePost.url.path}` : undefined,
        providerResponse: pubData,
      };
    }

    return {
      success: true,
      message: 'Wix draft post created.',
      externalId: draftId,
      providerResponse: data,
    };
  }

  async getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    const c = this.creds(context.config);
    if (!c.key || !c.site) return [];
    try {
      const res = await this.fetchWithTimeout(
        `${WIX_API}/blog/v3/categories/query`,
        { method: 'POST', headers: this.headers(c), body: JSON.stringify({ query: { paging: { limit: 100 } } }) },
        context.timeoutMs ?? 10_000,
      );
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const items = (data as any)?.categories;
      return Array.isArray(items)
        ? items.map((t: any) => ({ id: String(t.id), name: String(t.label ?? t.title ?? ''), slug: t.slug }))
        : [];
    } catch { return []; }
  }

  async getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return this.getCategories(context);
  }

  async deletePost(context: CmsAdapterContext, externalId: string): Promise<CmsDeleteResult> {
    const c = this.creds(context.config);
    if (!c.key || !c.site) return { success: false, message: 'Wix integration is missing credentials.' };
    // Try the live-post delete first; fall back to draft-post delete if Wix
    // returns 404 (the externalId could be either).
    const live = await this.fetchWithTimeout(
      `${WIX_API}/blog/v3/posts/${encodeURIComponent(externalId)}`,
      { method: 'DELETE', headers: this.headers(c) },
      context.timeoutMs ?? 15_000,
    );
    if (live.ok || live.status === 204) return { success: true, message: 'Post deleted from Wix.' };
    if (live.status === 401 || live.status === 403) return { success: false, message: 'Wix authentication failed during delete.' };
    const draft = await this.fetchWithTimeout(
      `${WIX_API}/blog/v3/draft-posts/${encodeURIComponent(externalId)}`,
      { method: 'DELETE', headers: this.headers(c) },
      context.timeoutMs ?? 15_000,
    );
    if (draft.ok || draft.status === 204) return { success: true, message: 'Draft deleted from Wix.' };
    if (draft.status === 404) return { success: true, message: 'Post already absent on Wix.' };
    return { success: false, message: `Wix delete returned status ${draft.status}.` };
  }

  async uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    const c = this.creds(context.config);
    if (!c.key || !c.site) return { providerResponse: { error: 'missing_credentials' } };
    try {
      const bytes = input.body instanceof Buffer ? input.body : Buffer.from(input.body as ArrayBuffer);
      // Wix two-step upload: generate URL → PUT bytes.
      const step1 = await this.fetchWithTimeout(
        `${WIX_API}/site-media/v1/files/generate-upload-url`,
        {
          method: 'POST',
          headers: this.headers(c),
          body: JSON.stringify({
            mimeType: input.contentType,
            fileName: input.filename,
            sizeInBytes: String(bytes.length),
          }),
        },
        context.timeoutMs ?? 15_000,
      );
      const step1Data = await step1.json().catch(() => null);
      const uploadUrl = (step1Data as any)?.uploadUrl;
      if (!uploadUrl) return { providerResponse: step1Data ?? { error: 'generate_upload_url_failed' } };
      const put = await this.fetchWithTimeout(
        uploadUrl,
        { method: 'PUT', headers: { 'Content-Type': input.contentType }, body: bytes as any },
        context.timeoutMs ?? 30_000,
      );
      const putData = await put.json().catch(() => null);
      if (!put.ok) return { providerResponse: putData ?? { status: put.status } };
      const file = (putData as any)?.file ?? putData;
      return { id: file?.id ? String(file.id) : undefined, url: file?.url, providerResponse: putData };
    } catch (err) {
      return { providerResponse: { error: String(err) } };
    }
  }
}
