'use client';

import React from 'react';
import type { ImageBlock } from '../../../lib/blog/blockTypes';
import { ImageIcon } from 'lucide-react';

type Props = {
  block: ImageBlock;
  onChange: (block: ImageBlock) => void;
};

export function ImageBlockEditor({ block, onChange }: Props) {
  const hasUrl = block.url.trim() !== '';
  const isAltMissing = hasUrl && !block.alt.trim();

  return (
    <div className="space-y-3">
      {/* URL */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Image URL *</label>
        <input
          type="url"
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="https://..."
        />
      </div>

      {/* Preview */}
      {hasUrl && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          <img
            src={block.url}
            alt={block.alt || 'Preview'}
            className="max-h-48 w-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {!hasUrl && (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 py-8 text-gray-400">
          <ImageIcon className="h-8 w-8" />
        </div>
      )}

      {/* Alt text — required */}
      <div>
        <label className={`block text-xs font-medium mb-1 ${isAltMissing ? 'text-red-600' : 'text-gray-600'}`}>
          Alt text {isAltMissing ? '— required for accessibility and SEO' : '*'}
        </label>
        <input
          type="text"
          value={block.alt}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-[#3D4F61] focus:outline-none ${
            isAltMissing ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-[#0A66C2]'
          }`}
          placeholder="Describe the image for screen readers and search engines"
        />
      </div>

      {/* Caption */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Caption (optional)</label>
        <input
          type="text"
          value={block.caption ?? ''}
          onChange={(e) => onChange({ ...block, caption: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="Image caption displayed below the image"
        />
      </div>
    </div>
  );
}
