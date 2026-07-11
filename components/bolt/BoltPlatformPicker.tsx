/**
 * BoltPlatformPicker — shared chip-row UI for BOLT platform selection.
 * ──────────────────────────────────────────────────────────────────────────
 * Renders the picker section consistently across all BOLT generator modes
 * (Text / Creator / Intelligent Mix). Purely presentational — the caller owns
 * selection state and persistence. (Strategic Mix is NOT a BOLT mode — its
 * canonical shell is the Campaign Planner; see STRATEGIC-MIX-SPEC-001.)
 *
 * Contract (Round-6 Phase 4):
 *   - supported platforms render as toggleable chips
 *   - hidden platforms render as disabled chips with the registry-provided
 *     reason as a tooltip (`title`) — these are connected-but-incompatible
 *     with the active capability
 *   - unregistered platforms NEVER render (fail-closed; passed to the hook
 *     only for diagnostics)
 *   - `blocked: true` (capability resolution failed for a single-capability
 *     mode) replaces the whole section with the standardized message
 *
 * Capability handling MUST come from useBoltPlatformPicker — this component
 * does no fetching, normalization, or registry lookups of its own.
 */

import React from 'react';
import { PLATFORM_LABELS } from '../../lib/shared/platforms';

export interface BoltPlatformPickerProps {
  /** Title shown above the chip row. */
  label?: string;
  /** Subtitle/hint shown next to the title. */
  hint?: string;
  loading: boolean;
  blocked: boolean;
  /** Registered + capability-compatible platforms (toggleable). */
  supported: string[];
  /** Registered + capability-incompatible platforms (disabled chip + tooltip). */
  hidden: Array<{ platform: string; reason: string }>;
  /** Currently-selected subset of `supported`. */
  selected: string[];
  /** Toggle handler invoked when the user clicks a supported chip. */
  onToggle: (platform: string) => void;
  /** Accent color family — matches each BOLT mode's visual theme. */
  accent?: 'amber' | 'teal' | 'violet' | 'indigo';
  /** Optional empty-state message override. */
  emptyMessage?: string;
}

const ACCENT: Record<NonNullable<BoltPlatformPickerProps['accent']>, {
  selectedChip: string; hoverChip: string; warningText: string;
}> = {
  amber:  { selectedChip: 'border-amber-400 bg-amber-100 text-amber-900',  hoverChip: 'hover:border-amber-300 hover:bg-amber-50',  warningText: 'text-amber-700' },
  teal:   { selectedChip: 'border-teal-400 bg-teal-100 text-teal-900',     hoverChip: 'hover:border-teal-300 hover:bg-teal-50',    warningText: 'text-teal-700' },
  violet: { selectedChip: 'border-violet-400 bg-violet-100 text-violet-900', hoverChip: 'hover:border-violet-300 hover:bg-violet-50', warningText: 'text-violet-700' },
  indigo: { selectedChip: 'border-indigo-400 bg-indigo-100 text-indigo-900', hoverChip: 'hover:border-indigo-300 hover:bg-indigo-50', warningText: 'text-indigo-700' },
};

const labelFor = (platform: string) =>
  PLATFORM_LABELS[platform] ?? (platform.charAt(0).toUpperCase() + platform.slice(1));

export default function BoltPlatformPicker(props: BoltPlatformPickerProps) {
  const {
    label = 'Platforms',
    hint = 'pick which connected platforms to use for this campaign',
    loading,
    blocked,
    supported,
    hidden,
    selected,
    onToggle,
    accent = 'amber',
    emptyMessage,
  } = props;

  const styles = ACCENT[accent];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">{label}</label>
        <span className="text-[10px] text-gray-400">— {hint}</span>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading connected platforms…</p>
      ) : blocked ? (
        <p className="text-[11px] rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-amber-800">
          Unable to determine compatible publishing platforms for this BOLT mode.
        </p>
      ) : supported.length === 0 && hidden.length === 0 ? (
        <p className="text-xs text-gray-400">
          {emptyMessage ?? 'No compatible platforms connected yet. Add social links in company settings to target specific platforms.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {supported.map((p) => {
              const isSelected = selected.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onToggle(p)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border-2 font-medium transition-all ${
                    isSelected ? styles.selectedChip : `border-gray-200 text-gray-600 ${styles.hoverChip}`
                  }`}
                >
                  {isSelected && '✓ '}{labelFor(p)}
                </button>
              );
            })}
            {hidden.map(({ platform, reason }) => (
              <button
                key={platform}
                type="button"
                disabled
                aria-disabled
                title={reason}
                className="text-xs px-2.5 py-1.5 rounded-full border-2 border-gray-200 bg-gray-50 text-gray-400 font-medium cursor-not-allowed opacity-60"
              >
                {labelFor(platform)}
              </button>
            ))}
          </div>
          {supported.length > 0 && selected.length === 0 && (
            <p className={`text-[11px] mt-2 ${styles.warningText}`}>
              Select at least one platform — otherwise BOLT will default to all compatible connected platforms.
            </p>
          )}
        </>
      )}
    </div>
  );
}
