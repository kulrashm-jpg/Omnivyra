import React, { useState, useMemo } from 'react';

/** First letter of each word uppercase; rest lowercase. Used for display only. */
function toTitleCase(s: string): string {
  if (!s || typeof s !== 'string') return s;
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Fallback when API does not return company-specific aspects. */
export const DEFAULT_STRATEGIC_ASPECTS = [
  'Personal Clarity & Mental Peace',
  'Career & Professional Direction',
  'Emotional & Relationship Challenges',
  'Life Transitions & Decision Points',
  'Self-Discovery & Growth',
  'Crisis & Immediate Problem Solving',
];

const COLLAPSED_VISIBLE = 6;

type Props = {
  /** Company-specific strategic aspects (from profile / recommendation_strategic_config). */
  aspects: string[];
  selectedAspect: string | null;
  onChange: (aspect: string | null) => void;
  /** When set, only these aspects are clickable (e.g. after user picked Offerings first). Null = all active. */
  enabledAspectIds?: Set<string> | null;
};

const sortAtoZ = (a: string, b: string) =>
  a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), undefined, { sensitivity: 'base' });

export default function StrategicAspectSelector({
  aspects,
  selectedAspect,
  onChange,
  enabledAspectIds = null,
}: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const raw = aspects.length > 0 ? aspects : DEFAULT_STRATEGIC_ASPECTS;
  const list = useMemo(() => [...raw].sort(sortAtoZ), [raw]);
  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((a) => a.toLowerCase().includes(q));
  }, [list, search]);
  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_VISIBLE);
  const hasMore = filtered.length > COLLAPSED_VISIBLE;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Strategic aspect</h3>
      <div className="mb-3">
        <input
          type="search"
          placeholder="Search aspects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
          aria-label="Search strategic aspects"
        />
        {search.trim() && (
          <p className="mt-1 text-xs text-gray-500">
            {filtered.length} aspect{filtered.length !== 1 ? 's' : ''} match
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {visible.map((aspect) => {
          const selected = selectedAspect === aspect;
          const enabled = enabledAspectIds == null || enabledAspectIds.has(aspect);
          return (
            <button
              key={aspect}
              type="button"
              disabled={!enabled}
              onClick={() => (enabled ? onChange(selected ? null : aspect) : undefined)}
              className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                !enabled
                  ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : selected
                    ? 'border-indigo-600 bg-indigo-50/50 text-gray-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
              }`}
            >
              {toTitleCase(aspect)}
            </button>
          );
        })}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          {expanded ? 'Show less' : `Show more (${filtered.length - COLLAPSED_VISIBLE} more)`}
        </button>
      )}
    </div>
  );
}
