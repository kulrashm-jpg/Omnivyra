import React from 'react';
import { buildImageQuery, searchImages as searchStockImages } from '@/lib/media/imageService';

type ImagePickerProps = {
  topic: string;
  description?: string;
  onSelect: (img: { url: string; thumb: string; attribution: string } | null) => void;
  selectedUrl?: string;
};

export default function ImagePicker({
  topic,
  description,
  onSelect,
  selectedUrl,
}: ImagePickerProps) {
  const autoQuery = buildImageQuery({ title: topic, excerpt: description });
  const [query, setQuery] = React.useState(autoQuery);
  const [results, setResults] = React.useState<import('@/lib/media/imageService').ImageResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searched, setSearched] = React.useState(false);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const imgs = await searchStockImages({ query: q.trim(), perPage: 4 });
      setResults(imgs);
      setSearched(true);
      if (imgs.length === 0) setError(null);
    } catch {
      setError('Failed to fetch images');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (autoQuery.trim()) search(autoQuery);
  }, [autoQuery]);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(query)}
          placeholder="Search images..."
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:border-indigo-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => search(query)}
          disabled={loading}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? '...' : 'Search'}
        </button>
        {selectedUrl && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            title="Remove selected image"
          >
            x
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}

      {results.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {results.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => onSelect({ url: img.full, thumb: img.thumb, attribution: img.attribution })}
              className={`relative aspect-video overflow-hidden rounded focus:outline-none ${
                selectedUrl === img.full ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-gray-400'
              }`}
              title={img.attribution}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumb} alt={img.alt} className="h-full w-full object-cover" loading="lazy" />
              {selectedUrl === img.full && (
                <div className="absolute inset-0 flex items-center justify-center bg-indigo-500/20">
                  <span className="text-lg text-white">OK</span>
                </div>
              )}
            </button>
          ))}
        </div>
      ) : searched && !loading ? (
        <p className="py-3 text-center text-[11px] text-gray-400">No images found. Try different keywords.</p>
      ) : !searched && !loading ? (
        <p className="py-3 text-center text-[11px] text-gray-400">Searching for "{topic}"...</p>
      ) : null}

      {selectedUrl && (
        <p className="mt-1.5 text-[9px] leading-tight text-gray-400">
          {results.find((r) => r.full === selectedUrl)?.attribution ?? 'Image selected'}
        </p>
      )}
    </div>
  );
}
