/**
 * Platform Registry Service
 *
 * Provides controlled platform list, capability lookup, and validation.
 * Uses platform_registry table when available; falls back to in-memory defaults.
 */

import { supabase } from '../db/supabaseClient';

export type PlatformCapabilities = {
  platform_key: string;
  platform_label: string;
  api_base_url: string;
  auth_type: string;
  supports_publishing: boolean;
  supports_replies: boolean;
  supports_comments: boolean;
  supports_threads: boolean;
  supports_video: boolean;
  supports_ingestion: boolean;
  platform_category?: 'social' | 'community';
};

export type PlatformRegistryEntry = PlatformCapabilities & {
  created_at?: string | null;
};

// Fallback when DB not yet migrated
const FALLBACK_REGISTRY: PlatformRegistryEntry[] = [
  {
    platform_key: 'linkedin',
    platform_label: 'LinkedIn',
    api_base_url: 'https://api.linkedin.com/v2',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: false,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'twitter',
    platform_label: 'Twitter/X',
    api_base_url: 'https://api.twitter.com/2',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: true,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'youtube',
    platform_label: 'YouTube',
    api_base_url: 'https://www.googleapis.com/youtube/v3',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: false,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'reddit',
    platform_label: 'Reddit',
    api_base_url: 'https://oauth.reddit.com/api',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'facebook',
    platform_label: 'Facebook',
    api_base_url: 'https://graph.facebook.com/v18.0',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: false,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'instagram',
    platform_label: 'Instagram',
    api_base_url: 'https://graph.instagram.com',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: false,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'tiktok',
    platform_label: 'TikTok',
    api_base_url: 'https://open.tiktokapis.com/v2',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: false,
    supports_video: true,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'whatsapp',
    platform_label: 'WhatsApp Business',
    api_base_url: 'https://graph.facebook.com/v18.0',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: false,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'social',
  },
  {
    platform_key: 'pinterest',
    platform_label: 'Pinterest',
    api_base_url: 'https://api.pinterest.com/v5',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: false,
    supports_comments: true,
    supports_threads: false,
    supports_video: false,
    supports_ingestion: true,
  },
  {
    platform_key: 'quora',
    platform_label: 'Quora',
    api_base_url: 'https://api.quora.com',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: false,
    platform_category: 'social',
  },
  {
    platform_key: 'slack',
    platform_label: 'Slack Communities',
    api_base_url: 'https://slack.com/api',
    auth_type: 'oauth',
    supports_publishing: false,
    supports_replies: false,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
  {
    platform_key: 'discord',
    platform_label: 'Discord',
    api_base_url: 'https://discord.com/api/v10',
    auth_type: 'oauth',
    supports_publishing: false,
    supports_replies: false,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
  {
    platform_key: 'github',
    platform_label: 'GitHub Discussions',
    api_base_url: 'https://api.github.com',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
  {
    platform_key: 'stackoverflow',
    platform_label: 'Stack Overflow',
    api_base_url: 'https://api.stackexchange.com/2.3',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: true,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
  {
    platform_key: 'producthunt',
    platform_label: 'Product Hunt',
    api_base_url: 'https://api.producthunt.com/v2',
    auth_type: 'oauth',
    supports_publishing: true,
    supports_replies: false,
    supports_comments: true,
    supports_threads: false,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
  {
    platform_key: 'hackernews',
    platform_label: 'Hacker News',
    api_base_url: 'https://hacker-news.firebaseio.com/v0',
    auth_type: 'oauth',
    supports_publishing: false,
    supports_replies: false,
    supports_comments: true,
    supports_threads: true,
    supports_video: false,
    supports_ingestion: true,
    platform_category: 'community',
  },
];

/**
 * Get all supported platforms from registry.
 */
export async function getSupportedPlatforms(): Promise<PlatformRegistryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('platform_registry')
      .select('*')
      .order('platform_label', { ascending: true });

    if (error) {
      console.warn('[platformRegistry] Table may not exist, using fallback:', error.message);
      return FALLBACK_REGISTRY;
    }
    if (data && data.length > 0) {
      return data as PlatformRegistryEntry[];
    }
    return FALLBACK_REGISTRY;
  } catch (e) {
    console.warn('[platformRegistry] Error loading registry, using fallback:', (e as Error)?.message);
    return FALLBACK_REGISTRY;
  }
}

/**
 * Get capabilities for a platform by key.
 */
export async function getPlatformCapabilities(platformKey: string): Promise<PlatformCapabilities | null> {
  const normalized = (platformKey || '').toString().trim().toLowerCase();
  if (!normalized) return null;
  const alias = normalized === 'x' ? 'twitter' : normalized;

  try {
    const { data, error } = await supabase
      .from('platform_registry')
      .select('*')
      .eq('platform_key', alias)
      .maybeSingle();

    if (!error && data) {
      return data as PlatformCapabilities;
    }
    const fallback = FALLBACK_REGISTRY.find((p) => p.platform_key === alias);
    return fallback ?? null;
  } catch {
    return FALLBACK_REGISTRY.find((p) => p.platform_key === alias) ?? null;
  }
}

/**
 * Validate that a platform key is supported.
 */
export async function validatePlatformKey(platformKey: string): Promise<boolean> {
  const caps = await getPlatformCapabilities(platformKey);
  return caps !== null;
}

/**
 * Get platform category (social | community). Returns 'social' for unknown.
 */
export async function getPlatformCategory(platformKey: string): Promise<'social' | 'community'> {
  const caps = await getPlatformCapabilities(platformKey);
  return (caps?.platform_category as 'social' | 'community') ?? 'social';
}
