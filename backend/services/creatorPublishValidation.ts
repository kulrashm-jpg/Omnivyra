import { resolvePlatformVisualProfile, validateVisualGovernance } from './creatorAssetGovernance';
import type { RenderManifest } from './creatorRenderManifest';
import { runCreatorOcr, type CreatorOcrResult } from './creatorOcrProvider';
import { recordCreatorRenderMetric } from './creatorRenderObservability';
import { persistCreatorValidationManifest } from './creatorRenderPersistence';

export type CreatorPublishAttachmentMetadata = {
  asset_composition_intent?: Record<string, unknown> | null;
  attachment_mode?: string | null;
  governance_profile?: Record<string, unknown> | null;
  platform_rendering_profile?: Record<string, unknown> | null;
  transform_intent?: string | null;
  render_manifest?: RenderManifest | null;
  validation_manifest?: Record<string, unknown> | null;
  renderer_id?: string | null;
};

export type CreatorPublishValidationResult =
  | { ok: true; warnings: string[]; normalizedMetadata: CreatorPublishAttachmentMetadata[] }
  | { ok: false; errors: string[]; warnings: string[]; normalizedMetadata: CreatorPublishAttachmentMetadata[] };

export type CreatorLivePublishValidationResult = CreatorPublishValidationResult & {
  liveOcrResults?: CreatorOcrResult[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeCreatorPublishMetadata(value: unknown): CreatorPublishAttachmentMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => object(item)).map((item) => ({
    asset_composition_intent: object(item.asset_composition_intent),
    attachment_mode: typeof item.attachment_mode === 'string' ? item.attachment_mode : typeof object(item.asset_composition_intent).attachmentMode === 'string' ? String(object(item.asset_composition_intent).attachmentMode) : null,
    governance_profile: object(item.governance_profile),
    platform_rendering_profile: object(item.platform_rendering_profile),
    transform_intent: typeof item.transform_intent === 'string' ? item.transform_intent : typeof object(item.asset_composition_intent).sourceTextTransform === 'string' ? String(object(item.asset_composition_intent).sourceTextTransform) : null,
    render_manifest: item.render_manifest && typeof item.render_manifest === 'object' ? item.render_manifest as RenderManifest : null,
    validation_manifest: object(item.validation_manifest),
    renderer_id: typeof item.renderer_id === 'string' ? item.renderer_id : typeof object(item.render_manifest).rendererId === 'string' ? String(object(item.render_manifest).rendererId) : null,
  }));
}

export function validateCreatorPublishSemantics(input: {
  platform: string;
  contentType?: string | null;
  text?: string | null;
  mediaUrls?: string[] | null;
  creatorAttachmentMetadata?: unknown;
  scheduledPostId?: string;
}): CreatorPublishValidationResult {
  const metadata = normalizeCreatorPublishMetadata(input.creatorAttachmentMetadata);
  if (metadata.length === 0) return { ok: true, warnings: [], normalizedMetadata: metadata };
  const platformProfile = resolvePlatformVisualProfile(input.platform);
  const errors: string[] = [];
  const warnings: string[] = [];

  metadata.forEach((entry, index) => {
    const intent = object(entry.asset_composition_intent);
    const assetType = String(intent.assetType || input.contentType || 'supporting_image');
    const attachmentMode = entry.attachment_mode;
    if (attachmentMode !== 'embedded_copy' && attachmentMode !== 'supporting_visual') {
      errors.push(`attachment_${index}_missing_attachment_mode`);
    }
    if (!entry.renderer_id) errors.push(`attachment_${index}_missing_renderer_identity`);
    if (!entry.render_manifest) errors.push(`attachment_${index}_missing_render_manifest`);
    const manifest = entry.render_manifest;
    if (manifest) {
      if (manifest.validationResult?.ok === false) errors.push(`attachment_${index}_governance_manifest_failed`);
      if (manifest.ocrResult?.ok === false) errors.push(`attachment_${index}_ocr_manifest_failed`);
      if (manifest.typographySafetyResult?.ok === false) errors.push(`attachment_${index}_typography_manifest_failed`);
      if (manifest.accessibilityValidation?.ok === false) errors.push(`attachment_${index}_accessibility_manifest_failed`);
      if (!manifest.accessibility?.altText || manifest.accessibility.altText.length < 12) errors.push(`attachment_${index}_alt_text_missing`);
      if (!Array.isArray(manifest.accessibility?.readingOrder) || manifest.accessibility.readingOrder.length === 0) errors.push(`attachment_${index}_reading_order_missing`);
      if (manifest.qualityScore?.clutterRisk > 72) errors.push(`attachment_${index}_clutter_risk_exceeds_publish_tolerance`);
      if (manifest.qualityScore?.readability < 55) errors.push(`attachment_${index}_readability_below_publish_tolerance`);
    }
    const textBlocks = [String(input.text || '')].filter(Boolean);
    const governance = validateVisualGovernance({
      assetType,
      platform: input.platform,
      textBlocks: attachmentMode === 'supporting_visual' ? [] : textBlocks,
      hasCTA: /\b(book a demo|buy now|subscribe|learn more|click here|sign up|get started)\b/i.test(String(input.text || '')),
    });
    if (!governance.ok) errors.push(...governance.errors.map((error) => `attachment_${index}_${error}`));
    if (platformProfile.preferredDensity === 'low' && governance.wordCount > 28) {
      errors.push(`attachment_${index}_platform_density_unsupported`);
    }
    warnings.push(...governance.warnings.map((warning) => `attachment_${index}_${warning}`));
  });

  recordCreatorRenderMetric({
    name: errors.length ? 'publish_rejection' : 'render_duration_ms',
    value: errors.length ? 1 : 0,
    tags: { platform: input.platform, scheduledPostId: input.scheduledPostId ?? '', contentType: input.contentType ?? '' },
  });

  return errors.length
    ? { ok: false, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), normalizedMetadata: metadata }
    : { ok: true, warnings: Array.from(new Set(warnings)), normalizedMetadata: metadata };
}

