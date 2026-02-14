import React from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export default function EngineOverridePanel({ value, onChange }: Props) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-800">Strategic Direction Override</h3>
      </div>
      <div className="p-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Adjust focus for this engine (optional)…"
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
    </div>
  );
}
