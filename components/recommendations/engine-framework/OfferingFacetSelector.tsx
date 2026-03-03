import React from 'react';

export type OfferingFacetCard = { id: string; title: string; description?: string };

/** First letter of each word uppercase; rest lowercase. Used for display only. */
function toTitleCase(s: string): string {
  if (!s || typeof s !== 'string') return s;
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

type Props = {
  /** Strategic aspect currently selected; offerings are shown only after aspect selection. */
  selectedAspect: string | null;
  /** Offerings for the selected aspect (from API: offerings_by_aspect[selectedAspect]). Loaded by parent from recommendation_strategic_config. */
  offerings: OfferingFacetCard[];
  selectedFacets: string[];
  onChange: (facets: string[]) => void;
  mode: string;
};

/**
 * Offering focus selector. Displays offerings ONLY after user selects a strategic aspect.
 * Parent supplies offerings from API (offerings_by_aspect[selectedAspect]).
 * No frontend derivation; all data from backend strategic intelligence.
 */
export default function OfferingFacetSelector({
  selectedAspect,
  offerings,
  selectedFacets,
  onChange,
  mode,
}: Props) {
  const toggle = (id: string) => {
    if (selectedFacets.includes(id)) {
      onChange(selectedFacets.filter((f) => f !== id));
    } else {
      onChange([...selectedFacets, id]);
    }
  };

  if (mode === 'NONE') return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Offering focus</h3>
      {!selectedAspect && (
        <p className="text-xs text-gray-500">
          Select a strategic aspect above to see offering focus options for that domain.
        </p>
      )}
      {selectedAspect && offerings.length === 0 && (
        <p className="text-xs text-gray-500">No offerings for this aspect from company profile.</p>
      )}
      {selectedAspect && offerings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          {offerings.map((f) => {
            const selected = selectedFacets.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'border-indigo-600 bg-indigo-50/50 text-gray-900'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <div className="font-medium truncate">{toTitleCase(f.title)}</div>
                {f.description && (
                  <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{toTitleCase(f.description)}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
