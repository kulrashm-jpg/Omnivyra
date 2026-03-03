/**
 * Unified Context Mode Selector for Trend, Market Pulse, Active Leads.
 * Persists to localStorage: engine_context_selection
 */

import React, { useState, useEffect } from 'react';

export type ContextMode = 'FULL' | 'FOCUSED' | 'NONE';
export type FocusModule =
  | 'TARGET_CUSTOMER'
  | 'PROBLEM_DOMAIN'
  | 'CAMPAIGN_PURPOSE'
  | 'OFFERINGS'
  | 'GEOGRAPHY'
  | 'PRICING';

const STORAGE_KEY = 'engine_context_selection';

export type StoredSelection = {
  mode: ContextMode;
  modules: FocusModule[];
};

const FOCUS_MODULES: { value: FocusModule; label: string }[] = [
  { value: 'TARGET_CUSTOMER', label: 'Target Customer' },
  { value: 'PROBLEM_DOMAIN', label: 'Problem Domains' },
  { value: 'CAMPAIGN_PURPOSE', label: 'Campaign Purpose' },
  { value: 'OFFERINGS', label: 'Offerings' },
  { value: 'GEOGRAPHY', label: 'Geography' },
  { value: 'PRICING', label: 'Pricing' },
];

function loadStored(): StoredSelection {
  if (typeof window === 'undefined') return { mode: 'FULL', modules: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: 'FULL', modules: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'mode' in parsed) {
      const mode = ['FULL', 'FOCUSED', 'NONE'].includes((parsed as { mode?: string }).mode as string)
        ? ((parsed as { mode: ContextMode }).mode)
        : 'FULL';
      const modules = Array.isArray((parsed as { modules?: unknown }).modules)
        ? ((parsed as unknown as { modules: unknown[] }).modules as FocusModule[]).filter((m) =>
            FOCUS_MODULES.some((f) => f.value === m)
          )
        : [];
      return { mode, modules };
    }
  } catch {
    /* ignore */
  }
  return { mode: 'FULL', modules: [] };
}

function saveStored(s: StoredSelection) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export type UnifiedContextModeSelectorProps = {
  mode: ContextMode;
  modules: FocusModule[];
  additionalDirection: string;
  onModeChange: (mode: ContextMode) => void;
  onModulesChange: (modules: FocusModule[]) => void;
  onAdditionalDirectionChange: (value: string) => void;
  /** When true, NONE mode requires additionalDirection to be non-empty for execution */
  requireDirectionWhenNone?: boolean;
};

export default function UnifiedContextModeSelector({
  mode,
  modules,
  additionalDirection,
  onModeChange,
  onModulesChange,
  onAdditionalDirectionChange,
  requireDirectionWhenNone = true,
}: UnifiedContextModeSelectorProps) {
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (restored) return;
    const stored = loadStored();
    onModeChange(stored.mode);
    onModulesChange(stored.modules);
    setRestored(true);
  }, [restored, onModeChange, onModulesChange]);

  useEffect(() => {
    if (!restored) return;
    saveStored({ mode, modules });
  }, [mode, modules, restored]);

  const toggleModule = (m: FocusModule) => {
    if (modules.includes(m)) {
      onModulesChange(modules.filter((x) => x !== m));
    } else {
      onModulesChange([...modules, m]);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-2">Context Mode</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="contextMode"
              checked={mode === 'FULL'}
              onChange={() => onModeChange('FULL')}
              className="text-indigo-600"
            />
            <span className="text-sm text-gray-700">Full Company Context</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="contextMode"
              checked={mode === 'FOCUSED'}
              onChange={() => onModeChange('FOCUSED')}
              className="text-indigo-600"
            />
            <span className="text-sm text-gray-700">Focused Context</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="contextMode"
              checked={mode === 'NONE'}
              onChange={() => onModeChange('NONE')}
              className="text-indigo-600"
            />
            <span className="text-sm text-gray-700">No Company Context</span>
          </label>
        </div>
      </div>

      {mode === 'FOCUSED' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Focus Modules (multi-select)</label>
          <div className="flex flex-wrap gap-2">
            {FOCUS_MODULES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleModule(f.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                  modules.includes(f.value)
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-800'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {modules.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Focused on: {modules.map((m) => FOCUS_MODULES.find((f) => f.value === m)?.label ?? m).join(' + ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

