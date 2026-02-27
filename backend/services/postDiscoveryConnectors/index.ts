import type { RawPost, SearchPostsParams } from './types';
import { searchPosts as instagramSearch } from './instagramConnector';
import { searchPosts as facebookSearch } from './facebookConnector';
import { searchPosts as twitterSearch } from './twitterConnector';
import { searchPosts as redditSearch } from './redditConnector';
import { searchPosts as linkedinSearch } from './linkedinConnector';

const CONNECTORS: Record<string, (params: SearchPostsParams) => Promise<RawPost[]>> = {
  instagram: instagramSearch,
  facebook: facebookSearch,
  twitter: twitterSearch,
  x: twitterSearch,
  reddit: redditSearch,
  linkedin: linkedinSearch,
};

export type { RawPost, SearchPostsParams };

export function getConnector(platform: string): ((params: SearchPostsParams) => Promise<RawPost[]>) | null {
  const key = String(platform || '').toLowerCase().trim();
  return CONNECTORS[key] ?? null;
}

export function getSupportedPlatforms(): string[] {
  return Object.keys(CONNECTORS);
}

