/**
 * Phase 5 — Central listening-connector registry.
 *
 * Single lookup table mapping platform identifier → concrete
 * ListeningConnector. Adding a new connector in future phases requires
 * exactly one line here. All execution paths (orchestrator, execution
 * service, keyword-stream meta-connector) resolve connectors only through
 * this file.
 *
 * Lookup is case-insensitive and accepts the platform aliases used in
 * social_accounts (`twitter` ↔ `x`).
 */

import type { ListeningConnector } from '../../types/listeningConnector';
import { redditListeningConnector } from './redditListeningConnector';
import { hackerNewsListeningConnector } from './hackerNewsListeningConnector';
import { githubListeningConnector } from './githubListeningConnector';
import { keywordStreamConnector } from './keywordStreamConnector';

const CONNECTORS: Record<string, ListeningConnector> = {
  reddit: redditListeningConnector,
  hackernews: hackerNewsListeningConnector,
  github: githubListeningConnector,
  keyword_stream: keywordStreamConnector,
};

const ALIASES: Record<string, string> = {
  twitter: 'x',
  'hacker_news': 'hackernews',
  'hacker-news': 'hackernews',
  hn: 'hackernews',
};

export function getListeningConnector(platform: string | null | undefined): ListeningConnector | null {
  if (!platform) return null;
  const key = platform.trim().toLowerCase();
  const resolved = ALIASES[key] ?? key;
  return CONNECTORS[resolved] ?? null;
}

export function listRegisteredConnectors(): string[] {
  return Object.keys(CONNECTORS).sort();
}
