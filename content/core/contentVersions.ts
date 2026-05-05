import type { ContentBlock } from '../../lib/blog/blockTypes';

export type ContentVersion = {
  version: number;
  blocks: ContentBlock[];
  timestamp: string;
  actor: string;
};

export function createContentVersion(input: {
  previousVersions?: ContentVersion[];
  blocks: ContentBlock[];
  actor: string;
  timestamp?: string;
}): ContentVersion {
  const latestVersion = Math.max(0, ...(input.previousVersions || []).map((version) => version.version));
  return {
    version: latestVersion + 1,
    blocks: input.blocks,
    timestamp: input.timestamp || new Date().toISOString(),
    actor: input.actor,
  };
}
