'use client';

/**
 * XRenderer — Phase 2 extraction (covers X + Twitter).
 *
 * JSX extracted verbatim from PostPreviewModal's `isX` branch
 * (components/dashboard/PostPreviewModal.tsx lines 222-253).
 */

import React from 'react';
import {
  ContentRenderer,
  MediaThumb,
  PlatformIcon,
  fmtScheduled,
  hasMedia,
  isVisualContentType,
  DEFAULT_AUTHOR_NAME,
  DEFAULT_AUTHOR_HANDLE,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function XRenderer({ payload, cfg }: PlatformRendererProps) {
  const showMedia = isVisualContentType(payload.contentType) || payload.mediaUrls.length > 0;
  const showCharCount = !!cfg.charLimit;
  return (
    <div className="bg-white px-4 py-3">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white shrink-0">
          <PlatformIcon platform="x" size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-sm font-bold text-gray-900">{payload.authorName || DEFAULT_AUTHOR_NAME}</span>
            <span className="text-sm text-gray-500">{payload.authorHandle || DEFAULT_AUTHOR_HANDLE}</span>
            <span className="text-gray-400 text-xs ml-auto">{fmtScheduled(payload)}</span>
          </div>
          <ContentRenderer
            content={payload.content ?? ''}
            platform={payload.platform}
            contentType={payload.contentType}
            accentBg={cfg.avatarBg}
            showCharCount={showCharCount}
            emptyText="Write the first draft in Workspace to preview how this post will read."
            className="text-[15px] text-gray-900 leading-relaxed"
          />
          {showMedia && (
            <MediaThumb
              mediaUrls={payload.mediaUrls}
              className="mt-2 rounded-xl border border-gray-200 bg-gray-100 aspect-video"
              fallback={
                <div className="text-center opacity-40">
                  <PlatformIcon platform="x" size={28} />
                  <p className="text-xs text-gray-500 mt-1">{payload.contentType === 'video' ? 'Video' : 'Media'}</p>
                </div>
              }
            />
          )}
          <div className="mt-3 flex items-center gap-5 text-gray-400 text-xs">
            {['💬 0', '🔁 0', '❤ 0', '🔖', '📤'].map((a, i) => <span key={i}>{a}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
