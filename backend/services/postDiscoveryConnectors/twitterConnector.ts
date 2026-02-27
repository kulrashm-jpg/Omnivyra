import type { RawPost, SearchPostsParams } from './types';

/**
 * X (Twitter) connector for lead listening.
 * Production: replace with real public search API. Rate limit in production.
 */
export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'product';
  const posted_at = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  return [
    {
      platform: 'twitter',
      raw_text: `Tweet: Anyone know a good ${k} provider in ${region}?`,
      snippet: `Good ${k} in ${region}?`,
      source_url: `https://x.com/mock-${region}-1`,
      author_handle: 'handle_' + region.toLowerCase(),
      region,
      language: 'en',
      posted_at,
    },
  ];
}