async function fetchMediaBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
    if (!match) throw new Error('invalid_data_url');
    const body = match[3] ?? '';
    return {
      buffer: Buffer.from(decodeURIComponent(body), match[2] ? 'base64' : 'utf8'),
      mimeType: match[1] || 'image/png',
    };
  }
  // HARDEN-005: media URL is user/generated content — download via the
  // SSRF-safe fetcher (validated host, DNS-pinned, size-capped).
  const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
  const response = await safeFetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`media_fetch_failed_${response.status}`);
  return {
    buffer: await readCapped(response),
    mimeType: response.headers.get('content-type') || 'image/png',
  };
}

function comparePersistedOcr(input: {
  persisted?: RenderManifest['ocrResult'] | null;
  live: CreatorOcrResult;
  attachmentMode?: string | null;
}): string[] {
  const errors: string[] = [];
  const persisted = input.persisted;
  if (persisted?.ok === true && input.live.ok === false) errors.push('live_ocr_failed_after_persisted_pass');
  const persistedConfidence = Number((persisted as Record<string, unknown> | null | undefined)?.confidence ?? 0);
  if (persistedConfidence > 0 && input.live.confidence + 0.12 < persistedConfidence) errors.push('live_ocr_confidence_drift');
  const persistedHash = String((persisted as Record<string, unknown> | null | undefined)?.imageHash ?? '');
  if (persistedHash && input.live.imageHash && persistedHash !== input.live.imageHash) errors.push('live_ocr_image_hash_drift');
  if (input.attachmentMode === 'supporting_visual' && input.live.text.trim().length > 0) errors.push('live_ocr_visible_text_in_supporting_visual');
  return errors;
}

export async function validateCreatorPublishSemanticsLive(input: {
  platform: string;
  contentType?: string | null;
  text?: string | null;
  mediaUrls?: string[] | null;
  creatorAttachmentMetadata?: unknown;
  scheduledPostId?: string;
}): Promise<CreatorLivePublishValidationResult> {
  const base = validateCreatorPublishSemantics(input);
  const metadata = base.normalizedMetadata;
  if (metadata.length === 0) return base;
  const errors = base.ok === false ? [...base.errors] : [];
  const warnings = [...base.warnings];
  const liveOcrResults: CreatorOcrResult[] = [];
  const mediaUrls = Array.isArray(input.mediaUrls) ? input.mediaUrls.filter(Boolean) : [];

  await Promise.all(metadata.map(async (entry, index) => {
    const mediaUrl = mediaUrls[index] ?? mediaUrls[0];
    if (!mediaUrl) {
      errors.push(`attachment_${index}_live_ocr_media_missing`);
      return;
    }
    const intent = object(entry.asset_composition_intent);
    const assetType = String(intent.assetType || input.contentType || 'supporting_image');
    try {
      const media = await fetchMediaBuffer(mediaUrl);
      const live = await runCreatorOcr({
        image: media.buffer,
        mimeType: media.mimeType,
        assetType,
        platform: input.platform,
        attachmentMode: entry.attachment_mode,
      });
      liveOcrResults[index] = live;
      if (!live.ok) errors.push(...live.flags.map((flag) => `attachment_${index}_${flag}`));
      errors.push(...comparePersistedOcr({ persisted: entry.render_manifest?.ocrResult, live, attachmentMode: entry.attachment_mode })
        .map((error) => `attachment_${index}_${error}`));
      await persistCreatorValidationManifest({
        rendererId: entry.renderer_id ?? 'unknown-renderer',
        assetType,
        platform: input.platform,
        attachmentMode: entry.attachment_mode,
        renderManifest: (entry.render_manifest ?? {}) as unknown as Record<string, unknown>,
        validationManifest: {
          phase: 'publish_live_ocr_revalidation',
          ok: live.ok,
          live_ocr: live,
          scheduled_post_id: input.scheduledPostId ?? null,
        },
        auditId: entry.render_manifest?.rendererId ? `${entry.render_manifest.rendererId}:publish` : null,
      });
    } catch (error) {
      errors.push(`attachment_${index}_${error instanceof Error ? error.message : 'live_ocr_failed'}`);
    }
  }));

  if (errors.length) {
    recordCreatorRenderMetric({
      name: 'publish_live_ocr_rejection',
      tags: { platform: input.platform, scheduledPostId: input.scheduledPostId ?? '', contentType: input.contentType ?? '' },
    });
    return { ok: false, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), normalizedMetadata: metadata, liveOcrResults };
  }
  return { ok: true, warnings: Array.from(new Set(warnings)), normalizedMetadata: metadata, liveOcrResults };
}
