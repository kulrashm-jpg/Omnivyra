import type { Blog } from '../blogService';
import type { CmsValidationReport } from './cmsEnvironmentFramework';

export type CmsProvider =
  | 'wordpress'
  | 'custom_blog_api'
  | 'ghost'
  | 'drupal'
  | 'joomla'
  | 'webflow'
  | 'shopify';

export interface CmsAdapterContext {
  provider: CmsProvider;
  companyId?: string | null;
  connectionId?: string | null;
  websiteId?: string | null;
  config: Record<string, string>;
  timeoutMs?: number;
  /** When true, bypass persisted/cached API base and re-run discovery. */
  forceApiRediscovery?: boolean;
}

export interface CmsPostInput {
  blog: Blog;
  htmlContent: string;
  status?: 'draft' | 'publish' | 'future';
  scheduledFor?: string | null;
}

export interface CmsPublishResult {
  success: boolean;
  message: string;
  externalId?: string;
  externalUrl?: string;
  providerResponse?: unknown;
}

export interface CmsHealthResult {
  healthy: boolean;
  message: string;
  providerResponse?: unknown;
  /** Machine-readable failure code (universal CMS error model). */
  code?: string;
  /** Standardized provider-agnostic validation report for the Integrations UI. */
  diagnostics?: CmsValidationReport;
}

export interface CmsTaxonomyItem {
  id: string;
  name: string;
  slug?: string;
}

export interface CmsMediaUploadInput {
  filename: string;
  contentType: string;
  body: ArrayBuffer | Buffer;
  altText?: string;
}

export interface CmsMediaUploadResult {
  id?: string;
  url?: string;
  providerResponse?: unknown;
}

export interface CmsSyncResult {
  synced: number;
  providerResponse?: unknown;
}

export interface CmsAdapter {
  readonly provider: CmsProvider;
  validateConnection(context: CmsAdapterContext): Promise<CmsHealthResult>;
  publishPost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult>;
  updatePost(context: CmsAdapterContext, externalId: string, input: CmsPostInput): Promise<CmsPublishResult>;
  uploadMedia(context: CmsAdapterContext, input: CmsMediaUploadInput): Promise<CmsMediaUploadResult>;
  schedulePost(context: CmsAdapterContext, input: CmsPostInput): Promise<CmsPublishResult>;
  syncPosts(context: CmsAdapterContext): Promise<CmsSyncResult>;
  getCategories(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]>;
  getTags(context: CmsAdapterContext): Promise<CmsTaxonomyItem[]>;
  refreshToken(context: CmsAdapterContext): Promise<CmsHealthResult>;
  healthCheck(context: CmsAdapterContext): Promise<CmsHealthResult>;
}
