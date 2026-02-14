import type { RawPost, SearchPostsParams } from './types';

/**
 * Facebook connector for lead listening.
 * Production: replace with real public search API. Rate limit in production.
 */
export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'topic';
  const posted_at = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  return [
    {
      platform: 'facebook',
      raw_text: `Public discussion: ${k} in ${region}. Looking for recommendations.`,
      snippet: `Looking for ${k}...`,
      source_url: `https://facebook.com/mock-${region}-1`,
      author_handle: 'page_' + region.toLowerCase(),
      region,
      language: 'en',
      posted_at,
    },
  ];
}
