import type { NextRouter } from 'next/router';
import {
  assetLabel,
  buildAssetCompositionIntent,
  creatorLayoutForAsset,
  creatorRouteTypeForAsset,
  resolveAttachmentModeFromIntent,
  type AssetCompositionIntent,
  type AttachmentMode,
  type SourceTextTransform,
  type WriterCreatorAssetType,
} from './writerCreatorAttachmentContracts';
import {
  getPostAllowedAssetTypes as _getPostAllowedAssetTypes,
  getThreadAllowedAssetTypes as _getThreadAllowedAssetTypes,
} from '../../backend/services/creator/intelligence/canonical/creatorAssetRegistry';
import { createAttachmentSession } from './creatorAttachmentSession';

export type WriterSourceType = 'post' | 'thread';
export type CreatorAssetLaunchType = WriterCreatorAssetType;

export type WriterOverlayText = {
  hook: string;
  headline: string;
  keyInsight: string;
  cta: string;
  supportingText: string;
};

export type WriterCreatorSourcePayload = {
  id: string;
  sourceType: WriterSourceType;
  sourceId: string;
  title: string;
  body: string;
  audience?: string;
  tone?: string;
  platform?: string;
  hashtags?: string[];
  companyName?: string;
  brandContext?: Record<string, unknown>;
  compositionIntent: AssetCompositionIntent;
  createdAt: string;
};

export type WriterAttachedAsset = {
  id: string;
  creatorType: CreatorAssetLaunchType;
  title: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  attachmentMode?: AttachmentMode;
  compositionIntent?: AssetCompositionIntent;
  platformContext?: string;
  renderIdentityHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

/**
 * Derived from CREATOR_ASSET_REGISTRY (Phase 1 unification).
 * `writer_source_eligibility: ['post']` on a canonical entry surfaces
 * its subtypes here; same for thread. No parallel hardcoded arrays.
 */
export const POST_CREATOR_ASSET_TYPES: CreatorAssetLaunchType[] =
  Array.from(_getPostAllowedAssetTypes()) as CreatorAssetLaunchType[];

export const THREAD_CREATOR_ASSET_TYPES: CreatorAssetLaunchType[] =
  Array.from(_getThreadAllowedAssetTypes()) as CreatorAssetLaunchType[];

/**
 * Taxonomy consolidation — UI-facing subset of the writer-attachable
 * creator types. Removes `banner` (now an Image layout) so the writer
 * "Add Asset" menu surfaces only the 3 consolidated primary types
 * plus brand_card. The underlying POST_CREATOR_ASSET_TYPES /
 * THREAD_CREATOR_ASSET_TYPES arrays remain unfiltered for backward
 * compat — historical attachments saved as `banner` still load,
 * render, and label correctly via the alias map + assetLabel().
 *
 * IMPORTANT: do NOT filter at the canonical registry. The runtime
 * normalization (`runtime_asset_types`) depends on the full list. Only
 * the user-facing PICKER chips are reduced here.
 */
const CONSOLIDATION_HIDDEN_TYPES: ReadonlySet<CreatorAssetLaunchType> = new Set([
  'banner' as CreatorAssetLaunchType,
]);

export const POST_CREATOR_ASSET_TYPES_VISIBLE: CreatorAssetLaunchType[] =
  POST_CREATOR_ASSET_TYPES.filter((t) => !CONSOLIDATION_HIDDEN_TYPES.has(t));

export const THREAD_CREATOR_ASSET_TYPES_VISIBLE: CreatorAssetLaunchType[] =
  THREAD_CREATOR_ASSET_TYPES.filter((t) => !CONSOLIDATION_HIDDEN_TYPES.has(t));

export function getWriterAttachedAssetsKey(sourceType: WriterSourceType, sourceId: string): string {
  return `writer_attached_assets_${sourceType}_${sourceId || 'draft'}`;
}

export function getWriterCreatorPrefillKey(token: string): string {
  return `writer_creator_prefill_${token}`;
}

export function createWriterSourceId(sourceType: WriterSourceType, id?: string | null): string {
  return `${sourceType}:${String(id || 'draft').trim() || 'draft'}`;
}

export function readWriterAttachedAssets(sourceType: WriterSourceType, sourceId: string): WriterAttachedAsset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getWriterAttachedAssetsKey(sourceType, sourceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as WriterAttachedAsset[] : [];
  } catch {
    return [];
  }
}

export function appendWriterAttachedAsset(
  sourceType: WriterSourceType,
  sourceId: string,
  asset: WriterAttachedAsset,
): void {
  if (typeof window === 'undefined') return;
  const current = readWriterAttachedAssets(sourceType, sourceId);
  const deduped = current.filter((item) => item.id !== asset.id);
  window.localStorage.setItem(
    getWriterAttachedAssetsKey(sourceType, sourceId),
    JSON.stringify([asset, ...deduped].slice(0, 12)),
  );
}

