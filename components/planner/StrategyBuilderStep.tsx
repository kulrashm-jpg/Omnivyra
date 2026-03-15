/**
 * Strategy Builder Step
 * Collects strategy fields: duration, platforms, frequency, content mix, goal, audience.
 */

import React, { useState } from 'react';
import { usePlannerSession, type StrategyContext } from './plannerSessionStore';
import { CANONICAL_PLATFORMS, PLATFORM_OPTIONS, type CanonicalPlatform } from '../../backend/constants/platforms';

const CANONICAL_VALUES = new Set<string>(CANONICAL_PLATFORMS);

function toCanonicalPlatform(p: string): CanonicalPlatform | null {
  const v = String(p ?? '').trim().toLowerCase();
  if (v === 'x') return 'twitter';
  return CANONICAL_VALUES.has(v) ? (v as CanonicalPlatform) : null;
}
const CONTENT_MIX_OPTIONS = ['post', 'video', 'blog', 'carousel', 'story', 'thread', 'short'];
const DURATION_OPTIONS = [6, 8, 12, 16];

export interface StrategyBuilderStepProps {
  onComplete?: (output: StrategyContext) => void;
}

export function StrategyBuilderStep({ onComplete }: StrategyBuilderStepProps) {
  const { state, setStrategyContext } = usePlannerSession();
  const prev = state.execution_plan?.strategy_context;
  const [duration_weeks, setDurationWeeks] = useState(prev?.duration_weeks ?? 12);
  const [platforms, setPlatforms] = useState<string[]>(() => {
    const raw = prev?.platforms ?? [];
    return raw.map(toCanonicalPlatform).filter((p): p is CanonicalPlatform => p != null);
  });
  const [content_mix, setContentMix] = useState<string[]>(prev?.content_mix ?? ['post']);
  const [campaign_goal, setCampaignGoal] = useState(prev?.campaign_goal ?? '');
  const [target_audience, setTargetAudience] = useState(prev?.target_audience ?? '');
  const [posting_frequency, setPostingFrequency] = useState<Record<string, number>>(
    prev?.posting_frequency ?? {}
  );

  const togglePlatform = (value: string) => {
    setPlatforms((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]
    );
  };

  const toggleContentMix = (c: string) => {
    setContentMix((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const isValid =
    duration_weeks > 0 &&
    platforms.length > 0 &&
    platforms.every((p) => typeof posting_frequency[p] === 'number' || posting_frequency[p] === undefined);

  const handleSave = () => {
    if (!isValid) return;
    const freq: Record<string, number> = {};
    platforms.forEach((p) => {
      freq[p] = posting_frequency[p] ?? 3;
    });
    const output: StrategyContext = {
      duration_weeks,
      platforms,
      posting_frequency: freq,
      content_mix: content_mix.length ? content_mix : ['post'],
      campaign_goal,
      target_audience,
    };
    setStrategyContext(output);
    onComplete?.(output);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Strategy</h2>
        <p className="text-sm text-gray-500 mt-1">
          Define duration, platforms, and content focus for your campaign.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Duration (weeks)</label>
        <div className="flex gap-2 flex-wrap">
          {DURATION_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDurationWeeks(n)}
              className={`px-4 py-2 rounded-xl border-2 text-sm font-medium ${
                duration_weeks === n
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {n} weeks
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Platforms</label>
        <div className="flex gap-2 flex-wrap">
          {PLATFORM_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => togglePlatform(value)}
              className={`px-4 py-2 rounded-xl border-2 text-sm font-medium ${
                platforms.includes(value)
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Content mix</label>
        <div className="flex gap-2 flex-wrap">
          {CONTENT_MIX_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleContentMix(c)}
              className={`px-4 py-2 rounded-xl border-2 text-sm font-medium ${
                content_mix.includes(c)
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Campaign goal</label>
        <input
          type="text"
          value={campaign_goal}
          onChange={(e) => setCampaignGoal(e.target.value)}
          placeholder="e.g. Brand awareness, lead generation"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Target audience</label>
        <input
          type="text"
          value={target_audience}
          onChange={(e) => setTargetAudience(e.target.value)}
          placeholder="e.g. B2B marketers, small business owners"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={!isValid}
        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
