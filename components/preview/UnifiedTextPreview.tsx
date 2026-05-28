'use client';

/**
 * G9 — Unified text-content preview composing helper.
 *
 * Single canonical entry point for rendering a text+asset preview from a
 * UnifiedPreviewPayload. Composes the shared primitives that already exist:
 *
 *   - ContentRenderer for platform-aware text formatting
 *   - resolvePlatformCardConfig / PlatformCardConfig for platform card chrome
 *   - MediaThumb for multi-image / single-image grid
 *   - ThreadSequencePreview for threadNodes (delegated entirely)
 *
 * Phase 1 (stabilization) — now uses the canonical preview utilities
 * (`lib/preview/previewUtils`) for platform-key normalization and
 * attachment URL resolution. The PlatformCard retains its QA-specific
 * chrome (creation-mode badge, asset-only badge, mixed badge) because
 * those affordances are distinct from the platform-faithful renderers
 * that `PlatformPreview` dispatches to.
 *
 * When `platforms` is omitted or empty, renders ONE generic card. When
 * `platforms` has N entries, renders N cards (one per platform) so a multi-
 * platform repurpose can be previewed at once.
 */

import React from 'react';
import ContentRenderer from '../ContentRenderer';
import PlatformIcon from '../ui/PlatformIcon';
import { MediaThumb, resolvePlatformCardConfig } from './platformCardPrimitives';
import ThreadSequencePreview from '../thread/ThreadSequencePreview';
import {
  collectAttachmentPreviewUrls,
  normalizePlatformKey,
  pickAttachmentPreviewUrl,
} from '../../lib/preview/previewUtils';
import type {
  CreatorAttachment,
  UnifiedPreviewPayload,
} from '../../lib/preview/unifiedPreviewContract';

export interface UnifiedTextPreviewProps {
  payload: UnifiedPreviewPayload;
  /** Outer wrapper classes */
  className?: string;
  /** Empty-state label override */
  emptyLabel?: string;
}

function platformLabel(platform: string): string {
  if (!platform) return 'Preview';
  if (platform === 'x') return 'X';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function PlatformCard({
  platform,
  text,
  assets,
  creationMode,
  emptyLabel,
}: {
  platform: string;
  text: string;
  assets: CreatorAttachment[];
  creationMode: UnifiedPreviewPayload['creationMode'];
  emptyLabel: string;
}) {
  const key = normalizePlatformKey(platform);
  const cfg = resolvePlatformCardConfig(key);
  const mediaUrls = collectAttachmentPreviewUrls(assets);
  const assetsWithoutPreview = assets.filter((a) => !pickAttachmentPreviewUrl(a));
  const hasText = Boolean(text && text.trim());
  const hasAssets = assets.length > 0;
  const isAssetOnly = !hasText && hasAssets;
  const isEmpty = !hasText && !hasAssets;
  const label = platformLabel(key);

  return (
    <article className={`relative rounded-2xl border border-slate-200 ${cfg.cardBg} shadow-[0_4px_18px_rgba(15,23,42,0.04)]`}>
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${cfg.avatarBg}`}>
          <PlatformIcon platform={key || 'default'} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Platform</p>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {creationMode && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {creationMode === 'manual' ? 'Manual' : 'AI'}
            </span>
          )}
          {isAssetOnly && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Asset only
            </span>
          )}
          {hasText && hasAssets && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Mixed
            </span>
          )}
        </div>
      </header>

      <div className="space-y-3 px-4 pb-4">
        {isEmpty && (
          <p className="text-xs italic text-slate-400">{emptyLabel}</p>
        )}

        {hasText && (
          <ContentRenderer
            content={text}
            platform={key || undefined}
            renderMode="social"
            showCharCount={Boolean(cfg.charLimit)}
            emptyText=""
          />
        )}

        {isAssetOnly && (
          <p className="text-xs italic text-slate-500">
            Asset-only — this preview will publish without caption text.
          </p>
        )}

        {mediaUrls.length > 0 && (
          <MediaThumb
            mediaUrls={mediaUrls}
            className="aspect-video rounded-xl border border-slate-200 bg-slate-100"
            fallback={<div className="text-xs text-slate-400">Media</div>}
          />
        )}

        {assetsWithoutPreview.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {assetsWithoutPreview.map((attachment) => (
              <span
                key={attachment.id}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                title={attachment.attachmentMode || undefined}
              >
                {attachment.title || attachment.assetType || 'Asset'}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function UnifiedTextPreview({
  payload,
  className,
  emptyLabel,
}: UnifiedTextPreviewProps) {
  // Threads delegate entirely to ThreadSequencePreview — single source of truth
  // for sequence rendering. Per-platform fan-out for threads belongs on the
  // node, not this top-level layer.
  if (payload.threadNodes && payload.threadNodes.length > 0) {
    return (
      <ThreadSequencePreview
        nodes={payload.threadNodes}
        platform={payload.platforms?.[0]}
        className={className}
        emptyLabel={emptyLabel}
      />
    );
  }

  const platforms = (payload.platforms ?? [])
    .map((p) => normalizePlatformKey(p))
    .filter(Boolean);
  const text = payload.text ?? '';
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const resolvedEmpty = emptyLabel
    || (payload.creationMode === 'manual'
      ? 'Empty draft — add caption text or attach an asset to preview the post.'
      : 'No content available to preview yet.');

  // No platforms specified → single generic card.
  if (platforms.length === 0) {
    return (
      <div className={className}>
        <PlatformCard
          platform=""
          text={text}
          assets={assets}
          creationMode={payload.creationMode}
          emptyLabel={resolvedEmpty}
        />
      </div>
    );
  }

  // One card per platform.
  return (
    <div className={`grid gap-4 ${platforms.length > 1 ? 'md:grid-cols-2' : ''} ${className ?? ''}`}>
      {platforms.map((platform) => (
        <PlatformCard
          key={platform}
          platform={platform}
          text={text}
          assets={assets}
          creationMode={payload.creationMode}
          emptyLabel={resolvedEmpty}
        />
      ))}
    </div>
  );
}
