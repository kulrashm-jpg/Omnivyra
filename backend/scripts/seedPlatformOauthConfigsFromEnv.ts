/**
 * Seed platform_oauth_configs from environment variables.
 *
 * Run after: database/platform_oauth_configs.sql
 * Usage: npx ts-node -r dotenv/config backend/scripts/seedPlatformOauthConfigsFromEnv.ts
 *
 * Reads LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, etc. from .env,
 * encrypts credentials, and upserts into platform_oauth_configs.
 * Requires ENCRYPTION_KEY.
 */

import { supabase } from '../db/supabaseClient';
import { encryptCredential } from '../auth/credentialEncryption';

const PLATFORMS: {
  platform: string;
  envId: string;
  envSecret: string;
  authUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
}[] = [
  {
    platform: 'linkedin',
    envId: 'LINKEDIN_CLIENT_ID',
    envSecret: 'LINKEDIN_CLIENT_SECRET',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email', 'w_member_social'],
  },
  {
    platform: 'twitter',
    envId: 'TWITTER_CLIENT_ID',
    envSecret: 'TWITTER_CLIENT_SECRET',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
  },
  {
    platform: 'facebook',
    envId: 'FACEBOOK_CLIENT_ID',
    envSecret: 'FACEBOOK_CLIENT_SECRET',
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
  },
  {
    platform: 'instagram',
    envId: 'INSTAGRAM_CLIENT_ID',
    envSecret: 'INSTAGRAM_CLIENT_SECRET',
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
  },
  {
    platform: 'reddit',
    envId: 'REDDIT_CLIENT_ID',
    envSecret: 'REDDIT_CLIENT_SECRET',
    authUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
  },
  {
    platform: 'youtube',
    envId: 'YOUTUBE_CLIENT_ID',
    envSecret: 'YOUTUBE_CLIENT_SECRET',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
];

async function seed() {
  let upserted = 0;
  let skipped = 0;

  for (const p of PLATFORMS) {
    const clientId = process.env[p.envId] || process.env[p.envId.replace('_CLIENT_ID', '_APP_ID')] || '';
    const clientSecret =
      process.env[p.envSecret] || process.env[p.envSecret.replace('_CLIENT_SECRET', '_APP_SECRET')] || '';

    if (!clientId?.trim() || !clientSecret?.trim() || clientId.includes('your_')) {
      console.log(`  [${p.platform}] Skipped — no credentials in env`);
      skipped++;
      continue;
    }

    try {
      const oauth_client_id_encrypted = encryptCredential(clientId);
      const oauth_client_secret_encrypted = encryptCredential(clientSecret);

      const { error } = await supabase.from('platform_oauth_configs').upsert(
        {
          platform: p.platform,
          oauth_client_id_encrypted,
          oauth_client_secret_encrypted,
          oauth_authorize_url: p.authUrl ?? null,
          oauth_token_url: p.tokenUrl ?? null,
          oauth_scopes: p.scopes ?? [],
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'platform' }
      );

      if (error) {
        console.error(`  [${p.platform}] Error:`, error.message);
      } else {
        console.log(`  [${p.platform}] Upserted`);
        upserted++;
      }
    } catch (err: unknown) {
      console.error(`  [${p.platform}] Error:`, (err as Error)?.message);
    }
  }

  console.log(`\nDone. Upserted: ${upserted}, Skipped: ${skipped}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
