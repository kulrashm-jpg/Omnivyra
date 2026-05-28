'use client';

/**
 * Platform Renderer Dispatcher (Phase 2 unification).
 *
 * Single dispatch point from `NormalizedPreviewPayload` to the
 * appropriate platform-faithful renderer. Used by:
 *   - PostPreviewModal (calendar surface — wraps with action chrome)
 *   - WriterEmbeddedPreview (writer surface — strips action chrome)
 *   - PreviewCard (quick-QA surface — generic-card style override)
 *
 * Thread payloads (`payload.isThread`) are delegated to
 * `ThreadSequencePreview` which already consumes shared primitives.
 *
 * The dispatcher does NOT render the modal/page chrome around the
 * preview — that remains the responsibility of the consuming shell so
 * each surface can attach its own affordances (action buttons,
 * reschedule UI, sidebar metadata, etc.).
 */

import React from 'react';
import ThreadSequencePreview from '../../thread/ThreadSequencePreview';
import { resolvePlatformCardConfig } from '../platformCardPrimitives';
import type { NormalizedPreviewPayload } from '../../../lib/preview/normalizedPreviewPayload';
import { normalizePlatformKey } from '../../../lib/preview/previewUtils';

import InstagramRenderer from './InstagramRenderer';
import LinkedInRenderer from './LinkedInRenderer';
import XRenderer from './XRenderer';
import TikTokRenderer from './TikTokRenderer';
import FacebookRenderer from './FacebookRenderer';
import YouTubeRenderer from './YouTubeRenderer';
import PinterestRenderer from './PinterestRenderer';
import DefaultRenderer from './DefaultRenderer';
import type { PlatformRenderer } from './BasePlatformRenderer';

export {
  InstagramRenderer,
  LinkedInRenderer,
  XRenderer,
  TikTokRenderer,
  FacebookRenderer,
  YouTubeRenderer,
  PinterestRenderer,
  DefaultRenderer,
};

const RENDERER_BY_PLATFORM: Record<string, PlatformRenderer> = {
  instagram: InstagramRenderer,
  linkedin: LinkedInRenderer,
  x: XRenderer,
  twitter: XRenderer,
  tiktok: TikTokRenderer,
  facebook: FacebookRenderer,
  youtube: YouTubeRenderer,
  pinterest: PinterestRenderer,
};

export function resolvePlatformRenderer(platform: string): PlatformRenderer {
  const key = normalizePlatformKey(platform);
  return RENDERER_BY_PLATFORM[key] ?? DefaultRenderer;
}

export type RenderPreviewProps = {
  payload: NormalizedPreviewPayload;
  className?: string;
  threadEmptyLabel?: string;
};

/**
 * One-shot render entry point. Reads style + thread mode + platform
 * from the payload and dispatches accordingly.
 *
 * - Thread mode (`isThread: true`) → ThreadSequencePreview.
 * - generic-card style → DefaultRenderer (writer/QA card).
 * - platform-faithful style → platform-specific renderer.
 */
export default function PlatformPreview({ payload, className, threadEmptyLabel }: RenderPreviewProps) {
  // Phase 7 hardening — guard against a missing/malformed payload.
  // Treat it as an empty preview rather than throwing so the
  // surrounding modal / writer chrome stays mounted.
  if (!payload || typeof payload !== 'object') {
    return <div className={className} aria-hidden />;
  }
  const safePlatform = normalizePlatformKey(payload.platform);

  if (payload.isThread) {
    const nodes = Array.isArray(payload.threadNodes) ? payload.threadNodes : [];
    return (
      <ThreadSequencePreview
        nodes={nodes}
        platform={safePlatform || undefined}
        className={className}
        emptyLabel={threadEmptyLabel}
      />
    );
  }
  const cfg = resolvePlatformCardConfig(safePlatform);
  const Renderer = payload.style === 'generic-card'
    ? DefaultRenderer
    : resolvePlatformRenderer(safePlatform);
  // Hand the renderer a payload with the normalized platform + safe
  // defaults for array fields so renderers don't need to guard them
  // individually (Phase 7 hardening).
  const safePayload: NormalizedPreviewPayload = {
    ...payload,
    platform: safePlatform,
    mediaUrls: Array.isArray(payload.mediaUrls) ? payload.mediaUrls : [],
    attachedAssets: Array.isArray(payload.attachedAssets) ? payload.attachedAssets : [],
  };
  return (
    <div className={className}>
      <Renderer payload={safePayload} cfg={cfg} />
    </div>
  );
}
