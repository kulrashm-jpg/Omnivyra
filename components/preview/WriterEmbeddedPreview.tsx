'use client';

/**
 * WriterEmbeddedPreview (Phase 1 unification).
 *
 * Renders the REAL composed post / thread preview inside the writer
 * pages. Reuses the same platform-faithful renderer family that
 * PostPreviewModal uses at publish time → preview/publish parity.
 *
 * Integration points:
 *   - components/content/ShortformResultPage.tsx (post writer)
 *   - components/thread/ThreadResultView.tsx (thread writer)
 *
 * Surface contract:
 *   - Accepts the writer's local state (text + attached assets, OR
 *     segments + per-node attachment map) and a target platform.
 *   - Builds a NormalizedPreviewPayload via the registered builders.
 *   - Delegates to the `PlatformPreview` dispatcher.
 *   - Does NOT add modal/page chrome; the writer page wraps it.
 *
 * Multi-asset rendering: when the writer attaches several assets,
 * `mediaUrls` is the union of preview URLs across attachments and the
 * platform renderer's `MediaThumb` collapses them into a 2x2 grid
 * (existing behavior — single primitive).
 *
 * Lifecycle-safe hydration: builders are pure; passing a refreshed
 * `attachedAssets` array re-renders the preview with no orchestration
 * coupling.
 *
 * Does NOT modify editor UX; this component is a sibling of the
 * existing writer affordances.
 */

import React from 'react';
import PlatformPreview from './platforms';
import {
  buildPreviewPayloadFromWriterPost,
  buildPreviewPayloadFromWriterThread,
} from '../../lib/preview/normalizedPreviewPayload';
import type {
  CreatorAttachment,
  ThreadNode,
} from '../thread/ThreadSequencePreview';

export type WriterEmbeddedPostPreviewProps = {
  mode: 'post';
  platform: string;
  content: string;
  contentType?: string;
  title?: string;
  scheduledDate?: string;
  attachedAssets: CreatorAttachment[];
  className?: string;
};

export type WriterEmbeddedThreadPreviewProps = {
  mode: 'thread';
  platform: string;
  /** Raw writer state — segments + per-node map + available assets. */
  segments?: string[];
  nodeAttachmentMap?: Record<number, string[]>;
  availableAssets?: CreatorAttachment[];
  /**
   * Already-projected thread nodes. When provided, takes precedence
   * over `segments` + `nodeAttachmentMap`. Used by ThreadResultView
   * which already projects nodes via its own resolver.
   */
  precomputedNodes?: ThreadNode[];
  title?: string;
  className?: string;
  threadEmptyLabel?: string;
};

export type WriterEmbeddedPreviewProps =
  | WriterEmbeddedPostPreviewProps
  | WriterEmbeddedThreadPreviewProps;

export default function WriterEmbeddedPreview(props: WriterEmbeddedPreviewProps) {
  if (props.mode === 'thread') {
    // Prefer caller-projected nodes (ThreadResultView already runs the
    // per-node attachment resolver against the same writer state), so
    // we don't re-do the projection here.
    const payload = buildPreviewPayloadFromWriterThread({
      platform: props.platform,
      segments: props.segments ?? [],
      nodeAttachmentMap: props.nodeAttachmentMap,
      availableAssets: props.availableAssets,
      title: props.title,
    });
    const effective = props.precomputedNodes
      ? { ...payload, threadNodes: props.precomputedNodes }
      : payload;
    return (
      <PlatformPreview
        payload={effective}
        className={props.className}
        threadEmptyLabel={props.threadEmptyLabel}
      />
    );
  }
  const payload = buildPreviewPayloadFromWriterPost({
    platform: props.platform,
    content: props.content,
    contentType: props.contentType,
    title: props.title,
    scheduledDate: props.scheduledDate,
    attachedAssets: props.attachedAssets,
  });
  return <PlatformPreview payload={payload} className={props.className} />;
}
