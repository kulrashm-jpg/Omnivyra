'use client';

import React from 'react';
import type { MediaBlock, MediaType } from '../../../lib/blog/blockTypes';

type Props = {
  block: MediaBlock;
  onChange: (block: MediaBlock) => void;
};

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: 'youtube',          label: 'YouTube' },
  { value: 'spotify_track',    label: 'Spotify Track' },
  { value: 'spotify_podcast',  label: 'Spotify Podcast' },
  { value: 'external_link',    label: 'External Link' },
];

export function MediaBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      {/* Media type selector */}
      <div className="flex flex-wrap gap-2">
        {MEDIA_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange({ ...block, mediaType: opt.value })}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              block.mediaType === opt.value
                ? 'bg-[#0A66C2] text-white border-[#0A66C2]'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* URL */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">URL *</label>
        <input
          type="url"
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="https://..."
        />
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Title (optional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="Media title"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
        <textarea
          value={block.description ?? ''}
          onChange={(e) => onChange({ ...block, description: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none resize-none"
          placeholder="Brief description of this media"
        />
      </div>
    </div>
  );
}
