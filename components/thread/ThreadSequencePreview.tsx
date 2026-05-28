'use client';

/**
 * ThreadSequencePreview — Phase 1A (G3).
 *
 * Visualizes a thread as the ordered sequence of nodes it will publish as,
 * using the same node contract that the Phase 1B (G1) runtime will emit.
 *
 * Strict reuse:
 *   - Text rendering goes through the central [ContentRenderer] (no isolated
 *     formatting). Char-count + platform highlighting are handled there.
 *   - Platform card chrome (header bg, avatar bg, char limit) comes from the
 *     shared [platformCardPrimitives] module that PostPreviewModal also uses.
 *   - Media rendering uses the shared [MediaThumb] from the same module.
 *
 * No route coupling: receives ThreadNode[] as a prop. Same shape can be projected
 * from sessionStorage segments (today) or from the multi-row scheduled_posts join
 * once G1 ships.
 *
 * Attachment ownership: the [CreatorAttachment] type projects the canonical
 * relational source (creator_asset_attachments × creator_assets). Never reads
 * scheduled_posts.creator_attachment_metadata (which is a publish snapshot,
 * not a live source per Phase 1 canonical decision).
 */

import React from 'react';
import ContentRenderer from '../ContentRenderer';
import PlatformIcon from '../ui/PlatformIcon';
import {
  MediaThumb,
  resolvePlatformCardConfig,
} from '../preview/platformCardPrimitives';
import {
  validateThreadNodeForPlatform,
  platformValidationBadgeClass,
  platformValidationLabel,
} from '../../lib/preview/platformLimitValidation';
import {
  collectAttachmentPreviewUrls,
  normalizePlatformKey,
  pickAttachmentPreviewUrl,
} from '../../lib/preview/previewUtils';

export type CreatorAttachment = {
  id: string;
  assetId: string;
  assetType?: string;
  title?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  attachmentMode?: 'supporting_visual' | 'embedded_copy';
  mediaKind?: 'image' | 'video' | 'gif' | 'other';
};

export type ThreadNode = {
  id: string;
  position: number;
  content: string;
  attachments?: CreatorAttachment[];
  platform?: string;
};

export interface ThreadSequencePreviewProps {
  nodes: ThreadNode[];
  /** Fallback platform when a node does not specify its own */
  platform?: string;
  /** Outer wrapper classes */
  className?: string;
  /** Optional label rendered when the sequence is empty */
  emptyLabel?: string;
}

// Phase 3 — `pickPreviewUrl` consolidated into the shared
// `pickAttachmentPreviewUrl` in lib/preview/previewUtils. Kept this
// local alias only for the per-call signature compatibility below.
const pickPreviewUrl = pickAttachmentPreviewUrl;

function ThreadNodeCard({
  node,
  index,
  total,
  inheritedPlatform,
  isLast,
}: {
  node: ThreadNode;
  index: number;
  total: number;
  inheritedPlatform?: string;
  isLast: boolean;
}) {
  const platform = normalizePlatformKey(node.platform || inheritedPlatform);
  const cfg = resolvePlatformCardConfig(platform);

  const attachments = Array.isArray(node.attachments) ? node.attachments : [];
  const mediaUrls = collectAttachmentPreviewUrls(attachments);
  const attachmentsWithoutPreview = attachments.filter((a) => !pickPreviewUrl(a));

  const hasText = Boolean(node.content && node.content.trim());
  const hasAssets = attachments.length > 0;
  const isAssetOnly = !hasText && hasAssets;
  const isEmpty = !hasText && !hasAssets;

  const platformLabel = platform
    ? platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1)
    : null;

  // G11.B — canonical per-node validation. Surfaces visible state on the card
  // when the node's content is over (or near) the platform's character limit.
  const validation = validateThreadNodeForPlatform({ content: node.content || '', platform }, platform);
  const showValidationBadge = validation.maxCount > 0 && (validation.state === 'warning' || validation.state === 'invalid');
  const cardBorderClass = validation.state === 'invalid'
    ? 'border-red-300'
    : validation.state === 'warning'
      ? 'border-amber-300'
      : 'border-slate-200';

  return (
    <div className="relative">
      {!isLast && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-5 top-12 -bottom-4 w-px bg-slate-200"
        />
      )}

      <article className={`relative rounded-2xl border ${cardBorderClass} ${cfg.cardBg} shadow-[0_4px_18px_rgba(15,23,42,0.04)]`}>
        <header className="flex items-center gap-3 px-4 pt-3 pb-2">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${cfg.avatarBg}`}>
            <PlatformIcon platform={platform || 'default'} size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Thread Post
            </p>
            <p className="text-sm font-semibold text-slate-900">
              {index + 1} <span className="text-slate-400">/ {total}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {platformLabel && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.headerBg}`}>
                {platformLabel}
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
            {showValidationBadge && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${platformValidationBadgeClass(validation.state)}`}
                title={validation.state === 'invalid' ? `Over ${platformLabel || 'platform'} limit by ${validation.exceeded} chars` : `Near ${platformLabel || 'platform'} limit`}
              >
                {platformValidationLabel(validation)}
              </span>
            )}
          </div>
        </header>

        <div className="space-y-3 px-4 pb-4">
          {isEmpty && (
            <p className="text-xs italic text-slate-400">
              Empty thread post — add a caption or attach an asset.
            </p>
          )}

          {hasText && (
            <ContentRenderer
              content={node.content}
              platform={platform || undefined}
              renderMode="social"
              showCharCount={Boolean(cfg.charLimit)}
              emptyText=""
            />
          )}

          {isAssetOnly && (
            <p className="text-xs italic text-slate-500">
              Asset-only post — this node will publish without caption text.
            </p>
          )}

          {mediaUrls.length > 0 && (
            <MediaThumb
              mediaUrls={mediaUrls}
              className="aspect-video rounded-xl border border-slate-200 bg-slate-100"
              fallback={
                <div className="text-center opacity-50">
                  <p className="text-xs text-slate-500">Media</p>
                </div>
              }
            />
          )}

          {attachmentsWithoutPreview.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachmentsWithoutPreview.map((attachment) => (
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
    </div>
  );
}

export default function ThreadSequencePreview({
  nodes,
  platform,
  className,
  emptyLabel,
}: ThreadSequencePreviewProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center ${className ?? ''}`}>
        <p className="text-sm italic text-slate-400">
          {emptyLabel || 'Add at least one thread post to preview the sequence.'}
        </p>
      </div>
    );
  }

  const ordered = [...nodes].sort((a, b) => a.position - b.position);
  const total = ordered.length;

  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {ordered.map((node, index) => (
        <ThreadNodeCard
          key={node.id}
          node={node}
          index={index}
          total={total}
          inheritedPlatform={platform}
          isLast={index === total - 1}
        />
      ))}
    </div>
  );
}
