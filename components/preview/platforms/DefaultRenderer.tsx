'use client';

/**
 * DefaultRenderer — Phase 2 extraction.
 *
 * Generic fallback chrome for platforms without a bespoke renderer.
 * JSX extracted verbatim from PostPreviewModal's default branch
 * (components/dashboard/PostPreviewModal.tsx lines 381-394).
 */

import React from 'react';
import {
  ContentRenderer,
  PlatformIcon,
  fmtScheduled,
  DEFAULT_AUTHOR_NAME,
  type PlatformRendererProps,
} from './BasePlatformRenderer';

export default function DefaultRenderer({ payload, cfg }: PlatformRendererProps) {
  const showCharCount = !!cfg.charLimit;
  return (
    <div className="bg-white p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 ${cfg.avatarBg}`}>
          <PlatformIcon platform={payload.platform || 'default'} size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{payload.authorName || DEFAULT_AUTHOR_NAME}</p>
          <p className="text-xs text-gray-500">{fmtScheduled(payload)}</p>
        </div>
      </div>
      <ContentRenderer
        content={payload.content ?? ''}
        platform={payload.platform}
        contentType={payload.contentType}
        accentBg={cfg.avatarBg}
        showCharCount={showCharCount}
        emptyText="Write the first draft in Workspace to preview how this post will read."
        className={cfg.fontCls}
      />
    </div>
  );
}
