'use client';

/**
 * PinterestRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isPinterest` branch
 * (components/dashboard/PostPreviewModal.tsx lines 361-379).
 */

import React from 'react';
import {
  ContentRenderer,
  MediaThumb,
  PlatformIcon,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function PinterestRenderer({ payload, cfg }: PlatformRendererProps) {
  return (
    <div className="bg-white">
      <MediaThumb
        mediaUrls={payload.mediaUrls}
        className="aspect-[2/3] max-h-64 bg-gradient-to-br from-rose-100 to-orange-100 rounded-2xl mx-3 mt-3"
        fallback={
          <div className="text-center opacity-40">
            <PlatformIcon platform="pinterest" size={36} />
            <p className="text-xs text-gray-500 mt-1">Pin Image</p>
          </div>
        }
      />
      <div className="px-4 py-3">
        <p className="text-base font-bold text-gray-900 mb-1">{payload.title || ''}</p>
        <ContentRenderer
          content={payload.content ?? ''}
          platform={payload.platform}
          contentType={payload.contentType}
          accentBg={cfg.avatarBg}
          showCharCount={false}
          emptyText="Add a helpful description in Workspace so this pin is ready to publish."
          className="text-sm text-gray-600 leading-relaxed"
        />
      </div>
    </div>
  );
}
