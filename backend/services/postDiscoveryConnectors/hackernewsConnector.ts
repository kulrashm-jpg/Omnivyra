import type { RawPost, SearchPostsParams } from './types';

export async function searchPosts(params: SearchPostsParams): Promise<RawPost[]> {
  const { region, keywords } = params;
  const k = keywords.length ? keywords[0] : 'marketing intelligence';
  const posted_at = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  return [
    {
      platform: 'hackernews',
      raw_text: `HN: Looking for ${k} tools with solid workflows for teams operating in ${region}.`,
      snippet: `Looking for ${k} tools for teams in ${region}.`,
      source_url: `https://news.ycombinator.com/item?id=mock-${region.toLowerCase()}-1`,
      author_handle: `hn_${region.toLowerCase()}`,
      region,
      language: 'en',
      posted_at,
    },
  ];
}
