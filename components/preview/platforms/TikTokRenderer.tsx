'use client';

/**
 * TikTokRenderer — Phase 2 extraction.
 *
 * JSX extracted verbatim from PostPreviewModal's `isTikTok` branch
 * (components/dashboard/PostPreviewModal.tsx lines 152-180).
 */

import React from 'react';
import {
  PlatformIcon,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function TikTokRenderer({ payload }: PlatformRendererProps) {
  return (
    <div className="bg-black relative">
      <div className="relative bg-gradient-to-b from-gray-900 to-black" style={{ aspectRatio: '9/16', maxHeight: '52vh' }}>
        <div className="absolute inset-0 flex flex-col justify-end p-3">
          <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white border-2 border-white bg-black">
              <PlatformIcon platform="tiktok" size={14} />
            </div>
            {[['❤', '0'], ['💬', '0'], ['↩', '0'], ['⊕', '']].map(([icon, count], i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="text-white text-xl">{icon}</span>
                {count && <span className="text-white text-[10px]">{count}</span>}
              </div>
            ))}
          </div>
          <div className="pr-12">
            <p className="text-white font-semibold text-sm mb-1">@yourbrand</p>
            <p className="text-white text-xs leading-relaxed line-clamp-3">{payload.content || payload.title || ''}</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-white text-[10px] opacity-70">♫ Original sound · yourbrand</span>
            </div>
          </div>
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20">
          <PlatformIcon platform="tiktok" size={40} />
        </div>
      </div>
    </div>
  );
}
