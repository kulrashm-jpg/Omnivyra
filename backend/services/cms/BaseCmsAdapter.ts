import type {
  CmsAdapter,
  CmsAdapterContext,
  CmsDeleteResult,
  CmsHealthResult,
  CmsMediaUploadInput,
  CmsMediaUploadResult,
  CmsPostInput,
  CmsPublishResult,
  CmsSyncResult,
  CmsTaxonomyItem,
} from './types';
import {
  runCmsValidationPipeline,
  type CmsAuthProbeResult,
} from './cmsEnvironmentFramework';
import {
  invalidateApiBaseCache,
  persistCanonicalApiBase,
  resolveCanonicalApiBase,
} from './cmsApiBaseResolver';

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

  async deletePost(context: CmsAdapterContext, externalId: string): Promise<CmsDeleteResult> {
    return {
      success: false,
      message: `Remote delete is not supported for ${context.provider} (external id ${externalId}).`,
    };
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
    // HARDEN-005A: CMS site/API-base URLs are user-configured (site_url) — route
    // through the SSRF-safe fetcher. allowHttp because self-hosted CMS may be
    // http; private-IP checks still block internal targets either way.
    const { safeFetch } = await import('../../../lib/security/safeFetch');
    return safeFetch(url, options, { allowHttp: true, timeoutMs: ms, maxBytes: 10 * 1024 * 1024 });
  }

  /**
   * Canonical, universal validation entrypoint shared by all non-WordPress
   * adapters. Runs the universal pipeline (env → HTTPS → discovery → auth),
   * then promotes a validated discovery into the persisted canonical API base
   * so publish/queue/reconciliation never use a runtime-only path.
   */
  protected async validateViaPipeline(
    context: CmsAdapterContext,
    siteUrl: string,
    authProbe?: (apiBase: string) => Promise<CmsAuthProbeResult>,
    canonicalBaseOverride?: string,
  ): Promise<CmsHealthResult> {
    const timeoutMs = context.timeoutMs ?? 10_000;
    if (context.forceApiRediscovery) invalidateApiBaseCache(context.connectionId);

    const result = await runCmsValidationPipeline({
      provider: this.provider,
      siteUrl,
      timeoutMs,
      fetchFn: (url) => this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs),
      authProbe,
    });

    const canonicalBase = canonicalBaseOverride ?? result.report?.apiBase;
    // Surface the real provider base in diagnostics for auth-gated providers
    // whose pipeline skipped unauthenticated discovery.
    if (canonicalBaseOverride && result.report) {
      result.report.apiBase = canonicalBaseOverride;
      if (!result.report.detectedApiRoot && result.healthy) {
        result.report.detectedApiRoot = canonicalBaseOverride;
      }
    }
    if (result.healthy && context.connectionId && canonicalBase) {
      await persistCanonicalApiBase(context.connectionId, {
        apiBase: canonicalBase,
        detectedApiRoot: result.report?.detectedApiRoot ?? canonicalBase,
        metadata: {
          provider: this.provider,
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

  /** Resolve the canonical operational API base for this connection. */
  protected async canonicalApiBase(
    context: CmsAdapterContext,
    siteUrl: string,
    forceRediscover = false,
  ): Promise<string> {
    const timeoutMs = context.timeoutMs ?? 10_000;
    const resolved = await resolveCanonicalApiBase({
      provider: this.provider,
      siteUrl,
      connectionId: context.connectionId,
      fetchFn: (url) => this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs),
      forceRediscover,
    });
    return resolved.apiBase;
  }
}
