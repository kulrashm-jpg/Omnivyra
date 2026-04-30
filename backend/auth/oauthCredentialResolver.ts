/**
 * OAuth Credential Resolver
 *
 * Resolves OAuth client_id and client_secret from global platform config.
 * Layer 1: platform_oauth_configs (Super Admin configured, per-platform).
 * Layer 2: process.env fallback during migration.
 *
 * No company-based OAuth lookup — tenants connect via Connect Accounts only.
 */

import { getPlatformOAuthConfig } from '../services/platformOauthConfigService';

const PLATFORM_ENV_MAP: Record<string, { id: string; secret: string }> = {
  ga4: { id: 'GOOGLE_ANALYTICS_CLIENT_ID', secret: 'GOOGLE_ANALYTICS_CLIENT_SECRET' },
  linkedin: { id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET' },
  youtube: { id: 'YOUTUBE_CLIENT_ID', secret: 'YOUTUBE_CLIENT_SECRET' },
  facebook: { id: 'FACEBOOK_CLIENT_ID', secret: 'FACEBOOK_CLIENT_SECRET' },
  // meta and whatsapp use the same Facebook App credentials
  meta:      { id: 'FACEBOOK_CLIENT_ID', secret: 'FACEBOOK_CLIENT_SECRET' },
  whatsapp:  { id: 'FACEBOOK_CLIENT_ID', secret: 'FACEBOOK_CLIENT_SECRET' },
  instagram: { id: 'FACEBOOK_CLIENT_ID', secret: 'FACEBOOK_CLIENT_SECRET' },
  x: { id: 'X_CLIENT_ID', secret: 'X_CLIENT_SECRET' },
  tiktok: { id: 'TIKTOK_CLIENT_ID', secret: 'TIKTOK_CLIENT_SECRET' },
  pinterest: { id: 'PINTEREST_APP_ID', secret: 'PINTEREST_APP_SECRET' },
  spotify:       { id: 'SPOTIFY_CLIENT_ID',       secret: 'SPOTIFY_CLIENT_SECRET' },
  reddit:        { id: 'REDDIT_CLIENT_ID',         secret: 'REDDIT_CLIENT_SECRET' },
  github:        { id: 'GITHUB_CLIENT_ID',         secret: 'GITHUB_CLIENT_SECRET' },
  discord:       { id: 'DISCORD_CLIENT_ID',        secret: 'DISCORD_CLIENT_SECRET' },
  medium:        { id: 'MEDIUM_CLIENT_ID',         secret: 'MEDIUM_CLIENT_SECRET' },
  stackoverflow: { id: 'STACKOVERFLOW_CLIENT_ID',  secret: 'STACKOVERFLOW_CLIENT_SECRET' },
};

export type OAuthCredentials = {
  client_id: string;
  client_secret: string;
  source: 'platform_config' | 'env';
};

/**
 * Get OAuth credentials for a platform.
 * 1. Read from platform_oauth_configs (global, Super Admin configured)
 * 2. Fallback to environment variables during migration
 * 3. Returns null if neither source has credentials
 */
export async function getOAuthCredentialsForPlatform(
  platform: string
): Promise<OAuthCredentials | null> {
  const normalized = platform.toLowerCase().replace(/^twitter$/, 'x');

  // 1. Try platform_oauth_configs (global config)
  const config = await getPlatformOAuthConfig(normalized);
  if (config?.client_id && config?.client_secret) {
    return {
      client_id: config.client_id,
      client_secret: config.client_secret,
      source: 'platform_config',
    };
  }

  // 2. Fallback to .env (migration / backward compatibility)
  const envKeys = PLATFORM_ENV_MAP[normalized];
  if (envKeys) {
    const envCandidates = [envKeys.id];
    if (normalized === 'ga4') envCandidates.push('GOOGLE_CLIENT_ID');
    if (normalized === 'x') envCandidates.push('TWITTER_CLIENT_ID');
    if (['facebook', 'meta', 'instagram', 'whatsapp'].includes(normalized)) {
      envCandidates.push('META_CLIENT_ID', 'META_APP_ID', 'FACEBOOK_APP_ID');
    }
    const secretCandidates = [envKeys.secret];
    if (normalized === 'ga4') secretCandidates.push('GOOGLE_CLIENT_SECRET');
    if (normalized === 'x') secretCandidates.push('TWITTER_CLIENT_SECRET');
    if (['facebook', 'meta', 'instagram', 'whatsapp'].includes(normalized)) {
      secretCandidates.push('META_CLIENT_SECRET', 'META_APP_SECRET', 'FACEBOOK_APP_SECRET');
    }

    const client_id = envCandidates
      .flatMap((k) => [process.env[k], process.env[k.replace('_CLIENT_ID', '_APP_ID')]])
      .find((v) => v && v.trim() && !v.includes('your_')) || '';
    const client_secret = secretCandidates
      .flatMap((k) => [process.env[k], process.env[k.replace('_CLIENT_SECRET', '_APP_SECRET')]])
      .find((v) => v && v.trim()) || '';
    if (client_id && client_secret) {
      return {
        client_id,
        client_secret,
        source: 'env',
      };
    }
  }

  return null;
}
