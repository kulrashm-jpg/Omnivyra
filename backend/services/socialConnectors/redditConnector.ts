import type { RawPost, SearchPostsParams } from './types';

export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'service';
  const posted_at = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  return [
    {
      platform: 'reddit',
      raw_text: `[r/ask] Best ${k} for small business in ${region}?`,
      snippet: `Best ${k} in ${region}?`,
      source_url: `https://reddit.com/r/mock/comments/mock-${region}-1`,
      author_handle: 'u/mock_' + region.toLowerCase(),
      region,
      language: 'en',
      posted_at,
    },
  ];
}
