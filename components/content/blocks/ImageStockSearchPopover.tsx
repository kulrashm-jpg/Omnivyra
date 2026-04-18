'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { searchImages, buildImageQuery, type ImageResult } from '../../../lib/media/imageService';

type Props = {
  blogTitle: string;
  blogExcerpt?: string;
  blogTags?: string[];
  nearestHeading?: string;
  onSelect: (img: ImageResult) => void;
  onClose: () => void;
};

export function ImageStockSearchPopover({ blogTitle, blogExcerpt, blogTags, nearestHeading, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Auto-generate initial query
  useEffect(() => {
    const auto = buildImageQuery({
      title: nearestHeading || blogTitle,
      excerpt: blogExcerpt,
      tags: blogTags,
    });
    setQuery(auto);
    if (auto) {
      doSearch(auto);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    const imgs = await searchImages({ query: q.trim(), perPage: 12 });
    setResults(imgs);
    setLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-semibold text-gray-700">Search Stock Images</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-b border-gray-100">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Unsplash, Pexels, Pixabay..."
            className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-xs text-gray-700 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Go'}
        </button>
      </form>

      {/* Results */}
      <div className="max-h-[300px] overflow-y-auto px-4 py-3">
        {loading && (
          <div className="text-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
            <p className="text-xs text-gray-400 mt-1">Searching...</p>
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-8">No images found. Try a different query.</p>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {results.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => onSelect(img)}
                className="group relative rounded-lg overflow-hidden border border-gray-200 hover:border-purple-400 hover:ring-2 hover:ring-purple-200 transition-all"
              >
                <img
                  src={img.thumb}
                  alt={img.alt}
                  className="w-full h-20 object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end">
                  <p className="text-[8px] text-white opacity-0 group-hover:opacity-100 transition-opacity px-1.5 pb-1 truncate w-full">
                    {img.author} · {img.source}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
        <p className="text-[9px] text-gray-400">
          Images from Unsplash, Pexels, and Pixabay via integrated APIs
        </p>
      </div>
    </div>
  );
}
