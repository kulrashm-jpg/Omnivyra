/**
 * InfluencerPanel — Top influencers across social and community platforms.
 * Shows author name, platform icon, influence score, recent activity.
 */

import React, { useState, useEffect, useCallback } from 'react';

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼',
  twitter: '🐦',
  youtube: '▶️',
  reddit: '🤖',
  facebook: '👤',
  instagram: '📷',
  tiktok: '🎵',
  slack: '💬',
  discord: '🎮',
  github: '🐙',
  stackoverflow: '📚',
  producthunt: '🚀',
  hackernews: '🟠',
};

function getPlatformIcon(platform: string): string {
  return PLATFORM_ICONS[platform?.toLowerCase() ?? ''] ?? '💬';
}

function formatLastActive(lastAt: string | null): string {
  if (!lastAt) return '—';
  const d = new Date(lastAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export type Influencer = {
  id: string;
  author_id: string;
  author_name: string;
  platform: string;
  influence_score: number;
  message_count: number;
  thread_count?: number;
  reply_count?: number;
  recommendation_mentions?: number;
  question_answers?: number;
  last_active_at: string | null;
};

export interface InfluencerPanelProps {
  organizationId: string | null;
  platform?: string | null;
  limit?: number;
  onViewConversations?: (authorId: string, platform: string) => void;
  onOpenThreadListFilteredByAuthor?: (authorId: string, authorName: string, platform: string) => void;
  onCountChange?: (count: number) => void;
  className?: string;
}

export const InfluencerPanel = React.memo(function InfluencerPanel({
  organizationId,
  platform,
  limit = 10,
  onViewConversations,
  onOpenThreadListFilteredByAuthor,
  onCountChange,
  className = '',
}: InfluencerPanelProps) {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInfluencers = useCallback(async () => {
    if (!organizationId) {
      setInfluencers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        limit: String(limit),
      });
      if (platform) params.set('platform', platform);
      const res = await fetch(`/api/engagement/influencers?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      const list = json.influencers ?? [];
      setInfluencers(list);
      onCountChange?.(list.length);
    } catch (e) {
      setError((e as Error).message);
      setInfluencers([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, platform, limit]);

  useEffect(() => {
    void fetchInfluencers();
  }, [fetchInfluencers]);

  if (!organizationId) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        Select an organization to view influencers.
      </div>
    );
  }

  if (loading) {
    return <div className={`text-sm text-slate-500 ${className}`}>Loading influencers…</div>;
  }

  if (error) {
    return <div className={`text-sm text-amber-700 ${className}`}>{error}</div>;
  }

  if (influencers.length === 0) {
    return (
      <div className={`text-sm text-slate-500 ${className}`}>
        No influencers detected yet. The system learns from engagement over time.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        Top Influencers
      </h4>
      <div className="space-y-2">
        {influencers.map((inf) => (
          <div
            key={inf.id}
            className="rounded border border-slate-100 bg-slate-50 p-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700 truncate">
                {getPlatformIcon(inf.platform)} {inf.author_name}
              </span>
              <span className="text-xs text-slate-600 shrink-0">
                {(inf.influence_score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {inf.message_count} messages · {inf.recommendation_mentions ?? 0} rec. mentions ·{' '}
              {formatLastActive(inf.last_active_at)}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => onViewConversations?.(inf.author_id, inf.platform)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                View conversations
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenThreadListFilteredByAuthor?.(
                    inf.author_id,
                    inf.author_name,
                    inf.platform
                  )
                }
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Open thread list filtered by author
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
