/** Shared types for lead-engine social connectors. */
export type RawPost = {
  platform: string;
  raw_text: string;
  snippet: string;
  source_url: string;
  author_handle?: string;
  region?: string;
  language?: string;
  /** ISO date string; used for freshness scoring (<48h bonus, >30d penalty). */
  posted_at?: string;
};

export type SearchPostsParams = {
  region: string;
  keywords: string[];
};
