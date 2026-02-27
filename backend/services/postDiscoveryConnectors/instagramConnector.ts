import type { RawPost, SearchPostsParams } from './types';

export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'brand';
  const posted_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  return [
    {
      platform: 'instagram',
      raw_text: `Public post about ${k} in ${region}. Interested in solutions.`,
      snippet: `Interested in ${k}...`,
      source_url: `https://instagram.com/p/mock-${region}-1`,
      author_handle: 'user_' + region.toLowerCase(),
      region,
      language: 'en',
      posted_at,
    },
  ];
}

