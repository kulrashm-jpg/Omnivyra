/**
 * InsightEvidenceModal — Displays evidence (discussion threads) for an insight.
 */

import React from 'react';

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼',
  twitter: '🐦',
  youtube: '▶️',
  reddit: '🤖',
  slack: '💬',
  discord: '🎮',
  github: '🐙',
};

function getPlatformIcon(platform: string): string {
  return PLATFORM_ICONS[platform?.toLowerCase() ?? ''] ?? '💬';
}

export type InsightEvidence = {
  thread_id: string;
  message_id: string;
  author_name: string | null;
  platform: string;
  text_snippet: string | null;
};

export type InsightForModal = {
  id: string;
  insight_title: string;
  evidence: InsightEvidence[];
};

export interface InsightEvidenceModalProps {
  insight: InsightForModal;
  onClose: () => void;
  onOpenConversation: (threadId: string) => void;
}

export const InsightEvidenceModal = React.memo(function InsightEvidenceModal({
  insight,
  onClose,
  onOpenConversation,
}: InsightEvidenceModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{insight.insight_title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {insight.evidence?.length === 0 ? (
            <p className="text-sm text-slate-500">No evidence available.</p>
          ) : (
            insight.evidence?.map((e, i) => (
              <div
                key={`${e.thread_id}-${e.message_id}-${i}`}
                className="rounded border border-slate-100 bg-slate-50 p-3 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span>{getPlatformIcon(e.platform)}</span>
                  <span className="font-medium text-slate-700">{e.author_name ?? 'Unknown'}</span>
                  <span className="text-xs text-slate-500">{e.platform}</span>
                </div>
                <p className="text-slate-600 line-clamp-2 mb-2">
                  {(e.text_snippet ?? 'No preview').slice(0, 150)}…
                </p>
                <button
                  type="button"
                  onClick={() => onOpenConversation(e.thread_id)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Open Conversation
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
