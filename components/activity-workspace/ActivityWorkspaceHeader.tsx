import React from 'react';
import { ArrowLeft, Save, X } from 'lucide-react';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceHeader({ d }: { d: S }) {
  const {
    aiConfidenceMessage,
    aiPreviewMessage,
    handleBackToWeekPlan,
    notice,
    payload,
    saveAndSendBack,
  } = d;

  return (
    <>
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity Content Workspace</h1>
          <p className="text-sm text-gray-600">
            Week {payload.weekNumber || '-'} • {payload.day || '-'} • {payload.title || 'Untitled activity'}
            {(payload as any).distribution_strategy && (
              <> • Distribution: {String((payload as any).distribution_strategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char: string) => char.toUpperCase())}</>
            )}
          </p>
          {(payload as any).distribution_reason && (
            <p className="text-xs text-gray-500 mt-0.5">Why: {(payload as any).distribution_reason}</p>
          )}
          {(payload as any).planning_adjustment_reason && (
            <p className="text-xs text-gray-500 mt-0.5">{(payload as any).planning_adjustment_reason}</p>
          )}
          {(payload as any).planning_adjustments_summary?.text && (
            <p className="text-xs text-gray-500 mt-0.5">What changed: {(payload as any).planning_adjustments_summary.text}</p>
          )}
          {(payload as any).momentum_adjustments?.absorbed_from_week?.length ? (
            <p className="text-xs text-gray-500 mt-0.5">
              Momentum adjusted from Week {(payload as any).momentum_adjustments.absorbed_from_week.join(', ')}
              {(payload as any).momentum_adjustments?.momentum_transfer_strength ? (
                <> • Momentum: {(payload as any).momentum_adjustments.momentum_transfer_strength.charAt(0).toUpperCase()}{(payload as any).momentum_adjustments.momentum_transfer_strength.slice(1)} adjustment</>
              ) : null}
            </p>
          ) : null}
          {(payload as any).week_extras?.recovered_topics?.length ? (
            <p className="text-xs text-gray-500 mt-0.5" title={((payload as any).week_extras.recovered_topics as Array<{ topic: string; recovered_from_week: number }>).map((item) => item.topic).join(', ')}>
              Narrative recovered from Week {((payload as any).week_extras.recovered_topics as Array<{ recovered_from_week: number }>).map((item) => item.recovered_from_week).filter((value, index, all) => all.indexOf(value) === index).join(', ')}
            </p>
          ) : null}
          {aiPreviewMessage ? (
            <p className="text-xs text-slate-500 italic mt-0.5">AI Preview: {aiPreviewMessage}</p>
          ) : null}
          {aiConfidenceMessage ? (
            <p className="text-xs text-slate-400 italic mt-0.5">{aiConfidenceMessage}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackToWeekPlan}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to week plan
          </button>
          <button
            onClick={saveAndSendBack}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </button>
          <button
            onClick={() => window.close()}
            className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
