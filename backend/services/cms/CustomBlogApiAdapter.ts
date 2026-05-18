import { BaseCmsAdapter } from './BaseCmsAdapter';
import type { CmsAdapterContext, CmsHealthResult, CmsPostInput, CmsPublishResult } from './types';

export class CustomBlogApiAdapter extends BaseCmsAdapter {
  readonly provider = 'custom_blog_api' as const;

  async validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult> {
    const config = context.config;
    if (!config.endpoint_url || !config.api_key) {
      return { healthy: false, message: 'endpoint_url and api_key are required.' };
    }
    const result = await this.publishPost(context, {
      blog: {
        id: 'integration-test',
        company_id: '',
        created_by: '',
        title: 'Test Post',
        content: 'Integration test',
        slug: null,
        excerpt: null,
        content_blocks: null,
        featured_image_url: null,
        category: null,
        tags: [],
        seo_meta_title: null,
        seo_meta_description: null,
        is_featured: false,
        views_count: 0,
        status: 'draft',
        integration_id: null,
        external_id: null,
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        angle_type: null,
        hook_strength: null,
      },
      htmlContent: 'Integration test',
    });
    return { healthy: result.success, message: result.message, providerResponse: result.providerResponse };
  }

  async publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    const config = context.config;
    if (!config.endpoint_url || !config.api_key) {
      return { success: false, message: 'Custom blog API integration is missing credentials.' };
    }
    const authHeader = config.auth_header || 'Authorization';
    const blog = input.blog;
    const payload: Record<string, unknown> = {
      title: blog.title,
      content: input.htmlContent,
    };
    if (blog.slug) payload.slug = blog.slug;
    if (blog.excerpt) payload.excerpt = blog.excerpt;
    if (blog.featured_image_url) payload.featured_image_url = blog.featured_image_url;
    if (blog.category) payload.category = blog.category;
    if (blog.tags?.length) payload.tags = blog.tags;
    if (blog.seo_meta_title) payload.seo_meta_title = blog.seo_meta_title;
    if (blog.seo_meta_description) payload.seo_meta_description = blog.seo_meta_description;
    if (input.scheduledFor) payload.scheduled_for = input.scheduledFor;

    const res = await this.fetchWithTimeout(config.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [authHeader]: `Bearer ${config.api_key}`,
        ...(blog.id === 'integration-test' ? { 'X-Integration-Test': 'true' } : {}),
      },
      body: JSON.stringify(payload),
    }, context.timeoutMs ?? 15_000);

    const data = await res.json().catch(() => null);
    if (res.ok) {
      return {
        success: true,
        message: 'Published to your blog API.',
        externalId: data?.id ? String(data.id) : undefined,
        externalUrl: data?.url,
        providerResponse: data,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: 'API rejected the key. Check your api_key in Integrations.', providerResponse: data };
    }
    return { success: false, message: `Blog API returned status ${res.status}.`, providerResponse: data };
  }
}
