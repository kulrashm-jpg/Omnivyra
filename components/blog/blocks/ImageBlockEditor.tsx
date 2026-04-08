'use client';

import React from 'react';
import type { ImageBlock } from '../../../lib/blog/blockTypes';
import { ImageIcon, Search } from 'lucide-react';

type Props = {
  block: ImageBlock;
  onChange: (block: ImageBlock) => void;
  onSearchStock?: () => void;
};

export function ImageBlockEditor({ block, onChange, onSearchStock }: Props) {
  const hasUrl = block.url.trim() !== '';
  const isAltMissing = hasUrl && !block.alt.trim();

  return (
    <div className="space-y-3">
      {/* URL + Search button */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Image URL *</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
            placeholder="https://..."
          />
          {onSearchStock && (
            <button
              type="button"
              onClick={onSearchStock}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-colors whitespace-nowrap"
            >
              <Search className="h-3.5 w-3.5" /> Stock Images
            </button>
          )}
        </div>
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
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 py-8 text-gray-400 gap-2">
          <ImageIcon className="h-8 w-8" />
          {onSearchStock && (
            <button
              type="button"
              onClick={onSearchStock}
              className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
            >
              <Search className="h-3 w-3" /> Search stock images
            </button>
          )}
        </div>
      )}

      {/* Attribution (from stock image selection) */}
      {block.attribution && (
        <p className="text-[10px] text-gray-400 italic">
          {block.attributionUrl ? (
            <a href={block.attributionUrl} target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 underline">
              {block.attribution}
            </a>
          ) : (
            block.attribution
          )}
        </p>
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
