/**
 * Base Platform Adapter Interface
 *
 * Unified interface for platform operations: publishing, engagement, ingestion, and connection testing.
 * Implementations live in platformAdapters/ (linkedinAdapter, twitterAdapter, etc.).
 *
 * Existing flows (backend/adapters/platformAdapter, platformConnectors) remain canonical.
 * These adapters provide a parallel path for ingestion and test-connection.
 *
 * Adapter guidelines:
 * - Call withRateLimit(platformKey) before each platform API request
 * - Call validatePublishPolicy(platformKey, payload) before publishContent
 */

import { checkRateLimit } from '../platformRateLimitService';
import { validatePublishPolicy } from '../../constants/platformPolicies';

export type PublishContentPayload = {
  content: string;
  title?: string;
  hashtags?: string[];
  media_urls?: string[];
  platform_post_id?: string;
  template_name?: string;
};

export type FetchCommentsParams = {
  platformPostId: string;
  accessToken: string;
};

export type PlatformCredentials = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
};

export type PublishResult = {
  success: boolean;
  platform_post_id?: string;
  post_url?: string;
  error?: string;
};

export type ConnectionTestResult = {
  success: boolean;
  message?: string;
  error?: string;
};

export interface IPlatformAdapter {
  readonly platformKey: string;

  /** Publish content. May throw or return error result. */
  publishContent(contentPayload: PublishContentPayload, credentials: PlatformCredentials): Promise<PublishResult>;

  /** Reply to a comment/thread. threadId is platform post or comment URN. */
  replyToComment(threadId: string, message: string, credentials: PlatformCredentials): Promise<{ success: boolean; error?: string }>;

  /** Like a comment or post. messageId is platform comment/post ID. */
  likeComment(messageId: string, credentials: PlatformCredentials): Promise<{ success: boolean; error?: string }>;

  /** Fetch comments for a platform post. Returns raw API response for normalizer. */
  fetchComments(params: FetchCommentsParams): Promise<unknown>;

  /** Test connection with credentials. */
  testConnection(credentials: PlatformCredentials): Promise<ConnectionTestResult>;
}

/**
 * Wrap a platform request with rate limit check.
 * Call at the start of each adapter method that makes platform API calls.
 */
export async function withRateLimit<T>(platformKey: string, fn: () => Promise<T>): Promise<T> {
  checkRateLimit(platformKey);
  return fn();
}

/**
 * Validate publish payload against platform policy. Throws PlatformPolicyError if invalid.
 */
export function enforcePublishPolicy(platformKey: string, payload: PublishContentPayload): void {
  validatePublishPolicy(platformKey, {
    content: payload.content,
    media_urls: payload.media_urls,
    template_name: payload.template_name,
  });
}

export type FetchJsonWithBearerOptions = {
  init?: RequestInit & { headers?: Record<string, string> };
  extraHeaders?: Record<string, string>;
  getErrorMsg?: (data: any, status: number) => string;
};

/**
 * Shared HTTP helper for Bearer-authenticated platform API calls.
 * Reduces duplication across adapters (LinkedIn, Twitter, Discord, etc.).
 */
export async function fetchJsonWithBearer(
  url: string,
  token: string,
  opts?: FetchJsonWithBearerOptions
): Promise<any> {
  const { init = {}, extraHeaders = {}, getErrorMsg } = opts ?? {};
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' }),
    ...(init.headers as Record<string, string> | undefined),
    ...extraHeaders,
  };
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const msg = getErrorMsg
      ? getErrorMsg(data, response.status)
      : data?.message || data?.error || data?.detail || data?.error_message || `Request failed (${response.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}
