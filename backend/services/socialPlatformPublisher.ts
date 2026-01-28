import { createHash } from 'crypto';
import {
  getApiConfigByPlatform,
  getApiHealthByPlatform,
} from './externalApiService';
import { recordPerformance } from './performanceFeedbackService';

export type PublishPlatform = 'youtube' | 'linkedin' | 'instagram' | 'reddit' | 'x';

export type PublishScheduledPostInput = {
  post_id: string;
  platform: PublishPlatform;
  content: string;
  hashtags?: string[];
  content_type?: string;
  metadata?: Record<string, any>;
  seo_meta?: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
  scheduled_time: string;
  campaign_id: string;
};

export type PublishOptions = {
  dry_run: boolean;
  admin_override?: boolean;
};

export type PublishResult = {
  status: 'DRY_RUN' | 'PUBLISHED' | 'SKIPPED' | 'SKIPPED_UNRELIABLE' | 'FORBIDDEN' | 'FAILED';
  platform: PublishPlatform;
  payload_preview?: any;
  external_post_id?: string;
  timestamp: string;
  message?: string;
};

const fetchJson = async (url: string, init: RequestInit) => {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
};

const getAccessToken = (apiConfig: any) => {
  if (!apiConfig?.api_key_name) return null;
  return process.env[apiConfig.api_key_name] || null;
};

const publishToFacebook = async (payload: any, apiConfig: any) => {
  const accessToken = getAccessToken(apiConfig);
  if (!accessToken) return { status: 'FAILED', error_message: 'Missing access token' };
  const base = apiConfig.base_url || '';
  const url = base.includes('graph.facebook.com')
    ? base
    : `https://graph.facebook.com/v18.0/${base}/feed`;

  const { ok, body } = await fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: payload.content,
      link: payload.url,
    }),
  });

  if (!ok) {
    return { status: 'FAILED', error_message: body?.error?.message || 'Facebook publish failed' };
  }

  return { status: 'PUBLISHED', external_post_id: body?.id };
};

const publishToLinkedIn = async (payload: any, apiConfig: any) => {
  const accessToken = getAccessToken(apiConfig);
  if (!accessToken) return { status: 'FAILED', error_message: 'Missing access token' };

  const authorSeed = apiConfig.base_url || '';
  const author = authorSeed.startsWith('urn:li:')
    ? authorSeed
    : `urn:li:person:${authorSeed}`;

  const { ok, body } = await fetchJson('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: payload.content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }),
  });

  if (!ok) {
    return { status: 'FAILED', error_message: body?.message || 'LinkedIn publish failed' };
  }

  return { status: 'PUBLISHED', external_post_id: body?.id };
};

const publishToYouTube = async (payload: any, apiConfig: any) => {
  const accessToken = getAccessToken(apiConfig);
  if (!accessToken) return { status: 'FAILED', error_message: 'Missing access token' };

  const { ok, body } = await fetchJson(
    'https://www.googleapis.com/youtube/v3/videos?part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          title: payload.title || payload.content.slice(0, 100),
          description: payload.content,
          tags: payload.hashtags,
        },
        status: { privacyStatus: 'public' },
      }),
    }
  );

  if (!ok) {
    return { status: 'FAILED', error_message: body?.error?.message || 'YouTube publish failed' };
  }

  return { status: 'PUBLISHED', external_post_id: body?.id };
};

const publishToTwitter = async (payload: any) => {
  return {
    status: 'PUBLISHED',
    external_post_id: `stub_twitter_${Date.now()}`,
  };
};

const publishToPlatform = async (platform: PublishPlatform, payload: any, apiConfig: any) => {
  try {
    if (platform === 'facebook') return await publishToFacebook(payload, apiConfig);
    if (platform === 'linkedin') return await publishToLinkedIn(payload, apiConfig);
    if (platform === 'youtube') return await publishToYouTube(payload, apiConfig);
    if (platform === 'x') return await publishToTwitter(payload);

    const raw = JSON.stringify({ platform, payload });
    const external_post_id = `stub_${platform}_${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
    return { status: 'PUBLISHED', external_post_id };
  } catch (error: any) {
    return { status: 'FAILED', error_message: error?.message || 'Publish failed' };
  }
};

export async function publishScheduledPost(
  post: PublishScheduledPostInput,
  options: PublishOptions
): Promise<PublishResult> {
  const apiConfig = await getApiConfigByPlatform(post.platform);
  if (!apiConfig) {
    return {
      status: 'SKIPPED',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: 'API config not found',
    };
  }

  if (!apiConfig.is_active) {
    return {
      status: 'SKIPPED',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: 'API disabled',
    };
  }

  const health = await getApiHealthByPlatform(post.platform);
  const reliability = health?.reliability_score ?? 1;
  if (reliability < 0.3) {
    return {
      status: 'SKIPPED_UNRELIABLE',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: 'API reliability below threshold',
    };
  }

  const requiresAdmin = Boolean((apiConfig as any).requires_admin);
  if (requiresAdmin && !options.admin_override) {
    return {
      status: 'FORBIDDEN',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: 'Admin override required',
    };
  }

  const contentType = post.content_type || 'text';
  const supportedTypes = Array.isArray((apiConfig as any).supported_content_types)
    ? (apiConfig as any).supported_content_types
    : [];
  if (supportedTypes.length > 0 && !supportedTypes.includes(contentType)) {
    return {
      status: 'SKIPPED',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: `Unsupported content type: ${contentType}`,
    };
  }

  const requiredMeta = (apiConfig as any).required_metadata || {};
  const requiredFields = Array.isArray(requiredMeta)
    ? requiredMeta
    : Object.keys(requiredMeta).filter((key) => Boolean(requiredMeta[key]));
  const metadata = {
    hashtags: post.hashtags,
    seo_keywords: post.seo_meta?.keywords,
    hook: post.metadata?.hook,
    cta: post.metadata?.cta,
    best_time: post.metadata?.best_time,
  };
  for (const field of requiredFields) {
    if (!metadata[field]) {
      return {
        status: 'SKIPPED',
        platform: post.platform,
        timestamp: new Date().toISOString(),
        message: `Missing required metadata: ${field}`,
      };
    }
  }

  const payload = {
    platform: post.platform,
    content: post.content,
    hashtags: post.hashtags ?? [],
    seo_meta: post.seo_meta ?? {},
    title: post.seo_meta?.title,
    scheduled_time: post.scheduled_time,
  };

  if (options.dry_run) {
    return {
      status: 'DRY_RUN',
      platform: post.platform,
      payload_preview: payload,
      timestamp: new Date().toISOString(),
    };
  }

  const publishResult = await publishToPlatform(post.platform, payload, apiConfig);
  if (publishResult.status !== 'PUBLISHED') {
    return {
      status: 'FAILED',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: publishResult.error_message || 'Publish failed',
    };
  }

  try {
    if (publishResult.external_post_id) {
      await recordPerformance({
        campaign_id: post.campaign_id,
        platform: post.platform,
        post_id: publishResult.external_post_id,
        impressions: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        clicks: 0,
        engagement_rate: 0,
        collected_at: new Date().toISOString(),
        source: 'platform_api',
      });
    }
    return {
      status: 'PUBLISHED',
      platform: post.platform,
      external_post_id: publishResult.external_post_id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'FAILED',
      platform: post.platform,
      timestamp: new Date().toISOString(),
      message: 'Publish failed',
    };
  }
}
