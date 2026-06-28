/**
 * Image asset-slot editor actions (CREATOR-038, STEP 4/6/7).
 *
 * Bridges the existing ImageBlockEditor `assetActions` toolbar to the asset
 * realization engine + real infrastructure. Each action mutates exactly ONE
 * slot + ONE block and commits via `apply` — nothing else in the document is
 * read or touched (STEP 6/7). Pure and injectable: the browser-bound bits
 * (file picker / URL prompt / library modals) are supplied by the host, so this
 * is fully unit-testable without a DOM.
 *
 * Action keys are present ONLY when their capability is wired — no dead buttons.
 */

import type { ImageBlock } from '../blog/blockTypes';
import type { AssetSlotActions } from '../../components/content/blocks/ImageBlockEditor';
import {
  applySlotToBlocks, regenerateSlot, applyUploadToSlot, applyUrlToSlot, removeSlotAsset,
  applyLibraryAssetToSlot, type AssetSlot, type AssetProvider, type RealizationContext,
} from './assetRealization';

export interface UploadResult { url: string; altText?: string; caption?: string }

export interface ImageAssetActionDeps {
  block: ImageBlock;
  slot: AssetSlot;
  providers: AssetProvider[];
  ctx: RealizationContext;
  /** Commit the updated block + slot back into editor state (the ONLY write). */
  apply: (block: ImageBlock, slot: AssetSlot) => void;
  /** Open a file picker, upload via the existing media service, resolve the URL. */
  pickUpload?: () => Promise<UploadResult | null>;
  /** Prompt for / resolve an external URL to import. */
  pickUrl?: () => Promise<string | null> | string | null;
  /** Pick from the organization/brand asset library. */
  pickOrganizationAsset?: () => Promise<UploadResult | null>;
  /** Open the media library modal (host-owned; commits via apply later). */
  openMediaLibrary?: () => void;
  /** Monotonic timestamp for history entries (host supplies; engine stays pure). */
  stamp?: () => number;
}

function toBlock(block: ImageBlock, slot: AssetSlot): ImageBlock {
  return applySlotToBlocks([block], slot)[0] as ImageBlock;
}

/** Build the wired action set for one image slot. */
export function buildImageAssetActions(deps: ImageAssetActionDeps): AssetSlotActions {
  const { block, slot, providers, ctx, apply, stamp } = deps;
  const now = () => (stamp ? stamp() : undefined);

  const regenerate = async () => {
    const next = await regenerateSlot(slot, providers, { ...ctx, stamp: now() });
    apply(toBlock(block, next), next);
  };

  const actions: AssetSlotActions = {
    // Always available — engine-only, no external dependency.
    onGenerateAI: regenerate,
    onReplace: regenerate,
    onRemove: () => { const next = removeSlotAsset(slot, now()); apply({ ...block, url: '' }, next); },
  };

  if (deps.pickUpload) {
    actions.onUpload = async () => {
      const up = await deps.pickUpload!();
      if (!up) return;
      const next = applyUploadToSlot(slot, up, now());
      apply(toBlock(block, next), next);
    };
  }
  if (deps.pickUrl) {
    actions.onImportUrl = async () => {
      const url = await deps.pickUrl!();
      if (!url) return;
      const next = applyUrlToSlot(slot, url, now());
      apply(toBlock(block, next), next);
    };
  }
  if (deps.pickOrganizationAsset) {
    actions.onOrganizationLibrary = async () => {
      const asset = await deps.pickOrganizationAsset!();
      if (!asset) return;
      const next = applyLibraryAssetToSlot(slot, asset, now());
      apply(toBlock(block, next), next);
    };
  }
  if (deps.openMediaLibrary) actions.onMediaLibrary = deps.openMediaLibrary;

  return actions;
}
