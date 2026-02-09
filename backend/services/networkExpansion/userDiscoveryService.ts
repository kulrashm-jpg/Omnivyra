import { supabase } from '../../db/supabaseClient';
import type { DiscoveredUser } from './discoveredUserTypes';
import { discoverUsersFromRedditRpa } from './rpaDiscoveryHandlers/redditDiscoveryRpa';

type DiscoveryInput = {
  tenant_id: string;
  organization_id: string;
  platform: 'reddit' | 'twitter' | 'instagram' | 'facebook';
  discovery_source: 'post' | 'comment' | 'thread' | 'search';
  source_url?: string;
  limit?: number;
};

type RpaDiscoveryInput = {
  tenant_id: string;
  organization_id: string;
  platform: 'reddit';
  source_url: string;
  limit?: number;
};

type DiscoveredUserStub = {
  external_user_id?: string;
  external_username?: string;
  profile_url: string;
};

const mockDiscoverFromRedditApi = async (_input: DiscoveryInput): Promise<DiscoveredUserStub[]> => {
  return [
    {
      external_user_id: 't2_reddit_user_1',
      external_username: 'reddit_user_1',
      profile_url: 'https://www.reddit.com/user/reddit_user_1',
    },
  ];
};

const mockDiscoverFromTwitterApi = async (_input: DiscoveryInput): Promise<DiscoveredUserStub[]> => {
  return [
    {
      external_user_id: 'twitter_user_1',
      external_username: 'twitter_user_1',
      profile_url: 'https://x.com/twitter_user_1',
    },
  ];
};

const mockDiscoverFromInstagramApi = async (
  _input: DiscoveryInput
): Promise<DiscoveredUserStub[]> => {
  return [
    {
      external_user_id: 'instagram_user_1',
      external_username: 'instagram_user_1',
      profile_url: 'https://www.instagram.com/instagram_user_1',
    },
  ];
};

const mockDiscoverFromFacebookApi = async (
  _input: DiscoveryInput
): Promise<DiscoveredUserStub[]> => {
  return [
    {
      external_user_id: 'facebook_user_1',
      external_username: 'facebook_user_1',
      profile_url: 'https://www.facebook.com/facebook_user_1',
    },
  ];
};

const discoverFromPlatform = async (input: DiscoveryInput): Promise<DiscoveredUserStub[]> => {
  switch (input.platform) {
    case 'reddit':
      return mockDiscoverFromRedditApi(input);
    case 'twitter':
      return mockDiscoverFromTwitterApi(input);
    case 'instagram':
      return mockDiscoverFromInstagramApi(input);
    case 'facebook':
      return mockDiscoverFromFacebookApi(input);
    default:
      return [];
  }
};

const inferDiscoverySource = (sourceUrl?: string) => {
  if (!sourceUrl) return 'search';
  const lowered = sourceUrl.toLowerCase();
  if (lowered.includes('/comments/')) return 'comment';
  if (lowered.includes('/r/')) return 'thread';
  return 'search';
};

const upsertDiscoveredUsers = async (records: Partial<DiscoveredUser>[]) => {
  if (records.length === 0) {
    return { upserted: [] };
  }

  const { data, error } = await supabase
    .from('community_ai_discovered_users')
    .upsert(records, {
      onConflict: 'tenant_id,organization_id,platform,profile_url',
    })
    .select('*');

  if (error) {
    throw new Error(`Failed to upsert discovered users: ${error.message}`);
  }

  return { upserted: data || [] };
};

export const discoverUsersFromApi = async (input: DiscoveryInput) => {
  const discovered = await discoverFromPlatform(input);
  const now = new Date().toISOString();

  const records: Partial<DiscoveredUser>[] = discovered.map((user) => ({
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    platform: input.platform,
    external_user_id: user.external_user_id,
    external_username: user.external_username,
    profile_url: user.profile_url,
    discovered_via: 'api',
    discovery_source: input.discovery_source,
    source_url: input.source_url,
    classification: 'unknown',
    eligible_for_engagement: true,
    last_seen_at: now,
  }));

  const { upserted } = await upsertDiscoveredUsers(records);
  return { discovered, upserted };
};

export const discoverUsersFromRpa = async (input: RpaDiscoveryInput) => {
  try {
    const limit = typeof input.limit === 'number' ? input.limit : undefined;
    let discovered: DiscoveredUserStub[] = [];
    if (input.platform === 'reddit') {
      discovered = await discoverUsersFromRedditRpa({
        tenant_id: input.tenant_id,
        organization_id: input.organization_id,
        source_url: input.source_url,
        limit,
      });
    }

    const now = new Date().toISOString();
    const discoverySource = inferDiscoverySource(input.source_url);
    const records: Partial<DiscoveredUser>[] = discovered.map((user) => ({
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
      platform: input.platform,
      external_username: user.external_username,
      profile_url: user.profile_url,
      discovered_via: 'rpa',
      discovery_source: discoverySource,
      source_url: input.source_url,
      classification: 'unknown',
      eligible_for_engagement: true,
      last_seen_at: now,
    }));

    const { upserted } = await upsertDiscoveredUsers(records);
    return { discovered, upserted };
  } catch (error: any) {
    return { discovered: [], upserted: [], error: error?.message || 'RPA_DISCOVERY_FAILED' };
  }
};
