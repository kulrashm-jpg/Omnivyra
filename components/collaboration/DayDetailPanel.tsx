/**
 * DayDetailPanel — Side panel when clicking a calendar day.
 * Sections: Activities, Team Chat (single row opens FloatingChatPanel).
 */

import React from 'react';
import { X, MessageSquare, ChevronRight, Clock, Eye } from 'lucide-react';
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
  scheduled_for?: string | null;
  time?: string;
  status?: string;
  is_overdue?: boolean;
  content?: string | null;
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
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Activities
            {activities.filter(a => a.scheduled_post_id).length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">— click to preview</span>
            )}
          </h3>
          {activities.length === 0 ? (
            <p className="text-sm text-gray-500">No activities scheduled.</p>
          ) : (
            <div className="space-y-2">
              {activities.map((act, idx) => {
                const isReal = !!act.scheduled_post_id;
                const isOverdue = act.is_overdue && act.status !== 'published';
                const statusColor = act.status === 'published'
                  ? 'bg-emerald-100 text-emerald-700'
                  : isOverdue ? 'bg-red-100 text-red-700'
                  : act.status === 'scheduled' ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500';
                const statusLabel = isOverdue ? 'overdue' : act.status || 'planned';
                return (
                  <div
                    key={act.scheduled_post_id ?? act.execution_id ?? idx}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      isReal && onActivityClick
                        ? 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer group'
                        : 'border-dashed border-gray-200 bg-gray-50 opacity-70'
                    }`}
                    onClick={() => isReal && onActivityClick?.(act)}
                  >
                    {/* Platform icon */}
                    <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                      act.platform ? 'bg-gray-100' : 'bg-gray-100'
                    }`}>
                      {act.platform
                        ? <PlatformIcon platform={act.platform} size={20} />
                        : <span className="text-gray-400 text-xs font-medium">📋</span>}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {act.platform && (
                          <span className="text-xs font-semibold text-gray-700 capitalize">
                            {act.platform === 'x' ? 'X (Twitter)' : act.platform}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 capitalize">
                          {act.content_type?.replace(/_/g, ' ') || 'post'}
                        </span>
                        {isReal && (
                          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full capitalize shrink-0 ${statusColor}`}>
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">{act.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        {act.time && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{act.time}</span>
                        )}
                        {(act.repurpose_total ?? 1) > 1 && (
                          <RepurposeDots index={act.repurpose_index ?? 1} total={act.repurpose_total ?? 1} />
                        )}
                      </div>
                    </div>

                    {/* Arrow hint for real posts */}
                    {isReal && onActivityClick && (
                      <Eye className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 shrink-0 mt-1 transition-colors" />
                    )}
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
