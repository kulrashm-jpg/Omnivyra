/**
 * Engagement Work Queue Service
 * Daily work queue: actionable threads per platform.
 *
 * Actionable = ignored=false AND the latest authoritative turn is external.
 *
 * F1/F2: this service no longer resolves ownership itself. It consumes
 * `ThreadSummary.actionable` from `engagementThreadService.getThreads`, which is
 * the one place the canonical predicate (`isAuthorSelf` → author_id ↔
 * connected-account map → unresolved ⇒ external) is evaluated. Previously this
 * file carried its own copy of `getOrgAuthorIds` plus its own latest-message
 * fetch and its own self-detection, which is exactly how the two surfaces
 * drifted apart in the first place. One decision, three readers.
 */

import { getThreads } from './engagementThreadService';

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'reddit'];

export type PlatformWorkItem = {
  platform: string;
  actionable_threads: number;
  high_priority_threads: number;
  unread_messages: number;
};

export type DailyWorkQueue = {
  platforms: PlatformWorkItem[];
  total_actionable_threads: number;
};

/**
 * Thread is actionable if: ignored=false and the latest turn is external.
 */
export async function getDailyWorkQueue(organizationId: string): Promise<DailyWorkQueue> {
  const empty = (): DailyWorkQueue => ({
    platforms: PLATFORMS.map((p) => ({
      platform: p, actionable_threads: 0, high_priority_threads: 0, unread_messages: 0,
    })),
    total_actionable_threads: 0,
  });

  if (!organizationId) {
    return { platforms: [], total_actionable_threads: 0 };
  }

  let threads: Awaited<ReturnType<typeof getThreads>>;
  try {
    // Every non-ignored thread, across platforms. `actionable_only` is
    // deliberately NOT set: this is an aggregate, not a page, so the counters
    // need to see answered threads in order to exclude them explicitly rather
    // than by absence — and `high_priority_threads` keeps its existing
    // whole-population meaning.
    threads = await getThreads({
      organization_id: organizationId,
      platform: null,
      limit: 500,
      exclude_ignored: true,
    });
  } catch (error) {
    console.warn(
      '[engagementWorkQueueService] getDailyWorkQueue error',
      error instanceof Error ? error.message : String(error),
    );
    return empty();
  }

  if (threads.length === 0) return empty();

  const byPlatform = new Map<string, { actionable: number; highPri: number; unread: number }>();
  for (const p of PLATFORMS) byPlatform.set(p, { actionable: 0, highPri: 0, unread: 0 });

  let totalActionable = 0;

  for (const t of threads) {
    const platform = (t.platform || '').toLowerCase();
    if (!byPlatform.has(platform)) byPlatform.set(platform, { actionable: 0, highPri: 0, unread: 0 });
    const cur = byPlatform.get(platform)!;

    // Canonical state — no local re-derivation.
    const actionable = t.actionable;
    // getThreads already zeroes unread on an answered thread; the guard keeps
    // the two from ever drifting apart.
    cur.unread += actionable ? Number(t.unread_count ?? 0) || 0 : 0;

    const triagePri = Number(t.triage_priority ?? 0) || 0;
    const score = Number(t.priority_score ?? 0) || 0;
    if (triagePri >= 7 || score >= 50) cur.highPri += 1;

    if (actionable) {
      cur.actionable += 1;
      totalActionable += 1;
    }
  }

  const platforms: PlatformWorkItem[] = PLATFORMS.map((p) => {
    const c = byPlatform.get(p) ?? { actionable: 0, highPri: 0, unread: 0 };
    return {
      platform: p,
      actionable_threads: c.actionable,
      high_priority_threads: c.highPri,
      unread_messages: c.unread,
    };
  });

  return { platforms, total_actionable_threads: totalActionable };
}
