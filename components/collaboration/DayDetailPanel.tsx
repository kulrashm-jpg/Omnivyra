/**
 * DayDetailPanel — Side panel when clicking a calendar day.
 * Sections: Activities, Team Chat (single row opens FloatingChatPanel).
 */

import React from 'react';
import { X, MessageSquare, ChevronRight } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';

/** Repurpose progress dots — unique = ●, repurposed = ● ● ○ etc. */
function RepurposeDots({ index, total, contentType }: { index: number; total: number; contentType?: string }) {
  const safeTotal = total < 1 ? 1 : total;
  const safeIndex = index < 1 ? 1 : index;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600" aria-label={safeTotal === 1 ? 'Unique' : `${safeIndex} of ${safeTotal}`}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span key={i} className={i < safeIndex ? 'text-indigo-600' : 'text-gray-300'}>{i < safeIndex ? '●' : '○'}</span>
      ))}
      {contentType && <span className="text-gray-400 ml-0.5">{contentType}</span>}
    </span>
  );
}

export type DayActivity = {
  execution_id?: string;
  scheduled_post_id?: string;
  platform: string;
  title: string;
  content_type: string;
  repurpose_index?: number;
  repurpose_total?: number;
  date?: string;
  time?: string;
  campaign_id: string;
};

export type DayDetailPanelProps = {
  dateKey: string;
  dateLabel: string;
  activities: DayActivity[];
  /** Total message count for the day */
  messageCount?: number;
  /** Unread message count for the day */
  unreadCount?: number;
  currentUserId: string;
  campaignId: string;
  onClose: () => void;
  /** Opens the FloatingChatPanel for this day */
  onOpenChat: () => void;
  onActivityClick?: (activity: DayActivity) => void;
};

export default function DayDetailPanel({
  dateKey,
  dateLabel,
  activities,
  messageCount = 0,
  unreadCount = 0,
  currentUserId,
  campaignId,
  onClose,
  onOpenChat,
  onActivityClick,
}: DayDetailPanelProps) {
  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl border-l border-gray-200 flex flex-col z-[9998]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900">{dateLabel}</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-200 text-gray-600 hover:text-gray-900"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Activities */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Activities</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-gray-500">No activities scheduled.</p>
          ) : (
            <div className="space-y-2">
              {activities.map((act, idx) => {
                const timeStr = act.time || '';
                return (
                  <div
                    key={act.scheduled_post_id ?? act.execution_id ?? idx}
                    className={`flex items-center gap-2 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 ${
                      onActivityClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => onActivityClick?.(act)}
                  >
                    <div className="shrink-0 p-1.5 rounded-lg bg-gray-100">
                      <PlatformIcon platform={act.platform} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {act.content_type || 'Post'}
                      </p>
                      <p className="text-xs text-gray-600 truncate">{act.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                        <RepurposeDots
                          index={act.repurpose_index ?? 1}
                          total={act.repurpose_total ?? 1}
                          contentType={act.content_type ?? undefined}
                        />
                        {timeStr && <span>{timeStr}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Team Chat — single row, opens FloatingChatPanel */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Team Chat</h3>
          <button
            type="button"
            onClick={onOpenChat}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50 hover:bg-indigo-100 transition-colors cursor-pointer text-left"
          >
            <div className="shrink-0 p-2 rounded-lg bg-indigo-500">
              <MessageSquare className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-indigo-900">
                {messageCount > 0 ? `${messageCount} message${messageCount !== 1 ? 's' : ''}` : 'Start team conversation'}
              </p>
              {unreadCount > 0 && (
                <p className="text-xs text-indigo-600">{unreadCount} unread</p>
              )}
            </div>
            {unreadCount > 0 && (
              <span className="shrink-0 min-w-[22px] h-[22px] flex items-center justify-center rounded-full bg-indigo-500 text-white text-[11px] font-bold px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-indigo-400 shrink-0" />
          </button>
        </section>
      </div>
    </div>
  );
}
