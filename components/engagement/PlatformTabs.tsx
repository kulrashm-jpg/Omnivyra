/**
 * PlatformTabs — platform tabs with activity indicators.
 * Displays actionable_threads badge, high_priority_threads indicator.
 * Color: high_priority > 0 → red; actionable > 0 → amber.
 * Uses dynamic platforms from company integrations when provided; otherwise shows All only.
 */

import React from 'react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPlatformLabel } from '@/utils/platformIcons';
import type { PlatformCounts } from '@/hooks/usePlatformCounts';
import type { PlatformWorkItem } from '@/hooks/useWorkQueue';

/** Canonical order for known platforms when displayed dynamically. */
const PLATFORM_ORDER = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'reddit'] as const;

function normalizeToCanonicalSlug(p: string): string {
  const lower = (p || '').toLowerCase().trim();
  if (lower === 'x') return 'twitter';
  return lower || 'unknown';
}

function buildTabItems(integratedPlatforms: string[]): Array<{ slug: string; label: string }> {
  const allTab = { slug: 'all', label: 'All' };
  if (!integratedPlatforms.length) return [allTab];
  const normalized = [...new Set(integratedPlatforms.map(normalizeToCanonicalSlug).filter((s) => s !== 'unknown'))];
  const ordered = normalized.sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a as typeof PLATFORM_ORDER[number]);
    const ib = PLATFORM_ORDER.indexOf(b as typeof PLATFORM_ORDER[number]);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  return [allTab, ...ordered.map((slug) => ({ slug, label: getPlatformLabel(slug) || slug }))];
}

function getTierColor(tier: 'high' | 'medium' | 'low'): string {
  if (tier === 'high') return 'border-l-red-500';
  if (tier === 'medium') return 'border-l-amber-500';
  return 'border-l-transparent';
}

function getBadgeAccent(work?: PlatformWorkItem): string {
  if (!work) return 'border-l-transparent';
  if (work.high_priority_threads > 0) return 'border-l-red-500';
  if (work.actionable_threads > 0) return 'border-l-amber-500';
  return 'border-l-transparent';
}

function getAggregateCounts(counts: PlatformCounts, workPlatforms?: PlatformWorkItem[]): {
  thread_count: number;
  unread_count: number;
  max_priority_tier: 'high' | 'medium' | 'low';
  actionable_threads: number;
  high_priority_threads: number;
} {
  const list = Object.values(counts);
  const threadCount = list.reduce((s, x) => s + (x?.thread_count ?? 0), 0);
  const unreadCount = list.reduce((s, x) => s + (x?.unread_count ?? 0), 0);
  const hasHigh = list.some((x) => x?.max_priority_tier === 'high');
  const hasMedium = list.some((x) => x?.max_priority_tier === 'medium');
  const maxTier: 'high' | 'medium' | 'low' = hasHigh ? 'high' : hasMedium ? 'medium' : 'low';
  const actionableTotal = (workPlatforms ?? []).reduce((s, w) => s + (w.actionable_threads ?? 0), 0);
  const highPriTotal = (workPlatforms ?? []).reduce((s, w) => s + (w.high_priority_threads ?? 0), 0);
  return {
    thread_count: threadCount,
    unread_count: unreadCount,
    max_priority_tier: maxTier,
    actionable_threads: actionableTotal,
    high_priority_threads: highPriTotal,
  };
}

/** Legacy fallback: all platforms when no integrations passed (backward compat). */
const FALLBACK_PLATFORM_SLUGS = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'reddit'];

export interface PlatformTabsProps {
  counts: PlatformCounts;
  selectedPlatform: string;
  onSelectPlatform: (platform: string) => void;
  workQueue?: { platforms: PlatformWorkItem[] };
  /** Configured platform slugs for company. When provided, only these + All shown. When empty [], only All. */
  platforms?: string[];
  loading?: boolean;
  className?: string;
}

export const PlatformTabs = React.memo(function PlatformTabs({
  counts,
  selectedPlatform,
  onSelectPlatform,
  workQueue,
  platforms: integratedPlatforms,
  loading = false,
  className = '',
}: PlatformTabsProps) {
  const workByPlatform = new Map((workQueue?.platforms ?? []).map((p) => [p.platform, p]));
  const platformsToShow =
    integratedPlatforms !== undefined ? integratedPlatforms : FALLBACK_PLATFORM_SLUGS;
  const tabItems = buildTabItems(platformsToShow);

  return (
    <div className={className}>
      <Tabs value={selectedPlatform} onValueChange={onSelectPlatform}>
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          {tabItems.map(({ slug, label }) => {
            const c = slug && slug !== 'all'
              ? (counts[slug] ?? { thread_count: 0, unread_count: 0, max_priority_tier: 'low' as const })
              : getAggregateCounts(counts, workQueue?.platforms);
            const work = slug && slug !== 'all' ? workByPlatform.get(slug) : undefined;
            const agg = slug === 'all' ? getAggregateCounts(counts, workQueue?.platforms) : null;
            const workItem = work ?? (agg ? { actionable_threads: agg.actionable_threads, high_priority_threads: agg.high_priority_threads } : undefined);
            const accentColor = workItem ? getBadgeAccent(workItem as PlatformWorkItem) : getTierColor(c.max_priority_tier);
            const isActive = selectedPlatform === slug;
            const actionable = (workItem as { actionable_threads?: number })?.actionable_threads ?? 0;
            return (
              <TabsTrigger
                key={slug}
                value={slug}
                className={`flex items-center gap-2 px-3 py-2 border-l-2 ${isActive ? accentColor : 'border-l-transparent'}`}
              >
                {slug && slug !== 'all' ? <PlatformIcon platform={slug} size={14} /> : null}
                <span>{label}</span>
                {c.thread_count > 0 && (
                  <span className="text-xs text-slate-500">({c.thread_count})</span>
                )}
                {actionable > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold text-white bg-amber-500 rounded-full px-1">
                    {actionable > 99 ? '99+' : actionable}
                  </span>
                )}
                {c.unread_count > 0 && actionable === 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold text-white bg-blue-500 rounded-full px-1">
                    {c.unread_count > 99 ? '99+' : c.unread_count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {loading && <div className="h-1 bg-slate-100 rounded animate-pulse mt-2" />}
    </div>
  );
});
