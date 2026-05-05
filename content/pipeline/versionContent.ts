import { createContentVersion, type ContentVersion } from '../core/contentVersions';
import { validateBlocks, validateContentOrThrow } from '../core/contentValidator';
import { sanitizeBlocks } from '../engine/sanitizer';
import {
  createContentVersion as insertContentAssetVersion,
  getContentAssetById,
  listContentVersions as listContentAssetVersions,
  updateContentAssetStatus,
} from '../../backend/db/contentAssetStore';
import type { ContentBlock } from '../../lib/blog/blockTypes';

export type VersionContentInput = {
  assetId?: string;
  blocks: ContentBlock[];
  actor: string;
  reason?: string;
  previousVersions?: ContentVersion[];
};

export async function recordContentVersion(input: VersionContentInput): Promise<ContentVersion> {
  const blocks = sanitizeBlocks(validateBlocks(input.blocks));
  const previousVersions = input.assetId
    ? await getContentVersions(input.assetId)
    : input.previousVersions;

  const version = createContentVersion({
    previousVersions,
    blocks,
    actor: input.actor,
  });

  if (input.assetId) {
    await insertContentAssetVersion({
      assetId: input.assetId,
      version: version.version,
      content: version,
      reason: input.reason,
    });
  }

  return version;
}

function rowToContentVersion(row: any): ContentVersion & { versionId?: string } {
  const content = row?.content_json ?? {};
  const validated = validateContentOrThrow({
    type: content.type ?? content.meta?.type ?? 'blog',
    blocks: content.blocks,
    state: content.state ?? 'validated',
  });

  return {
    versionId: row?.version_id ? String(row.version_id) : undefined,
    version: Number(row?.version ?? content.version) || 0,
    blocks: sanitizeBlocks(validated.blocks),
    timestamp: String(row?.created_at || content.timestamp || new Date().toISOString()),
    actor: String(content.actor || 'system'),
  };
}

export async function getContentVersions(contentId: string): Promise<Array<ContentVersion & { versionId?: string }>> {
  const rows = await listContentAssetVersions(contentId);
  return rows.map((row) => rowToContentVersion(row));
}

export async function getLatestVersion(contentId: string): Promise<(ContentVersion & { versionId?: string }) | null> {
  const versions = await getContentVersions(contentId);
  return versions[versions.length - 1] ?? null;
}

export async function restoreVersion(contentId: string, versionId: string | number, actor?: string): Promise<ContentVersion>;
export async function restoreVersion(input: {
  contentId: string;
  versionId: string | number;
  actor?: string;
}): Promise<ContentVersion>;
export async function restoreVersion(
  contentIdOrInput: string | { contentId: string; versionId: string | number; actor?: string },
  versionId?: string | number,
  actor?: string,
): Promise<ContentVersion> {
  const input = typeof contentIdOrInput === 'string'
    ? { contentId: contentIdOrInput, versionId: versionId as string | number, actor }
    : contentIdOrInput;

  if (input.versionId === undefined || input.versionId === null) {
    throw new Error('Content version id is required');
  }

  const asset = await getContentAssetById(input.contentId);
  if (!asset) {
    throw new Error('Content asset not found');
  }

  const rows = await listContentAssetVersions(input.contentId);
  const target = rows.find((row: any) =>
    String(row.version_id) === String(input.versionId) ||
    String(row.version) === String(input.versionId),
  );
  if (!target) {
    throw new Error('Content version not found');
  }

  const restored = rowToContentVersion(target);
  const nextVersion = createContentVersion({
    previousVersions: await getContentVersions(input.contentId),
    blocks: sanitizeBlocks(validateBlocks(restored.blocks)),
    actor: input.actor || restored.actor || 'system',
  });

  await insertContentAssetVersion({
    assetId: input.contentId,
    version: nextVersion.version,
    content: nextVersion,
    reason: `Restored from version ${restored.version}`,
  });
  await updateContentAssetStatus({
    assetId: input.contentId,
    status: asset.status ?? 'draft',
    currentVersion: nextVersion.version,
  });

  return nextVersion;
}
