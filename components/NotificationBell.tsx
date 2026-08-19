/**
 * Notification Bell
 * Shows unread count badge; opens a dropdown of recent notifications.
 * Polls every 60 s. Marks individual or all-read via PATCH /api/notifications.
 *
 * OPT-005 Phase 1: the list is an SWR cache entry. The visibility poll below
 * is the SINGLE revalidation owner for this key — SWR focus/reconnect
 * revalidation is disabled so cadences never double up. Mark-read keeps its
 * post-PATCH local update via mutate(..., { revalidate: false }).
 */

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Bell, X, CheckCheck, Users } from 'lucide-react';
import { useVisibilityPolling } from '../lib/client/dataKit';
import { apiFetch } from '../lib/apiFetch';

type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
};

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function NotifIcon({ type }: { type: string }) {
  if (type === 'self_join') return <Users className="h-4 w-4 text-indigo-500" />;
  if (type === 'role_updated') return <CheckCheck className="h-4 w-4 text-emerald-500" />;
  return <Bell className="h-4 w-4 text-gray-400" />;
}

/**
 * The one SWR key for notifications. Exported so read-only subscribers share
 * this exact cache entry instead of issuing their own request — this component
 * remains the key's single revalidation owner (see the poll below).
 */
export const NOTIFICATIONS_KEY = '/api/notifications';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // SWR owns fetch/dedupe/cache. dedupingInterval preserves the previous
  // runSharedPoll minIntervalMs=5000; errors are non-fatal exactly as before
  // (last-known list keeps rendering, badge doesn't flicker).
  const { data, mutate } = useSWR<{ notifications?: AppNotification[] }>(NOTIFICATIONS_KEY, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5_000,
  });
  const notifications: AppNotification[] = data?.notifications ?? [];

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // W4-8 (audit B-53): the poll is VISIBILITY-AWARE via the F-13 kit —
  // hidden/background tabs stop polling entirely and refresh immediately on
  // return. Same 60 s cadence while visible; SWR mutate() is the fetcher and
  // this poll is the key's single revalidation owner.
  useVisibilityPolling(() => {
    void mutate();
  }, 60_000);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markRead(id?: string) {
    setLoading(true);
    try {
      const url = id ? `/api/notifications?id=${id}` : '/api/notifications';
      await apiFetch(url, { method: 'PATCH' });
      // Same post-PATCH local update as before, now written into the shared
      // cache entry (revalidate:false — the next poll reconciles).
      await mutate(
        (current) => ({
          notifications: (current?.notifications ?? []).map((n) =>
            (!id || n.id === id) ? { ...n, is_read: true } : n
          ),
        }),
        { revalidate: false }
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-96 max-h-[480px] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">
              Notifications {unreadCount > 0 && <span className="ml-1 text-xs font-normal text-gray-500">({unreadCount} unread)</span>}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markRead()}
                  disabled={loading}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <Bell className="h-8 w-8 text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    n.is_read ? 'bg-white' : 'bg-indigo-50/50'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                    <NotifIcon type={n.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 leading-snug">{n.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="flex-shrink-0 mt-0.5 w-2 h-2 rounded-full bg-indigo-500 hover:bg-indigo-700 transition-colors"
                      title="Mark as read"
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
