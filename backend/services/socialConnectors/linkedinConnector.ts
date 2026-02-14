import type { RawPost, SearchPostsParams } from './types';

export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'solution';
  const posted_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      platform: 'linkedin',
      raw_text: `Post: Exploring ${k} options in ${region}. Open to suggestions.`,
      snippet: `Exploring ${k} in ${region}...`,
      source_url: `https://linkedin.com/feed/update/mock-${region}-1`,
      author_handle: 'linkedin_' + region.toLowerCase(),
      region,
      language: 'en',
      posted_at,
    },
  ];
}
