'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, BarChart3, Image, Layers, LayoutTemplate, Loader2, PanelsTopLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CreatorAssetBlock, CreatorAssetBlockType } from '../../../lib/blog/blockTypes';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';

type CreatorAssetRecord = {
  id: string;
  creatorType: string;
  title: string;
  url?: string;
  files?: string[];
  previewKind?: string;
  blockTemplateId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

type Props = {
  block: CreatorAssetBlock;
  companyId?: string;
  onChange: (block: CreatorAssetBlock) => void;
};

const ASSET_TYPES: Array<{ type: CreatorAssetBlockType; label: string; description: string; Icon: typeof Image; route: string }> = [
  { type: 'supporting_image', label: 'Image', description: 'Static visual or supporting image', Icon: Image, route: 'image' },
  { type: 'banner', label: 'Banner', description: 'Campaign, offer, or event banner', Icon: LayoutTemplate, route: 'banner' },
  { type: 'infographic', label: 'Infographic', description: 'Process, stats, or framework visual', Icon: BarChart3, route: 'infographic' },
  { type: 'carousel', label: 'Carousel', description: 'Multi-slide educational asset', Icon: PanelsTopLeft, route: 'carousel' },
  { type: 'slider', label: 'Slider', description: 'Presentation-flow slide asset', Icon: Layers, route: 'slider' },
  { type: 'brand_card', label: 'Brand Card', description: 'Quote, proof, or branded authority card', Icon: Badge, route: 'image' },
];

function previewUrl(asset: CreatorAssetRecord | CreatorAssetBlock): string {
  return asset.url || (Array.isArray(asset.files) ? asset.files.find(Boolean) || '' : '');
}

function captionFromAsset(asset: CreatorAssetRecord): string {
  const metadata = asset.metadata || {};
  const packaging = metadata.packaging && typeof metadata.packaging === 'object' ? metadata.packaging as Record<string, unknown> : {};
  return typeof packaging.caption === 'string' ? packaging.caption : '';
}

export function CreatorAssetBlockEditor({ block, companyId, onChange }: Props) {
  const [selectedType, setSelectedType] = useState<CreatorAssetBlockType>(block.creatorType || 'supporting_image');
  const [assets, setAssets] = useState<CreatorAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTypeMeta = useMemo(
    () => ASSET_TYPES.find((item) => item.type === selectedType) || ASSET_TYPES[0],
    [selectedType],
  );
  const SelectedTypeIcon = selectedTypeMeta.Icon;

  const loadAssets = useCallback(async (type: CreatorAssetBlockType) => {
    if (!companyId) {
      setAssets([]);
      setError('Select a company to browse saved Creator assets.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        company_id: companyId,
        creator_type: type,
        limit: '48',
      });
      const response = await fetchWithAuth(`/api/creator-assets?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to load Creator assets.');
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Creator assets.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadAssets(selectedType);
  }, [loadAssets, selectedType]);

  const selectAsset = (asset: CreatorAssetRecord) => {
    onChange({
      ...block,
      creatorType: selectedType,
      assetId: asset.id,
      title: asset.title,
      url: asset.url,
      files: Array.isArray(asset.files) ? asset.files.filter(Boolean) : [],
      previewKind: asset.previewKind,
      caption: captionFromAsset(asset),
      blockTemplateId: asset.blockTemplateId,
      metadata: asset.metadata || {},
    });
  };

  const deleteAsset = async (asset: CreatorAssetRecord) => {
    if (typeof window === 'undefined') return;
    if (!companyId) {
      window.alert('Select a company before deleting assets.');
      return;
    }
    if (!window.confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    try {
      const url = `/api/creator-assets?company_id=${encodeURIComponent(companyId)}&id=${encodeURIComponent(asset.id)}`;
      const res = await fetchWithAuth(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        let parsedError: string | null = null;
        try {
          const json = raw ? JSON.parse(raw) : null;
          parsedError = json && typeof json.error === 'string' ? json.error : null;
        } catch { /* not JSON */ }
        const isHtml = !parsedError && /^\s*<(!doctype|html)/i.test(raw);
        const diagnostic = isHtml
          ? 'dev server is serving an HTML page instead of JSON. Save any file in the editor to trigger a recompile, then try again.'
          : (parsedError || `server returned HTTP ${res.status}.`);
        window.alert(`Failed to delete asset — ${diagnostic}`);
        return;
      }
      // Drop the deleted asset from local state. If the currently-
      // selected block referenced this asset, clear the block too so
      // the editor doesn't keep a dead reference.
      setAssets((prev) => prev.filter((row) => row.id !== asset.id));
      if (block.assetId === asset.id) {
        onChange({
          ...block,
          assetId: undefined,
          title: '',
          url: undefined,
          files: [],
          previewKind: undefined,
          caption: undefined,
          blockTemplateId: undefined,
          metadata: {},
        });
      }
    } catch (err) {
      window.alert(err instanceof Error ? `Failed to delete asset: ${err.message}` : 'Failed to delete asset. Please try again.');
    }
  };

  const createHref = `/command-center/creator-content/${selectedTypeMeta.route}`;
  const currentPreview = previewUrl(block);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Asset type</p>
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-6">
          {ASSET_TYPES.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setSelectedType(type);
                if (block.creatorType !== type) {
                  onChange({
                    ...block,
                    creatorType: type,
                    assetId: undefined,
                    title: '',
                    url: undefined,
                    files: [],
                    previewKind: undefined,
                    caption: undefined,
                    blockTemplateId: undefined,
                    metadata: {},
                  });
                }
              }}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                selectedType === type
                  ? 'border-violet-400 bg-violet-50 text-violet-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-violet-200 hover:bg-violet-50/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {block.assetId && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3">
          <div className="flex gap-3">
            {currentPreview ? (
              <img src={currentPreview} alt={block.title || 'Selected asset'} className="h-20 w-24 rounded-md object-cover" />
            ) : (
              <div className="flex h-20 w-24 items-center justify-center rounded-md bg-white text-violet-500">
                <SelectedTypeIcon className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{block.title || 'Selected Creator asset'}</p>
              <p className="mt-1 text-xs text-gray-500">{selectedTypeMeta.label}{block.previewKind ? ` - ${block.previewKind.replace(/_/g, ' ')}` : ''}</p>
              {block.caption && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{block.caption}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Repository — collapsed by default. The full gallery grid is
          tall (especially with many saved assets), so it dominated
          the block. Hidden behind a single-line header that the
          operator clicks to expand when they're ready to browse and
          pick. `open` is uncontrolled so each block-instance tracks
          its own state without React plumbing. */}
      <details className="rounded-xl border border-gray-200 bg-gray-50 group">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 transition-transform group-open:rotate-90 select-none">▸</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedTypeMeta.label} repository</p>
              <p className="text-xs text-gray-500">{selectedTypeMeta.description}{assets.length > 0 ? ` · ${assets.length} saved` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => void loadAssets(selectedType)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <a
              href={createHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </a>
          </div>
        </summary>

        <div className="px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved assets...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>
        ) : assets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-center">
            <SelectedTypeIcon className="mx-auto h-6 w-6 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-700">No saved {selectedTypeMeta.label.toLowerCase()} assets yet.</p>
            <p className="mt-1 text-xs text-gray-500">Create one in Creator Content, save it as an asset, then return here and refresh.</p>
          </div>
        ) : (
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => {
              const isSelected = block.assetId === asset.id;
              const url = previewUrl(asset);
              return (
                <div
                  key={asset.id}
                  className={`group relative overflow-hidden rounded-lg border bg-white transition-all ${
                    isSelected ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-violet-300 hover:shadow-sm'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectAsset(asset)}
                    className="block w-full text-left"
                  >
                    {url ? (
                      <img src={url} alt={asset.title} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-gray-100 text-gray-400">
                        <SelectedTypeIcon className="h-6 w-6" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="truncate text-xs font-semibold text-gray-900">{asset.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">{asset.previewKind || asset.creatorType}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteAsset(asset);
                    }}
                    aria-label={`Delete ${asset.title}`}
                    title="Delete asset"
                    className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-500 opacity-0 shadow-sm transition-opacity hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </details>
    </div>
  );
}
