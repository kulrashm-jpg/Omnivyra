/**
 * Shared platform card primitives.
 *
 * Single source of truth for platform-faithful preview chrome (colors, engagement
 * affordances, multi-image grid). Consumed by both [PostPreviewModal] (single-event
 * preview) and [ThreadSequencePreview] (multi-node thread preview) so platform
 * formatting is never duplicated.
 *
 * Visual config moved here verbatim from components/dashboard/PostPreviewModal.tsx
 * as part of Phase 1A (G3). No behavior change for the modal — it imports the
 * same map it used to declare inline.
 */

import React from 'react';

export type PlatformCardConfig = {
  headerBg: string;
  avatarBg: string;
  cardBg: string;
  highlightCls: string;
  linkCls: string;
  engagements: string[];
  charLimit?: number;
  fontCls: string;
};

export const PLATFORM_CARD_CONFIG: Record<string, PlatformCardConfig> = {
  linkedin: {
    headerBg: 'bg-[#0A66C2] text-white',
    avatarBg: 'bg-[#0A66C2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#0A66C2] font-medium',
    linkCls: 'text-[#0A66C2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Repost', '✉ Send'],
    fontCls: 'font-sans',
  },
  x: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  twitter: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-white',
    highlightCls: 'text-sky-500 font-medium',
    linkCls: 'text-sky-500',
    engagements: ['💬 Reply', '🔁 Repost', '❤ Like', '🔖 Bookmark'],
    charLimit: 280,
    fontCls: 'font-sans text-[15px]',
  },
  instagram: {
    headerBg: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white',
    avatarBg: 'bg-gradient-to-br from-purple-500 to-orange-400',
    cardBg: 'bg-white',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['❤ Like', '💬 Comment', '📤 Share', '🔖 Save'],
    fontCls: 'font-sans',
  },
  facebook: {
    headerBg: 'bg-[#1877F2] text-white',
    avatarBg: 'bg-[#1877F2]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#1877F2] font-medium',
    linkCls: 'text-[#1877F2]',
    engagements: ['👍 Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans',
  },
  youtube: {
    headerBg: 'bg-[#FF0000] text-white',
    avatarBg: 'bg-[#FF0000]',
    cardBg: 'bg-[#F9F9F9]',
    highlightCls: 'text-blue-600 font-medium',
    linkCls: 'text-blue-600',
    engagements: ['👍 Like', '👎 Dislike', '↩ Share', '💾 Save'],
    fontCls: 'font-sans text-[13px]',
  },
  tiktok: {
    headerBg: 'bg-black text-white',
    avatarBg: 'bg-black',
    cardBg: 'bg-black',
    highlightCls: 'text-[#FE2C55] font-medium',
    linkCls: 'text-[#FE2C55]',
    engagements: ['❤ Like', '💬 Comment', '↩ Share'],
    fontCls: 'font-sans text-white',
  },
  pinterest: {
    headerBg: 'bg-[#E60023] text-white',
    avatarBg: 'bg-[#E60023]',
    cardBg: 'bg-white',
    highlightCls: 'text-[#E60023] font-medium',
    linkCls: 'text-[#E60023]',
    engagements: ['❤ Save', '💬 Comment', '↩ Send'],
    fontCls: 'font-sans',
  },
};

export const DEFAULT_PLATFORM_CARD_CONFIG: PlatformCardConfig = {
  headerBg: 'bg-indigo-600 text-white',
  avatarBg: 'bg-indigo-600',
  cardBg: 'bg-gray-50',
  highlightCls: 'text-indigo-600 font-medium',
  linkCls: 'text-indigo-600',
  engagements: ['❤ Like', '💬 Comment', '↩ Share'],
  fontCls: 'font-sans',
};

export function resolvePlatformCardConfig(platform?: string | null): PlatformCardConfig {
  const key = (platform ?? '').toLowerCase().trim();
  return PLATFORM_CARD_CONFIG[key] ?? DEFAULT_PLATFORM_CARD_CONFIG;
}

export function MediaThumb({
  mediaUrls,
  className,
  fallback,
}: {
  mediaUrls?: string[];
  className: string;
  fallback: React.ReactNode;
}) {
  const urls = (mediaUrls || []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  if (urls.length === 0) {
    return <div className={`${className} flex items-center justify-center`}>{fallback}</div>;
  }
  if (urls.length === 1) {
    return (
      <div className={`${className} relative overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[0]}
          alt="Post media"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    );
  }
  const display = urls.slice(0, 4);
  const extra = urls.length - display.length;
  const gridClass =
    display.length === 2 ? 'grid-cols-2 grid-rows-1'
    : 'grid-cols-2 grid-rows-2';
  return (
    <div className={`${className} relative overflow-hidden`}>
      <div className={`absolute inset-0 grid gap-0.5 ${gridClass}`}>
        {display.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className={`relative overflow-hidden bg-gray-100 ${
              display.length === 3 && i === 0 ? 'row-span-2' : ''
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Post media ${i + 1}`}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {extra > 0 && i === display.length - 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <span className="text-xl font-bold text-white">+{extra}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
