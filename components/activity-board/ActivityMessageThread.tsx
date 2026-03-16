/**
 * Vertical message thread in side panel. Chronological, scrollable.
 * Each message: avatar/initial, sender name, role badge, timestamp, text.
 * Role-based accent colors. Approval messages auto-generated format.
 */

import React, { useRef, useEffect } from 'react';
import ContentRenderer from '../ContentRenderer';
import type { ActivityMessage, SenderRole } from './types';
import { ROLE_ACCENT_CLASSES } from './types';

function initial(name: string): string {
  const n = String(name || '?').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function formatTime(created_at: string): string {
  try {
    const d = new Date(created_at);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return created_at;
  }
}

export interface ActivityMessageThreadProps {
  messages: ActivityMessage[];
  className?: string;
}

export default function ActivityMessageThread({ messages, className = '' }: ActivityMessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const sorted = React.useMemo(
    () => [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages]
  );

  return (
    <div ref={scrollRef} className={`flex flex-col gap-3 overflow-y-auto ${className}`}>
      {sorted.map((msg) => {
        const accent = ROLE_ACCENT_CLASSES[msg.sender_role] || ROLE_ACCENT_CLASSES.SYSTEM;
        return (
          <div
            key={msg.id}
            className={`rounded-lg border p-3 ${accent}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="flex-shrink-0 w-8 h-8 rounded-full bg-white border flex items-center justify-center text-sm font-medium"
                aria-hidden
              >
                {initial(msg.sender_name)}
              </span>
              <span className="font-medium text-gray-900">{msg.sender_name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/80 border">
                {msg.sender_role.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-gray-500 ml-auto">{formatTime(msg.created_at)}</span>
            </div>
            <ContentRenderer content={msg.message_text} renderMode="comment" className="mt-2 break-words" />
            {msg.message_type === 'APPROVAL' && (
              <div className="mt-1 text-xs font-medium text-emerald-700">✔ Approval recorded</div>
            )}
            {msg.message_type === 'REJECTION' && (
              <div className="mt-1 text-xs font-medium text-red-700">✘ Rejection recorded</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