export async function loadWriterAttachedAssetsDurable(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
}): Promise<WriterAttachedAsset[]> {
  const local = readWriterAttachedAssets(input.sourceType, input.sourceId);
  if (!input.companyId || typeof window === 'undefined') return local;
  try {
    const params = new URLSearchParams({
      company_id: input.companyId,
      source_type: input.sourceType,
      source_id: input.sourceId,
    });
    const response = await fetch(`/api/creator-assets/attachments?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) return local;
    const data = await response.json().catch(() => ({}));
    const remote = Array.isArray(data.attachments) ? data.attachments as WriterAttachedAsset[] : [];
    if (remote.length > 0) {
      try {
        window.localStorage.setItem(getWriterAttachedAssetsKey(input.sourceType, input.sourceId), JSON.stringify(remote.slice(0, 12)));
      } catch {
        // Keep durable result even when local fallback cannot be refreshed.
      }
      return remote;
    }
    return local;
  } catch {
    return local;
  }
}

export async function appendWriterAttachedAssetDurable(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
  asset: WriterAttachedAsset;
  sourceContent?: Record<string, unknown>;
}): Promise<WriterAttachedAsset> {
  appendWriterAttachedAsset(input.sourceType, input.sourceId, input.asset);
  if (!input.companyId || typeof window === 'undefined') return input.asset;
  try {
    const response = await fetch('/api/creator-assets/attachments', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: input.companyId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        asset: input.asset,
        source_content: input.sourceContent || null,
      }),
    });
    if (!response.ok) return input.asset;
    const data = await response.json().catch(() => ({}));
    return (data.attachment || input.asset) as WriterAttachedAsset;
  } catch {
    return input.asset;
  }
}

export function buildWriterCreatorPrefill(input: {
  sourceType: WriterSourceType;
  sourceId: string;
  assetType: CreatorAssetLaunchType;
  attachmentMode?: AttachmentMode;
  sourceTextTransform?: SourceTextTransform;
  title: string;
  body: string;
  audience?: string;
  tone?: string;
  platform?: string;
  hashtags?: string[];
  companyName?: string;
  brandContext?: Record<string, unknown>;
}): WriterCreatorSourcePayload {
  // Phase 3 fix — resolve attachment_mode from prefill signals so the
  // session payload that lands on the Direct route already carries a
  // semantically-aligned mode. The Direct API normalize layer also
  // resolves (belt-and-braces), but resolving here means the prefill
  // UI and the API see the same mode and there's no flicker between
  // launch and submit.
  const resolution = resolveAttachmentModeFromIntent({
    assetType: input.assetType,
    requestedMode: input.attachmentMode ?? null,
    sourceText: input.body,
    sourceTextTransform: input.sourceTextTransform ?? null,
    freeFormIntent: [input.tone],
  });
  return {
    id: `${input.sourceType}-${Date.now()}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    body: input.body,
    audience: input.audience,
    tone: input.tone,
    platform: input.platform,
    hashtags: input.hashtags,
    companyName: input.companyName,
    brandContext: input.brandContext,
    compositionIntent: buildAssetCompositionIntent({
      assetType: input.assetType,
      attachmentMode: resolution.mode,
      sourceTextTransform: input.sourceTextTransform,
    }),
    createdAt: new Date().toISOString(),
  };
}

export function launchCreatorFromWriter(input: {
  router: NextRouter;
  assetType: CreatorAssetLaunchType;
  source: WriterCreatorSourcePayload;
}): void {
  if (typeof window === 'undefined') return;
  const routeType = creatorRouteTypeForAsset(input.assetType);
  // Taxonomy consolidation — when the writer assetType maps to a different route
  // type (e.g., banner → image), include a layout preset so the consolidated
  // workflow opens on the correct preset.
  const layoutPreset = creatorLayoutForAsset(input.assetType);
  const returnTo = `${window.location.pathname}${window.location.search}`;
  // CANONICAL LIFECYCLE: the writer launch is just an adapter that creates the
  // ONE CreatorAttachmentSession (launch context + return destination + draft +
  // routing/composition consolidated into a single object/key). The generation
  // page and return read the session — no scattered prefill key / return_to.
  const session = createAttachmentSession({
    source: 'writer',
    launchContext: input.source,
    returnDestination: returnTo,
    assetType: input.assetType,
    attachmentMode: input.source.compositionIntent.attachmentMode,
    sourceTextTransform: input.source.compositionIntent.copyPolicy?.sourceTextTransform ?? null,
    layout: layoutPreset,
    platform: input.source.platform ?? null,
  });
  // Enter the canonical Creator workflow at the TEMPLATE GALLERY (one pipeline),
  // requesting the optional helper stages be skipped (post content already exists).
  void input.router.push({
    pathname: `/command-center/creator-content/${routeType}/templates`,
    query: {
      source: 'writer',
      session: session.token,
      skip_blueprint: '1',
      skip_ingestion: '1',
      ...(layoutPreset ? { layout: layoutPreset } : {}),
      ...(input.source.platform ? { platform: input.source.platform } : {}),
    },
  });
}

export { assetLabel };
