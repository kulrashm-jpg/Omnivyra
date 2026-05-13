import React from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import ContentRenderer from '@/components/ContentRenderer';

type Props = {
  showSystemFields: boolean;
  dailyRaw: Record<string, unknown> | null;
  systemBlockExpanded: boolean;
  setSystemBlockExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  viewMode: string;
  masterContentExpanded: boolean;
  setMasterContentExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  hasMasterGenerated: boolean;
  masterContent: Record<string, unknown> | null;
};

export default function ActivityWorkspaceInsightsPanels({
  showSystemFields,
  dailyRaw,
  systemBlockExpanded,
  setSystemBlockExpanded,
  viewMode,
  masterContentExpanded,
  setMasterContentExpanded,
  hasMasterGenerated,
  masterContent,
}: Props) {
  return (
    <>
      {showSystemFields && dailyRaw && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setSystemBlockExpanded((v) => !v)}
            className="flex w-full items-center justify-between border-b border-gray-100 px-5 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>System Execution Intelligence</span>
            {systemBlockExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {systemBlockExpanded && (
            <div className="grid grid-cols-1 gap-2 p-5 text-xs text-gray-600 md:grid-cols-2">
              {dailyRaw.execution_mode != null && <div><span className="font-medium text-gray-500">execution_mode:</span> {String(dailyRaw.execution_mode)}</div>}
              {dailyRaw.ai_generated != null && <div><span className="font-medium text-gray-500">ai_generated:</span> {String(dailyRaw.ai_generated)}</div>}
              {dailyRaw.master_content_id != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">master_content_id:</span> {String(dailyRaw.master_content_id)}</div>}
              {dailyRaw.narrativeStyle != null && <div className="md:col-span-2"><span className="font-medium text-gray-500">narrativeStyle:</span> {String(dailyRaw.narrativeStyle)}</div>}
              {dailyRaw.contentGuidance && typeof dailyRaw.contentGuidance === 'object' && <div className="md:col-span-2"><span className="font-medium text-gray-500">contentGuidance:</span> {JSON.stringify(dailyRaw.contentGuidance)}</div>}
              {dailyRaw.weeklyContextCapsule != null && typeof dailyRaw.weeklyContextCapsule === 'object' && <div className="md:col-span-2"><span className="font-medium text-gray-500">weeklyContextCapsule:</span> {JSON.stringify(dailyRaw.weeklyContextCapsule)}</div>}
            </div>
          )}
        </div>
      )}

      {viewMode === 'CONTENT_ARCHITECT' && (
        <div className="overflow-hidden rounded-xl border border-indigo-200 bg-white">
          <button
            type="button"
            onClick={() => setMasterContentExpanded((v) => !v)}
            className="flex w-full items-center justify-between border-b border-indigo-100 px-5 py-3 text-left text-sm font-semibold text-indigo-800 hover:bg-indigo-50"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              Master Content
              {hasMasterGenerated && (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" /> Ready
                </span>
              )}
            </span>
            {masterContentExpanded ? <ChevronUp className="h-4 w-4 text-indigo-400" /> : <ChevronDown className="h-4 w-4 text-indigo-400" />}
          </button>
          {masterContentExpanded && (
            <div className="space-y-4 p-5">
              {masterContent ? (
                <>
                  {String(masterContent?.title || masterContent?.master_title || '').trim() && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Title</p>
                      <p className="text-sm font-semibold text-gray-900">{String(masterContent.title || masterContent.master_title)}</p>
                    </div>
                  )}
                  {String(masterContent?.content || '').trim() && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Content</p>
                      <ContentRenderer
                        content={String(masterContent.content)}
                        platform="linkedin"
                        contentType="article"
                        renderMode="rich"
                      />
                    </div>
                  )}
                  {String(masterContent?.generation_status || '').trim() && (
                    <p className="text-xs text-gray-400">Status: {String(masterContent.generation_status)}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">Master content not yet generated. Click Repurpose on any platform to auto-generate it.</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
