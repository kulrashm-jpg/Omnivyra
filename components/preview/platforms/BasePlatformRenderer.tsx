'use client';

/**
 * BasePlatformRenderer (Phase 2 unification).
 *
 * Shared scaffolding for every per-platform faithful renderer:
 *   - props contract (NormalizedPreviewPayload)
 *   - shared helpers (resolveDisplayContentType, hasMedia, etc.)
 *   - re-exports of the shared primitives so renderers only import from
 *     one place.
 *
 * Each per-platform renderer (Instagram / LinkedIn / X / TikTok / etc.)
 * extracts the JSX previously hardcoded inside PostPreviewModal into a
 * pure function `({ payload, cfg }) => ReactNode`. The renderers are
 * surface-agnostic — they consume the normalized payload and render
 * the platform-faithful chrome, leaving calendar-specific affordances
 * (publish/reschedule buttons, schedule pill, etc.) to the consuming
 * shell (PostPreviewModal).
 */

import React from 'react';
import ContentRenderer from '../../ContentRenderer';
import PlatformIcon from '../../ui/PlatformIcon';
import {
  MediaThumb,
  resolvePlatformCardConfig,
  type PlatformCardConfig,
} from '../platformCardPrimitives';
import type { NormalizedPreviewPayload } from '../../../lib/preview/normalizedPreviewPayload';

export type PlatformRendererProps = {
  payload: NormalizedPreviewPayload;
  cfg: PlatformCardConfig;
};

export type PlatformRenderer = (props: PlatformRendererProps) => React.ReactElement;

export { ContentRenderer, PlatformIcon, MediaThumb, resolvePlatformCardConfig };

export function hasMedia(payload: NormalizedPreviewPayload): boolean {
  return payload.mediaUrls.length > 0 || payload.mediaType === 'image' || payload.mediaType === 'video' || payload.mediaType === 'carousel';
}

export function isVisualContentType(contentType: string): boolean {
  const n = (contentType || '').toLowerCase();
  return n === 'reel' || n === 'short' || n === 'video' || n === 'story' || n === 'image' || n === 'carousel';
}

export const DEFAULT_AUTHOR_NAME = 'Your Brand';
export const DEFAULT_AUTHOR_HANDLE = '@yourbrand';

export function fmtScheduled(payload: NormalizedPreviewPayload, fallback = 'Scheduled'): string {
  return payload.scheduledDate || fallback;
}
