'use client';

/**
 * InstagramRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isInstagram` branch
 * (components/dashboard/PostPreviewModal.tsx lines 182-220) so the
 * writer + calendar surfaces share platform-faithful Instagram chrome.
 */

import React from 'react';
import {
  ContentRenderer,
  MediaThumb,
  PlatformIcon,
  fmtScheduled,
  hasMedia,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function InstagramRenderer({ payload, cfg }: PlatformRendererProps) {
  const showMedia = hasMedia(payload) || payload.contentType === 'post';
  const isStory = payload.contentType === 'story';
  return (
    <div className="bg-white">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-orange-400 flex items-center justify-center text-white shrink-0">
            <PlatformIcon platform="instagram" size={14} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900 leading-none">yourbrand</p>
            <p className="text-[10px] text-gray-500">{fmtScheduled(payload)}</p>
          </div>
        </div>
        <span className="text-gray-400 text-lg">•••</span>
      </div>
      {showMedia && (
        <MediaThumb
          mediaUrls={payload.mediaUrls}
          className={`w-full bg-gradient-to-br from-purple-100 via-pink-100 to-orange-100 ${
            isStory ? 'aspect-[9/16] max-h-52' : 'aspect-square'
          }`}
          fallback={
            <div className="text-center opacity-40">
              <PlatformIcon platform="instagram" size={32} />
              <p className="text-xs text-gray-500 mt-1">
                {payload.contentType === 'reel' ? 'Reel'
                  : payload.contentType === 'story' ? 'Story'
                  : payload.contentType === 'carousel' ? 'Carousel'
                  : 'Photo'}
              </p>
            </div>
          }
        />
      )}
      <div className="px-3 pt-2 flex items-center gap-3 text-gray-800">
        <span>❤</span><span>💬</span><span>📤</span>
        <span className="ml-auto">🔖</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-gray-900">
          <span className="font-semibold">yourbrand</span>{' '}
          {payload.content
            ? <span className="line-clamp-3">{payload.content}</span>
            : <span className="text-gray-400 italic">Write a short caption to preview how this post will read.</span>}
        </p>
      </div>
    </div>
  );
}
