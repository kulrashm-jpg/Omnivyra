'use client';

/**
 * LinkedInRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isLinkedIn` branch
 * (components/dashboard/PostPreviewModal.tsx lines 255-298).
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
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function LinkedInRenderer({ payload, cfg }: PlatformRendererProps) {
  const isLinkedInArticle = payload.contentType === 'article';
  const showMedia = (isVisualContentType(payload.contentType) || payload.mediaUrls.length > 0) && !isLinkedInArticle;
  const showCharCount = !!cfg.charLimit;
  return (
    <div className="bg-white">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${cfg.avatarBg}`}>
            <PlatformIcon platform="linkedin" size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight">{payload.authorName || DEFAULT_AUTHOR_NAME}</p>
            <p className="text-[11px] text-gray-500 leading-tight">Company · {fmtScheduled(payload)}</p>
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">🌐 Anyone</span>
          </div>
          <span className="ml-auto text-gray-400 text-sm shrink-0">•••</span>
        </div>
        {isLinkedInArticle && payload.title && (
          <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-5">
              <p className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide mb-1">Article</p>
              <p className="text-base font-bold text-gray-900 leading-snug">{payload.title}</p>
              <p className="text-xs text-gray-500 mt-1">{payload.authorName || DEFAULT_AUTHOR_NAME} · LinkedIn Article</p>
            </div>
          </div>
        )}
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
            className="mt-3 rounded-lg bg-gray-100 aspect-video border border-gray-200"
            fallback={
              <div className="text-center opacity-40">
                <PlatformIcon platform="linkedin" size={28} />
                <p className="text-xs text-gray-500 mt-1">
                  {payload.contentType === 'video' ? 'Video'
                    : payload.contentType === 'carousel' ? 'Carousel'
                    : 'Image'}
                </p>
              </div>
            }
          />
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-100">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          {cfg.engagements.map((a, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50 rounded">{a}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
