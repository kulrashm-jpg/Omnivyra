/**
 * Account Insight Panel
 * variant="social" → social presence numbers (followers, engagement, reach per platform)
 * variant="content" → content-perspective health per platform + recommendations
 *
 * Shows top 3 platforms by default (sorted by followers desc).
 * A "Show" button opens a dropdown listing all configured platforms;
 * user can pick up to 3.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { usePlannerSession } from './plannerSessionStore';
import PlatformIcon from '../ui/PlatformIcon';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function audienceTerm(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'linkedin': return 'connections';
    case 'youtube':  return 'subscribers';
    case 'reddit':   return 'members';
    default:         return 'followers';
  }
}

const MAX_SELECTED = 3;

function PlatformPickerDropdown({
  platforms,
  selected,
  onToggle,
}: {
  platforms: { platform: string }[];
  selected: Set<string>;
  onToggle: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition-colors"
      >
        Show ({selected.size}/{MAX_SELECTED})
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          <p className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
            Select up to {MAX_SELECTED}
          </p>
          {platforms.map((p) => {
            const checked = selected.has(p.platform);
            const atMax = selected.size >= MAX_SELECTED && !checked;
            return (
              <button
                key={p.platform}
                type="button"
                disabled={atMax}
                onClick={() => onToggle(p.platform)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                  atMax
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-indigo-50'
                } ${checked ? 'bg-indigo-50' : ''}`}
              >
                <PlatformIcon platform={p.platform} size={14} showLabel useBrandColor={!atMax} />
                {checked && <Check className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AccountInsightPanel({ variant }: { variant: 'social' | 'content' }) {
  const { state } = usePlannerSession();
  const ctx = state.account_context;

  // Sort all configured platforms by followers desc; default top 3 selected
  const sortedPlatforms = [...(ctx?.platforms ?? [])].sort((a, b) => b.followers - a.followers);
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (ctx && !selected) {
      setSelected(new Set(sortedPlatforms.slice(0, MAX_SELECTED).map((p) => p.platform)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const activeSelected = selected ?? new Set(sortedPlatforms.slice(0, MAX_SELECTED).map((p) => p.platform));

  function togglePlatform(platform: string) {
    setSelected((prev) => {
      const next = new Set(prev ?? activeSelected);
      if (next.has(platform)) {
        if (next.size === 1) return next; // keep at least one
        next.delete(platform);
      } else {
        if (next.size >= MAX_SELECTED) return next; // cap at 3
        next.add(platform);
      }
      return next;
    });
  }

  if (!ctx) return (
    <div className="text-xs text-gray-400 px-4 py-3">Account insight not yet loaded.</div>
  );

  const stageBadge: Record<string, string> = {
    NEW: 'bg-yellow-100 text-yellow-800',
    GROWING: 'bg-blue-100 text-blue-800',
    ESTABLISHED: 'bg-green-100 text-green-800',
  };

  const displayPlatforms = sortedPlatforms.filter((p) => activeSelected.has(p.platform));

  const picker = sortedPlatforms.length > 0 && (
    <PlatformPickerDropdown
      platforms={sortedPlatforms}
      selected={activeSelected}
      onToggle={togglePlatform}
    />
  );

  if (variant === 'social') {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        {/* Summary row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Stage:</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${stageBadge[ctx.maturityStage] ?? 'bg-gray-100 text-gray-700'}`}>
                {ctx.maturityStage}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Authority:</span>
              <span className="text-sm font-bold text-indigo-700">{ctx.overallScore}/100</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Total Audience:</span>
              <span className="text-sm font-bold text-gray-800">
                {(() => { const t = ctx.platforms.reduce((s, p) => s + p.followers, 0); return t > 0 ? fmt(t) : '—'; })()}
              </span>
            </div>
          </div>
          {picker}
        </div>

        {/* Per-platform grid */}
        {displayPlatforms.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {displayPlatforms.map((p) => (
              <div key={p.platform} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 space-y-1">
                <div className="text-xs font-semibold text-gray-700">
                  <PlatformIcon platform={p.platform} size={13} showLabel />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-xs text-gray-500">
                    <span className="font-medium text-gray-800">{p.followers > 0 ? fmt(p.followers) : '—'}</span> {audienceTerm(p.platform)}
                  </span>
                  {p.engagementRate > 0 && (
                    <span className="text-xs text-gray-500">
                      <span className="font-medium text-gray-800">{p.engagementRate.toFixed(1)}%</span> eng
                    </span>
                  )}
                  {p.avgReach > 0 && (
                    <span className="text-xs text-gray-500">
                      <span className="font-medium text-gray-800">{fmt(p.avgReach)}</span> reach
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // variant === 'content'
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-xs font-medium text-gray-500">
            Content Authority: <span className="font-bold text-indigo-700">{ctx.overallScore}/100</span>
          </div>
          <div className="text-xs text-gray-500">
            Stage: <span className={`ml-1 px-2 py-0.5 rounded-full font-semibold ${stageBadge[ctx.maturityStage] ?? 'bg-gray-100 text-gray-700'}`}>{ctx.maturityStage}</span>
          </div>
        </div>
        {picker}
      </div>

      {/* Per-platform content health */}
      {displayPlatforms.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {displayPlatforms.map((p) => {
            const engLow = p.engagementRate < 2.0;
            const freqLow = p.postingFrequency < 3;
            return (
              <div key={p.platform} className={`rounded-lg border px-3 py-2 space-y-1 ${engLow || freqLow ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-gray-50'}`}>
                <div className="text-xs font-semibold text-gray-700">
                  <PlatformIcon platform={p.platform} size={13} showLabel />
                </div>
                {engLow && <div className="text-xs text-amber-700">↑ Boost engagement ({p.engagementRate.toFixed(1)}%)</div>}
                {freqLow && <div className="text-xs text-amber-700">↑ Post more ({p.postingFrequency.toFixed(0)}/wk)</div>}
                {!engLow && !freqLow && <div className="text-xs text-green-700">✓ Healthy activity</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Recommendations */}
      {ctx.recommendations.length > 0 && (
        <ul className="space-y-1">
          {ctx.recommendations.map((rec, i) => (
            <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
              <span className="text-indigo-400 mt-0.5">•</span>
              {rec}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
