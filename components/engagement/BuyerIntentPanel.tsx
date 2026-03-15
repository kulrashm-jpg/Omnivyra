/**
 * BuyerIntentPanel — High-intent accounts from engagement.
 */

import React, { useState, useEffect, useCallback } from 'react';

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

function formatLastDetected(lastAt: string | null): string {
  if (!lastAt) return '—';
  const d = new Date(lastAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export type BuyerIntentAccount = {
  id: string;
  author_name: string;
  platform: string;
  intent_score: number;
  message_count: number;
  intent_signals?: number;
  last_detected_at: string | null;
};

export interface BuyerIntentPanelProps {
  organizationId: string | null;
  limit?: number;
  onCountChange?: (count: number) => void;
  onOpenDiscussion?: (authorName: string, platform: string) => void;
  onAddToLeadTracking?: (authorName: string, platform: string) => void;
  className?: string;
}

export const BuyerIntentPanel = React.memo(function BuyerIntentPanel({
  organizationId,
  limit = 10,
  onCountChange,
  onOpenDiscussion,
  onAddToLeadTracking,
  className = '',
}: BuyerIntentPanelProps) {
  const [accounts, setAccounts] = useState<BuyerIntentAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    if (!organizationId) {
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/engagement/buyer-intent?organization_id=${encodeURIComponent(organizationId)}&limit=${limit}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      const list = json.accounts ?? [];
      setAccounts(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, limit, onCountChange]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  if (!organizationId) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        Select an organization to view buyer intent.
      </div>
    );
  }

  if (loading) {
    return <div className={`text-sm text-slate-500 ${className}`}>Loading…</div>;
  }

  if (error) {
    return <div className={`text-sm text-amber-700 ${className}`}>{error}</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        No high-intent accounts detected yet.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        High Intent Accounts
      </h4>
      <div className="space-y-2">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="rounded border border-slate-100 bg-slate-50 p-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700 truncate">
                {getPlatformIcon(acc.platform)} {acc.author_name}
              </span>
              <span className="text-xs text-slate-600 shrink-0">
                {(acc.intent_score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {acc.message_count} messages · {formatLastDetected(acc.last_detected_at)}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => onOpenDiscussion?.(acc.author_name, acc.platform)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Open discussion
              </button>
              <button
                type="button"
                onClick={() => onAddToLeadTracking?.(acc.author_name, acc.platform)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Add to lead tracking
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
