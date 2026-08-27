/**
 * P4 — bulk week selection.
 *
 * The structural control layer: pick weeks by hand, or by a CONDITION whose
 * exact predicate is written into the UI (title attribute) so a label can
 * never mean something vaguer than its rule. Every state and count is derived
 * on render by lib/campaign/campaignWeekState — nothing here is persisted and
 * there is no week model.
 *
 * Three selection ideas are kept distinct (P4 §12):
 *   Select all          every week in the campaign
 *   Select all matching every week satisfying the active condition
 *   (the filter narrows what is LISTED; it never silently edits an explicit
 *    selection — changing the condition leaves picked weeks picked)
 *
 * Read-only over campaign data. The only action is Release, and it hands the
 * selection to the EXISTING P1 contract (scope: 'weeks') — the server stays
 * authoritative and re-validates every week.
 */

import React, { useMemo, useState } from 'react';
import { CheckSquare, Filter, Square } from 'lucide-react';
import {
  WEEK_CONDITIONS,
  matchWeeks,
  summarizeWeekSelection,
  type CampaignWeekState,
  type WeekConditionId,
  type WeekStateCode,
} from '../../lib/campaign/campaignWeekState';

const STATE_STYLE: Record<WeekStateCode, { label: string; cls: string }> = {
  empty:       { label: 'No slots',    cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  planned:     { label: 'Planned',     cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  in_progress: { label: 'In progress', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  in_review:   { label: 'In review',   cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved:    { label: 'Approved',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  released:    { label: 'Released',    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  failed:      { label: 'Failed',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

export interface WeekSelectionBarProps {
  states: CampaignWeekState[];
  selected: number[];
  onChange: (weeks: number[]) => void;
  /** Release the selected weeks through the existing P1 scope:'weeks' contract. */
  onReleaseSelected?: (weeks: number[]) => void;
  releaseBusy?: boolean;
}

export function WeekSelectionBar({
  states, selected, onChange, onReleaseSelected, releaseBusy,
}: WeekSelectionBarProps) {
  const [condition, setCondition] = useState<WeekConditionId>('all');

  const matching = useMemo(() => matchWeeks(states, condition), [states, condition]);
  const matchingSet = useMemo(() => new Set(matching), [matching]);
  const summary = useMemo(
    () => summarizeWeekSelection({ states, selected, condition }),
    [states, selected, condition],
  );
  const activeCondition = useMemo(
    () => WEEK_CONDITIONS.find((c) => c.id === condition)!,
    [condition],
  );

  const toggle = (week: number) => {
    const next = new Set(summary.selected);
    if (next.has(week)) next.delete(week);
    else next.add(week);
    onChange(Array.from(next).sort((a, b) => a - b));
  };

  if (states.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
        No weeks yet — build the campaign skeleton to plan by week.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* Condition + bulk controls */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <Filter className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as WeekConditionId)}
          title={activeCondition.definition}
          aria-label="Filter weeks by condition"
          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700"
        >
          {WEEK_CONDITIONS.map((c) => (
            <option key={c.id} value={c.id} title={c.definition}>{c.label}</option>
          ))}
        </select>

        {/* The exact predicate, visible — never a vague label. */}
        <span className="text-[11px] text-gray-400 truncate max-w-md" title={activeCondition.definition}>
          {activeCondition.definition}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-500">{summary.match_label}</span>
          <button
            type="button"
            onClick={() => onChange(matching)}
            disabled={matching.length === 0}
            className="text-xs px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            Select all matching ({matching.length})
          </button>
          <button
            type="button"
            onClick={() => onChange(states.map((w) => w.week))}
            className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Select all ({states.length})
          </button>
          {summary.selected_count > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Week cards — the filter narrows what is LISTED; an explicit
          selection outside the filter is preserved and still counted. */}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {states.map((w) => {
          const isSelected = summary.selected.includes(w.week);
          const inFilter = matchingSet.has(w.week);
          const style = STATE_STYLE[w.state];
          return (
            <button
              key={w.week}
              type="button"
              onClick={() => toggle(w.week)}
              aria-pressed={isSelected}
              title={
                `Week ${w.week} — ${style.label}\n`
                + `${w.counts.approved}/${w.counts.total} approved · ${w.counts.with_content}/${w.counts.total} written`
                + (w.counts.assets_pending_approval > 0 ? `\n${w.counts.assets_pending_approval} asset(s) awaiting approval` : '')
                + (w.counts.released > 0 ? `\n${w.counts.released} released` : '')
                + (w.counts.failed > 0 ? `\n${w.counts.failed} publish failure(s)` : '')
              }
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${style.cls} ${
                isSelected ? 'ring-2 ring-indigo-500' : ''
              } ${!inFilter ? 'opacity-45' : ''}`}
            >
              {isSelected
                ? <CheckSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-600" />
                : <Square className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-50" />}
              <span className="min-w-0">
                <span className="block text-xs font-semibold">Week {w.week}</span>
                <span className="block text-[10px] opacity-80">{style.label}</span>
                <span className="block text-[10px] opacity-70 tabular-nums">
                  {w.counts.approved}/{w.counts.total} approved
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Selection + the one bulk action whose backend semantics support it */}
      {summary.selected_count > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
          <span className="text-xs font-medium text-gray-700">{summary.selection_label}</span>
          <span className="text-[11px] text-gray-500">
            Weeks {summary.selected.join(', ')}
          </span>
          {onReleaseSelected && (
            <button
              type="button"
              disabled={releaseBusy}
              onClick={() => onReleaseSelected(summary.selected)}
              className="ml-auto text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {releaseBusy ? 'Releasing…' : `Release ${summary.selected_count} week${summary.selected_count === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default WeekSelectionBar;
