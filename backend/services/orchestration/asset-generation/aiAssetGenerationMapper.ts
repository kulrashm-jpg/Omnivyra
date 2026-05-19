/**
 * aiAssetGenerationMapper — Phase-2 Step-19.
 *
 * Pure. Reads the REAL media the existing creator generation runtime
 * (runCreatorAssetGenerationRuntime) persists into
 * daily_content_plans.content and exposes it in one normalized shape so the
 * Step-18 hydrator can surface a real preview/thumbnail/asset_id INSTEAD of
 * preview_pending. No fabrication: every field here is read from persisted
 * runtime output, never synthesized.
 *
 * Runtime persistence surface (see creatorAssetGenerationRuntime.ts):
 *   content.creator_asset_id          : string
 *   content.rendered_asset.urls       : string[]   (rendered media)
 *   content.rendered_asset.metadata   : { thumbnail_url?, preview_kind?, ... }
 *   content.rendered_asset.export_ready: boolean
 *   content.asset_payload.media_bundle: { url?, files?[], metadata? }
 *   content.creator_asset             : legacy/explicit attachment (Step-18)
 */

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function firstUrl(v: unknown): string {
  if (Array.isArray(v)) {
    const hit = v.map((x) => str(x).trim()).find(Boolean);
    return hit ?? '';
  }
  return str(v).trim();
}

export interface ResolvedRenderedMedia {
  asset_id: string;
  preview_url: string | null;
  thumbnail_url: string | null;
  files: string[];
  /** true when the resolved media came from real persisted runtime output. */
  rendered: boolean;
  source: 'rendered_asset' | 'media_bundle' | 'creator_asset';
}

/**
 * Resolve real, persisted rendered media for an execution blob. Priority:
 *   1. rendered_asset (written by the autonomous renderer path)
 *   2. asset_payload.media_bundle (renderer merge target)
 *   3. creator_asset (explicit attachment — Step-18 contract)
 * Returns null when NO real media has been persisted yet (caller keeps the
 * honest preview_pending state — nothing is invented).
 */
export function resolveRenderedMedia(blob: Record<string, unknown>): ResolvedRenderedMedia | null {
  const rendered = obj(blob.rendered_asset);
  if (rendered) {
    const url = firstUrl(rendered.urls) || str(rendered.url).trim();
    if (url) {
      const meta = obj(rendered.metadata) ?? {};
      return {
        asset_id: str(rendered.creator_asset_id) || str(blob.creator_asset_id) || '',
        preview_url: url,
        thumbnail_url: str(meta.thumbnail_url) || str(meta.thumbnail) || null,
        files: Array.isArray(rendered.urls) ? rendered.urls.map(String).filter(Boolean) : [url],
        rendered: true,
        source: 'rendered_asset',
      };
    }
  }

  const mediaBundle = obj(obj(blob.asset_payload)?.media_bundle ?? null);
  if (mediaBundle) {
    const url = str(mediaBundle.url).trim() || firstUrl(mediaBundle.files);
    const bundleMeta = obj(mediaBundle.metadata) ?? {};
    if (url && bundleMeta.export_ready !== false) {
      return {
        asset_id: str(blob.creator_asset_id) || '',
        preview_url: url,
        thumbnail_url: str(bundleMeta.thumbnail_url) || null,
        files: Array.isArray(mediaBundle.files) ? mediaBundle.files.map(String).filter(Boolean) : [url],
        rendered: true,
        source: 'media_bundle',
      };
    }
  }

  const ca = obj(blob.creator_asset);
  if (ca) {
    const url = str(ca.url).trim() || firstUrl(ca.files);
    if (url) {
      return {
        asset_id: str(ca.id) || str(blob.creator_asset_id) || '',
        preview_url: url,
        thumbnail_url: str(ca.thumbnail) || null,
        files: Array.isArray(ca.files) ? ca.files.map(String).filter(Boolean) : [url],
        rendered: true,
        source: 'creator_asset',
      };
    }
  }

  return null;
}

export interface GenerationRuntimeSummary {
  ok: boolean;
  rendered_count: number;
  failed_count: number;
  awaiting_media_upload_count: number;
  skipped_count: number;
  final_status: string;
  error: string | null;
}

/** Normalize the real runtime result (or a thrown error) to a flat summary. */
export function mapRuntimeResultToSummary(
  result:
    | {
        rendered_count?: number;
        failed_count?: number;
        awaiting_media_upload_count?: number;
        skipped_count?: number;
        final_status?: string;
      }
    | null,
  error?: unknown,
): GenerationRuntimeSummary {
  if (error || !result) {
    return {
      ok: false,
      rendered_count: 0,
      failed_count: 0,
      awaiting_media_upload_count: 0,
      skipped_count: 0,
      final_status: 'render_failed',
      error: error instanceof Error ? error.message : error ? String(error) : 'no_result',
    };
  }
  return {
    ok: true,
    rendered_count: Number(result.rendered_count ?? 0),
    failed_count: Number(result.failed_count ?? 0),
    awaiting_media_upload_count: Number(result.awaiting_media_upload_count ?? 0),
    skipped_count: Number(result.skipped_count ?? 0),
    final_status: String(result.final_status ?? 'unknown'),
    error: null,
  };
}
