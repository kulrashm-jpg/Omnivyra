'use client';

/**
 * YouTubeRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isYouTube` branch
 * (components/dashboard/PostPreviewModal.tsx lines 333-359).
 */

import React from 'react';
import {
  ContentRenderer,
  PlatformIcon,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function YouTubeRenderer({ payload, cfg }: PlatformRendererProps) {
  return (
    <div className="bg-[#F9F9F9]">
      <div className="aspect-video bg-gray-800 flex items-center justify-center relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 bg-[#FF0000] rounded-full flex items-center justify-center opacity-80">
            <span className="text-white text-xl">▶</span>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 p-3">
          <p className="text-white text-xs font-medium line-clamp-2">{payload.title || ''}</p>
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-900 leading-snug mb-2 line-clamp-2">{payload.title || ''}</p>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-[#FF0000] flex items-center justify-center text-white shrink-0">
            <PlatformIcon platform="youtube" size={14} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900">{payload.authorName || 'Your Brand'}</p>
            <p className="text-[10px] text-gray-500">Scheduled · {payload.scheduledDate || ''}</p>
          </div>
        </div>
        <ContentRenderer
          content={payload.content ?? ''}
          platform={payload.platform}
          contentType={payload.contentType}
          accentBg={cfg.avatarBg}
          showCharCount={false}
          emptyText="Add a short description in Workspace to preview how viewers will discover this video."
          className="text-xs text-gray-600 leading-relaxed"
        />
      </div>
    </div>
  );
}
