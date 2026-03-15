/**
 * Platform Adapters Index
 *
 * Resolves platform key to IPlatformAdapter instance.
 * Used by engagementIngestionService and test-connection endpoint.
 */

import type { IPlatformAdapter } from './baseAdapter';
import { linkedinAdapter } from './linkedinAdapter';
import { twitterAdapter } from './twitterAdapter';
import { youtubeAdapter } from './youtubeAdapter';
import { redditAdapter } from './redditAdapter';
import { whatsappAdapter } from './whatsappAdapter';
import { pinterestAdapter } from './pinterestAdapter';
import { quoraAdapter } from './quoraAdapter';
import { slackAdapter } from './slackAdapter';
import { discordAdapter } from './discordAdapter';
import { githubDiscussionsAdapter } from './githubDiscussionsAdapter';
import { stackoverflowAdapter } from './stackoverflowAdapter';
import { productHuntAdapter } from './productHuntAdapter';

const ADAPTER_MAP: Record<string, IPlatformAdapter> = {
  linkedin: linkedinAdapter,
  twitter: twitterAdapter,
  x: twitterAdapter,
  youtube: youtubeAdapter,
  reddit: redditAdapter,
  whatsapp: whatsappAdapter,
  pinterest: pinterestAdapter,
  quora: quoraAdapter,
  slack: slackAdapter,
  discord: discordAdapter,
  github: githubDiscussionsAdapter,
  stackoverflow: stackoverflowAdapter,
  producthunt: productHuntAdapter,
};

/**
 * Get adapter for platform key. Returns null if not found.
 */
export function getPlatformAdapter(platformKey: string): IPlatformAdapter | null {
  const key = (platformKey || '').toString().trim().toLowerCase();
  const normalized = key === 'x' ? 'twitter' : key;
  return ADAPTER_MAP[normalized] ?? null;
}

export {
  linkedinAdapter,
  twitterAdapter,
  youtubeAdapter,
  redditAdapter,
  whatsappAdapter,
  pinterestAdapter,
  quoraAdapter,
  slackAdapter,
  discordAdapter,
  githubDiscussionsAdapter,
  stackoverflowAdapter,
  productHuntAdapter,
};
export type { IPlatformAdapter } from './baseAdapter';
