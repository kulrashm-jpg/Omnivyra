import type {
  CmsAdapter,
  CmsAdapterContext,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsSyncResult,
  CmsTaxonomyItem,
} from './types';

export class CmsAdapterError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string = 'CMS_ADAPTER_ERROR',
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'CmsAdapterError';
  }
}

export abstract class BaseCmsAdapter implements CmsAdapter {
  abstract readonly provider: CmsAdapter['provider'];

  abstract validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult>;
  abstract publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult>;

  async updatePost(context: CmsAdapterContext, externalId: string, input: CmsPostInput): Promise<CmsPublishResult> {
    throw new CmsAdapterError(`Update is not implemented for ${externalId}.`, context.provider, 'CMS_UPDATE_UNSUPPORTED');
  }

  async uploadMedia(context: CmsAdapterContext, _input: CmsMediaUploadInput): Promise<CmsMediaUploadResult> {
    throw new CmsAdapterError('Media upload is not implemented for this provider.', context.provider, 'CMS_MEDIA_UNSUPPORTED');
  }

  async schedulePost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult> {
    return this.publishPost(context, { ...input, status: 'future' });
  }

  async syncPosts(_context: CmsAdapterContext): Promise<CmsSyncResult> {
    return { synced: 0 };
  }

  async getCategories(_context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return [];
  }

  async getTags(_context: CmsAdapterContext): Promise<CmsTaxonomyItem[]> {
    return [];
  }

  async refreshToken(context: CmsAdapterContext): Promise<CmsHealthResult> {
    return { healthy: true, message: `${context.provider} does not require token refresh.` };
  }

  async healthCheck(context: CmsAdapterContext): Promise<CmsHealthResult> {
    return this.validateConnection(context);
  }

  protected async fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }
}
