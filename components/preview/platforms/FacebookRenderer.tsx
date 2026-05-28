'use client';

/**
 * FacebookRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isFacebook` branch
 * (components/dashboard/PostPreviewModal.tsx lines 300-331).
 */

import React from 'react';
import {
  ContentRenderer,
  MediaThumb,
  PlatformIcon,
  fmtScheduled,
  isVisualContentType,
  DEFAULT_AUTHOR_NAME,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function FacebookRenderer({ payload, cfg }: PlatformRendererProps) {
  const showMedia = isVisualContentType(payload.contentType) || payload.mediaUrls.length > 0;
  const showCharCount = !!cfg.charLimit;
  return (
    <div className="bg-white">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-full bg-[#1877F2] flex items-center justify-center text-white shrink-0">
            <PlatformIcon platform="facebook" size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{payload.authorName || DEFAULT_AUTHOR_NAME}</p>
            <p className="text-[11px] text-gray-500 flex items-center gap-1">{fmtScheduled(payload)} · <span>🌐</span></p>
          </div>
          <span className="ml-auto text-gray-400">•••</span>
        </div>
        <ContentRenderer
          content={payload.content ?? ''}
          platform={payload.platform}
          contentType={payload.contentType}
          accentBg={cfg.avatarBg}
          showCharCount={showCharCount}
          emptyText="Write the first draft in Workspace to preview how this post will read."
          className="text-sm text-gray-800 leading-relaxed"
        />
        {showMedia && (
          <MediaThumb
            mediaUrls={payload.mediaUrls}
            className="mt-3 -mx-4 bg-gray-100 aspect-video"
            fallback={
              <div className="text-center opacity-40">
                <PlatformIcon platform="facebook" size={32} />
                <p className="text-xs text-gray-500 mt-1">Photo / Video</p>
              </div>
            }
          />
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-1 text-xs text-gray-600">
        {cfg.engagements.map((a, i) => (
          <span key={i} className="flex-1 flex items-center justify-center gap-1 py-1 hover:bg-gray-50 rounded font-medium">{a}</span>
        ))}
      </div>
    </div>
  );
}
