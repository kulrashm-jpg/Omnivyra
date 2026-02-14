import React from 'react';

const STRATEGIC_ASPECTS = [
  'Personal Clarity & Mental Peace',
  'Career & Professional Direction',
  'Emotional & Relationship Challenges',
  'Life Transitions & Decision Points',
  'Self-Discovery & Growth',
  'Crisis & Immediate Problem Solving',
] as const;

type Props = {
  selectedAspect: string | null;
  onChange: (aspect: string | null) => void;
};

export default function StrategicAspectSelector({ selectedAspect, onChange }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Strategic aspect</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STRATEGIC_ASPECTS.map((aspect) => {
          const selected = selectedAspect === aspect;
          return (
            <button
              key={aspect}
              type="button"
              onClick={() => onChange(selected ? null : aspect)}
              className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                selected
                  ? 'border-indigo-600 bg-indigo-50/50 text-gray-900'
                  : 'border-gray-200 hover:border-gray-300 text-gray-700'
              }`}
            >
              {aspect}
            </button>
          );
        })}
      </div>
    </div>
  );
}
