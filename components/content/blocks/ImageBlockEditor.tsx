'use client';

import React from 'react';
import type { ImageBlock } from '../../../lib/blog/blockTypes';
import { ImageIcon, Search, Sparkles, Upload, Library, Link2, Building2, RefreshCw, Trash2 } from 'lucide-react';
import { BlockFormatControls } from './BlockFormatControls';

/**
 * Asset-slot actions (CREATOR-037, STEP 5). Each is optional — buttons render
 * only when a handler is wired, so this is a pure additive extension of the
 * existing image block. The host wires these to the universal realization engine
 * (AI generate / upload / media library / import URL / organization library /
 * replace / remove). No editor redesign; no second asset system.
 */
export type AssetSlotActions = {
  onGenerateAI?: () => void;
  onUpload?: () => void;
  onMediaLibrary?: () => void;
  onImportUrl?: () => void;
  onOrganizationLibrary?: () => void;
  onReplace?: () => void;
  onRemove?: () => void;
};

type Props = {
  block: ImageBlock;
  onChange: (block: ImageBlock) => void;
  onSearchStock?: () => void;
  assetActions?: AssetSlotActions;
};

function AssetActionBar({ actions }: { actions: AssetSlotActions }) {
  const items: Array<[boolean | undefined, () => void, React.ReactNode, string]> = [
    [!!actions.onGenerateAI, actions.onGenerateAI!, <Sparkles className="h-3.5 w-3.5" />, 'Generate with AI'],
    [!!actions.onUpload, actions.onUpload!, <Upload className="h-3.5 w-3.5" />, 'Upload'],
    [!!actions.onMediaLibrary, actions.onMediaLibrary!, <Library className="h-3.5 w-3.5" />, 'Media Library'],
    [!!actions.onImportUrl, actions.onImportUrl!, <Link2 className="h-3.5 w-3.5" />, 'Import URL'],
    [!!actions.onOrganizationLibrary, actions.onOrganizationLibrary!, <Building2 className="h-3.5 w-3.5" />, 'Organization Library'],
    [!!actions.onReplace, actions.onReplace!, <RefreshCw className="h-3.5 w-3.5" />, 'Replace'],
    [!!actions.onRemove, actions.onRemove!, <Trash2 className="h-3.5 w-3.5" />, 'Remove'],
  ];
  const shown = items.filter(([on]) => on);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(([, handler, icon, label], i) => (
        <button
          key={i}
          type="button"
          onClick={handler}
          title={label}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
            label === 'Remove' ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300'
          }`}
        >
          {icon} {label}
        </button>
      ))}
    </div>
  );
}

export function ImageBlockEditor({ block, onChange, onSearchStock, assetActions }: Props) {
  const hasUrl = block.url.trim() !== '';
  const isAltMissing = hasUrl && !block.alt.trim();

  return (
    <div className="space-y-3">
      {assetActions && <AssetActionBar actions={assetActions} />}
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

      <BlockFormatControls block={block} onChange={onChange} />
    </div>
  );
}
