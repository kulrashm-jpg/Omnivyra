/**
 * Facebook Adapter
 *
 * Publishes posts to Facebook Pages using the Facebook Graph API.
 *
 * Token model: page_access_token is persisted on social_accounts at OAuth time
 * (and refreshed in lockstep with the parent meta_oauth_connections row).
 * The adapter NEVER calls /me/accounts on the publish path — it reads the
 * stored Page Access Token directly.
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';
import { assertMockPlatformsAllowed } from '../services/mockGuard';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { META_GRAPH_VERSION } from '../auth/metaAuthService';
import crypto from 'crypto';

const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

interface ScheduledPost {
  id: string;
  platform: string;
  content: string;
  title?: string;
  hashtags?: string[];
  media_urls?: string[];
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string;
  username?: string;
}

interface Token {
  access_token: string;
  token_type?: string;
}

function getEncryptionKey(): Buffer {
  const env = (config.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '').trim();
  if (!env) throw new Error('ENCRYPTION_KEY missing');
  if (env.length === 64 && /^[0-9a-fA-F]+$/.test(env)) {
    return Buffer.from(env, 'hex');
  }
  const buf = Buffer.from(env, 'base64');
  if (buf.length !== KEY_LENGTH) throw new Error('ENCRYPTION_KEY wrong length');
  return buf;
}

function decryptEnvelope(encrypted: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid token envelope');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let out = decipher.update(dataHex, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

async function loadStoredPageAccessToken(socialAccountId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('page_access_token, is_active, is_system_user')
    .eq('id', socialAccountId)
    .single();
  if (error || !data) return null;
  if (!data.is_active) return null;
  if (!data.page_access_token) return null;
  try {
    return decryptEnvelope(data.page_access_token);
  } catch {
    return null;
  }
}

export async function publishToFacebook(
  post: ScheduledPost,
  account: SocialAccount,
  _token: Token,
): Promise<PublishResult> {
  if (config.USE_MOCK_PLATFORMS === true) {
    assertMockPlatformsAllowed('facebookAdapter');
    console.log('🧪 MOCK MODE: Simulating Facebook post');
    return {
      success: true,
      platform_post_id: `mock_facebook_${Date.now()}`,
      post_url: `https://www.facebook.com/${account.platform_user_id}/posts/${Date.now()}`,
      published_at: new Date(),
    };
  }

  const pageAccessToken = await loadStoredPageAccessToken(account.id);
  if (!pageAccessToken) {
    return {
      success: false,
      error: {
        code: 'FACEBOOK_PERMISSION_DENIED',
        message:
          'No Page Access Token available for this Facebook Page. Reconnect Facebook from the Social Platforms page; the connection grants pages_show_list, pages_read_engagement, and pages_manage_posts which produce the page-scoped token.',
        retryable: false,
      },
    };
  }

  try {
    const pageId = account.platform_user_id;
    const apiUrl = `${META_GRAPH}/${pageId}/feed`;

    const formatted = formatContentForPlatform(post.content, 'facebook', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    if (formatted.warnings.length > 0) {
      console.warn('⚠️ Facebook content formatting warnings:', formatted.warnings);
    }

    let message = formatted.text;
    if (formatted.hashtags.length > 0) {
      message += ' ' + formatted.hashtags.join(' ');
    }

    const payload: Record<string, string> = {
      message,
      access_token: pageAccessToken,
    };

    if (post.media_urls && post.media_urls.length > 0) {
      const firstMedia = post.media_urls[0];
      const isVideo = firstMedia.match(/\.(mp4|mov|avi|webm)$/i);
      const isImage = firstMedia.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      if (isImage) {
        payload.link = firstMedia;
      } else if (isVideo) {
        payload.source = firstMedia;
        if (post.title || post.content) {
          payload.description = post.title || formatted.text;
        }
      }
    }

    if (formatted.links.length > 0 && (!post.media_urls || post.media_urls.length === 0)) {
      payload.link = formatted.links[0];
    }

    const response = await axios.post(apiUrl, null, { params: payload });

    const postId = response.data.id;
    const postIdPart = postId.split('_').pop();
    const postUrl = `https://www.facebook.com/${pageId}/posts/${postIdPart}`;

    console.log(`✅ Facebook post published: ${postUrl}`);

    return {
      success: true,
      platform_post_id: postId,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('Facebook API error:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'FACEBOOK_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect Facebook account.',
          retryable: false,
        },
      };
    }

    if (error.response?.status === 403) {
      const errorData = error.response?.data?.error || {};
      return {
        success: false,
        error: {
          code: 'FACEBOOK_PERMISSION_DENIED',
          message: `Permission denied: ${errorData.message || 'Insufficient permissions'}.`,
          retryable: false,
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'FACEBOOK_RATE_LIMIT',
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true,
        },
      };
    }

    if (error.response?.status === 400) {
      const errorData = error.response?.data?.error || {};
      return {
        success: false,
        error: {
          code: 'FACEBOOK_VALIDATION_ERROR',
          message: errorData.message || 'Invalid post content',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'FACEBOOK_API_ERROR',
        message: error.response?.data?.error?.message || error.message,
        retryable: true,
      },
    };
  }
}
