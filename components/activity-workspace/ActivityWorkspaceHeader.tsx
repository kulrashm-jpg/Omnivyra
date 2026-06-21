import React from 'react';
import { ArrowLeft, Save, X } from 'lucide-react';
import type { useActivityWorkspace } from '../../hooks/useActivityWorkspace';
import { isActivityDetailMode } from '@/lib/shared/activityWorkspaceMode';

type S = ReturnType<typeof useActivityWorkspace>;

export default function ActivityWorkspaceHeader({ d }: { d: S }) {
  const {
    aiConfidenceMessage,
    aiPreviewMessage,
    handleBackToWeekPlan,
    notice,
    payload,
    saveAndSendBack,
    workspaceMode,
    contentType,
    schedules,
    labelize,
  } = d;

  const noticeBanner = notice && (
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
  );

  // PHASE ACTIVITY-WORKSPACE-ISOLATION — scoped "Activity Detail" header. Shows
  // only this activity's facts (platform / content type / status / schedule) and
  // a "Back to Calendar" exit; the campaign narrative (distribution / momentum /
  // recovery) is omitted. Activity actions (Save) stay.
  if (isActivityDetailMode(workspaceMode)) {
    const first = (schedules || [])[0];
    const platform = String(first?.platform || (payload as any)?.dailyExecutionItem?.platform || '').trim();
    const status = String(first?.status || '').trim();
    const scheduledTime = [first?.date, first?.time].filter(Boolean).join(' ').trim();
    const campaignId = String((payload as any)?.campaignId || '').trim();
    const companyId = String((payload as any)?.companyId || '').trim();
    const backToCalendar = () => {
      if (campaignId) {
        window.location.href = `/campaign-calendar/${encodeURIComponent(campaignId)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`;
      } else {
        try { window.history.back(); } catch { window.close(); }
      }
    };
    const Pill = ({ label, value }: { label: string; value: string }) => (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
        <span className="text-gray-400">{label}:</span>
        <span className="font-medium text-gray-800">{value}</span>
      </span>
    );
    return (
      <>
        {noticeBanner}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Activity Detail</h1>
            <p className="text-sm text-gray-600">{payload.title || 'Untitled activity'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {platform ? <Pill label="Platform" value={labelize ? labelize(platform) : platform} /> : null}
              {contentType ? <Pill label="Content type" value={String(contentType)} /> : null}
              {status ? <Pill label="Status" value={status} /> : null}
              {scheduledTime ? <Pill label="Scheduled" value={scheduledTime} /> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={backToCalendar}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Calendar
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

  return (
    <>
      {noticeBanner}
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
