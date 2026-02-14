import React from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  mode?: string;
};

export default function StrategicConsole({ value, onChange }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">Strategic Direction & Refinement</h3>
      </div>
      <div className="p-4 space-y-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Adjust focus for this engine (optional)…"
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {}}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            🎙 Record Voice
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
