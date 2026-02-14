import React from 'react';

export type ContextMode = 'FULL' | 'BRAND_ONLY' | 'ICP_ONLY' | 'BRAND_ICP' | 'NONE';

const OPTIONS: { value: ContextMode; label: string }[] = [
  { value: 'FULL', label: 'Full Company Context (FULL)' },
  { value: 'BRAND_ONLY', label: 'Brand Voice Only (BRAND_ONLY)' },
  { value: 'ICP_ONLY', label: 'ICP Only (ICP_ONLY)' },
  { value: 'BRAND_ICP', label: 'Brand + ICP (BRAND_ICP)' },
  { value: 'NONE', label: 'No Company Context (NONE)' },
];

type Props = {
  mode: ContextMode;
  onChange: (mode: ContextMode) => void;
};

export default function ContextModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <label className="block text-sm font-semibold text-gray-800 mb-2">Company Context Scope</label>
      <select
        value={mode}
        onChange={(e) => onChange(e.target.value as ContextMode)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
