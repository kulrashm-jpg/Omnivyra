/**
 * User Template Preview — pure mapping + lifecycle (no DB, no renderer import).
 *
 * Maps a template definition + its sample content + rendering contract into the
 * canonical `asset_payload` the EXISTING renderer consumes — so preview
 * generation reuses the exact same rendering / visual-validation / diagnostic
 * pipeline as normal asset generation. No duplicate preview path.
 */

import type { CreatorTemplate } from './types';
import { canPublishTemplate } from './userTemplate';

export type PreviewStatus = 'pending' | 'rendering' | 'ready' | 'failed';

/** Deterministic current preview status (from metadata, else inferred). */
export function previewStatusOf(t: CreatorTemplate): PreviewStatus {
  const s = (t.metadata as Record<string, unknown> | undefined)?.previewStatus;
  if (s === 'pending' || s === 'rendering' || s === 'ready' || s === 'failed') return s;
  return t.preview.thumbnailUrl ? 'ready' : 'pending';
}

/** A template may publish only when its preview is Ready AND the diagnostic
 *  produced during preview generation passes. Combines the existing gate. */
export function canPublishWithPreview(t: CreatorTemplate, diagnostic: unknown): { ok: boolean; reasons: string[] } {
  const status = previewStatusOf(t);
  if (status !== 'ready') {
    return { ok: false, reasons: [status === 'failed' ? 'Preview render failed — regenerate before publishing.' : `Preview is ${status} — wait for it to finish.`] };
  }
  return canPublishTemplate(diagnostic);
}

/* ── Preview resolution (ONE source of truth for gallery + details) ──── */

export interface ResolvedPreview {
  /** 'rendered' → show the real preview image; 'sample' → show the live sample composition. */
  kind: 'rendered' | 'sample';
  /** The rendered preview URL when kind === 'rendered'. */
  url: string | null;
  status: PreviewStatus;
  /** True when the template is a user template (status indicators apply). */
  isUserTemplate: boolean;
}

/**
 * Resolve which preview a template should display — used identically by the
 * gallery cards AND the details drawer (no duplicate logic):
 *
 *   - A rendered preview image exists (preview_url) → show it (real preview).
 *     This also covers "keep the previous preview" while a new version
 *     re-renders or after a failure — never a placeholder, never a broken image.
 *   - No rendered preview yet → show the existing sample composition.
 *
 * System templates have no preview_url → always 'sample' (unchanged behavior).
 */
export function resolveTemplatePreview(t: CreatorTemplate): ResolvedPreview {
  const status = previewStatusOf(t);
  const url = typeof t.preview.thumbnailUrl === 'string' && t.preview.thumbnailUrl.trim() ? t.preview.thumbnailUrl : null;
  return {
    kind: url ? 'rendered' : 'sample',
    url,
    status,
    isUserTemplate: t.ownership === 'user',
  };
}

const PREVIEW_STATUS_LABELS: Record<PreviewStatus, string> = {
  pending: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
};

/** Human label for a preview status (deterministic). */
export function previewStatusLabel(status: PreviewStatus): string {
  return PREVIEW_STATUS_LABELS[status];
}

/* ── Preview intent (template + sample → canonical asset_payload) ─────── */

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Build the canonical asset_payload for a template preview from its
 * `preview.sample` content + rendering contract. The shapes mirror exactly what
 * the orchestrator's content-ingestion produces, so the renderer treats a
 * preview like any other asset (overlay_text for image, slides[] for carousel,
 * thread_visual_transform.items for infographic).
 */
export function buildPreviewIntent(template: CreatorTemplate): Record<string, unknown> {
  const contract = template.renderingContract;
  const sample = template.preview.sample ?? {};
  const baseMeta: Record<string, unknown> = {
    content_type: template.assetFamily === 'infographic' ? 'infographic' : template.assetFamily,
    creator_content_asset_type: template.assetFamily === 'infographic' ? 'infographic' : undefined,
    writer_asset_type: contract.writerAssetType,
    attachment_mode: contract.attachmentMode,
    subtype: contract.subtype ?? undefined,
    purpose_key: contract.purposeKey ?? undefined,
    infographic_layout: contract.infographicLayout ?? undefined,
    platform: 'linkedin',
    topic: template.name,
    summary: template.description,
    template_id: template.id,
    template_version: template.version,
    preview_render: true,
  };

  if (template.assetFamily === 'image') {
    const overlay: Record<string, unknown> = {
      hook: '',
      headline: clean(sample.headline) || clean(sample.quote),
      keyInsight: clean(sample.author),
      cta: clean(sample.cta),
      supportingText: clean(sample.subheadline),
      __template_authoritative: true,
    };
    return {
      asset_kind: 'image',
      overlay_text: overlay,
      visual_descriptor: { headline: overlay.headline, visual_description: template.description || template.name },
      media_bundle: { metadata: { ...baseMeta, overlay_text: overlay } },
    };
  }

  if (template.assetFamily === 'carousel') {
    const slideLabels = Array.isArray(sample.slides) ? sample.slides : [];
    const slides = slideLabels.map((label, i) => ({ slide_number: i + 1, title: clean(label), headline: clean(label), body: '', body_text: '' }));
    return {
      asset_kind: 'carousel',
      slides,
      slide_count: slides.length,
      media_bundle: { metadata: { ...baseMeta } },
    };
  }

  // infographic — renders through the image asset kind + infographic renderer.
  const sections = Array.isArray(sample.sections) ? sample.sections : [];
  const items = sections.map((s) => {
    const label = clean(s.label);
    const value = clean(s.value);
    return value ? `${label}: ${value}` : label;
  }).filter(Boolean);
  return {
    asset_kind: 'image',
    visual_descriptor: { headline: template.name, visual_description: template.description || template.name },
    media_bundle: { metadata: { ...baseMeta, thread_visual_transform: { items, source: 'template_preview' } } },
  };
}
