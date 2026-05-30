/**
 * Writer variant store helpers.
 *
 * Pure functions over the `CreatorAssetBlock` schema (PHASE 4 of the
 * final variant workflow activation phase). The Writer's block editor
 * uses these to:
 *
 *   - Apply a fan-out outcome batch onto a block (merge variants[])
 *   - Pick a primary variant (mirrors selectedVariantId →
 *     block.assetId / block.url / block.files)
 *   - Clear the variant collection back to legacy single-asset shape
 *
 * No React. No I/O.
 */

import type { CreatorAssetBlock, CreatorAssetVariantEntry } from '../blog/blockTypes';
import type { FanOutResult } from './fanOutRunner';
import type { VariantWinner } from '../../components/variant-experience/useVariantApi';

/* ── Outcome → variant entry ───────────────────────────────────── */

/**
 * Translate a single fan-out outcome (one decision's result) into a
 * `CreatorAssetVariantEntry`. The renderer endpoint returns the
 * generated asset under `output.asset_payload.media_bundle` —
 * extract the url / files / asset id from that shape.
 */
export function buildVariantEntryFromOutcome(input: {
  variantId: string;
  variantFamily: 'v1' | 'v2' | 'v3';
  ok: boolean;
  responseJson: unknown;
}): CreatorAssetVariantEntry {
  const json = (input.responseJson && typeof input.responseJson === 'object')
    ? input.responseJson as Record<string, unknown>
    : {};
  const output = (json.output && typeof json.output === 'object')
    ? json.output as Record<string, unknown>
    : {};
  const assetPayload = (output.asset_payload && typeof output.asset_payload === 'object')
    ? output.asset_payload as Record<string, unknown>
    : {};
  const mediaBundle = (assetPayload.media_bundle && typeof assetPayload.media_bundle === 'object')
    ? assetPayload.media_bundle as Record<string, unknown>
    : {};
  const packaging = (output.packaging && typeof output.packaging === 'object')
    ? output.packaging as Record<string, unknown>
    : {};
  const url = typeof mediaBundle.url === 'string' ? mediaBundle.url : undefined;
  const files = Array.isArray(mediaBundle.files)
    ? (mediaBundle.files as unknown[]).filter((f): f is string => typeof f === 'string')
    : undefined;
  const caption = typeof packaging.caption === 'string' ? packaging.caption : undefined;
  const assetId =
    (typeof json.asset_id === 'string' ? json.asset_id : null)
    ?? (typeof assetPayload.id === 'string' ? assetPayload.id : null);
  return {
    variant_id: input.variantId,
    variant_family: input.variantFamily,
    asset_id: assetId,
    url,
    files,
    caption,
    state: input.ok ? 'generated' : 'failed',
  };
}

/**
 * Apply a complete `FanOutResult` to a block. Builds variant entries
 * for each outcome and merges them onto `block.variants[]`. When the
 * block has no prior selection AND at least one outcome succeeded,
 * the first successful variant becomes the primary (selected).
 */
export function applyFanOutToBlock(
  block: CreatorAssetBlock,
  result: FanOutResult,
): CreatorAssetBlock {
  const entries = result.outcomes
    .map((outcome) => buildVariantEntryFromOutcome({
      variantId: outcome.decision.variant.variant_id,
      variantFamily: outcome.decision.variant.variant_family,
      ok: outcome.ok,
      responseJson: outcome.responseJson,
    }))
    .filter((entry) => entry.variant_id && entry.variant_family);
  if (entries.length === 0) return block;
  const next: CreatorAssetBlock = {
    ...block,
    variants: entries,
  };
  // Select the first successful entry as primary if none already chosen.
  const previousSelection = block.selectedVariantId
    ? entries.find((e) => e.variant_id === block.selectedVariantId)
    : null;
  const firstOk = entries.find((e) => e.state === 'generated' && e.url);
  const primary = previousSelection ?? firstOk ?? null;
  if (primary) {
    return selectVariantOnBlock(next, primary.variant_id);
  }
  return next;
}

/**
 * Set the primary variant on a block — mirrors the selected entry's
 * fields onto the block's top-level `assetId` / `url` / `files` so
 * existing read paths see the chosen variant as the canonical asset.
 *
 * No-ops gracefully when the id is unknown.
 */
export function selectVariantOnBlock(
  block: CreatorAssetBlock,
  variantId: string,
): CreatorAssetBlock {
  const variants = block.variants ?? [];
  const target = variants.find((entry) => entry.variant_id === variantId);
  if (!target) return block;
  return {
    ...block,
    selectedVariantId: target.variant_id,
    assetId: target.asset_id ?? block.assetId,
    url: target.url ?? block.url,
    files: target.files ?? block.files,
    caption: target.caption ?? block.caption,
    metadata: {
      ...(block.metadata ?? {}),
      applied_variant: {
        variant_id: target.variant_id,
        variant_family: target.variant_family,
        selected_at: new Date().toISOString(),
      },
    },
  };
}

/**
 * Clear the variant collection back to legacy single-asset shape.
 * Keeps the currently-selected variant's asset id / url / files at
 * the top level (so the published block doesn't lose its primary).
 */
export function clearVariantsOnBlock(block: CreatorAssetBlock): CreatorAssetBlock {
  if (!block.variants || block.variants.length === 0) return block;
  const { applied_variant: _omit, ...metadata } = (block.metadata ?? {}) as Record<string, unknown>;
  return {
    ...block,
    variants: undefined,
    selectedVariantId: undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Annotate variant entries with live winner / metrics data. Used by
 * the Writer preview so each variant card carries the metrics from
 * the strategy-analytics endpoint without re-fetching per row.
 */
export function annotateVariantsWithMetrics(
  variants: ReadonlyArray<CreatorAssetVariantEntry>,
  winner: VariantWinner | null,
): CreatorAssetVariantEntry[] {
  if (!winner) return variants.map((v) => ({ ...v }));
  const winnerVariantId = winner.winner?.variant_id ?? null;
  const winnerMetrics = winner.winner?.metrics ?? null;
  const runnerUpId = winner.runner_up?.variant_id ?? null;
  const runnerUpMetrics = winner.runner_up?.metrics ?? null;
  return variants.map((entry) => {
    if (entry.variant_id === winnerVariantId && winnerMetrics) {
      return { ...entry, metrics: extractMetrics(winnerMetrics) };
    }
    if (entry.variant_id === runnerUpId && runnerUpMetrics) {
      return { ...entry, metrics: extractMetrics(runnerUpMetrics) };
    }
    return { ...entry };
  });
}

function extractMetrics(raw: any): CreatorAssetVariantEntry['metrics'] {
  if (!raw || typeof raw !== 'object') return null;
  return {
    engagementRate: Number(raw.engagementRate ?? 0),
    saveRate: Number(raw.saveRate ?? 0),
    shareRate: Number(raw.shareRate ?? 0),
    sampleSize: Number(raw.sampleSize ?? 0),
  };
}

/**
 * Returns true when the block has more than one variant (i.e. fan-out
 * has run). Used by the Writer UI to switch between single-asset and
 * multi-asset preview modes.
 */
export function blockHasVariants(block: CreatorAssetBlock): boolean {
  return Array.isArray(block.variants) && block.variants.length > 0;
}
