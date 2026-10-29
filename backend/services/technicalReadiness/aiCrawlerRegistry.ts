/**
 * Technical readiness — the versioned registry of crawler product tokens evaluated against a
 * site's robots.txt.
 *
 * Vendors rename and add tokens; the registry carries a version so every finding states which
 * list it was evaluated against. `kind` exists so a report never conflates a training crawler,
 * a search crawler, a user-initiated fetcher and a CONTROL TOKEN (a robots.txt-only token that
 * performs no fetches of its own — e.g. Google-Extended is honoured by Googlebot's fetches).
 */
export const AI_AGENT_REGISTRY_VERSION = '2026-10-29.1';

export type CrawlerKind =
  | 'search_crawler'
  | 'training_crawler'
  | 'user_initiated_fetcher'
  | 'control_token'
  | 'dataset_crawler';

export type CrawlerToken = {
  token: string;
  operator: string;
  kind: CrawlerKind;
  /** Legacy tokens are still evaluated, and labelled as such. */
  legacy?: boolean;
  /** Fixed caveat printed with this token's finding, when the vendor documents one. */
  note?: string;
};

export const AI_CRAWLER_REGISTRY: readonly CrawlerToken[] = [
  { token: 'GPTBot', operator: 'OpenAI', kind: 'training_crawler' },
  { token: 'OAI-SearchBot', operator: 'OpenAI', kind: 'search_crawler' },
  { token: 'ChatGPT-User', operator: 'OpenAI', kind: 'user_initiated_fetcher', note: 'User-initiated fetches; the operator documents that robots.txt may not govern them.' },
  { token: 'ClaudeBot', operator: 'Anthropic', kind: 'training_crawler' },
  { token: 'Claude-SearchBot', operator: 'Anthropic', kind: 'search_crawler' },
  { token: 'Claude-User', operator: 'Anthropic', kind: 'user_initiated_fetcher' },
  { token: 'anthropic-ai', operator: 'Anthropic', kind: 'training_crawler', legacy: true },
  { token: 'Claude-Web', operator: 'Anthropic', kind: 'user_initiated_fetcher', legacy: true },
  { token: 'PerplexityBot', operator: 'Perplexity', kind: 'search_crawler' },
  { token: 'Perplexity-User', operator: 'Perplexity', kind: 'user_initiated_fetcher', note: 'User-initiated fetches; the operator documents that robots.txt may not govern them.' },
  { token: 'Google-Extended', operator: 'Google', kind: 'control_token', note: 'A robots.txt control token, not a crawler: it governs use of Googlebot-fetched content for Gemini. It does not control Google Search or AI Overviews.' },
  { token: 'Googlebot', operator: 'Google', kind: 'search_crawler' },
  { token: 'Bingbot', operator: 'Microsoft', kind: 'search_crawler' },
  { token: 'CCBot', operator: 'Common Crawl', kind: 'dataset_crawler' },
  { token: 'Applebot', operator: 'Apple', kind: 'search_crawler' },
  { token: 'Applebot-Extended', operator: 'Apple', kind: 'control_token', note: 'A robots.txt control token, not a crawler: it governs use of Applebot-fetched content for Apple AI training.' },
];
