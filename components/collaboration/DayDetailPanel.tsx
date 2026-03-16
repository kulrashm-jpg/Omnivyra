/**
 * DayDetailPanel — Side panel when clicking a calendar day.
 * Sections: Activities, Messages.
 * Replaces inline day-detail block; opens as slide-over.
 */

import React, { useEffect, useState } from 'react';
import { X, Send } from 'lucide-react';
import PlatformIcon from '../ui/PlatformIcon';
import ContentRenderer from '../ContentRenderer';

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
import type { CollaborationMessage } from './FloatingChatPanel';

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
  messages: CollaborationMessage[];
  loadingMessages?: boolean;
  currentUserId: string;
  campaignId: string;
  onClose: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onActivityClick?: (activity: DayActivity) => void;
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function DayDetailPanel({
  dateKey,
  dateLabel,
  activities,
  messages,
  loadingMessages = false,
  currentUserId,
  campaignId,
  onClose,
  onSendMessage,
  onActivityClick,
}: DayDetailPanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSendMessage(text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

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

        {/* Messages */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Messages</h3>
          {loadingMessages ? (
            <p className="text-sm text-gray-500">Loading messages...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-gray-500">No messages yet.</p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => {
                const isOwn = msg.created_by === currentUserId;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 ${
                        isOwn ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-900'
                      }`}
                    >
                      <p className="text-xs font-medium opacity-90">
                        {isOwn ? 'You' : msg.created_by_name || 'User'} ·{' '}
                        {formatTime(msg.created_at)}
                      </p>
                      <ContentRenderer content={msg.message_text} renderMode="comment" className="mt-0.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Add message */}
      <div className="p-4 border-t border-gray-200 bg-white flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())
          }
          placeholder="Write message..."
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={sending}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        >
          Send
        </button>
      </div>
    </div>
  );
}
